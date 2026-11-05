// The pieces every chart shares (M7.3, L14; docs/06 §4.5 "custom SVG, built with the tokens"; the dataviz method): the plot's width from its box, a scale with
// clean ticks, one keyboard stop per chart with the arrow keys moving between its marks (roving focus), the hover and focus readout, and the legend. No chart
// package (CLAUDE.md rule 11). Geometry only: a value is placed in pixels here, never added up as money; every figure printed comes from the caller's
// formatter (core's `formatMoney`).
import "./chart.css";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** The series tones: `a` the stronger of a pair (verdigris-700 light, -300 dark), `b` the lighter, `s1` to `s4` the overdue ramp, `k1` to `k3` the kinds of
 * work, `n` the neutral (chart.css says which token each is in each theme). */
export type Tone = "a" | "b" | "s1" | "s2" | "s3" | "s4" | "k1" | "k2" | "k3" | "n";

/** The width of a box, followed as it changes (a ResizeObserver); 0 until measured. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Clean ticks over [min, max] (0 always inside): steps of 1, 2 or 5 × 10ⁿ, about `count` of them. `minStep` keeps money ticks on whole units (100 minor
 * units), so every tick prints without decimals.
 */
export function niceTicks(min: number, max: number, count = 4, minStep = 1): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, minStep * 5];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(minStep, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v));
  return out;
}

/** A linear scale from a domain to a pixel range. */
export const linear =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number): number =>
    d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/** About how wide a tick label is at the caption size (12 px Archivo, tabular figures): for the plot's left margin. */
export const labelWidth = (text: string) => Math.ceil(text.length * 7.2) + 8;

/**
 * One keyboard stop per chart: the marks are a roving set (the first, or the last focused, takes Tab); Left/Up and Right/Down move, Home and End jump, Escape
 * hides the readout. `onActive` hears the mark that has the focus (null when the focus leaves).
 */
export function useRoving(count: number) {
  const [current, setCurrent] = useState(0);
  const refs = useRef<(SVGGElement | HTMLElement | null)[]>([]);
  const move = useCallback(
    (to: number) => {
      const i = Math.max(0, Math.min(count - 1, to));
      setCurrent(i);
      refs.current[i]?.focus();
    },
    [count],
  );
  const onKeyDown = (i: number) => (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") move(i + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp") move(i - 1);
    else if (k === "Home") move(0);
    else if (k === "End") move(count - 1);
    else return;
    e.preventDefault();
  };
  const props = (i: number) => ({
    ref: (el: SVGGElement | HTMLElement | null) => {
      refs.current[i] = el;
    },
    tabIndex: i === Math.min(current, count - 1) ? 0 : -1,
    onKeyDown: onKeyDown(i),
  });
  return { props, setCurrent };
}

/** What the readout shows: a heading and its rows (value first, then the series name, each with its line key). */
export type TipContent = {
  title: string;
  rows: { tone?: Tone | undefined; value: string; label: string }[];
};
export type TipState = { x: number; y: number; content: TipContent } | null;

/**
 * The hover and focus readout. It repeats what the mark's own name says (the mark is named for a screen reader), so it is hidden from assistive technology;
 * it never holds the only copy of a figure (the table on the page has them all). Escape hides it (WCAG 1.4.13).
 */
export function useTip() {
  const [tip, setTip] = useState<TipState>(null);
  useEffect(() => {
    if (!tip) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setTip(null);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [tip]);
  return { tip, show: setTip, hide: () => setTip(null) };
}

export function ChartTip({ tip, width }: { tip: TipState; width: number }) {
  if (!tip) return null;
  // keep the box inside the chart: flip to the left of the point past the middle
  const left = tip.x > width / 2;
  return (
    <div
      className="chart-tip"
      aria-hidden="true"
      style={{
        top: `${Math.max(0, tip.y)}px`,
        ...(left ? { right: `${Math.max(0, width - tip.x + 8)}px` } : { left: `${tip.x + 8}px` }),
      }}
    >
      <p className="chart-tip__title">{tip.content.title}</p>
      <ul className="chart-tip__rows">
        {tip.content.rows.map((r) => (
          <li key={r.label} className="chart-tip__row">
            {r.tone && <span className={`chart-key chart-key--line chart-tone--${r.tone}`} />}
            <span className="chart-tip__value">{r.value}</span>
            <span className="chart-tip__label">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A legend (two or more series): a swatch shaped like the mark beside each name, in the marks' order. Text in text colours, never the series colour. */
export function Legend(props: { items: { tone: Tone; label: string }[]; shape?: "rect" | "line" }) {
  return (
    <ul className="chart-legend">
      {props.items.map((i) => (
        <li key={i.label} className="chart-legend__item">
          <span
            className={`chart-key chart-key--${props.shape ?? "rect"} chart-tone--${i.tone}`}
            aria-hidden="true"
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A chart's frame: its title (h3), an optional legend and note, then the plot. A figure, captioned by its title; the plot inside is a group named by the same
 * words, so its marks read as a set.
 */
export function ChartFrame(props: {
  id: string;
  title: string;
  legend?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`chart${props.className ? ` ${props.className}` : ""}`} aria-labelledby={props.id}>
      <figcaption className="chart__head">
        <h3 id={props.id} className="chart__title">
          {props.title}
        </h3>
        {props.legend}
      </figcaption>
      {props.children}
      {props.note && <p className="chart__note">{props.note}</p>}
    </figure>
  );
}

/** A mark's position for the readout, from the event's target box against the chart's box. */
export function tipAt(target: Element, box: HTMLElement | null): { x: number; y: number } {
  if (!box) return { x: 0, y: 0 };
  const t = target.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return { x: t.left - b.left + t.width / 2, y: t.top - b.top };
}
