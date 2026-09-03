import { NextResponse } from "next/server";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError } from "@/server/api";
import { assetSummary } from "@/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await authenticateServer(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    throw err;
  }
  const { id } = await ctx.params;
  const summary = await assetSummary(id);
  if (!summary) return apiError("NOT_FOUND", "asset not found", 404);
  return NextResponse.json(summary);
}
