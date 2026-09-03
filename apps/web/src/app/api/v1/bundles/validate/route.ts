import { NextResponse } from "next/server";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError, fromOkfError, readArchive } from "@/server/api";
import { extractArchive, detectMediaType } from "@okf-anchor/pipeline";
import { processBundle } from "@okf-anchor/okf-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate + hash a bundle without persisting or anchoring anything. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { bytes, filename } = await readArchive(req.clone());
    await authenticateServer(req, bytes);

    const entries = extractArchive(bytes, detectMediaType(filename, bytes));
    const processed = await processBundle(entries, { requireConformant: false });

    return NextResponse.json({
      conformant: processed.validation.conformant,
      okfVersion: processed.validation.okfVersion,
      errors: processed.validation.errors,
      info: processed.validation.info,
      stats: processed.validation.stats,
      concepts: processed.validation.concepts,
      hashes: {
        canonicalHash: processed.canonical.canonicalHash,
        merkleRoot: processed.canonical.merkleRoot,
        graphHash: processed.graph.graphHash,
        manifestHash: processed.manifest.manifestHash,
      },
      manifest: processed.manifest.manifest,
    });
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    return fromOkfError(err);
  }
}
