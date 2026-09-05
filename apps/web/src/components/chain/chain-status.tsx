"use client";

import type { EvmChainSnapshot } from "@okf-anchor/providers";
import { relativeTime, truncateHex } from "./format";

export function ChainStatus({
  snapshot,
  lastUpdated,
  stale,
}: {
  snapshot: EvmChainSnapshot;
  lastUpdated: number | null;
  stale: boolean;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <span
          className={`inline-block h-2 w-2 rounded-full ${stale ? "bg-slate-400" : "bg-emerald-500"}`}
          aria-hidden="true"
        />
        {stale ? "Reconnecting…" : "Live"}
      </span>
      <span>
        Network <span className="hash">{snapshot.network}</span>
      </span>
      <span>
        Contract <span className="hash">{truncateHex(snapshot.contractAddress)}</span>
      </span>
      <span>
        Latest block <span className="font-semibold tabular-nums">{snapshot.latestBlockNumber.toLocaleString()}</span>
      </span>
      {lastUpdated && <span className="text-xs text-slate-500">Updated {relativeTime(Math.floor(lastUpdated / 1000))}</span>}
    </div>
  );
}
