// Popovers and menus without a library (docs/06 §5.1: WAI-ARIA Authoring Practices exactly).
// - usePopover: a disclosure (button + panel). Escape closes and returns focus to the button; a click outside or
//   focus moving out closes it quietly. Used by the bell and the account panel (links and buttons, not a menu).
// - MenuButton: the APG menu-button pattern for row actions: arrow keys, Home/End, first-letter jump, Escape and
//   Tab close it; choosing an item puts focus back on the button before the action runs (so a dialog it opens
//   returns focus there too).
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "./icons.tsx";

export function usePopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, close]);

  return { open, setOpen, close, wrapRef, triggerRef, toggle: () => setOpen((o) => !o) };
}

export type MenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode | undefined;
  tone?: "danger" | undefined;
};

export function MenuButton(props: {
  /** The accessible name, e.g. "Actions for Arjun Menon". */
  label: string;
  items: MenuItem[];
  /** Visible text on the button; without it the button shows the "more" icon only. */
  text?: string | undefined;
  align?: "start" | "end" | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { items } = props;

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function openAt(i: number) {
    setActive(i);
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onButtonKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt(items.length - 1);
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    const last = items.length - 1;
    if (e.key === "ArrowDown") setActive((i) => (i >= last ? 0 : i + 1));
    else if (e.key === "ArrowUp") setActive((i) => (i <= 0 ? last : i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Escape") closeMenu();
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const from = active + 1;
      const order = [...items.slice(from), ...items.slice(0, from)];
      const hit = order.find((it) => it.label.toLowerCase().startsWith(k));
      if (hit) setActive(items.indexOf(hit));
    } else return;
    e.preventDefault();
  }

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={props.text ? "btn btn--secondary" : "icon-btn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={props.text ? undefined : props.label}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={onButtonKey}
      >
        {props.text ?? <MoreHorizontal />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={props.label}
          className={props.align === "start" ? "menu__list menu__list--start" : "menu__list"}
          onKeyDown={onMenuKey}
        >
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              className={it.tone === "danger" ? "menu__item menu__item--danger" : "menu__item"}
              onClick={() => {
                closeMenu();
                it.onSelect();
              }}
              onMouseEnter={() => setActive(i)}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
