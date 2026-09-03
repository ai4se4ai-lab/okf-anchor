import { NextResponse } from "next/server";
import { providers } from "@/server/providers";
import { authenticateServer, AuthError } from "@/server/auth";
import { apiError } from "@/server/api";
import { SparqlRejected } from "@okf-anchor/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await authenticateServer(req.clone());
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHORIZED", err.message, err.status);
    throw err;
  }

  const body = (await req.json().catch(() => ({}))) as {
    sparql?: string;
    query?: string;
    assetVersionId?: string;
    maxResults?: number;
  };
  const sparql = body.sparql ?? body.query;
  if (!sparql) return apiError("OKF_VALIDATION_FAILED", "missing 'sparql'", 422);

  try {
    const started = Date.now();
    const result = await providers.graph.query(sparql, {
      assetVersionId: body.assetVersionId,
      maxResults: Math.min(body.maxResults ?? 1000, 5000),
    });
    return NextResponse.json({ ...result, elapsedMs: Date.now() - started });
  } catch (err) {
    if (err instanceof SparqlRejected) return apiError("SPARQL_REJECTED", err.message, 400);
    return apiError("QUERY_FAILED", (err as Error).message, 400);
  }
}
