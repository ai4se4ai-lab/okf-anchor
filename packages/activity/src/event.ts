/**
 * The shape of a live mint/verify activity event. The pipeline emits
 * `PipelineEvent`s through an injected callback (an extension of the existing
 * `onStage` hook); the recorder stamps `runId` / `kind` / `seq` / `ts` and
 * writes the resulting `ActivityEvent` to Redis. Never carries a secret — the
 * recorder redacts every `detail` value (CLAUDE.md §3).
 */

export type ActivityKind = "mint" | "verify";
export type ActivityLevel = "info" | "success" | "warn" | "error";

/** Maps 1:1 to the five architectural layers in CLAUDE.md §2 (plus the signer). */
export type ActivityLayer = "okf" | "canonical" | "graph" | "storage" | "anchor" | "signer";

/** JSON-safe primitives only — no bigint, no nested objects. */
export type ActivityDetail = Record<string, string | number | boolean | null>;

/** What `publishBundle` / `verifyStoredVersion` emit through `ctx.onEvent`. */
export interface PipelineEvent {
  readonly phase: string;
  readonly level: ActivityLevel;
  readonly layer?: ActivityLayer;
  readonly message: string;
  readonly detail?: ActivityDetail;
}

/** A recorded event: a `PipelineEvent` plus the run/order stamps the recorder adds. */
export interface ActivityEvent extends PipelineEvent {
  readonly runId: string;
  readonly kind: ActivityKind;
  readonly seq: number;
  readonly ts: number;
}

export type ActivityRunState = "running" | "done" | "error";

/** One row in the global index stream — the console's run list is built from these. */
export interface ActivityRunSummary {
  readonly runId: string;
  readonly kind: ActivityKind;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly phase: string;
  readonly level: ActivityLevel;
  readonly state: ActivityRunState;
  readonly eventCount: number;
  readonly assetId?: string;
  readonly versionNumber?: number;
  readonly note?: string;
}

/** `runId` must be safe to interpolate into a Redis key (CLAUDE.md §3). */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

export const RUN_STREAM_PREFIX = "okf:activity:run:";
export const INDEX_STREAM_KEY = "okf:activity:index";

export function runStreamKey(runId: string): string {
  if (!isValidRunId(runId)) throw new Error(`invalid activity runId: ${JSON.stringify(runId)}`);
  return `${RUN_STREAM_PREFIX}${runId}`;
}
