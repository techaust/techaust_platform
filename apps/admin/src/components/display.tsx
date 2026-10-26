// Display pieces of the admin shell (docs/06 §5.3): PageHeader with breadcrumbs, StatusPill, EmptyState, the
// IST time with its relative form, and skeletons. Tokens only; the styles are in shell.css.

import { formatIstDateTime } from "@techaust/core";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { relative } from "../lib/format.ts";
import {
  Archive,
  Ban,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  Inbox,
  Lock,
  Pencil,
  RefreshCw,
  Send,
} from "./icons.tsx";
import { MenuButton, type MenuItem } from "./popover.tsx";

// The first screen of a visit keeps focus where the browser put it (React Router's first location has the key
// "default"); after that, every screen change moves focus to the new h1, so keyboard and screen-reader users start
// at the top of what changed.

export type Crumb = { label: string; to?: string | undefined };

export function PageHeader(props: {
  title: string;
  crumbs?: Crumb[] | undefined;
  lede?: ReactNode | undefined;
  /** The primary action (one button). */
  action?: ReactNode | undefined;
  /** Secondary actions, in an overflow menu. */
  more?: MenuItem[] | undefined;
  /** A status shown beside the title. */
  status?: ReactNode | undefined;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const { key, pathname } = useLocation();
  // Only a new path moves focus: filters and paging change the query string and keep focus where it is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the path changes, not on every query change
  useEffect(() => {
    if (key !== "default") h1.current?.focus();
  }, [pathname]);
  return (
    <header className="page-header">
      {props.crumbs && props.crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="crumbs">
          <ol>
            {props.crumbs.map((c) => (
              <li key={c.label}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                <ChevronRight size={16} />
              </li>
            ))}
            <li>
              <span aria-current="page">{props.title}</span>
            </li>
          </ol>
        </nav>
      )}
      <div className="page-header__row">
        <div className="page-header__title">
          <h1 ref={h1} tabIndex={-1}>
            {props.title}
          </h1>
          {props.status}
        </div>
        {(props.action || props.more) && (
          <div className="page-header__actions">
            {props.more && <MenuButton label="More actions" text="More" items={props.more} />}
            {props.action}
          </div>
        )}
      </div>
      {props.lede && <p className="page-header__lede">{props.lede}</p>}
    </header>
  );
}

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info" | "muted";

const PILL_ICON = {
  pencil: Pencil,
  check: CheckCircle,
  clock: Clock,
  send: Send,
  ban: Ban,
  lock: Lock,
  inbox: Inbox,
  flag: Flag,
  eye: Eye,
  archive: Archive,
  calendar: Calendar,
  progress: RefreshCw,
} as const;

/** Icon + text + colour, never colour alone (docs/06 §5.5). */
export function StatusPill(props: {
  tone: PillTone;
  icon: keyof typeof PILL_ICON;
  children: ReactNode;
  outline?: boolean | undefined;
}) {
  const I = PILL_ICON[props.icon];
  return (
    <span className={`spill spill--${props.tone}${props.outline ? " spill--outline" : ""}`}>
      <I size={16} />
      {props.children}
    </span>
  );
}

export function EmptyState(props: {
  title: string;
  children: ReactNode;
  icon?: ReactNode | undefined;
  action?: ReactNode | undefined;
  /** A small line above the title, e.g. which milestone brings this section. */
  note?: ReactNode | undefined;
  headingLevel?: 2 | 3 | undefined;
}) {
  const H = props.headingLevel === 3 ? "h3" : "h2";
  return (
    <div className="empty-state">
      {props.icon && <span className="empty-state__icon">{props.icon}</span>}
      {props.note && <p className="empty-state__note">{props.note}</p>}
      <H className="empty-state__title">{props.title}</H>
      <div className="empty-state__body">{props.children}</div>
      {props.action && <div className="empty-state__action">{props.action}</div>}
    </div>
  );
}

/** A time as people read it: IST date and time, with how long ago underneath (both visible, docs/06 §5.3). */
export function When({ ms, now, inline }: { ms: number | null; now?: number; inline?: boolean }) {
  if (ms === null) return <span className="when when--never">Never</span>;
  const abs = formatIstDateTime(ms);
  return (
    <span className={inline ? "when when--inline" : "when"}>
      <time dateTime={new Date(ms).toISOString()}>{abs}</time>
      <span className="when__rel">{relative(ms, now)}</span>
    </span>
  );
}

/** A sentence whose dates ("26 Oct 2026") never break across two lines; the words around them wrap as usual. */
export function KeepDates({ text }: { text: string }) {
  const parts = text.split(/(\d{1,2} [A-Z][a-z]{2} \d{4})/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence, never reordered
          <span key={i} className="when--keep">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function Skeleton({ width }: { width?: string }) {
  return <span className="skeleton" style={width ? { width } : undefined} />;
}
