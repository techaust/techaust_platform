// A stat tile with its meter (M7.3, L14; dataviz "Figures"): a label, the figure in the sans at display size with proportional figures, a line under it, and
// for a rate a thin meter whose track is a lighter step of the fill's own hue. The meter is a picture of the figure above it, so it is hidden from assistive
// technology; the figure and its line carry everything. A rate with no denominator shows its words, never 0 % (core `rate` gives null).
import type { ReactNode } from "react";

export function StatTile(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** a rate in basis points (0 to 10,000), drawn as a meter; omitted for a plain figure */
  meterBp?: number | null;
}) {
  const pct = props.meterBp == null ? null : Math.max(0, Math.min(100, props.meterBp / 100));
  return (
    <div className="chart-stat">
      <dt className="chart-stat__label">{props.label}</dt>
      <dd className="chart-stat__value">{props.value}</dd>
      {props.sub && <dd className="chart-stat__sub">{props.sub}</dd>}
      {props.meterBp !== undefined && (
        <dd className="chart-meter" aria-hidden="true">
          {pct !== null && pct > 0 && <span className="chart-meter__fill" style={{ width: `${pct}%` }} />}
        </dd>
      )}
    </div>
  );
}
