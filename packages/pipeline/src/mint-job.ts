/**
 * MintJob state machine. The async worker calls `runMintJob`; the same code path
 * is reusable synchronously in tests and the demo script. Idempotent: a job
 * already in a terminal state is returned unchanged.
 */
import type { PrismaClient } from "@okf-anchor/db";
import type { Providers } from "@okf-anchor/providers";
import { OkfError } from "@okf-anchor/okf-core";
import { publishBundle, type PublishResult, type PublishStage } from "./publish.js";
import type { PipelineEventSink } from "./events.js";

const STAGE_TO_STATE: Record<PublishStage, string> = {
  VALIDATING: "VALIDATING",
  VALID: "VALID",
  CANONICALIZING: "CANONICALIZING",
  HASHING: "HASHING",
  GRAPHING: "GRAPHING",
  UPLOADING: "UPLOADING",
  SIGNING: "SIGNING",
  SUBMITTING: "SUBMITTING",
  CONFIRMING: "CONFIRMING",
};

export interface RunMintJobContext {
  readonly prisma: PrismaClient;
  readonly providers: Providers;
  readonly publicBaseUrl?: string | undefined;
  /** Optional structured event stream for the live activity console (best-effort). */
  readonly onEvent?: PipelineEventSink | undefined;
}

export interface RunMintJobResult {
  readonly jobId: string;
  readonly state: string;
  readonly publish?: PublishResult;
  readonly error?: string;
}

export async function runMintJob(jobId: string, ctx: RunMintJobContext): Promise<RunMintJobResult> {
  const job = await ctx.prisma.mintJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.state === "MINTED" || job.state === "INVALID" || job.state === "FAILED") {
    return job.error ? { jobId, state: job.state, error: job.error } : { jobId, state: job.state };
  }

  await ctx.prisma.mintJob.update({
    where: { id: jobId },
    data: { state: "VALIDATING", attempts: { increment: 1 } },
  });

  try {
    const archive = await ctx.providers.storage.get(job.sourceCid);
    const result = await publishBundle(
      {
        archive,
        buildServerId: job.buildServerId,
        publisherId: job.publisherId,
        assetSlug: job.assetSlug,
        name: job.assetSlug,
      },
      {
        prisma: ctx.prisma,
        providers: ctx.providers,
        publicBaseUrl: ctx.publicBaseUrl,
        onEvent: ctx.onEvent,
        onStage: async (stage) => {
          await ctx.prisma.mintJob.update({
            where: { id: jobId },
            data: { state: STAGE_TO_STATE[stage] as never },
          });
        },
      },
    );

    await ctx.prisma.mintJob.update({
      where: { id: jobId },
      data: { state: "MINTED", assetVersionId: result.assetVersionId, error: null },
    });
    return { jobId, state: "MINTED", publish: result };
  } catch (err) {
    const isValidation = err instanceof OkfError && err.code === "OKF_VALIDATION_FAILED";
    const message =
      err instanceof OkfError
        ? [err.message, ...err.details].join("; ")
        : err instanceof Error
          ? err.message
          : "unknown error";
    await ctx.prisma.mintJob.update({
      where: { id: jobId },
      data: { state: isValidation ? "INVALID" : "FAILED", error: message.slice(0, 2000) },
    });
    return { jobId, state: isValidation ? "INVALID" : "FAILED", error: message };
  }
}
