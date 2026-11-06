// A limit strip (M7.5 G, the Free-plan usage tile; docs/06 §4.5, the dataviz method): one series over a fixed window of days, drawn on a fixed scale from
// zero to its limit, so the headroom is the picture: a calm line along the floor is the healthy state, and every strip of the tile shares the same scale
// (a share of its own limit). Hairline marks at the alert lines (50 % and 80 %) carry their words at the right edge, so they never rest on colour. A day
// that wasn't read is absent, never zero: the line breaks there, and a day read alone between gaps keeps a dot. A figure over the limit is drawn at the
// top. One keyboard stop: the arrow keys walk the days read, Home and End jump, the pointer snaps to the nearest day; the readout gives the day, the figure
// and its share (it repeats words the strip's name and the table hold, so it is hidden from assistive technology).
import { type PointerEvent, useState } from "react";
import { ChartTip, linear, useTip, useWidth } from "./core.tsx";

const HEIGHT = 56;
const TOP = 6;
const BOTTOM = 6;
/** Room at the right for the marks' words ("80 %" at the caption size). */
const GUTTER = 40;

const dayIndex = (from: string, d: string) => Math.round((Date.parse(d) - Date.parse(from)) / 86_400_000);

export function LimitStrip(props: {
  from: string;
  to: string;
  points: readonly { date: string; value: number }[];
  limit: number;
  /** The alert lines, in percent of the limit. */
  marks: readonly number[];
  markText: (t: number) => string;
  label: string;
  dayText: (iso: string) => string;
  valueText: (v: number) => string;
  shareText: (v: number) => string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const [at, setAt] = useState<number | null>(null);
  const days = Math.max(1, dayIndex(props.from, props.to) + 1);
  const right = Math.max(8, width - GUTTER);
  const x = linear(0, Math.max(1, days - 1), 4, right);
  const y = linear(0, Math.max(1, props.limit), HEIGHT - BOTTOM, TOP);
  const pts = props.points
    .map((p) => ({ ...p, i: dayIndex(props.from, p.date) }))
    .filter((p) => p.i >= 0 && p.i < days)
    .sort((a, b) => a.i - b.i)
    .map((p) => ({ ...p, x: x(p.i), y: y(Math.min(p.value, props.limit)) }));
  const read = new Set(pts.map((p) => p.i));
  let line = "";
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k] as (typeof pts)[number];
    const joined = k > 0 && (pts[k - 1] as (typeof pts)[number]).i === p.i - 1;
    line += `${joined ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  // The wash under each joined run, closed on the floor.
  let area = "";
  let run: typeof pts = [];
  const closeRun = () => {
    const a = run[0];
    const b = run.at(-1);
    if (run.length > 1 && a && b)
      area += `M${a.x.toFixed(1)},${y(0)}${run.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("")}L${b.x.toFixed(1)},${y(0)}Z`;
    run = [];
  };
  for (const p of pts) {
    const prev = run.at(-1);
    if (prev && prev.i !== p.i - 1) closeRun();
    run.push(p);
  }
  closeRun();
  const lone = pts.filter((p) => !read.has(p.i - 1) && !read.has(p.i + 1));
  const last = pts.at(-1);

  const focusOn = (k: number) => {
    const p = pts[k];
    if (!p) return;
    setAt(k);
    // The readout's foot sits just above the strip (the crosshair marks the day), so it never covers the line it reads.
    show({
      x: p.x,
      y: -4,
      content: {
        title: props.dayText(p.date),
        rows: [{ value: props.valueText(p.value), label: props.shareText(p.value) }],
      },
    });
  };
  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    if (pts.length === 0) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let k = 1; k < pts.length; k++)
      if (Math.abs((pts[k]?.x ?? 0) - px) < Math.abs((pts[best]?.x ?? 0) - px)) best = k;
    focusOn(best);
  };
  const current = at !== null ? pts[at] : undefined;

  return (
    <div className="chart-plot limit-strip" ref={box}>
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
          <line className="chart-axis" x1={0} x2={right + 4} y1={y(0)} y2={y(0)} />
          {props.marks.map((t) => {
            const my = y((props.limit * t) / 100);
            return (
              <g key={t}>
                <line className="limit-strip__mark" x1={0} x2={right + 4} y1={my} y2={my} />
                <text className="chart-tick" x={right + 10} y={my} dy="0.32em" textAnchor="start">
                  {props.markText(t)}
                </text>
              </g>
            );
          })}
          {area && <path className="chart-area chart-tone--a" d={area} />}
          {line && <path className="chart-line__path chart-stroke--a" d={line} />}
          {lone
            .filter((p) => p !== last)
            .map((p) => (
              <circle key={p.date} className="chart-dot chart-tone--a" cx={p.x} cy={p.y} r={3} />
            ))}
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
      {/* The strip is shorter than the readout: the box rises above it, clear of the line it reads. */}
      <ChartTip tip={tip} width={width} floor={Number.NEGATIVE_INFINITY} />
    </div>
  );
}
