import { NextResponse } from "next/server";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError, bundleResponse } from "@/server/api";
import { retrieveBundle } from "@/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retrieve the complete published OKF bundle through OKF Anchor — never Kubo's
 * admin API directly (CLAUDE.md §3, plan §16). `?version=<n>` fetches a
 * specific immutable version; omitted, the current version is returned. The
 * CID always comes from the `AssetVersion` record, never a request parameter.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await authenticateServer(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    throw err;
  }
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
