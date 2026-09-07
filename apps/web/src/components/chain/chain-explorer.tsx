"use client";

/**
 * Live EVM chain explorer: polls the read-only `/api/public/chain/live` feed
 * (backed by `EvmAnchorProvider.getLiveSnapshot`, viem under the hood) and
 * renders the interactive block chain, the anchor commitments with their IPFS
 * bundle CIDs, and the D3 stat charts. The live mint/verify activity console
 * renders regardless of the chain provider — it only needs Redis — so a default
 * `ANCHOR_PROVIDER=local` deployment still gets the full pipeline log.
 */
import { useEffect, useRef, useState } from "react";
import type { EvmChainSnapshot } from "@okf-anchor/providers";
import { ChainStatus } from "./chain-status";
import { BlockChain } from "./block-chain";
import { AnchorFeed } from "./anchor-feed";
import { ActivityConsole } from "./activity-console";
import { BlockTimeChart } from "./charts/block-time-chart";
import { GasUsageChart } from "./charts/gas-usage-chart";
import { AnchorsChart } from "./charts/anchors-chart";

type LiveResponse =
  | ({ available: true; ipfsGatewayUrl: string | null } & EvmChainSnapshot)
  | { available: false; provider: string; network: string };

const POLL_MS = 3000;
const STALE_AFTER_MS = POLL_MS * 3;

export function ChainExplorer() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/public/chain/live?blocks=25&anchors=15", { cache: "no-store" });
        if (!res.ok) throw new Error(`feed returned ${res.status}`);
        const body = (await res.json()) as LiveResponse;
        if (!cancelled) {
          setData(body);
          setError(null);
          setLastUpdated(Date.now());
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        inFlight.current = false;
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const stale =
    !!error || (lastUpdated !== null && Date.now() - lastUpdated > STALE_AFTER_MS);

  let chainSection: React.ReactNode;
  if (!data && error) {
    chainSection = <p className="card text-sm check-fail">Live chain feed unavailable: {error}</p>;
  } else if (!data) {
    chainSection = <p className="text-sm text-slate-500">Connecting to chain…</p>;
  } else if (!data.available) {
    chainSection = (
      <p className="card text-sm text-slate-500">
        No live EVM chain configured — the active anchor provider is <span className="hash">{data.provider}</span>. Set{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">ANCHOR_PROVIDER=evm</code> (see{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docs/evm-anchor.md</code>) to enable the block explorer.
      </p>
    );
  } else {
    chainSection = (
      <div className="space-y-6">
        <ChainStatus snapshot={data} lastUpdated={lastUpdated} stale={stale} />

        <div className="grid gap-4 lg:grid-cols-3">
          <BlockTimeChart blocks={data.blocks} />
          <GasUsageChart blocks={data.blocks} />
          <AnchorsChart blocks={data.blocks} anchors={data.anchors} />
        </div>

        <BlockChain blocks={data.blocks} anchors={data.anchors} ipfsGatewayUrl={data.ipfsGatewayUrl} />
        <AnchorFeed anchors={data.anchors} ipfsGatewayUrl={data.ipfsGatewayUrl} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {chainSection}
      <ActivityConsole />
    </div>
  );
}
