"use client";

import type { EvmBlockSummary } from "@okf-anchor/providers";
import { relativeTime, truncateHex } from "./format";

/** Live feed of recent blocks with a gas-usage meter (used vs. free capacity) for each. */
export function BlockList({ blocks }: { blocks: EvmBlockSummary[] }) {
  return (
    <div className="viz card overflow-x-auto">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Live blocks</h2>
      {blocks.length === 0 ? (
        <p className="text-sm text-slate-500">No blocks yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th scope="col" className="pb-2 pr-3 font-medium">
                Block
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Age
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Txns
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Gas used / free
              </th>
              <th scope="col" className="pb-2 font-medium">
                Hash
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {blocks.map((b) => {
              const pct = b.gasLimit > 0 ? Math.min(100, (b.gasUsed / b.gasLimit) * 100) : 0;
              return (
                <tr key={b.number}>
                  <td className="py-2 pr-3 tabular-nums">{b.number.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-slate-500">{relativeTime(b.timestampSec)}</td>
                  <td className="py-2 pr-3 tabular-nums">{b.transactionCount}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-16 overflow-hidden rounded-full"
                        style={{ background: "var(--viz-series-1-soft)" }}
                        role="meter"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`gas used ${pct.toFixed(1)}%, ${(100 - pct).toFixed(1)}% free`}
                      >
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--viz-series-1)" }} />
                      </div>
                      <span className="w-10 text-xs tabular-nums text-slate-500">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2 hash" title={b.hash}>
                    {truncateHex(b.hash)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
