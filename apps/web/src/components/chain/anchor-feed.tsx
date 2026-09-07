"use client";

import type { EvmAnchorEventSummary } from "@okf-anchor/providers";
import { AnchorRow } from "./anchor-row";

/** Recent `Anchored` commitments, each linked to the IPFS bundle CID it points at. */
export function AnchorFeed({
  anchors,
  ipfsGatewayUrl,
}: {
  anchors: EvmAnchorEventSummary[];
  ipfsGatewayUrl: string | null;
}) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent anchors</h2>
      {anchors.length === 0 ? (
        <p className="text-sm text-slate-500">No anchor commitments in the current window.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {anchors.map((a) => (
            <li key={a.transactionHash} className="py-2">
              <AnchorRow anchor={a} ipfsGatewayUrl={ipfsGatewayUrl} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
