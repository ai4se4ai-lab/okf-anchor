import { NextResponse } from "next/server";
import { apiError, bundleResponse } from "@/server/api";
import { retrieveBundle } from "@/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated bundle retrieval (plan §16). Same trust rule as the
 * authenticated route: the CID comes from the `AssetVersion` record only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const versionParam = new URL(req.url).searchParams.get("version");
  const versionNumber = versionParam ? Number(versionParam) : undefined;
  if (versionParam !== null && (!Number.isInteger(versionNumber) || (versionNumber ?? 0) < 1)) {
    return apiError("VALIDATION_FAILED", "version must be a positive integer", 422);
  }

  try {
    const bundle = await retrieveBundle(id, versionNumber);
    if (!bundle) return apiError("NOT_FOUND", "asset, version, or stored bundle not found", 404);
    return bundleResponse(bundle);
  } catch (err) {
    console.error("[api] bundle retrieval failed", err);
    return apiError("STORAGE_UNAVAILABLE", "the storage backend is unavailable", 503);
  }
}
