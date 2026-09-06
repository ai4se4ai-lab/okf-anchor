import type { Metadata } from "next";
import { ChainExplorer } from "@/components/chain/chain-explorer";

export const metadata: Metadata = { title: "Live chain — OKF Anchor" };

export default function ChainPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Live chain</h1>
        <p className="mt-1 text-sm text-slate-500">
          An interactive chain of recent blocks — click any block for its hashes, gas, transactions, and the anchor
          commitments it carries, each with the full IPFS bundle CID and a download link so anyone can retrieve and
          independently verify the anchored content. Plus a live console that streams every mint and verify action
          (IPFS, hashing, signing, and the on-chain anchor) as it happens. The chain is a trust anchor only; the
          knowledge itself lives on the asset pages.
        </p>
      </div>
      <ChainExplorer />
    </div>
  );
}
