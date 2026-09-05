import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, providers, activity } from "@/server/providers";
import { apiError, fromOkfError } from "@/server/api";
import { verifyStoredVersion } from "@okf-anchor/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public independent verification — re-derives every hash from stored content. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const runId = randomUUID();
  try {
    await activity.start({ runId, kind: "verify", note: `verify ${id}` });
    const report = await verifyStoredVersion(
      { assetId: id },
      { prisma, providers, requestedBy: "public", runId, onEvent: activity.onEvent(runId) },
    );
    await activity.finish(runId, {
      state: report.passed ? "done" : "error",
      assetId: report.assetId,
      versionNumber: report.versionNumber,
    });
    return NextResponse.json(report);
  } catch (err) {
    await activity.finish(runId, { state: "error", note: (err as Error).message });
    if (err instanceof Error && /no record|not found/i.test(err.message)) {
      return apiError("NOT_FOUND", "asset not found", 404);
    }
    return fromOkfError(err);
  }
}
