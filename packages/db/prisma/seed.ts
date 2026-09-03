/**
 * Non-secret development fixtures only (skill: okf-prisma-postgres). No real
 * keys, tokens, or knowledge payloads. The dev API token below is a well-known
 * placeholder for local use and is safe to commit.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "../src/generated/client/index.js";

const prisma = new PrismaClient();

/** Well-known local dev token. Never use outside `docker compose up`. */
const DEV_TOKEN = "okf_dev_local_0000000000000000000000000000";

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: { slug: "demo", name: "Demo Organization" },
  });

  await prisma.user.upsert({
    where: { email: "admin@demo.local" },
    update: {},
    create: {
      email: "admin@demo.local",
      name: "Demo Admin",
      role: "ADMIN",
      organizationId: org.id,
    },
  });

  const server = await prisma.buildServer.upsert({
    where: { publisherId: "build-server:demo-01" },
    update: {},
    create: {
      name: "demo-build-01",
      publisherId: "build-server:demo-01",
      environment: "DEVELOPMENT",
      organizationId: org.id,
    },
  });

  const tokenHash = createHash("sha256").update(DEV_TOKEN).digest("hex");
  await prisma.apiCredential.upsert({
    where: { tokenPrefix: DEV_TOKEN.slice(0, 12) },
    update: {},
    create: {
      buildServerId: server.id,
      tokenPrefix: DEV_TOKEN.slice(0, 12),
      tokenHash,
      label: "local dev",
    },
  });

  console.warn(`seeded org=${org.slug} server=${server.publisherId} devToken=${DEV_TOKEN}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
