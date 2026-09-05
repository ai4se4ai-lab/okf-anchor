/**
 * `ActivityRecorder` — the write side of the live mint/verify stream. Callers
 * that actually run the pipeline (the mint worker, the inline-mint route, the
 * verify routes) create one, call `start()` / `finish()` around a run, and hand
 * `onEvent(runId)` to `publishBundle` / `verifyStoredVersion`.
 *
 * Every write is best-effort: if Redis is down the run still completes, exactly
 * like `rateLimit()` failing open. Every `detail` value is passed through the
 * logger's redactor and reduced to a JSON-safe primitive, so an EVM signing key
 * or an API token can never enter the stream (CLAUDE.md §3).
 */
import { createLogger, isSecretKey } from "@okf-anchor/logger";
import {
  INDEX_STREAM_KEY,
  runStreamKey,
  type ActivityDetail,
  type ActivityEvent,
  type ActivityKind,
  type ActivityLevel,
  type ActivityRunState,
  type ActivityRunSummary,
  type PipelineEvent,
} from "./event.js";
import { activityRedis, ensureConnected } from "./redis.js";

const log = createLogger("activity");

const MESSAGE_MAX = 500;
const DETAIL_STRING_MAX = 512;
const DETAIL_KEYS_MAX = 24;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Read lazily so a deployment (or a test) can change the env after import.
const ttlSeconds = (): number => intEnv("OKF_ACTIVITY_TTL_SECONDS", 3600);
const runMaxlen = (): number => intEnv("OKF_ACTIVITY_RUN_MAXLEN", 500);
const indexMaxlen = (): number => intEnv("OKF_ACTIVITY_INDEX_MAXLEN", 300);
const indexTtlSeconds = (): number => Math.max(ttlSeconds(), 86_400);

export interface StartRunInput {
  readonly runId: string;
  readonly kind: ActivityKind;
  readonly note?: string;
}

export interface FinishRunInput {
  readonly state: Exclude<ActivityRunState, "running">;
  readonly note?: string;
  readonly assetId?: string;
  readonly versionNumber?: number;
}

export interface ActivityRecorder {
  start(input: StartRunInput): Promise<void>;
  event(runId: string, e: PipelineEvent): Promise<void>;
  finish(runId: string, input: FinishRunInput): Promise<void>;
  /** Bind a runId and return the `onEvent` callback the pipeline expects. */
  onEvent(runId: string): (e: PipelineEvent) => Promise<void>;
}

interface RunState {
  kind: ActivityKind;
  seq: number;
  startedAt: number;
  lastPhase: string;
  assetId?: string;
  versionNumber?: number;
}

/** Drop secret-shaped keys entirely and coerce every value to a JSON-safe primitive. */
export function sanitizeDetail(detail: ActivityDetail | undefined): ActivityDetail | undefined {
  if (!detail) return undefined;
  const out: ActivityDetail = {};
  let count = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (isSecretKey(key)) continue;
    if (count >= DETAIL_KEYS_MAX) break;
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      count++;
    } else if (typeof value === "string") {
      out[key] = value.length > DETAIL_STRING_MAX ? `${value.slice(0, DETAIL_STRING_MAX)}…` : value;
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

export function createActivityRecorder(): ActivityRecorder {
  const runs = new Map<string, RunState>();

  const state = (runId: string): RunState => {
    let s = runs.get(runId);
    if (!s) {
      s = { kind: "mint", seq: 0, startedAt: Date.now(), lastPhase: "" };
      runs.set(runId, s);
    }
    return s;
  };

  const writeIndex = async (runId: string, s: RunState, phase: string, level: ActivityLevel, runState: ActivityRunState, note?: string): Promise<void> => {
    const summary: ActivityRunSummary = {
      runId,
      kind: s.kind,
      startedAt: s.startedAt,
      updatedAt: Date.now(),
      phase,
      level,
      state: runState,
      eventCount: s.seq,
      ...(s.assetId ? { assetId: s.assetId } : {}),
      ...(s.versionNumber !== undefined ? { versionNumber: s.versionNumber } : {}),
      ...(note ? { note: note.slice(0, MESSAGE_MAX) } : {}),
    };
    const r = activityRedis();
    await ensureConnected(r);
    await r.xadd(INDEX_STREAM_KEY, "MAXLEN", "~", indexMaxlen(), "*", "s", JSON.stringify(summary));
    await r.expire(INDEX_STREAM_KEY, indexTtlSeconds());
  };

  const start = async (input: StartRunInput): Promise<void> => {
    const s: RunState = { kind: input.kind, seq: 0, startedAt: Date.now(), lastPhase: "start" };
    runs.set(input.runId, s);
    try {
      await writeIndex(input.runId, s, "start", "info", "running", input.note);
    } catch (err) {
      log.warn("activity start not recorded", { runId: input.runId, err: (err as Error).message });
    }
  };

  const event = async (runId: string, e: PipelineEvent): Promise<void> => {
    const s = state(runId);
    s.seq += 1;
    if (typeof e.detail?.["assetId"] === "string") s.assetId = e.detail["assetId"];
    if (typeof e.detail?.["versionNumber"] === "number") s.versionNumber = e.detail["versionNumber"];

    const detail = sanitizeDetail(e.detail);
    const stored: ActivityEvent = {
      runId,
      kind: s.kind,
      seq: s.seq,
      ts: Date.now(),
      phase: e.phase,
      level: e.level,
      ...(e.layer ? { layer: e.layer } : {}),
      message: e.message.slice(0, MESSAGE_MAX),
      ...(detail ? { detail } : {}),
    };

    try {
      const r = activityRedis();
      await ensureConnected(r);
      const key = runStreamKey(runId);
      await r.xadd(key, "MAXLEN", "~", runMaxlen(), "*", "e", JSON.stringify(stored));
      await r.expire(key, ttlSeconds());
      const phaseChanged = e.phase !== s.lastPhase;
      s.lastPhase = e.phase;
      if (phaseChanged || e.level === "error" || e.level === "warn") {
        await writeIndex(runId, s, e.phase, e.level, "running");
      }
    } catch (err) {
      log.warn("activity event not recorded", { runId, phase: e.phase, err: (err as Error).message });
    }
  };

  const finish = async (runId: string, input: FinishRunInput): Promise<void> => {
    const s = state(runId);
    if (input.assetId) s.assetId = input.assetId;
    if (input.versionNumber !== undefined) s.versionNumber = input.versionNumber;
    try {
      await writeIndex(
        runId,
        s,
        input.state === "done" ? "done" : "error",
        input.state === "done" ? "success" : "error",
        input.state,
        input.note,
      );
    } catch (err) {
      log.warn("activity finish not recorded", { runId, err: (err as Error).message });
    }
  };

  return {
    start,
    event,
    finish,
    onEvent: (runId: string) => (e: PipelineEvent) => event(runId, e),
  };
}
