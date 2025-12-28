import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function seed() {
  const email = "demo@n23t.com";
  const password = "demo1234";

  // limpa
  await prisma.evidence.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.workspaceUser.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      memberships: { create: { workspace: { create: { name: "Demo Workspace" } } } }
    },
    include: { memberships: { include: { workspace: true } } }
  });

  const wsId = user.memberships[0].workspace.id;

  const c1 = await prisma.claim.create({ data: { workspaceId: wsId, text: "Centralização cria ponto único de falha" } });
  const c2 = await prisma.claim.create({ data: { workspaceId: wsId, text: "Preços agregam informação dispersa" } });

  await prisma.evidence.createMany({
    data: [
      { claimId: c1.id, source: "Livro / Sistemas", excerpt: "SPOF aumenta risco; redundância reduz falhas.", status: "PENDING", reason: "" },
      { claimId: c2.id, source: "Economia / Hayek", excerpt: "O sistema de preços coordena conhecimento disperso.", status: "PENDING", reason: "" }
    ]
  });

  return { ok: true, email, password, workspaceId: wsId };
}

// permite rodar direto: node scripts/seed.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then((x) => { console.log(x); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
