import { MiniChart, type ChartPoint } from "./mini-chart";
import type { EvmBlockSummary } from "@okf-anchor/providers";

/** Gas used as a share of each block's gas limit — how full recent blocks are. */
export function GasUsageChart({ blocks }: { blocks: EvmBlockSummary[] }) {
  const ascending = [...blocks].sort((a, b) => a.number - b.number);
  const points: ChartPoint[] = ascending.map((b) => ({
    x: b.number,
    y: b.gasLimit > 0 ? (b.gasUsed / b.gasLimit) * 100 : 0,
    xLabel: `block ${b.number.toLocaleString()}`,
  }));

  return (
    <MiniChart
      title="Gas usage"
      subtitle="Used vs. block gas limit"
      points={points}
      kind="bar"
      color="series-1"
      valueFormat={(v) => `${v.toFixed(1)}%`}
    />
  );
}
