// Ranked horizontal bars (M7.3, L14): one hue (the series is named by the chart's title, so no legend), largest first, the value at each bar's tip in text
// colours. Rows are HTML (names wrap on a phone, never clipped); each bar is drawn on one shared scale from one baseline, at most 24 px thick with a
// 4 px rounded data end and a square base. The rows are one keyboard stop (arrow keys move), each named with its value; the readout adds what the caller
// passes (a count, a share).
import { ChartTip, type Tone, tipAt, useRoving, useTip, useWidth } from "./core.tsx";

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** the value as printed at the tip */
  valueText: string;
  /** extra readout rows (e.g. "4 lines") */
  more?: readonly { value: string; label: string }[];
};

export function RankedBars(props: {
  data: readonly BarDatum[];
  tone?: Tone;
  /** the plot's name for assistive technology (the chart's title) */
  label: string;
  /** the value's name in the readout ("Invoiced (before GST)", "Leads") */
  valueLabel: string;
  /** keep the caller's order (stages in their own order) instead of ranking */
  keepOrder?: boolean | undefined;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const rows = props.keepOrder ? props.data : [...props.data].sort((a, b) => b.value - a.value);
  const roving = useRoving(rows.length);
  const max = Math.max(0, ...rows.map((r) => r.value));
  const tone = props.tone ?? "a";
  return (
    <div className="chart-plot" ref={box} onPointerLeave={hide}>
      <ul className="chart-bars" aria-label={props.label}>
        {rows.map((r, i) => {
          const pct = max > 0 ? (Math.max(0, r.value) / max) * 100 : 0;
          const content = {
            title: r.label,
            rows: [{ value: r.valueText, label: props.valueLabel }, ...(r.more ?? [])],
          };
          return (
            <li key={r.key} className="chart-bars__item">
              <div
                className="chart-bars__row chart-hit"
                role="img"
                aria-label={`${r.label}: ${r.valueText}${(r.more ?? []).map((m) => `; ${m.value} ${m.label}`).join("")}`}
                {...roving.props(i)}
                onFocus={(e) => {
                  roving.setCurrent(i);
                  show({ ...tipAt(e.currentTarget, box.current), content });
                }}
                onBlur={hide}
                onPointerEnter={(e) => show({ ...tipAt(e.currentTarget, box.current), content })}
              >
                <span className="chart-bars__name">{r.label}</span>
                <span className="chart-bars__track">
                  {pct > 0 && (
                    <span className={`chart-bars__bar chart-tone--${tone}`} style={{ width: `${pct}%` }} />
                  )}
                </span>
                <span className="chart-bars__value tnum">{r.valueText}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <ChartTip tip={tip} width={width} />
    </div>
  );
}
