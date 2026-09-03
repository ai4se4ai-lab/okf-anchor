import { NextResponse } from "next/server";
import { prisma, providers, publicBaseUrl } from "@/server/providers";
import { authenticateServer, AuthError, recordAudit } from "@/server/auth";
import { apiError, fromOkfError, readArchive } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";
import { enqueueMint } from "@okf-anchor/queue";
import { runMintJob } from "@okf-anchor/pipeline";

/** Dev/CI convenience: run the pipeline inline so no separate worker is needed. */
const INLINE_MINT = process.env.OKF_INLINE_MINT === "1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept an OKF bundle archive and enqueue a mint. Returns 202 with a job id —
 * anchoring never blocks the request (plan §5, §27). Idempotent on
 * `Idempotency-Key`: a retry returns the original job.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let auth;
  let bytes: Uint8Array;
  let filename: string | undefined;
  try {
    const archive = await readArchive(req.clone());
    bytes = archive.bytes;
    filename = archive.filename;
    auth = await authenticateServer(req, bytes);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    return fromOkfError(err);
  }

  const rl = await rateLimit(`mint:${auth.publisherId}`, 20, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many mint requests; slow down", 429);

  const url = new URL(req.url);
  const assetSlug =
    req.headers.get("x-okf-asset-slug") ??
    url.searchParams.get("slug") ??
    (filename ? filename.replace(/\.(zip|tgz|tar\.gz)$/i, "") : "bundle");
  const name = req.headers.get("x-okf-asset-name") ?? assetSlug;
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;

  try {
    if (idempotencyKey) {
      const existing = await prisma.mintJob.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return NextResponse.json(
          { jobId: existing.id, state: existing.state, statusUrl: `/api/v1/mint-jobs/${existing.id}`, idempotent: true },
          { status: 200 },
        );
      }
    }

    const sourceCid = await providers.storage.put(bytes);
    await providers.storage.pin(sourceCid);

    const job = await prisma.mintJob.create({
      data: {
        buildServerId: auth.buildServerId,
        publisherId: auth.publisherId,
        assetSlug,
        idempotencyKey: idempotencyKey ?? null,
        sourceCid,
        state: "RECEIVED",
      },
    });

    if (INLINE_MINT) {
      await runMintJob(job.id, { prisma, providers, publicBaseUrl });
    } else {
      await enqueueMint(job.id).catch(async (err) => {
        // Redis down: fail the job loudly rather than leaving it stuck.
        await prisma.mintJob.update({
          where: { id: job.id },
          data: { state: "FAILED", error: `could not enqueue: ${(err as Error).message}` },
        });
      });
    }

    const finalJob = INLINE_MINT
      ? await prisma.mintJob.findUniqueOrThrow({ where: { id: job.id } })
      : job;

    await recordAudit({
      actorType: "BUILD_SERVER",
      actorId: auth.publisherId,
      action: "bundle.submitted",
      subjectType: "MintJob",
      subjectId: job.id,
      ip: req.headers.get("x-forwarded-for"),
      metadata: { assetSlug, bytes: bytes.byteLength, name },
    });

    return NextResponse.json(
      {
        jobId: job.id,
        state: finalJob.state,
        statusUrl: `/api/v1/mint-jobs/${job.id}`,
        verificationBaseUrl: `${publicBaseUrl.replace(/\/$/, "")}/verify`,
      },
      { status: finalJob.state === "MINTED" ? 201 : 202 },
    );
  } catch (err) {
    return fromOkfError(err);
  }
}
