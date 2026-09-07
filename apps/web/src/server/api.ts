/**
 * Shared API helpers: typed error envelope (never leak internals — CLAUDE.md §9),
 * body-size guard, and JSON responses.
 */
import { NextResponse } from "next/server";
import { OkfError } from "@okf-anchor/okf-core";
import { createLogger } from "@okf-anchor/logger";
import type { RetrievedBundle } from "./assets";

const log = createLogger("api");

export interface ApiErrorBody {
  error: { code: string; message: string; details?: string[] };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: string[],
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: details && details.length ? { code, message, details } : { code, message } },
    { status },
  );
}

export function fromOkfError(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof OkfError) {
    const status = err.code === "OKF_VALIDATION_FAILED" ? 422 : 400;
    return apiError(err.code, err.message, status, [...err.details]);
  }
  if (err instanceof Error && /not_?found|no record/i.test(err.message)) {
    return apiError("NOT_FOUND", "resource not found", 404);
  }
  log.error("unhandled error", { err });
  return apiError("INTERNAL", "an unexpected error occurred", 500);
}

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export async function readArchive(req: Request): Promise<{ bytes: Uint8Array; filename?: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("bundle");
    if (!(file instanceof File)) {
      throw new OkfError("OKF_VALIDATION_FAILED", "multipart body must include a 'bundle' file part");
    }
    if (file.size > MAX_ARCHIVE_BYTES) {
      throw new OkfError("OKF_BUNDLE_TOO_LARGE", `archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
    }
    return { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name };
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new OkfError("OKF_VALIDATION_FAILED", "request body is empty");
  }
  if (buf.byteLength > MAX_ARCHIVE_BYTES) {
    throw new OkfError("OKF_BUNDLE_TOO_LARGE", `archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }
  const filename = req.headers.get("x-okf-filename") ?? undefined;
  return filename ? { bytes: buf, filename } : { bytes: buf };
}

/** Serve a bundle retrieved through OKF Anchor (never a raw storage-provider URL). */
export function bundleResponse(bundle: RetrievedBundle): NextResponse {
  return new NextResponse(Buffer.from(bundle.bytes), {
    status: 200,
    headers: {
      "content-type": bundle.mediaType,
      "content-disposition": `attachment; filename="${bundle.filename.replace(/["\\]/g, "_")}"`,
      "content-length": String(bundle.bytes.byteLength),
      "x-okf-cid": bundle.cid,
      "x-okf-storage-provider": bundle.storageProvider,
      "x-okf-version-number": String(bundle.versionNumber),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
