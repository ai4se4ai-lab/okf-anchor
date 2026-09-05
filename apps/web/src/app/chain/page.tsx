import type { Metadata } from "next";
import { ChainExplorer } from "@/components/chain/chain-explorer";

export const metadata: Metadata = { title: "Live chain — OKF Anchor" };

export default function ChainPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Live chain</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live blocks and anchor commitments from the configured EVM anchor provider, with the IPFS bundle CID each
          commitment points at. The chain is a trust anchor only — see the asset pages for the knowledge itself.
        </p>
      </div>
      <ChainExplorer />
    </div>
  );
}
