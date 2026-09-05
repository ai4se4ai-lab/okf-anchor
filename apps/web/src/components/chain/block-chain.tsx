"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EvmAnchorEventSummary, EvmBlockSummary } from "@okf-anchor/providers";
import { AnchorRow } from "./anchor-row";
import { relativeTime, truncateHex } from "./format";

function gasPct(b: EvmBlockSummary): number {
  return b.gasLimit > 0 ? Math.min(100, (b.gasUsed / b.gasLimit) * 100) : 0;
}

function gweiFromWei(wei: string | null): string | null {
  if (wei == null) return null;
  const n = Number(wei);
  if (!Number.isFinite(n)) return null;
  return `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 })} Gwei`;
}

/** Chain-link glyph drawn between two block cards. */
function Connector() {
  return (
    <div className="flex shrink-0 items-center px-0.5 text-slate-300 dark:text-slate-700" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12a3 3 0 0 1 3-3h1a3 3 0 0 1 0 6h-1" />
        <path d="M15 12a3 3 0 0 1-3 3h-1a3 3 0 0 1 0-6h1" />
      </svg>
    </div>
  );
}

/**
 * The "Live blocks" chain: recent blocks as connected, clickable cards
 * (oldest → newest). Selecting a card opens a detail region with the block's
 * hashes, gas, base fee, its transaction hashes, and every `Anchored`
 * commitment that landed in it.
 */
export function BlockChain({
  blocks,
  anchors,
  ipfsGatewayUrl,
}: {
  blocks: EvmBlockSummary[];
  anchors: EvmAnchorEventSummary[];
  ipfsGatewayUrl: string | null;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const latest = blocks[0]?.number ?? -1;

  const ordered = useMemo(() => [...blocks].sort((a, b) => a.number - b.number), [blocks]);

  const anchorsByBlock = useMemo(() => {
    const m = new Map<number, EvmAnchorEventSummary[]>();
    for (const a of anchors) {
      const list = m.get(a.blockNumber) ?? [];
      list.push(a);
      m.set(a.blockNumber, list);
    }
    return m;
  }, [anchors]);

  // Keep the strip pinned to the newest block unless the user is inspecting one.
  useEffect(() => {
    if (selected === null && stripRef.current) {
      stripRef.current.scrollLeft = stripRef.current.scrollWidth;
    }
  }, [latest, selected]);

  // Drop a stale selection once that block scrolls out of the window.
  useEffect(() => {
    if (selected !== null && !blocks.some((b) => b.number === selected)) setSelected(null);
  }, [blocks, selected]);

  const selectedBlock = selected === null ? null : (blocks.find((b) => b.number === selected) ?? null);
  const selectedAnchors = selected === null ? [] : (anchorsByBlock.get(selected) ?? []);

  return (
    <div className="viz card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Live blocks</h2>

      {ordered.length === 0 ? (
        <p className="text-sm text-slate-500">No blocks yet.</p>
      ) : (
        <div ref={stripRef} className="flex items-stretch overflow-x-auto pb-2" role="list" aria-label="Recent blocks, oldest to newest">
          {ordered.map((b, i) => {
            const pct = gasPct(b);
            const anchorCount = anchorsByBlock.get(b.number)?.length ?? 0;
            const isSelected = selected === b.number;
            return (
              <div key={b.number} className="flex items-stretch" role="listitem">
                {i > 0 && <Connector />}
                <button
                  type="button"
                  onClick={() => setSelected(isSelected ? null : b.number)}
                  aria-pressed={isSelected}
                  aria-label={`Block ${b.number}, ${b.transactionCount} transactions, gas ${pct.toFixed(0)} percent${
                    anchorCount ? `, ${anchorCount} anchor commitment${anchorCount > 1 ? "s" : ""}` : ""
                  }`}
                  className={`flex w-32 shrink-0 flex-col gap-1 rounded-lg border p-2 text-left transition-colors ${
                    isSelected
                      ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
                      : "border-slate-200 hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600"
                  }`}
                >
                  <span className="font-semibold tabular-nums">#{b.number.toLocaleString()}</span>
                  <span className="text-xs text-slate-500">{relativeTime(b.timestampSec)}</span>
                  <span className="text-xs tabular-nums text-slate-500">{b.transactionCount} txn</span>
                  <span
                    className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--viz-series-1-soft)" }}
                    role="meter"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`gas used ${pct.toFixed(1)}%`}
                  >
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--viz-series-1)" }} />
                  </span>
                  {anchorCount > 0 && (
                    <span
                      className="mt-0.5 inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: "var(--viz-series-3-soft)", color: "var(--viz-series-3)" }}
                    >
                      ⚓ {anchorCount} anchor{anchorCount > 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedBlock && (
        <section
          role="region"
          aria-label={`Block ${selectedBlock.number} detail`}
          className="mt-4 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Block {selectedBlock.number.toLocaleString()}</h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
            >
              close
            </button>
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <Field label="Timestamp">
              {new Date(selectedBlock.timestampSec * 1000).toISOString()} ({relativeTime(selectedBlock.timestampSec)})
            </Field>
            <Field label="Transactions">{selectedBlock.transactionCount.toLocaleString()}</Field>
            <Field label="Gas used / limit">
              {selectedBlock.gasUsed.toLocaleString()} / {selectedBlock.gasLimit.toLocaleString()} (
              {gasPct(selectedBlock).toFixed(1)}%)
            </Field>
            <Field label="Base fee">{gweiFromWei(selectedBlock.baseFeePerGasWei) ?? "—"}</Field>
            <Field label="Miner">
              <span className="hash">{selectedBlock.miner}</span>
            </Field>
            <Field label="Block hash">
              <span className="hash">{selectedBlock.hash}</span>
            </Field>
            <Field label="Parent hash">
              <span className="hash">{selectedBlock.parentHash}</span>
            </Field>
          </dl>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-500">
              Transaction hashes{" "}
              {selectedBlock.transactionCount > selectedBlock.transactionHashes.length && (
                <span className="font-normal">
                  (showing {selectedBlock.transactionHashes.length} of {selectedBlock.transactionCount})
                </span>
              )}
            </p>
            {selectedBlock.transactionHashes.length === 0 ? (
              <p className="text-xs text-slate-500">No transactions in this block.</p>
            ) : (
              <ul className="space-y-0.5">
                {selectedBlock.transactionHashes.map((h) => (
                  <li key={h} className="hash" title={h}>
                    {truncateHex(h, 14, 10)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedAnchors.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-slate-500">
                Anchor commitments in this block ({selectedAnchors.length})
              </p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {selectedAnchors.map((a) => (
                  <li key={a.transactionHash} className="py-2">
                    <AnchorRow anchor={a} ipfsGatewayUrl={ipfsGatewayUrl} showAge={false} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}
