import { NextResponse } from "next/server";
import { prisma, providers } from "@/server/providers";
import { apiError, fromOkfError } from "@/server/api";
import { verifyStoredVersion } from "@okf-anchor/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public independent verification — re-derives every hash from stored content. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const report = await verifyStoredVersion({ assetId: id }, { prisma, providers, requestedBy: "public" });
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof Error && /no record|not found/i.test(err.message)) {
      return apiError("NOT_FOUND", "asset not found", 404);
    }
    return fromOkfError(err);
  }
}
