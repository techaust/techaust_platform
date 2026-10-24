// The admin shell (docs/06 §5.3 AppShell; ADM-G-01): an ink side rail with the navigation, a top bar (search,
// notifications, account) and the content area (max 1440 px). The rail collapses to icons (64 px) and remembers
// that on this device; below md it becomes a drawer opened from the top bar. The current section is marked with
// aria-current and the brand's 45° cut (docs/06 §4.3).
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import symbolColor from "@techaust/ui/brand/logo-symbol-color.svg?url";
import symbolDark from "@techaust/ui/brand/logo-symbol-dark.svg?url";
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "../icons.tsx";
import type { NavItem, NavKey } from "./nav.tsx";

const NAV_KEY = "ta-admin-nav";
const narrowQuery = "(max-width: 63.99rem)";

function readCollapsedPref(): boolean | null {
  try {
    const v = localStorage.getItem(NAV_KEY);
    return v === "collapsed" ? true : v === "expanded" ? false : null;
  } catch {
    return null;
  }
}

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

export function AppShell(props: {
  /** The sections this role may open, in the PRD order (`navFor`). */
  items: NavItem[];
  current: NavKey | null;
  hrefOf: (item: NavItem) => string;
  homeHref: string;
  /** Global search; null when the role has nothing to search yet. */
  search: ReactNode;
  bell: ReactNode;
  account: ReactNode;
  children: ReactNode;
}) {
  const narrow = useMedia(narrowQuery);
  const [pref, setPref] = useState<boolean | null>(readCollapsedPref);
  const collapsed = pref ?? narrow;
  const [drawer, setDrawer] = useState(false);
  const navId = useId();

  function toggle() {
    const next = !collapsed;
    setPref(next);
    try {
      localStorage.setItem(NAV_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  }

  return (
    <div className="shell" data-collapsed={collapsed || undefined}>
      {/* biome-ignore lint/a11y/useValidAnchor: a real link to #main (it works without script); the click only skips the hash change */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Focus the content without changing the URL hash: a hash change is a navigation the router (and the
          // unsaved-changes guard) would have to handle.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="shell__rail" id={navId}>
        <SideNav
          items={props.items}
          current={props.current}
          hrefOf={props.hrefOf}
          homeHref={props.homeHref}
          collapsed={collapsed}
          footer={
            <button
              type="button"
              className="rail__toggle"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-controls={navId}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              <span className={collapsed ? "visually-hidden" : undefined}>
                {collapsed ? "Expand menu" : "Collapse menu"}
              </span>
            </button>
          }
        />
      </aside>
      <div className="shell__main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu"
            aria-label="Open menu"
            aria-haspopup="dialog"
            onClick={() => setDrawer(true)}
          >
            <Menu />
          </button>
          <Link to={props.homeHref} className="topbar__mark">
            {/* The top bar is light or dark with the theme: the symbol for that ground (the T stays ink on light). */}
            <img
              src={symbolColor}
              className="mark--on-light"
              alt="TecHaust admin, dashboard"
              width="28"
              height="28"
            />
            <img
              src={symbolDark}
              className="mark--on-dark"
              alt="TecHaust admin, dashboard"
              width="28"
              height="28"
            />
          </Link>
          <div className="topbar__search">{props.search}</div>
          <div className="topbar__end">
            {props.bell}
            {props.account}
          </div>
        </header>
        <main id="main" className="shell__content" tabIndex={-1}>
          {props.children}
        </main>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <SideNav
          items={props.items}
          current={props.current}
          hrefOf={props.hrefOf}
          homeHref={props.homeHref}
          collapsed={false}
          onNavigate={() => setDrawer(false)}
        />
      </Drawer>
    </div>
  );
}

function SideNav(props: {
  items: NavItem[];
  current: NavKey | null;
  hrefOf: (item: NavItem) => string;
  homeHref: string;
  collapsed: boolean;
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const groups = [0, 1, 2, 3, 4]
    .map((g) => props.items.filter((n) => n.group === g))
    .filter((items) => items.length > 0);
  const show = (label: string, el: HTMLElement) => {
    if (!props.collapsed) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTip(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tip]);
  useEffect(() => {
    if (!props.collapsed) setTip(null);
  }, [props.collapsed]);

  return (
    <div className="rail">
      <Link to={props.homeHref} className="rail__brand" onClick={props.onNavigate}>
        {props.collapsed ? (
          <img src={symbolDark} alt="TecHaust admin, dashboard" width="32" height="32" />
        ) : (
          <img src={logoDark} alt="TecHaust admin, dashboard" width="150" height="21" />
        )}
      </Link>
      <nav className="rail__nav" aria-label="Main">
        {groups.map((items) => (
          <ul key={items[0]?.key} className="rail__group">
            {items.map((item) => {
              const current = item.key === props.current;
              return (
                <li key={item.key}>
                  <Link
                    to={props.hrefOf(item)}
                    className="rail__link"
                    aria-current={current ? "page" : undefined}
                    onClick={props.onNavigate}
                    onMouseEnter={(e) => show(item.label, e.currentTarget)}
                    onMouseLeave={() => setTip(null)}
                    onFocus={(e) => show(item.label, e.currentTarget)}
                    onBlur={() => setTip(null)}
                  >
                    {item.icon}
                    <span className="rail__label">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>
      {props.footer && <div className="rail__foot">{props.footer}</div>}
      {tip && (
        <span className="rail__tip" style={{ top: tip.top }} aria-hidden="true">
          {tip.label}
        </span>
      )}
    </div>
  );
}

/** The navigation on narrow screens: a modal sheet from the left (native <dialog>: focus trap, Escape, inert page). */
function Drawer(props: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!props.open && d.open) {
      d.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    }
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label="Menu"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={() => undefined}
    >
      {props.open && (
        <>
          <button
            type="button"
            className="icon-btn drawer__close"
            aria-label="Close menu"
            onClick={props.onClose}
          >
            <X />
          </button>
          {props.children}
        </>
      )}
    </dialog>
  );
}
