"use client";

import type { EvmAnchorEventSummary } from "@okf-anchor/providers";
import { looksLikeIpfsCid, relativeTime, truncateHex } from "./format";

/** Recent `Anchored` commitments, each linked to the IPFS bundle CID it points at. */
export function AnchorFeed({ anchors, ipfsGatewayUrl }: { anchors: EvmAnchorEventSummary[]; ipfsGatewayUrl: string | null }) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent anchors</h2>
      {anchors.length === 0 ? (
        <p className="text-sm text-slate-500">No anchor commitments in the current window.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {anchors.map((a) => {
            const gatewayHref =
              ipfsGatewayUrl && looksLikeIpfsCid(a.bundleCid) ? `${ipfsGatewayUrl.replace(/\/$/, "")}/ipfs/${a.bundleCid}` : null;
            return (
              <li key={a.transactionHash} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    version {a.versionNumber} <span className="text-slate-500">· block {a.blockNumber.toLocaleString()}</span>
                  </span>
                  <span className="text-xs text-slate-500">{relativeTime(a.timestampSec)}</span>
                </div>
                <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-slate-500">IPFS bundle CID: </span>
                    {gatewayHref ? (
                      <a href={gatewayHref} target="_blank" rel="noopener noreferrer" className="hash underline">
                        {truncateHex(a.bundleCid, 10, 6)}
                      </a>
                    ) : (
                      <span className="hash">{truncateHex(a.bundleCid, 10, 6)}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">tx: </span>
                    <span className="hash">{truncateHex(a.transactionHash)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">publisher: </span>
                    <span className="hash">{truncateHex(a.publisher)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">commitment: </span>
                    <span className="hash">{truncateHex(a.commitment)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
