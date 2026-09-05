/**
 * The structured progress events `publishBundle` / `verifyStoredVersion` emit
 * through an injected `onEvent` callback — a richer sibling of the existing
 * `onStage` hook. Deliberately defined here, with no dependency on
 * `@okf-anchor/activity`: the pipeline owns the contract and stays free of the
 * Redis layer that records it (CLAUDE.md §2). `@okf-anchor/activity`'s
 * `PipelineEvent` is structurally identical, so a recorder's `onEvent(runId)`
 * plugs straight in.
 */

export type PipelineEventLevel = "info" | "success" | "warn" | "error";

/** Mirrors the five architectural layers (CLAUDE.md §2) plus the signer. */
export type PipelineEventLayer = "okf" | "canonical" | "graph" | "storage" | "anchor" | "signer";

export type PipelineEventDetail = Record<string, string | number | boolean | null>;

export interface PipelineEvent {
  readonly phase: string;
  readonly level: PipelineEventLevel;
  readonly layer?: PipelineEventLayer;
  readonly message: string;
  readonly detail?: PipelineEventDetail;
}

export type PipelineEventSink = (event: PipelineEvent) => Promise<void> | void;

/**
 * Wrap an optional sink so every call site can `await emit(...)` without a
 * null-check, and a throwing/slow sink never breaks the pipeline.
 */
export function makeEmitter(sink: PipelineEventSink | undefined): (
  phase: string,
  level: PipelineEventLevel,
  message: string,
  detail?: PipelineEventDetail,
  layer?: PipelineEventLayer,
) => Promise<void> {
  return async (phase, level, message, detail, layer) => {
    if (!sink) return;
    try {
      await sink({
        phase,
        level,
        message,
        ...(layer ? { layer } : {}),
        ...(detail ? { detail } : {}),
      });
    } catch {
      /* activity logging is best-effort — never fail a mint because a log write failed */
    }
  };
}
