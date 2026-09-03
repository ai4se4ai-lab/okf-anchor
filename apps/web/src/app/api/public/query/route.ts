import { NextResponse } from "next/server";
import { providers } from "@/server/providers";
import { apiError } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";
import { SparqlRejected } from "@okf-anchor/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public read-only SPARQL. Rate-limited; the guard rejects any write form. */
export async function POST(req: Request): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const rl = await rateLimit(`pubquery:${ip}`, 30, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many queries", 429);

  const body = (await req.json().catch(() => ({}))) as {
    sparql?: string;
    query?: string;
    assetVersionId?: string;
  };
  const sparql = body.sparql ?? body.query;
  if (!sparql) return apiError("OKF_VALIDATION_FAILED", "missing 'sparql'", 422);

  try {
    const started = Date.now();
    const result = await providers.graph.query(sparql, {
      assetVersionId: body.assetVersionId,
      maxResults: 500,
    });
    return NextResponse.json({ ...result, elapsedMs: Date.now() - started });
  } catch (err) {
    if (err instanceof SparqlRejected) return apiError("SPARQL_REJECTED", err.message, 400);
    return apiError("QUERY_FAILED", (err as Error).message, 400);
  }
}
