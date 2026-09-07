"use client";

/**
 * Shared line/bar primitive for the live-chain stat charts (dataviz skill:
 * one axis, single series needs no legend box, hairline recessive gridlines,
 * crosshair + tooltip on hover, direct label at the series end). D3 supplies
 * the scales and path math only — React owns the DOM via SVG JSX.
 */
import { useMemo, useState } from "react";
import { extent, max, bisector, scaleLinear, line as d3line, curveMonotoneX } from "d3";

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  /** Shown in the tooltip in place of the raw x value (e.g. "block 1,234"). */
  readonly xLabel: string;
}

const WIDTH = 320;
const HEIGHT = 180;
const MARGIN = { top: 10, right: 8, bottom: 20, left: 34 };
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;

const bisectX = bisector<ChartPoint, number>((d) => d.x).left;

export function MiniChart({
  title,
  subtitle,
  points,
  kind,
  color,
  valueFormat,
  emptyMessage = "Not enough data yet.",
}: {
  title: string;
  subtitle?: string;
  points: ChartPoint[];
  kind: "line" | "bar";
  color: "series-1" | "series-3";
  valueFormat: (v: number) => string;
  emptyMessage?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const scales = useMemo(() => {
    if (points.length === 0) return null;
    const [x0, x1] = extent(points, (p) => p.x) as [number, number];
    const xScale = scaleLinear()
      .domain(x0 === x1 ? [x0 - 1, x0 + 1] : [x0, x1])
      .range([0, INNER_W]);
    const maxY = max(points, (p) => p.y) ?? 0;
    const yScale = scaleLinear()
      .domain([0, maxY <= 0 ? 1 : maxY * 1.15])
      .range([INNER_H, 0])
      .nice();
    return { xScale, yScale };
  }, [points]);

  const varColor = `var(--viz-${color})`;
  const varSoft = `var(--viz-${color}-soft)`;

  if (!scales || points.length < 2) {
    return (
      <div className="viz card">
        <ChartHeader title={title} subtitle={subtitle} />
        <div className="flex h-[140px] items-center justify-center text-xs" style={{ color: "var(--viz-muted)" }}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  const { xScale, yScale } = scales;
  const yTicks = yScale.ticks(4);
  const last = points[points.length - 1]!;

  const linePath =
    kind === "line"
      ? (d3line<ChartPoint>()
          .x((p) => xScale(p.x))
          .y((p) => yScale(p.y))
          .curve(curveMonotoneX)(points) ?? "")
      : null;

  const barSlot = INNER_W / points.length;
  const barWidth = Math.min(24, barSlot * 0.6);

  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xValue = xScale.invert(px);
    let idx = bisectX(points, xValue);
    idx = Math.max(0, Math.min(points.length - 1, idx));
    if (idx > 0 && Math.abs(points[idx - 1]!.x - xValue) < Math.abs(points[idx]!.x - xValue)) idx -= 1;
    setHoverIdx(idx);
  }

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="viz card">
      <ChartHeader title={title} subtitle={subtitle} valueNow={valueFormat(last.y)} />
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${title}: current value ${valueFormat(last.y)}`}
          className="w-full"
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={0} x2={INNER_W} y1={yScale(t)} y2={yScale(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={-6} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize={9} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t}
                </text>
              </g>
            ))}
            <line x1={0} x2={INNER_W} y1={INNER_H} y2={INNER_H} stroke="var(--viz-baseline)" strokeWidth={1} />

            {kind === "bar" &&
              points.map((p, i) => (
                <rect
                  key={i}
                  x={xScale(p.x) - barWidth / 2}
                  y={yScale(p.y)}
                  width={barWidth}
                  height={Math.max(0, INNER_H - yScale(p.y))}
                  rx={2}
                  fill={hoverIdx === i ? varColor : varSoft}
                />
              ))}

            {kind === "line" && linePath && (
              <>
                <path d={linePath} fill="none" stroke={varColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={xScale(last.x)} cy={yScale(last.y)} r={4} fill={varColor} stroke="var(--surface,#fff)" strokeWidth={2} />
                <text
                  x={xScale(last.x)}
                  y={yScale(last.y) - 8}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--viz-text-secondary)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {valueFormat(last.y)}
                </text>
              </>
            )}

            {hovered && (
              <line x1={xScale(hovered.x)} x2={xScale(hovered.x)} y1={0} y2={INNER_H} stroke="var(--viz-baseline)" strokeWidth={1} strokeDasharray="2,2" />
            )}

            <rect
              x={0}
              y={0}
              width={INNER_W}
              height={INNER_H}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIdx(null)}
            />
          </g>
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900"
            style={{
              left: `min(${((MARGIN.left + xScale(hovered.x)) / WIDTH) * 100}%, calc(100% - 5.5rem))`,
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-slate-500">{hovered.xLabel}</div>
            <div className="font-semibold tabular-nums" style={{ color: varColor }}>
              {valueFormat(hovered.y)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartHeader({ title, subtitle, valueNow }: { title: string; subtitle?: string; valueNow?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {valueNow && <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{valueNow}</span>}
    </div>
  );
}
