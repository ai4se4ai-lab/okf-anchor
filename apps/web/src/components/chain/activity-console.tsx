"use client";

/**
 * Live mint/verify activity console. Tails `/api/public/activity/stream` (SSE)
 * for run summaries and falls back to polling `/api/public/activity/recent` when
 * the stream is unavailable. Expanding a run pulls its full structured event log
 * from `/api/public/activity/runs/<runId>` and, while the run is still going,
 * polls it incrementally — so the operator sees every IPFS put, hash, signature
 * and on-chain step as it happens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, ActivityRunSummary } from "@okf-anchor/activity";
import { truncateHex } from "./format";

const RECENT_URL = "/api/public/activity/recent";
const STREAM_URL = "/api/public/activity/stream";
const runUrl = (runId: string, after?: string): string =>
  `/api/public/activity/runs/${encodeURIComponent(runId)}${after ? `?after=${encodeURIComponent(after)}` : ""}`;

const FALLBACK_POLL_MS = 4000;
const DETAIL_POLL_MS = 1500;

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function duration(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const KIND_STYLE: Record<string, string> = {
  mint: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
  verify: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300",
};

const LAYER_STYLE: Record<string, string> = {
  okf: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  canonical: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  graph: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  storage: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  anchor: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  signer: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
};

function statusDot(state: ActivityRunSummary["state"]): string {
  if (state === "done") return "bg-emerald-500";
  if (state === "error") return "bg-rose-500";
  return "bg-amber-500 animate-pulse";
}

function DetailGrid({ detail }: { detail: Record<string, string | number | boolean | null> }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
      {entries.map(([k, v]) => {
        const isHashish = typeof v === "string" && v.length > 24 && !v.includes(" ");
        return (
          <div key={k} className="min-w-0">
            <dt className="inline text-slate-500">{k}: </dt>
            <dd className={`inline ${isHashish ? "hash" : "break-all"}`} title={isHashish ? String(v) : undefined}>
              {isHashish ? truncateHex(String(v), 12, 8) : String(v)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function RunLog({ runId, running }: { runId: string; running: boolean }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const lastId = useRef<string>("-");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    lastId.current = "-";
    setEvents([]);

    const pull = async (): Promise<void> => {
      try {
        const res = await fetch(runUrl(runId, lastId.current === "-" ? undefined : lastId.current), {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { events: ActivityEvent[]; lastId: string };
        if (cancelled || body.events.length === 0) return;
        lastId.current = body.lastId;
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => `${e.seq}`));
          return [...prev, ...body.events.filter((e) => !seen.has(`${e.seq}`))];
        });
      } catch {
        /* transient — try again on the next tick */
      }
    };

    void pull();
    const id = running ? setInterval(pull, DETAIL_POLL_MS) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [runId, running]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events]);

  return (
    <div ref={scrollRef} className="mt-2 max-h-80 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950">
      {events.length === 0 ? (
        <p className="text-slate-500">Waiting for events…</p>
      ) : (
        <ol className="space-y-1.5">
          {events.map((e) => (
            <li key={e.seq} className="border-b border-slate-100 pb-1.5 last:border-0 dark:border-slate-800/60">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="tabular-nums text-slate-400">{clock(e.ts)}</span>
                {e.layer && (
                  <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${LAYER_STYLE[e.layer] ?? LAYER_STYLE.okf}`}>
                    {e.layer}
                  </span>
                )}
                <span className={e.level === "error" ? "check-fail" : e.level === "success" ? "check-pass" : ""}>
                  {e.message}
                </span>
              </div>
              {e.detail && <DetailGrid detail={e.detail} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ActivityConsole() {
  const [runs, setRuns] = useState<Record<string, ActivityRunSummary>>({});
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const connectedRef = useRef(false);

  const upsert = useCallback((incoming: ActivityRunSummary[]) => {
    setRuns((prev) => {
      const next = { ...prev };
      for (const r of incoming) {
        const cur = next[r.runId];
        if (!cur || r.updatedAt >= cur.updatedAt) next[r.runId] = r;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | undefined;

    const seed = async (): Promise<void> => {
      try {
        const res = await fetch(RECENT_URL, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { runs: ActivityRunSummary[] };
        upsert(body.runs);
      } catch {
        /* ignore */
      }
    };

    const startPolling = (): void => {
      if (pollId) return;
      pollId = setInterval(seed, FALLBACK_POLL_MS);
    };
    const stopPolling = (): void => {
      if (pollId) clearInterval(pollId);
      pollId = undefined;
    };

    void seed();

    if (typeof window !== "undefined" && "EventSource" in window) {
      es = new EventSource(STREAM_URL);
      es.addEventListener("open", () => {
        if (cancelled) return;
        setConnected(true);
        connectedRef.current = true;
        stopPolling();
      });
      es.addEventListener("run", (ev) => {
        if (cancelled) return;
        try {
          upsert([JSON.parse((ev as MessageEvent).data) as ActivityRunSummary]);
        } catch {
          /* skip a malformed frame */
        }
      });
      es.addEventListener("error", () => {
        if (cancelled) return;
        setConnected(false);
        connectedRef.current = false;
        startPolling();
      });
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      es?.close();
      stopPolling();
    };
  }, [upsert]);

  // Keep "running" elapsed times ticking.
  const anyRunning = useMemo(() => Object.values(runs).some((r) => r.state === "running"), [runs]);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const ordered = useMemo(
    () => Object.values(runs).sort((a, b) => b.updatedAt - a.updatedAt),
    [runs],
  );

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Live activity</h2>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
          {connected ? "streaming" : "polling"}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-slate-500">
          No mint or verify activity yet. Publish a bundle or run a verification and every pipeline step — IPFS,
          hashing, signing, the on-chain anchor — shows up here live.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {ordered.map((r) => {
            const isOpen = expanded === r.runId;
            return (
              <li key={r.runId} className="py-2">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.runId)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm"
                >
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[r.kind] ?? ""}`}>
                    {r.kind}
                  </span>
                  <span className="hash">{truncateHex(r.runId, 8, 4)}</span>
                  {r.assetId && (
                    <span className="text-xs text-slate-500">
                      {truncateHex(r.assetId, 6, 4)}
                      {r.versionNumber !== undefined ? ` v${r.versionNumber}` : ""}
                    </span>
                  )}
                  <span className="font-medium">{r.phase}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                    <span className="tabular-nums">{duration(Math.max(0, r.updatedAt - r.startedAt))}</span>
                    <span className={`inline-block h-2 w-2 rounded-full ${statusDot(r.state)}`} aria-hidden="true" />
                    <span className="sr-only">{r.state}</span>
                    <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  </span>
                </button>
                {isOpen && <RunLog runId={r.runId} running={r.state === "running"} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
