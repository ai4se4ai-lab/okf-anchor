import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, providers, activity } from "@/server/providers";
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
  const runId = randomUUID();
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const assetId = String(form.get("assetId") ?? "");
      const file = form.get("bundle");
      if (!assetId || !(file instanceof File)) {
        return apiError("OKF_VALIDATION_FAILED", "multipart body needs 'assetId' and a 'bundle' file", 422);
      }
      await activity.start({ runId, kind: "verify", note: `tamper-check ${assetId}` });
      const report = await verifyAgainstUpload(
        assetId,
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        { prisma, providers, requestedBy: auth.publisherId, runId, onEvent: activity.onEvent(runId) },
      );
      await activity.finish(runId, {
        state: report.passed ? "done" : "error",
        assetId: report.assetId,
        versionNumber: report.versionNumber,
      });
      return NextResponse.json(report);
    }

    const body = (await req.json()) as { assetId?: string; assetVersionId?: string };
    if (!body.assetId && !body.assetVersionId) {
      return apiError("OKF_VALIDATION_FAILED", "provide assetId or assetVersionId", 422);
    }
    await activity.start({ runId, kind: "verify", note: `verify ${body.assetId ?? body.assetVersionId}` });
    const report = await verifyStoredVersion(
      body.assetVersionId ? { assetVersionId: body.assetVersionId } : { assetId: body.assetId },
      { prisma, providers, requestedBy: auth.publisherId, runId, onEvent: activity.onEvent(runId) },
    );
    await activity.finish(runId, {
      state: report.passed ? "done" : "error",
      assetId: report.assetId,
      versionNumber: report.versionNumber,
    });
    return NextResponse.json(report);
  } catch (err) {
    await activity.finish(runId, { state: "error", note: (err as Error).message });
    return fromOkfError(err);
  }
}
