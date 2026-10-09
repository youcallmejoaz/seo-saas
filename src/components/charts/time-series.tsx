"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Single-series trend chart (one measure per chart: never dual-axis).
// Colours follow the dataviz reference palette: series slot 1 + recessive grid/axes.
const SERIES = "#2a78d6";
const GRID = "#e7e6e2";
const AXIS = "#52514e";

export function TimeSeriesChart({
  data,
  dataKey,
  label,
  height = 220,
  invert = false,
  format = (v: number) => v.toLocaleString("en-GB"),
}: {
  data: Record<string, number | string | null>[];
  dataKey: string;
  label: string;
  height?: number;
  /** For "lower is better" measures such as average position. */
  invert?: boolean;
  format?: (v: number) => string;
}) {
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-400">No data yet</p>;
  return (
    <div style={{ height }} role="img" aria-label={`${label} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} reversed={invert} tickFormatter={(v: number) => format(v)} width={48} />
          <Tooltip
            cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
            formatter={(v) => [format(Number(v)), label]}
            labelFormatter={(d) => String(d)}
            contentStyle={{ borderRadius: 8, borderColor: GRID, fontSize: 12 }}
          />
          <Area isAnimationActive={false} type="monotone" dataKey={dataKey} stroke={SERIES} strokeWidth={2} fill={`url(#fill-${dataKey})`} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
