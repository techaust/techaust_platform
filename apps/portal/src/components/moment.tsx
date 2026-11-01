// A moment in the client's own clock (lib/local-time.ts) as two unbreakable runs, "25 Oct 2026," and "06:12 GMT": a narrow column breaks it only
// between the date and the time, never inside the date or between a time and its zone ("02:42" above a lone "GMT+9").
import { type Clock, localDateTime } from "../lib/local-time.ts";

/** `clock` is for tests; the screens use the browser's own. */
export function Moment({ at, clock }: { at: number; clock?: Clock | undefined }) {
  const text = localDateTime(at, clock);
  const cut = text.indexOf(", ");
  if (cut < 0) return <span className="nowrap">{text}</span>;
  return (
    <>
      <span className="nowrap">{text.slice(0, cut + 1)}</span>{" "}
      <span className="nowrap">{text.slice(cut + 2)}</span>
    </>
  );
}

/** A copy line that embeds a moment (`line(MARK)` puts it in place): the words around it as they are, the moment as <Moment>. */
export function LineWithMoment({
  line,
  at,
  clock,
}: {
  line: (moment: string) => string;
  at: number;
  clock?: Clock | undefined;
}) {
  const MARK = "\u0000";
  const [before = "", after = ""] = line(MARK).split(MARK);
  return (
    <>
      {before}
      <Moment at={at} clock={clock} />
      {after}
    </>
  );
}
