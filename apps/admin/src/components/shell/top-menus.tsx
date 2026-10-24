// The bell (ADM-G-09) and the account panel in the top bar. Both are disclosures (a button and a panel of links
// and buttons), not ARIA menus: they hold ordinary links, a radio group and a sign-out button.

import type { Role } from "@techaust/core/permissions";
import { useId } from "react";
import { Link } from "react-router";
import { ROLE_LABELS, relative } from "../../lib/format.ts";
import { setTheme, THEME_LABELS, THEME_PREFS, useTheme } from "../../lib/theme.ts";
import { Bell, ChevronDown, LogOut, Monitor, Moon, Sun, User as UserIcon } from "../icons.tsx";
import { usePopover } from "../popover.tsx";

export type Notification = {
  id: string;
  title: string;
  detail: string;
  at: number;
  href: string;
  unread: boolean;
};

export function NotificationBell(props: {
  items: Notification[];
  onOpenItem: (id: string) => void;
  onMarkAllRead: () => void;
  now?: number;
}) {
  const p = usePopover();
  const panelId = useId();
  const unread = props.items.filter((n) => n.unread).length;
  return (
    <div className="pop" ref={p.wrapRef}>
      <button
        ref={p.triggerRef}
        type="button"
        className="icon-btn bell"
        aria-expanded={p.open}
        aria-controls={panelId}
        onClick={p.toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell />
        {unread > 0 && (
          <span className="bell__count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <div id={panelId} className="pop__panel notes" hidden={!p.open}>
        <div className="notes__head">
          <h2 className="notes__title">Notifications</h2>
          {unread > 0 && (
            <button type="button" className="btn btn--text" onClick={props.onMarkAllRead}>
              Mark all as read
            </button>
          )}
        </div>
        {props.items.length === 0 ? (
          <p className="notes__empty">Nothing new. New leads and other alerts will show here.</p>
        ) : (
          <ul className="notes__list">
            {props.items.map((n) => (
              <li key={n.id}>
                <Link
                  to={n.href}
                  className="notes__item"
                  data-unread={n.unread || undefined}
                  onClick={() => {
                    props.onOpenItem(n.id);
                    p.close(false);
                  }}
                >
                  <span className="notes__dot" aria-hidden="true" />
                  <span className="notes__body">
                    <span className="notes__item-title">
                      {n.unread && <span className="visually-hidden">Unread: </span>}
                      {n.title}
                    </span>
                    <span className="notes__detail">{n.detail}</span>
                    <span className="notes__time">{relative(n.at, props.now)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

export function AccountMenu(props: {
  user: { name: string; email: string; role: Role };
  accountHref: string;
  onSignOut: () => void;
}) {
  const p = usePopover();
  const panelId = useId();
  const theme = useTheme();
  const initials = props.user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className="pop" ref={p.wrapRef}>
      <button
        ref={p.triggerRef}
        type="button"
        className="account__btn"
        aria-expanded={p.open}
        aria-controls={panelId}
        onClick={p.toggle}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account__name">
          <span className="visually-hidden">Account: </span>
          {props.user.name}
        </span>
        <ChevronDown size={16} />
      </button>
      <div id={panelId} className="pop__panel account" hidden={!p.open}>
        <div className="account__who">
          <p className="account__who-name">{props.user.name}</p>
          <p className="account__who-email">{props.user.email}</p>
          <span className="pill">{ROLE_LABELS[props.user.role]}</span>
        </div>
        <ul className="account__links">
          <li>
            <Link to={props.accountHref} className="account__link" onClick={() => p.close(false)}>
              <UserIcon />
              Your account
            </Link>
          </li>
        </ul>
        <fieldset className="theme-pick">
          <legend>Theme</legend>
          <div className="theme-pick__row">
            {THEME_PREFS.map((t) => {
              const I = THEME_ICONS[t];
              return (
                <label key={t} className="theme-pick__opt">
                  <input
                    type="radio"
                    name="admin-theme"
                    value={t}
                    checked={theme === t}
                    onChange={() => setTheme(t)}
                  />
                  <I size={16} />
                  {THEME_LABELS[t]}
                </label>
              );
            })}
          </div>
        </fieldset>
        <button type="button" className="account__link account__signout" onClick={props.onSignOut}>
          <LogOut />
          Sign out
        </button>
      </div>
    </div>
  );
}
