import { NextResponse } from "next/server";
import { providers } from "@/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cheap reachability check (plan §18) — never a content fetch. Unauthenticated,
 * like `/api/v1/health`: it reveals nothing beyond which storage backend is
 * configured and whether it currently answers. */
export async function GET(): Promise<NextResponse> {
  const health = (await providers.storage.health?.()) ?? { healthy: true, latencyMs: 0 };
  return NextResponse.json({
    provider: providers.storage.kind,
    healthy: health.healthy,
    latencyMs: health.latencyMs,
    ...(health.error ? { error: health.error } : {}),
  });
}
