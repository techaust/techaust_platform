// A segmented bar (M7.3, L14; dataviz "Figures"): one whole split into its parts, widths in proportion, a part at zero draws nothing, a 2 px surface gap
// between parts, no baseline. Thin (8 px, rounded ends, no text: the ageing beside its table and in the dashboard's Overdue tile) or tall (28 px, each part
// its own block with 4 px corners and its share printed inside where it fits: the kinds of work). Every part is in the chart's roving focus and named with
// its name, figure and share; the legend lists the names in block order and repeats no figure.

import { rateText } from "../../lib/m73-reports.ts";
import { ChartTip, type Tone, tipAt, useRoving, useTip, useWidth } from "./core.tsx";

export type Segment = { key: string; label: string; tone: Tone; value: number; valueText: string };

export function SegmentedBar(props: {
  parts: readonly Segment[];
  size: "thin" | "tall";
  /** the bar's name for assistive technology ("Owed in INR") */
  label: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const parts = props.parts.filter((p) => p.value > 0);
  const roving = useRoving(parts.length);
  const whole = parts.reduce((n, p) => n + p.value, 0); // geometry only: widths in proportion (the figures printed are the caller's)
  const gaps = Math.max(0, parts.length - 1) * 2;
  const room = Math.max(0, width - gaps);
  const shareBp = (v: number) => (whole > 0 ? Math.round((v / whole) * 10_000) : 0);
  let x = 0;
  return (
    <div className={`chart-plot chart-seg chart-seg--${props.size}`} ref={box} onPointerLeave={hide}>
      {width > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a figure's parts, not form controls (no fieldset)
        <div className="chart-seg__bar" role="group" aria-label={props.label}>
          {parts.map((p, i) => {
            const w = whole > 0 ? (p.value / whole) * room : 0;
            const left = x;
            x += w + 2;
            const share = rateText(shareBp(p.value));
            const content = { title: p.label, rows: [{ tone: p.tone, value: p.valueText, label: share }] };
            const fits = props.size === "tall" && w >= share.length * 8 + 16;
            return (
              <div
                key={p.key}
                className={`chart-seg__part chart-hit chart-tone--${p.tone}`}
                role="img"
                aria-label={`${p.label}: ${p.valueText}, ${share}`}
                style={{ left: `${left}px`, width: `${Math.max(w, 2)}px` }}
                {...roving.props(i)}
                onFocus={(e) => {
                  roving.setCurrent(i);
                  show({ ...tipAt(e.currentTarget, box.current), content });
                }}
                onBlur={hide}
                onPointerEnter={(e) => show({ ...tipAt(e.currentTarget, box.current), content })}
              >
                {fits && <span className="chart-seg__share">{share}</span>}
              </div>
            );
          })}
        </div>
      )}
      <ChartTip tip={tip} width={width} />
    </div>
  );
}
