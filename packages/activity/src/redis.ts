/**
 * Lazy ioredis singleton, mirroring `apps/web/src/server/ratelimit.ts`: connects
 * on first use, never queues offline, and callers treat any failure as "activity
 * logging is best-effort" rather than an error that breaks a mint.
 */
import { Redis } from "ioredis";

/** The subset of ioredis the recorder / reader use — lets a test inject a fake. */
export interface ActivityRedisLike {
  status: string;
  connect(): Promise<unknown>;
  disconnect(): void;
  xadd(...args: (string | number)[]): Promise<string | null>;
  xrange(key: string, start: string, end: string, ...rest: (string | number)[]): Promise<[string, string[]][]>;
  xrevrange(key: string, start: string, end: string, ...rest: (string | number)[]): Promise<[string, string[]][]>;
  xread(...args: (string | number)[]): Promise<[string, [string, string[]][]][] | null>;
  expire(key: string, seconds: number): Promise<number>;
}

let client: ActivityRedisLike | undefined;
let overrides: { pooled?: ActivityRedisLike; blocking?: () => ActivityRedisLike } = {};

function makeReal(blocking: boolean): Redis {
  return new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
    maxRetriesPerRequest: blocking ? null : 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
}

export function activityRedis(): ActivityRedisLike {
  if (overrides.pooled) return overrides.pooled;
  client ??= makeReal(false) as unknown as ActivityRedisLike;
  return client;
}

/** A dedicated blocking connection for `XREAD BLOCK` (must not share the pooled client). */
export function newBlockingRedis(): ActivityRedisLike {
  if (overrides.blocking) return overrides.blocking();
  return makeReal(true) as unknown as ActivityRedisLike;
}

export async function ensureConnected(r: ActivityRedisLike): Promise<void> {
  if (r.status === "wait" || r.status === "end") await r.connect().catch(() => undefined);
}

/** Test seam — not exported from the package entrypoint. */
export function __setActivityRedisForTests(
  next: { pooled?: ActivityRedisLike; blocking?: () => ActivityRedisLike } | null,
): void {
  overrides = next ?? {};
  if (next?.pooled) client = undefined;
}
