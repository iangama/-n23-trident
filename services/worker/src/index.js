import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import client from "prom-client";

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// metrics
client.collectDefaultMetrics();
const jobs = new client.Counter({ name: "worker_jobs_total", help: "jobs processed", labelNames: ["result"] });

import http from "http";
const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
server.listen(3001, "0.0.0.0", () => console.log("worker metrics on 3001"));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function scoreEvidence({ source, excerpt }) {
  const s = (source + " " + excerpt).toLowerCase();
  let score = 0;
  if (s.includes("doi") || s.includes("journal") || s.includes("paper")) score += 4;
  if (s.includes("livro") || s.includes("book")) score += 3;
  if (s.includes("wikipedia")) score -= 2;
  if (excerpt.length > 250) score += 2;
  if (excerpt.length < 40) score -= 2;
  return Math.max(-5, Math.min(10, score));
}

new Worker("verify-evidence", async (job) => {
  const evidenceId = Number(job.data?.evidenceId);
  if (!Number.isFinite(evidenceId)) throw new Error("bad evidenceId");

  const ev = await prisma.evidence.findUnique({ where: { id: evidenceId } });
  if (!ev) return;

  await prisma.evidence.update({ where: { id: evidenceId }, data: { status: "RUNNING", reason: "" } });
  await sleep(900);

  const score = scoreEvidence(ev);
  const verified = score >= 2;

  await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      score,
      status: verified ? "VERIFIED" : "REJECTED",
      reason: verified ? "consistência ok" : "fraco/ambíguo"
    }
  });

  jobs.inc({ result: verified ? "verified" : "rejected" });
}, { connection });

console.log("worker consuming verify-evidence");
