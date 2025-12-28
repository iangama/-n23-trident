import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import multer from "multer";
import pdf from "pdf-parse";
import client from "prom-client";
import { PrismaClient } from "@prisma/client";
import { auth } from "./auth.js";
import { verifyQueue } from "./queue.js";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// ---------- metrics ----------
client.collectDefaultMetrics();
const httpCounter = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests total",
  labelNames: ["method", "route", "status"]
});
app.use((req, res, next) => {
  res.on("finish", () => httpCounter.inc({ method: req.method, route: req.path, status: String(res.statusCode) }));
  next();
});
app.get("/metrics", async (_, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ---------- health ----------
app.get("/api/health", async (_, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

// ---------- auth ----------
app.post("/api/register", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const workspaceName = String(req.body?.workspaceName || "Default").trim() || "Default";
  if (!email || password.length < 4) return res.status(400).json({ error: "bad input" });

  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      memberships: { create: { workspace: { create: { name: workspaceName } } } }
    }
  });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  res.json({ token });
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  res.json({ token });
});

app.get("/api/me", auth, async (req, res) => {
  const userId = req.user.userId;
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true,
      memberships: { include: { workspace: true } }
    }
  });
  res.json(me);
});

// ---------- workspaces ----------
app.post("/api/workspaces", auth, async (req, res) => {
  const userId = req.user.userId;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const ws = await prisma.workspace.create({
    data: { name, users: { create: { userId } } }
  });
  res.json(ws);
});

app.get("/api/workspaces", auth, async (req, res) => {
  const userId = req.user.userId;
  const rows = await prisma.workspaceUser.findMany({
    where: { userId },
    include: { workspace: true }
  });
  res.json(rows.map(r => r.workspace));
});

// ---------- claims ----------
async function ensureMember(userId, workspaceId) {
  const m = await prisma.workspaceUser.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  return !!m;
}

app.get("/api/workspaces/:workspaceId/claims", auth, async (req, res) => {
  const userId = req.user.userId;
  const workspaceId = Number(req.params.workspaceId);
  if (!Number.isFinite(workspaceId)) return res.status(400).json({ error: "bad workspaceId" });
  if (!(await ensureMember(userId, workspaceId))) return res.status(403).json({ error: "not member" });

  const claims = await prisma.claim.findMany({
    where: { workspaceId },
    orderBy: { id: "desc" },
    include: { evidences: { orderBy: { id: "desc" } } }
  });
  res.json(claims);
});

app.post("/api/workspaces/:workspaceId/claims", auth, async (req, res) => {
  const userId = req.user.userId;
  const workspaceId = Number(req.params.workspaceId);
  const text = String(req.body?.text || "").trim();
  if (!Number.isFinite(workspaceId)) return res.status(400).json({ error: "bad workspaceId" });
  if (!text) return res.status(400).json({ error: "text required" });
  if (!(await ensureMember(userId, workspaceId))) return res.status(403).json({ error: "not member" });

  const claim = await prisma.claim.create({ data: { workspaceId, text } });
  res.json(claim);
});

// ---------- evidence (text) ----------
app.post("/api/claims/:claimId/evidence", auth, async (req, res) => {
  const userId = req.user.userId;
  const claimId = Number(req.params.claimId);
  if (!Number.isFinite(claimId)) return res.status(400).json({ error: "bad claimId" });

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) return res.status(404).json({ error: "claim not found" });
  if (!(await ensureMember(userId, claim.workspaceId))) return res.status(403).json({ error: "not member" });

  const source = String(req.body?.source || "").trim();
  const excerpt = String(req.body?.excerpt || "").trim();
  if (!source || !excerpt) return res.status(400).json({ error: "source+excerpt required" });

  const ev = await prisma.evidence.create({
    data: { claimId, source, excerpt, status: "PENDING", reason: "" }
  });

  await verifyQueue.add("verify", { evidenceId: ev.id }, { removeOnComplete: 50, removeOnFail: 50 });
  res.json(ev);
});

// ---------- evidence (pdf upload) ----------
const uploadDir = "/app/uploads";
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname.replaceAll(" ", "_"))
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

app.post("/api/claims/:claimId/evidence/pdf", auth, upload.single("file"), async (req, res) => {
  const userId = req.user.userId;
  const claimId = Number(req.params.claimId);
  if (!Number.isFinite(claimId)) return res.status(400).json({ error: "bad claimId" });

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) return res.status(404).json({ error: "claim not found" });
  if (!(await ensureMember(userId, claim.workspaceId))) return res.status(403).json({ error: "not member" });

  const filePath = req.file?.path;
  if (!filePath) return res.status(400).json({ error: "file required" });

  const buff = fs.readFileSync(filePath);
  const parsed = await pdf(buff);
  const text = (parsed.text || "").replace(/\s+/g, " ").trim();
  const excerpt = text.slice(0, 700) || "(pdf sem texto extraível)";

  const ev = await prisma.evidence.create({
    data: {
      claimId,
      source: req.file.originalname,
      excerpt,
      filePath: path.basename(filePath),
      status: "PENDING",
      reason: ""
    }
  });

  await verifyQueue.add("verify", { evidenceId: ev.id }, { removeOnComplete: 50, removeOnFail: 50 });
  res.json(ev);
});

// ---------- verify manual ----------
app.post("/api/evidence/:evidenceId/verify", auth, async (req, res) => {
  const userId = req.user.userId;
  const evidenceId = Number(req.params.evidenceId);
  if (!Number.isFinite(evidenceId)) return res.status(400).json({ error: "bad evidenceId" });

  const ev = await prisma.evidence.findUnique({ where: { id: evidenceId }, include: { claim: true } });
  if (!ev) return res.status(404).json({ error: "not found" });
  if (!(await ensureMember(userId, ev.claim.workspaceId))) return res.status(403).json({ error: "not member" });

  await verifyQueue.add("verify", { evidenceId }, { removeOnComplete: 50, removeOnFail: 50 });
  res.json({ ok: true });
});

app.delete("/api/evidence/:evidenceId", auth, async (req, res) => {
  const userId = req.user.userId;
  const evidenceId = Number(req.params.evidenceId);
  if (!Number.isFinite(evidenceId)) return res.status(400).json({ error: "bad evidenceId" });

  const ev = await prisma.evidence.findUnique({ where: { id: evidenceId }, include: { claim: true } });
  if (!ev) return res.status(404).json({ error: "not found" });
  if (!(await ensureMember(userId, ev.claim.workspaceId))) return res.status(403).json({ error: "not member" });

  await prisma.evidence.delete({ where: { id: evidenceId } });
  res.json({ ok: true });
});

// ---------- seed inside image ----------
app.post("/api/dev/seed", async (_, res) => {
  // endpoint opcional p/ resetar demo sem entrar no container
  try {
    const out = await import("../scripts/seed.mjs");
    const result = await out.seed();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "seed failed" });
  }
});

app.listen(3000, "0.0.0.0", () => console.log("api on 3000"));
