import { NextResponse } from "next/server";
import { readRecentRuns } from "@okf-anchor/activity";
import { apiError } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated snapshot of the most recent mint/verify runs — the
 * seed for the `/chain` activity console and its polling fallback when the SSE
 * stream is unavailable. Only redacted, already-public pipeline metadata; never
 * a knowledge payload or a secret (CLAUDE.md §2, §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const rl = await rateLimit(`activityrecent:${ip}`, 120, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many requests", 429);

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "30");
  const runs = await readRecentRuns(Number.isFinite(limit) ? limit : 30);
  return NextResponse.json({ runs }, { headers: { "cache-control": "no-store" } });
}
