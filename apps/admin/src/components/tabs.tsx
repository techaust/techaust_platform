// Tabs (docs/06 §5.3, WAI-ARIA Authoring Practices "Tabs with manual activation"): a tablist of buttons, one tab stop
// (the selected tab), arrow keys and Home / End move focus along the row, Enter or Space opens the focused tab. Manual
// activation because a tab's panel may load from the API. The selected tab is the caller's (the client page keeps it in
// the URL, `?tab=`). On narrow screens the row scrolls sideways inside its own box; the focused tab is kept in view.
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export type TabItem<K extends string> = { key: K; label: string };

export function Tabs<K extends string>(props: {
  label: string;
  tabs: TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());
  const tabId = (k: K) => `${base}-tab-${k}`;
  const panelId = `${base}-panel`;

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
      <div className="tabs__scroll">
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
