import { NextResponse } from "next/server";
import { isValidRunId, readRun } from "@okf-anchor/activity";
import { apiError } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full (or incremental, via `?after=<streamId>`) event log for one activity run,
 * for the console's expandable detail view. `runId` is validated before it
 * touches a Redis key (CLAUDE.md §3).
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const rl = await rateLimit(`activityrun:${ip}`, 120, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many requests", 429);

  const { runId } = await ctx.params;
  if (!isValidRunId(runId)) return apiError("OKF_VALIDATION_FAILED", "invalid runId", 400);

  const after = new URL(req.url).searchParams.get("after") ?? "-";
  const safeAfter = /^[0-9]+-[0-9]+$/.test(after) ? after : "-";
  const log = await readRun(runId, safeAfter);
  return NextResponse.json(log, { headers: { "cache-control": "no-store" } });
}
