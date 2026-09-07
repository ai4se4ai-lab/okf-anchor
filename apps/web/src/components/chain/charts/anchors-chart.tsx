import { MiniChart, type ChartPoint } from "./mini-chart";
import type { EvmAnchorEventSummary, EvmBlockSummary } from "@okf-anchor/providers";

/** Cumulative anchor commitments written on-chain across the fetched block window. */
export function AnchorsChart({ blocks, anchors }: { blocks: EvmBlockSummary[]; anchors: EvmAnchorEventSummary[] }) {
  const ascending = [...blocks].sort((a, b) => a.number - b.number);
  let cumulative = 0;
  const points: ChartPoint[] = ascending.map((b) => {
    cumulative += anchors.filter((a) => a.blockNumber === b.number).length;
    return { x: b.number, y: cumulative, xLabel: `block ${b.number.toLocaleString()}` };
  });

  return (
    <MiniChart
      title="Anchors written"
      subtitle="Cumulative, this window"
      points={points}
      kind="line"
      color="series-3"
      valueFormat={(v) => v.toFixed(0)}
      emptyMessage="No anchors written in this window yet."
    />
  );
}
