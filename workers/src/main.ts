/**
 * The mint worker. Consumes `okf:mint` jobs and runs the full publish pipeline
 * (validate → canonicalize → hash → graph → store → sign → anchor → persist) off
 * the HTTP path. Idempotent and retried by BullMQ.
 */
import { prisma } from "@okf-anchor/db";
import { createProviders } from "@okf-anchor/providers";
import { runMintJob } from "@okf-anchor/pipeline";
import { createMintWorker } from "@okf-anchor/queue";

const providers = createProviders();
const publicBaseUrl = process.env["OKF_PUBLIC_BASE_URL"];

const worker = createMintWorker(async (job) => {
  const { mintJobId } = job.data;
  console.warn(`[mint] start job=${mintJobId}`);
  const result = await runMintJob(mintJobId, { prisma, providers, publicBaseUrl });
  console.warn(`[mint] done job=${mintJobId} state=${result.state}`);
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
  console.error(`[mint] job ${job?.id} failed: ${err.message}`);
});

console.warn("okf mint worker ready");

async function shutdown(): Promise<void> {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
