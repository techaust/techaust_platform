// A stat tile with its meter (M7.3, L14; dataviz "Figures"): a label, the figure in the sans at display size with proportional figures, a line under it, and
// for a rate a thin meter whose track is a lighter step of the fill's own hue. The meter is a picture of the figure above it, so it is hidden from assistive
// technology; the figure and its line carry everything. A rate with no denominator shows its words in the quiet size, never 0 % and never a meter (core `rate`
// gives null).
import type { ReactNode } from "react";

export function StatTile(props: {
  label: string;
  value: ReactNode;
  /** the value is words standing in for a figure ("No offers decided"): set smaller and muted */
  words?: boolean;
  sub?: ReactNode;
  /** a rate in basis points (0 to 10,000), drawn as a meter; null or omitted: no meter */
  meterBp?: number | null;
}) {
  const pct = props.meterBp == null ? null : Math.max(0, Math.min(100, props.meterBp / 100));
  return (
    <div className="chart-stat">
      <dt className="chart-stat__label">{props.label}</dt>
      <dd className={props.words ? "chart-stat__value chart-stat__value--words" : "chart-stat__value"}>
        {props.value}
      </dd>
      {props.sub && <dd className="chart-stat__sub">{props.sub}</dd>}
      {pct !== null && (
        <dd className="chart-meter" aria-hidden="true">
          {pct > 0 && <span className="chart-meter__fill" style={{ width: `${pct}%` }} />}
        </dd>
      )}
    </div>
  );
}
