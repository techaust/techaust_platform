// The reply clock (M7.4 G.1): an open request's window from the day it arrived to its reply date, as a thin track filled as far as today, with the reply
// date and the days left in words beside it. The track is drawn for the eye only (aria-hidden); the words carry everything, and the colour follows the
// state pill's (verdigris on time, amber due soon or not acknowledged, red overdue), never alone.

import type { RequestView } from "../../lib/m74-api.ts";
import { clockOf } from "../../lib/requests.ts";

export function ReplyClock(props: { r: RequestView; now: number; wide?: boolean | undefined }) {
  const c = clockOf(props.r, props.now);
  if (!c) return <span className="dp-clock dp-clock--none">–</span>;
  return (
    <span className={`dp-clock dp-clock--${c.tone}${props.wide ? " dp-clock--wide" : ""}`}>
      <span className="dp-clock__due">{c.dueText}</span>
      <span className="dp-clock__track" aria-hidden="true">
        <span className="dp-clock__fill" style={{ inlineSize: `${Math.round(c.elapsed * 1000) / 10}%` }} />
      </span>
      <span className="dp-clock__left">{c.left}</span>
    </span>
  );
}
