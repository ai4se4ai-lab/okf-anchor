import { MiniChart, type ChartPoint } from "./mini-chart";
import type { EvmBlockSummary } from "@okf-anchor/providers";

/** Seconds between consecutive blocks — the chain's live cadence. */
export function BlockTimeChart({ blocks }: { blocks: EvmBlockSummary[] }) {
  const ascending = [...blocks].sort((a, b) => a.number - b.number);
  const points: ChartPoint[] = [];
  for (let i = 1; i < ascending.length; i++) {
    const curr = ascending[i]!;
    const prev = ascending[i - 1]!;
    const delta = curr.timestampSec - prev.timestampSec;
    points.push({ x: curr.number, y: Math.max(0, delta), xLabel: `block ${curr.number.toLocaleString()}` });
  }

  return (
    <MiniChart
      title="Block time"
      subtitle="Seconds between blocks"
      points={points}
      kind="line"
      color="series-1"
      valueFormat={(v) => `${v.toFixed(1)}s`}
    />
  );
}
