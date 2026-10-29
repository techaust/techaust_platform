// A box that scrolls sideways is a keyboard stop while (and only while) it overflows (FX-3, A3 1; WCAG 2.1.1): it then
// takes `tabIndex=0`, `role="region"` and the name of what it holds, so the arrow keys scroll it once it has focus and
// a screen reader names it. A box that fits adds no stop. The box itself is `position: relative` in CSS (A3 2), so a
// visually hidden child (absolutely placed) is clipped with it and never widens the page.
import { type RefCallback, useCallback, useEffect, useState } from "react";

export type ScrollRegionProps =
  | { tabIndex: 0; role: "region"; "aria-label": string; "data-scrolls": "" }
  | Record<string, never>;

/** True when the box is wider inside than out (1 px of slack for sub-pixel rounding). */
export const overflowsSideways = (el: { scrollWidth: number; clientWidth: number }): boolean =>
  el.scrollWidth > el.clientWidth + 1;

export function useScrollRegion<T extends HTMLElement>(label: string): [RefCallback<T>, ScrollRegionProps] {
  const [el, setEl] = useState<T | null>(null);
  const [overflows, setOverflows] = useState(false);
  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return;
    const check = () => setOverflows(overflowsSideways(el));
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // The content can grow without the box changing size (rows arriving after loading).
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [el]);

  return [ref, overflows ? { tabIndex: 0, role: "region", "aria-label": label, "data-scrolls": "" } : {}];
}
