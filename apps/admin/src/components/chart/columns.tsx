// Columns (M7.3, L14): one or two series of vertical columns over categories (months, day bands), from one baseline, on one axis (never two). A pair is the
// stronger and the lighter step of one hue (invoiced against collected: the analyst's validated ordinal pair); a single series has no legend (the title names
// it). Columns are at most 24 px wide with a 4 px rounded data end and a square base; touching columns keep a 2 px surface gap. Gridlines are 1 px hairlines,
// solid. Each category is one mark for the keyboard and the pointer (the whole band is the target), named with every value it holds.
import { ChartTip, labelWidth, linear, niceTicks, type Tone, tipAt, useRoving, useTip, useWidth } from "./core.tsx";

export type ColumnDatum = {
  key: string;
  /** the axis label (short: "Oct") */
  label: string;
  /** the full name for the readout and the mark's name ("October 2026") */
  name: string;
  values: readonly number[];
};

const HEIGHT = 220;
const TOP = 12;
const BOTTOM = 28;
const BAR_MAX = 24;
const GAP = 2;

/** The path of a column: 4 px rounded at the data end, square at the baseline (upwards for a positive value, downwards for a negative one). */
function columnPath(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (y1 <= y0) {
    // positive: the top is the data end
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

export function ColumnChart(props: {
  data: readonly ColumnDatum[];
  /** one or two series, in the order of `values` */
  series: readonly { tone: Tone; label: string }[];
  /** a figure as text (money through core, counts as words) */
  format: (v: number) => string;
  /** the axis' figures (whole units for money) */
  tickFormat?: (v: number) => string;
  /** money: ticks on whole units */
  minStep?: number;
  /** print each value on its column's cap (a few columns only; the histogram) */
  capLabels?: boolean;
  /** the plot's name for assistive technology (the chart's title) */
  label: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const roving = useRoving(props.data.length);
  const all = props.data.flatMap((d) => d.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4, props.minStep ?? 1);
  const tickText = props.tickFormat ?? props.format;
  const left = Math.max(...ticks.map((t) => labelWidth(tickText(t))));
  const right = 8;
  const plotW = Math.max(0, width - left - right);
  const y = linear(ticks[0] ?? 0, ticks.at(-1) ?? 1, HEIGHT - BOTTOM, TOP);
  const band = props.data.length > 0 ? plotW / props.data.length : 0;
  const n = props.series.length;
  const barW = Math.max(2, Math.min(BAR_MAX, (band * 0.7 - GAP * (n - 1)) / n));
  const groupW = barW * n + GAP * (n - 1);
  const y0 = y(0);
  // with little room, show every other axis label (the table and the readout carry each one)
  const every = band < 34 ? 2 : 1;

  const nameOf = (d: ColumnDatum) =>
    `${d.name}: ${props.series.map((s, i) => `${s.label} ${props.format(d.values[i] ?? 0)}`).join("; ")}`;
  const content = (d: ColumnDatum) => ({
    title: d.name,
    rows: props.series.map((s, i) => ({
      tone: n > 1 ? s.tone : undefined,
      value: props.format(d.values[i] ?? 0),
      label: s.label,
    })),
  });

  return (
    <div className="chart-plot" ref={box}>
      {width > 0 && (
        <svg
          className="chart-svg"
          width={width}
          height={HEIGHT}
          role="group"
          aria-label={props.label}
          onPointerLeave={hide}
        >
          {/* gridlines and the axis' figures: hairlines, recessive; the zero line a step stronger */}
          <g aria-hidden="true">
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
                  {tickText(t)}
                </text>
              </g>
            ))}
          </g>
          {props.data.map((d, i) => {
            const x0 = left + band * i;
            const gx = x0 + (band - groupW) / 2;
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG mark has no HTML equivalent; it is named and takes the roving focus
              <g
                key={d.key}
                className="chart-hit"
                role="img"
                aria-label={nameOf(d)}
                {...roving.props(i)}
                onFocus={(e) => {
                  roving.setCurrent(i);
                  show({ ...tipAt(e.currentTarget, box.current), content: content(d) });
                }}
                onBlur={hide}
                onPointerEnter={(e) =>
                  show({ ...tipAt(e.currentTarget.firstElementChild ?? e.currentTarget, box.current), content: content(d) })
                }
              >
                <rect className="chart-hit__band" x={x0} y={TOP} width={band} height={HEIGHT - BOTTOM - TOP} />
                {d.values.map((v, j) => {
                  const s = props.series[j];
                  if (!s || v === 0) return null;
                  return (
                    <path
                      key={s.label}
                      className={`chart-mark chart-tone--${s.tone}`}
                      d={columnPath(gx + j * (barW + GAP), barW, y0, y(v))}
                    />
                  );
                })}
                {props.capLabels &&
                  d.values.map((v, j) => {
                    const s = props.series[j];
                    if (!s) return null;
                    return (
                      <text
                        key={`${s.label}-cap`}
                        className="chart-cap"
                        x={gx + j * (barW + GAP) + barW / 2}
                        y={Math.min(y(v), y0) - 6}
                        textAnchor="middle"
                      >
                        {props.format(v)}
                      </text>
                    );
                  })}
                {i % every === 0 && (
                  <text className="chart-tick" x={x0 + band / 2} y={HEIGHT - 8} textAnchor="middle">
                    {d.label}
                  </text>
                )}
                <rect
                  className="chart-hit__ring"
                  x={x0 + 1}
                  y={TOP - 4}
                  width={Math.max(0, band - 2)}
                  height={HEIGHT - TOP}
                  rx={4}
                />
              </g>
            );
          })}
        </svg>
      )}
      <ChartTip tip={tip} width={width} />
    </div>
  );
}
