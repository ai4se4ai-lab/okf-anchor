/**
 * The mint worker. Consumes `okf:mint` jobs and runs the full publish pipeline
 * (validate → canonicalize → hash → graph → store → sign → anchor → persist) off
 * the HTTP path. Idempotent and retried by BullMQ.
 */
import { prisma } from "@okf-anchor/db";
import { createProviders } from "@okf-anchor/providers";
import { runMintJob } from "@okf-anchor/pipeline";
import { createMintWorker } from "@okf-anchor/queue";
import { createLogger } from "@okf-anchor/logger";

const log = createLogger("worker");
const providers = createProviders();
const publicBaseUrl = process.env["OKF_PUBLIC_BASE_URL"];

const worker = createMintWorker(async (job) => {
  const { mintJobId } = job.data;
  const jobLog = log.child({ mintJobId });
  jobLog.info("mint job started");
  const result = await runMintJob(mintJobId, { prisma, providers, publicBaseUrl });
  jobLog.info("mint job finished", { state: result.state });
  if (result.state === "FAILED") {
    throw new Error(result.error ?? "mint failed");
  }
  return {
    state: result.state,
    ...(result.publish
      ? { assetId: result.publish.assetId, assetVersionId: result.publish.assetVersionId }
      : {}),
    ...(result.error ? { error: result.error } : {}),
  };
});

worker.on("failed", (job, err) => {
  log.error("mint job failed", { mintJobId: job?.id, err });
});

log.info("worker ready", { queue: "okf:mint" });

async function shutdown(): Promise<void> {
  log.info("shutting down");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
