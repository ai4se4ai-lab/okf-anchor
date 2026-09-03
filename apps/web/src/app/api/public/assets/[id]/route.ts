import { NextResponse } from "next/server";
import { apiError } from "@/server/api";
import { assetSummary } from "@/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated read of a published asset (plan §41). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const summary = await assetSummary(id);
  if (!summary) return apiError("NOT_FOUND", "asset not found", 404);
  return NextResponse.json(summary, { headers: { "cache-control": "public, max-age=30" } });
}
