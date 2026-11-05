// A line over days (M7.3, L14): one series, a 2 px line with round joins on one axis, a wash under it at about 10 %, the last point marked (8 px with a 2 px
// surface ring). The plot is one keyboard stop: the arrow keys walk the days, the pointer snaps to the nearest day (a hairline marks it) and the readout
// gives the day and its figure. A day the nightly count missed is absent, never drawn as zero: the line breaks there.
// The sparkline is the same mark without axes, for a tile (its name says the first and last figures).
import { type PointerEvent, useState } from "react";
import { ChartTip, labelWidth, linear, niceTicks, useTip, useWidth } from "./core.tsx";

export type LinePoint = { date: string; value: number };

const HEIGHT = 180;
const TOP = 12;
const BOTTOM = 28;

/** The days between two ISO dates (UTC calendar days; both are IST dates). */
const dayIndex = (from: string, d: string) => Math.round((Date.parse(d) - Date.parse(from)) / 86_400_000);

/** The path through the points, broken where a day is missing. */
function pathOf(points: readonly { x: number; y: number; i: number }[]): string {
  let d = "";
  let prev: number | null = null;
  for (const p of points) {
    d += `${prev !== null && p.i === prev + 1 ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    prev = p.i;
  }
  return d;
}

export function LineChart(props: {
  from: string;
  to: string;
  points: readonly LinePoint[];
  label: string;
  valueLabel: string;
  dayText: (iso: string) => string;
  axisDay: (iso: string) => string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const [at, setAt] = useState<number | null>(null);
  const days = Math.max(1, dayIndex(props.from, props.to) + 1);
  const ticks = niceTicks(0, Math.max(1, ...props.points.map((p) => p.value)), 3, 1);
  const left = Math.max(...ticks.map((t) => labelWidth(String(t))));
  const right = 12;
  const x = linear(0, Math.max(1, days - 1), left, Math.max(left, width - right));
  const y = linear(0, ticks.at(-1) ?? 1, HEIGHT - BOTTOM, TOP);
  const pts = props.points
    .map((p) => ({ ...p, i: dayIndex(props.from, p.date) }))
    .filter((p) => p.i >= 0 && p.i < days)
    .sort((a, b) => a.i - b.i)
    .map((p) => ({ ...p, x: x(p.i), y: y(p.value) }));
  const last = pts.at(-1);
  const line = pathOf(pts);
  const area =
    pts.length > 1 && last
      ? `${line}L${last.x.toFixed(1)},${y(0)}L${(pts[0] as (typeof pts)[number]).x.toFixed(1)},${y(0)}Z`
      : "";
  const focusOn = (k: number) => {
    const p = pts[k];
    if (!p) return;
    setAt(k);
    show({
      x: p.x,
      y: p.y - 8,
      content: { title: props.dayText(p.date), rows: [{ value: String(p.value), label: props.valueLabel }] },
    });
  };
  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - b.left;
    let best = 0;
    for (let k = 1; k < pts.length; k++)
      if (Math.abs((pts[k]?.x ?? 0) - px) < Math.abs((pts[best]?.x ?? 0) - px)) best = k;
    focusOn(best);
  };
  const current = at !== null ? pts[at] : undefined;
  const firstLabel = props.axisDay(props.from);
  const lastLabel = props.axisDay(props.to);
  return (
    <div className="chart-plot" ref={box}>
      {width > 0 && (
        <svg
          className="chart-svg chart-line"
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={props.label}
          tabIndex={pts.length > 0 ? 0 : -1}
          onPointerMove={nearest}
          onPointerLeave={() => {
            setAt(null);
            hide();
          }}
          onFocus={() => focusOn(at ?? pts.length - 1)}
          onBlur={() => {
            setAt(null);
            hide();
          }}
          onKeyDown={(e) => {
            const k = at ?? pts.length - 1;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") focusOn(Math.min(pts.length - 1, k + 1));
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") focusOn(Math.max(0, k - 1));
            else if (e.key === "Home") focusOn(0);
            else if (e.key === "End") focusOn(pts.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? "chart-axis" : "chart-grid"}
                x1={left}
                x2={width - right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="chart-tick" x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <text className="chart-tick" x={left} y={HEIGHT - 8} textAnchor="start">
            {firstLabel}
          </text>
          <text className="chart-tick" x={width - right} y={HEIGHT - 8} textAnchor="end">
            {lastLabel}
          </text>
          {area && <path className="chart-area chart-tone--a" d={area} />}
          <path className="chart-line__path chart-stroke--a" d={line} />
          {current && <line className="chart-cross" x1={current.x} x2={current.x} y1={TOP} y2={y(0)} />}
          {(current ?? last) && (
            <circle
              className="chart-dot chart-tone--a"
              cx={(current ?? last)?.x}
              cy={(current ?? last)?.y}
              r={4}
            />
          )}
        </svg>
      )}
      <ChartTip tip={tip} width={width} />
    </div>
  );
}

/** A tile's trend: the line alone (no axes), the last day marked in the accent; the name carries the figures. */
export function Sparkline(props: { points: readonly LinePoint[]; label: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const h = 40;
  const pts = props.points;
  if (pts.length < 2) return null;
  const first = pts[0] as LinePoint;
  const lastP = pts.at(-1) as LinePoint;
  const n = Math.max(1, dayIndex(first.date, lastP.date));
  const max = Math.max(1, ...pts.map((p) => p.value));
  const x = linear(0, n, 4, Math.max(4, width - 6));
  const y = linear(0, max, h - 5, 5);
  const xy = pts.map((p) => ({
    i: dayIndex(first.date, p.date),
    x: x(dayIndex(first.date, p.date)),
    y: y(p.value),
  }));
  const end = xy.at(-1) as (typeof xy)[number];
  return (
    <div className="chart-spark" ref={box}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={props.label}>
          <path className="chart-line__path chart-stroke--n" d={pathOf(xy)} />
          <circle className="chart-dot chart-tone--a" cx={end.x} cy={end.y} r={4} />
        </svg>
      )}
    </div>
  );
}
