/**
 * Fixed-window rate limiting in Redis. Applied hardest to `POST /bundles`
 * because every mint costs a chain transaction (plan §68). Fails open if Redis
 * is unreachable — availability over strictness in dev.
 */
import "server-only";
import Redis from "ioredis";

let client: Redis | undefined;
function redis(): Redis {
  client ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  return client;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  try {
    const r = redis();
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => undefined);
    const bucket = `okf:rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const count = await r.incr(bucket);
    if (count === 1) await r.expire(bucket, windowSeconds);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), resetSeconds: windowSeconds };
  } catch {
    return { ok: true, remaining: limit, resetSeconds: windowSeconds };
  }
}
