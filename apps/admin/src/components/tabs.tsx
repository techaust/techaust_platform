// Tabs (docs/06 §5.3, WAI-ARIA Authoring Practices "Tabs with manual activation"): a tablist of buttons, one tab stop
// (the selected tab), arrow keys and Home / End move focus along the row, Enter or Space opens the focused tab. Manual
// activation because a tab's panel may load from the API. The selected tab is the caller's (the client page keeps it in
// the URL, `?tab=`). On narrow screens the row scrolls sideways inside its own box; the focused tab is kept in view.
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react";

/** A tab; `badge` is a short count after the label (e.g. the requests waiting), its `label` read out by screen readers in place of the digits. */
export type TabItem<K extends string> = {
  key: K;
  label: string;
  badge?: { text: string; label: string } | null;
};

export function Tabs<K extends string>(props: {
  label: string;
  tabs: TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const tabId = (k: K) => `${base}-tab-${k}`;
  const panelId = `${base}-panel`;

  // M6.5 review part 2, P2-9: on a narrow screen the open tab may sit past the row's edge (Payments has five), so the row scrolls to show it whenever the
  // open tab changes (a link to `?tab=refunds`, Back). Only the row's own box moves (never the page, as `scrollIntoView` could), and only when the tab is
  // outside it, by the least that shows it with a little of its neighbour. Again when a badge arrives (a wider tab can push it out).
  const shape = props.tabs.map((t) => `${t.key}:${t.badge?.text ?? ""}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shape` stands for the tabs' widths (labels and badges)
  useLayoutEffect(() => {
    const box = scroller.current;
    const tab = refs.current.get(props.selected);
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    const gap = 24;
    const b = box.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const left = t.left - b.left + box.scrollLeft;
    const right = t.right - b.left + box.scrollLeft;
    if (left < box.scrollLeft) box.scrollLeft = Math.max(0, left - gap);
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + gap;
  }, [props.selected, shape]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = props.tabs.length;
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    const next = props.tabs[to];
    if (next) refs.current.get(next.key)?.focus();
  }

  return (
    <div className="tabs">
      <div className="tabs__scroll" ref={scroller}>
        <div className="tabs__list" role="tablist" aria-label={props.label}>
          {props.tabs.map((t, i) => {
            const on = t.key === props.selected;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  if (el) refs.current.set(t.key, el);
                  else refs.current.delete(t.key);
                }}
                id={tabId(t.key)}
                type="button"
                role="tab"
                className="tabs__tab"
                aria-selected={on}
                aria-controls={on ? panelId : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => props.onSelect(t.key)}
                onKeyDown={(e) => onKey(e, i)}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              >
                {t.label}
                {t.badge && (
                  <>
                    <span className="tabs__badge" aria-hidden="true">
                      {t.badge.text}
                    </span>
                    <span className="visually-hidden">, {t.badge.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {/* The panel is a Tab stop of its own (APG), so a panel that starts with text is reachable straight from its tab. */}
      <div
        className="tabs__panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(props.selected)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern makes the panel focusable
        tabIndex={0}
      >
        {props.children}
      </div>
    </div>
  );
}
