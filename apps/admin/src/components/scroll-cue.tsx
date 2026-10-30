// The edge shade of a box that scrolls sideways (FX-4, full audit A5 14; moved here from the reports' WideList for the invoice lines, final sweep
// A7): when the content is wider than its box (a phone), a soft shade on the edge that hides more columns says there is more to see, and moves to
// the other edge as it scrolls; nothing is drawn when everything fits. Decoration only: the box's own name and focus carry it for assistive
// technology. The CSS is `.scroll-cue` in app.css.
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** Which edges hide more content, measured on the box `ref` points at. */
export function useScrollCue<T extends HTMLElement>(): [
  RefObject<T | null>,
  { start: boolean; end: boolean },
] {
  const box = useRef<T>(null);
  const [more, setMore] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    // RTL scrollLeft runs negative; the magnitude is what matters here.
    const left = Math.abs(el.scrollLeft);
    const next = { start: left > 1, end: left + el.clientWidth < el.scrollWidth - 1 };
    setMore((m) => (m.start === next.start && m.end === next.end ? m : next));
  }, []);
  // FX-4 review L5: one effect with its dependencies, set up once, instead of measuring after every render. It measures when the box is drawn, as it
  // scrolls, when the box or the table inside it changes size, and when the content changes (new rows, or a table drawn afresh by a new read, which
  // the size observer then watches in place of the old one).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    const watchTable = () => {
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    };
    const mo = new MutationObserver(() => {
      watchTable();
      measure();
    });
    ro.observe(el);
    watchTable();
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);
  return [box, more];
}

/** The wrapper that draws the shades over the edges of the scrolling box inside it. */
export function ScrollCue(props: { more: { start: boolean; end: boolean }; children: ReactNode }) {
  return (
    <div
      className="scroll-cue"
      data-more-start={props.more.start || undefined}
      data-more-end={props.more.end || undefined}
    >
      {props.children}
    </div>
  );
}
