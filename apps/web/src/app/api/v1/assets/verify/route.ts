import { NextResponse } from "next/server";
import { prisma, providers } from "@/server/providers";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError, fromOkfError } from "@/server/api";
import { verifyAgainstUpload, verifyStoredVersion } from "@okf-anchor/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify an asset. Either:
 *  - JSON `{ "assetId": "..." }` — re-derive from stored canonical content, or
 *  - multipart with `assetId` + `bundle` file — compare an uploaded bundle to
 *    what was anchored (tamper detection).
 */
export async function POST(req: Request): Promise<NextResponse> {
  let auth;
  try {
    auth = await authenticateServer(req.clone());
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    throw err;
  }

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const assetId = String(form.get("assetId") ?? "");
      const file = form.get("bundle");
      if (!assetId || !(file instanceof File)) {
        return apiError("OKF_VALIDATION_FAILED", "multipart body needs 'assetId' and a 'bundle' file", 422);
      }
      const report = await verifyAgainstUpload(
        assetId,
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        { prisma, providers, requestedBy: auth.publisherId },
      );
      return NextResponse.json(report);
    }

    const body = (await req.json()) as { assetId?: string; assetVersionId?: string };
    if (!body.assetId && !body.assetVersionId) {
      return apiError("OKF_VALIDATION_FAILED", "provide assetId or assetVersionId", 422);
    }
    const report = await verifyStoredVersion(
      body.assetVersionId ? { assetVersionId: body.assetVersionId } : { assetId: body.assetId },
      { prisma, providers, requestedBy: auth.publisherId },
    );
    return NextResponse.json(report);
  } catch (err) {
    return fromOkfError(err);
  }
}
