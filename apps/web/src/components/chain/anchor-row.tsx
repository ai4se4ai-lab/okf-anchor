"use client";

import type { EvmAnchorEventSummary } from "@okf-anchor/providers";
import { looksLikeIpfsCid, relativeTime, truncateHex } from "./format";

/**
 * One decoded `Anchored` commitment — the on-chain hash plus the IPFS bundle CID
 * it points at. Shared by the "Recent anchors" feed and the interactive block
 * detail panel so both render commitments identically.
 */
export function AnchorRow({
  anchor,
  ipfsGatewayUrl,
  showAge = true,
}: {
  anchor: EvmAnchorEventSummary;
  ipfsGatewayUrl: string | null;
  showAge?: boolean;
}) {
  const gatewayHref =
    ipfsGatewayUrl && looksLikeIpfsCid(anchor.bundleCid)
      ? `${ipfsGatewayUrl.replace(/\/$/, "")}/ipfs/${anchor.bundleCid}`
      : null;

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          version {anchor.versionNumber}{" "}
          <span className="text-slate-500">· block {anchor.blockNumber.toLocaleString()}</span>
        </span>
        {showAge && <span className="text-xs text-slate-500">{relativeTime(anchor.timestampSec)}</span>}
      </div>
      <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <div>
          <span className="text-slate-500">IPFS bundle CID: </span>
          {gatewayHref ? (
            <a href={gatewayHref} target="_blank" rel="noopener noreferrer" className="hash underline">
              {truncateHex(anchor.bundleCid, 10, 6)}
            </a>
          ) : (
            <span className="hash">{truncateHex(anchor.bundleCid, 10, 6)}</span>
          )}
        </div>
        <div>
          <span className="text-slate-500">tx: </span>
          <span className="hash">{truncateHex(anchor.transactionHash)}</span>
        </div>
        <div>
          <span className="text-slate-500">publisher: </span>
          <span className="hash">{truncateHex(anchor.publisher)}</span>
        </div>
        <div>
          <span className="text-slate-500">commitment: </span>
          <span className="hash">{truncateHex(anchor.commitment)}</span>
        </div>
        <div>
          <span className="text-slate-500">assetId hash: </span>
          <span className="hash">{truncateHex(anchor.assetIdHash)}</span>
        </div>
      </div>
    </div>
  );
}
