/**
 * `@okf-anchor/db` — the Prisma client for the OKF Anchor metadata store, plus a
 * process-wide singleton. Import the client type and enums from here; never
 * reach into `src/generated` directly.
 */
import { PrismaClient } from "./generated/client/index.js";

export * from "./generated/client/index.js";
export { PrismaClient, Prisma } from "./generated/client/index.js";

declare global {
  var __okfPrisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  return new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Reuse one client across hot reloads in dev and across a serverless function's
 * warm invocations. In production each process gets its own.
 */
export const prisma: PrismaClient = globalThis.__okfPrisma ?? create();

if (process.env["NODE_ENV"] !== "production") {
  globalThis.__okfPrisma = prisma;
}
