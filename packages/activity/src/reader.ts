/**
 * The read side of the activity stream, used by the public `/api/public/activity`
 * routes: a bounded "recent runs" snapshot, the full per-run event log, and a
 * blocking tail of the index stream for the SSE endpoint. All read-only; every
 * `runId` is validated before it touches a Redis key (CLAUDE.md §3).
 */
import { createLogger } from "@okf-anchor/logger";
import {
  INDEX_STREAM_KEY,
  isValidRunId,
  runStreamKey,
  type ActivityEvent,
  type ActivityRunSummary,
} from "./event.js";
import { activityRedis, ensureConnected, newBlockingRedis } from "./redis.js";

const log = createLogger("activity");

type RawStreamEntry = [id: string, fields: string[]];
type RawStreamRead = Array<[key: string, entries: RawStreamEntry[]]> | null;

function fieldValue(fields: string[], name: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) return fields[i + 1];
  }
  return undefined;
}

function parseSummary(fields: string[]): ActivityRunSummary | null {
  const raw = fieldValue(fields, "s");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActivityRunSummary;
  } catch {
    return null;
  }
}

/**
 * Newest-first list of the most recent distinct runs. The index stream holds
 * several rows per run (start / phase changes / finish); we collapse to the
 * latest row per `runId`.
 */
export async function readRecentRuns(limit = 30): Promise<ActivityRunSummary[]> {
  const capped = Math.min(Math.max(Math.floor(limit) || 1, 1), 100);
  try {
    const r = activityRedis();
    await ensureConnected(r);
    const rows = (await r.xrevrange(INDEX_STREAM_KEY, "+", "-", "COUNT", capped * 8)) as RawStreamEntry[];
    const seen = new Map<string, ActivityRunSummary>();
    for (const [, fields] of rows) {
      const summary = parseSummary(fields);
      if (!summary || seen.has(summary.runId)) continue;
      seen.set(summary.runId, summary);
      if (seen.size >= capped) break;
    }
    return [...seen.values()];
  } catch (err) {
    log.warn("readRecentRuns failed", { err: (err as Error).message });
    return [];
  }
}

export interface RunLog {
  readonly runId: string;
  readonly events: ActivityEvent[];
  readonly lastId: string;
}

/** Full (or incremental, via `fromId`) event log for one run. */
export async function readRun(runId: string, fromId = "-"): Promise<RunLog> {
  if (!isValidRunId(runId)) throw new Error("invalid runId");
  const start = fromId === "-" ? "-" : `(${fromId}`;
  try {
    const r = activityRedis();
    await ensureConnected(r);
    const rows = (await r.xrange(runStreamKey(runId), start, "+")) as RawStreamEntry[];
    const events: ActivityEvent[] = [];
    let lastId = fromId;
    for (const [id, fields] of rows) {
      lastId = id;
      const raw = fieldValue(fields, "e");
      if (!raw) continue;
      try {
        events.push(JSON.parse(raw) as ActivityEvent);
      } catch {
        /* skip a corrupt row rather than fail the whole log */
      }
    }
    return { runId, events, lastId };
  } catch (err) {
    log.warn("readRun failed", { runId, err: (err as Error).message });
    return { runId, events: [], lastId: fromId };
  }
}

export interface IndexTailItem {
  readonly id: string;
  readonly summary: ActivityRunSummary;
}

export interface StreamIndexOptions {
  readonly signal: AbortSignal;
  /** Resume point; `$` (default) means "only rows added after we connect". */
  readonly lastId?: string;
  readonly blockMs?: number;
}

/**
 * Blocking tail of the global index stream for the SSE route. Yields each new
 * summary row as it lands; returns when `signal` aborts.
 */
export async function* streamIndex(opts: StreamIndexOptions): AsyncGenerator<IndexTailItem> {
  const conn = newBlockingRedis();
  let cursor = opts.lastId && opts.lastId.length > 0 ? opts.lastId : "$";
  const blockMs = opts.blockMs ?? 15_000;
  const onAbort = (): void => {
    conn.disconnect();
  };
  opts.signal.addEventListener("abort", onAbort, { once: true });
  try {
    await ensureConnected(conn);
    while (!opts.signal.aborted) {
      let res: RawStreamRead;
      try {
        res = (await conn.xread("BLOCK", blockMs, "STREAMS", INDEX_STREAM_KEY, cursor)) as RawStreamRead;
      } catch (err) {
        if (opts.signal.aborted) break;
        log.warn("streamIndex xread failed", { err: (err as Error).message });
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!res) {
        // Real Redis already blocked for `blockMs`; this guards a non-blocking
        // client (or a misconfig) from becoming a busy loop.
        if (!opts.signal.aborted) await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          cursor = id;
          const summary = parseSummary(fields);
          if (summary) yield { id, summary };
        }
      }
    }
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
    conn.disconnect();
  }
}
