import { NextResponse } from "next/server";
import { prisma } from "@/server/providers";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError } from "@/server/api";
import { assetSummary } from "@/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  let auth;
  try {
    auth = await authenticateServer(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    throw err;
  }
  const { id } = await ctx.params;
  const job = await prisma.mintJob.findUnique({ where: { id } });
  if (!job) return apiError("NOT_FOUND", "mint job not found", 404);
  if (job.publisherId !== auth.publisherId) return apiError("FORBIDDEN", "not your job", 403);

  const asset =
    job.state === "MINTED" && job.assetVersionId
      ? await prisma.assetVersion
          .findUnique({ where: { id: job.assetVersionId }, select: { assetId: true } })
          .then((v) => (v ? assetSummary(v.assetId) : null))
      : null;

  return NextResponse.json({
    jobId: job.id,
    state: job.state,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    asset,
  });
}
