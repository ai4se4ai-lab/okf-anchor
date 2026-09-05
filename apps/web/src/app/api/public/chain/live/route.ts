import { NextResponse } from "next/server";
import { EvmAnchorProvider, MAX_LIVE_ANCHORS, MAX_LIVE_BLOCKS } from "@okf-anchor/providers";
import { providers, ipfsGatewayUrl } from "@/server/providers";
import { apiError } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampParam(raw: string | null, fallback: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

/**
 * Public, unauthenticated, read-only live-chain feed for the explorer UI
 * (blocks + decoded `Anchored` events). Only ever reads public chain state —
 * never a knowledge-graph payload — and only when `ANCHOR_PROVIDER=evm`; every
 * other provider reports itself as unavailable rather than erroring, so the UI
 * degrades gracefully in the default offline setup.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const rl = await rateLimit(`chainlive:${ip}`, 60, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many requests", 429);

  if (!(providers.anchor instanceof EvmAnchorProvider)) {
    return NextResponse.json(
      { available: false, provider: providers.anchor.kind, network: providers.anchor.network },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(req.url);
  const blockCount = clampParam(url.searchParams.get("blocks"), 20, MAX_LIVE_BLOCKS);
  const anchorCount = clampParam(url.searchParams.get("anchors"), 15, MAX_LIVE_ANCHORS);

  try {
    const snapshot = await providers.anchor.getLiveSnapshot({ blockCount, anchorCount });
    return NextResponse.json(
      { available: true, ipfsGatewayUrl, ...snapshot },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return apiError("CHAIN_UNREACHABLE", (err as Error).message, 502);
  }
}
