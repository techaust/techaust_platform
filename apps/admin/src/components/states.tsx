// The whole-screen states inside the shell (docs/06 §5.5): not found, no access, a section a later milestone builds,
// and a read that failed (offline or a server error) with a way to try again. Each has one h1 (PageHeader) so focus
// lands on it when the screen changes.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { errorText, RequestError } from "../api.ts";
import { notFoundLine } from "../lib/access.ts";
import { ROLE_LABELS, sentence } from "../lib/format.ts";
import { useUser } from "../session.tsx";
import { type Crumb, EmptyState, PageHeader } from "./display.tsx";
import { Compass, RefreshCw, ShieldAlert, WifiOff } from "./icons.tsx";
import { type NavKey, navItem } from "./shell/nav.tsx";

export function NotFound() {
  const user = useUser();
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={<Compass />}
        title="There's nothing at this address"
        action={
          <Link to="/" className="btn btn--primary">
            Go to the dashboard
          </Link>
        }
      >
        <p>{notFoundLine(user.role)}</p>
      </EmptyState>
    </>
  );
}

/** A 403 inside the shell: the page exists, this role can't open it. */
export function NoAccess({ what, crumbs }: { what: string; crumbs?: Crumb[] }) {
  const user = useUser();
  return (
    <>
      <PageHeader title="You don't have access" crumbs={crumbs} />
      <EmptyState
        icon={<ShieldAlert />}
        title={`${what} isn't open to your role`}
        action={
          <Link to="/" className="btn btn--secondary">
            Go to the dashboard
          </Link>
        }
      >
        <p>
          Your role is {ROLE_LABELS[user.role]}, which can't open this page. If you need it for your work, ask
          the owner to change your role.
        </p>
      </EmptyState>
    </>
  );
}

/** A section that a later milestone builds: what arrives and in which milestone, never a date. */
export function ComingSoon({ section }: { section: NavKey }) {
  const item = navItem(section);
  const user = useUser();
  const settings = user.role === "owner" || user.role === "accountant";
  return (
    <>
      <PageHeader title={item.label} />
      {item.arrives && (
        <EmptyState
          icon={item.icon}
          note={`Arrives in milestone ${item.arrives.milestone}`}
          title={`${item.label} isn't built yet`}
          action={
            settings ? (
              <Link to="/settings" className="btn btn--secondary">
                Go to settings
              </Link>
            ) : (
              <Link to="/account" className="btn btn--secondary">
                Go to your account
              </Link>
            )
          }
        >
          <p>{item.arrives.what}</p>
          <p className="hint">
            {settings
              ? "Until then, settings, users and the audit log are ready to use."
              : user.role === "staff" || user.role === "sales"
                ? "Until then, Leads, your account and its sign-in settings are ready to use."
                : "Until then, your account and its sign-in settings are ready to use."}
          </p>
        </EmptyState>
      )}
    </>
  );
}

/** A read failed: say what happened (offline, or the server's words) and offer to try again. */
export function LoadFailed({
  error,
  onRetry,
  headingLevel,
}: {
  error: unknown;
  onRetry: () => void;
  headingLevel?: 2 | 3;
}) {
  const offline = error instanceof RequestError ? error.code === "network" : true;
  return (
    <div role="alert">
      <EmptyState
        icon={offline ? <WifiOff /> : <RefreshCw />}
        headingLevel={headingLevel}
        title={offline ? "You seem to be offline" : "This didn't load"}
        action={
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            <RefreshCw />
            Try again
          </button>
        }
      >
        <p>
          {offline
            ? "The admin couldn't reach the server. Check your connection, then try again."
            : `${sentence(errorText(error))} Try again in a moment.`}
        </p>
      </EmptyState>
    </div>
  );
}

export type Loaded<T> =
  | { state: "loading"; data?: undefined; error?: undefined }
  | { state: "ready"; data: T; error?: undefined }
  | { state: "failed"; data?: undefined; error: unknown };

/**
 * Load something when a screen opens (and again on `reload`). A later answer never overwrites a newer one, and a screen
 * that closed while the request ran ignores it. `quiet` reloads keep the old data on screen while the new one comes.
 * `key`: what the load depends on (a new key loads again), e.g. the query string of a list.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [s, set] = useState<Loaded<T>>({ state: "loading" });
  const seq = useRef(0);
  const latest = useRef(load);
  latest.current = load;
  const run = useCallback((quiet = false) => {
    const n = ++seq.current;
    if (!quiet) set({ state: "loading" });
    latest.current().then(
      (data) => {
        if (n === seq.current) set({ state: "ready", data });
      },
      (error) => {
        if (n === seq.current) set({ state: "failed", error });
      },
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key is a new load
  useEffect(() => {
    run();
    return () => {
      seq.current++;
    };
  }, [run, key]);
  return { ...s, reload: run } as Loaded<T> & { reload: (quiet?: boolean) => void };
}

/**
 * Someone else saved first (409 `stale_version`): say so, keep nothing half-saved, offer the latest. It takes focus and
 * scrolls into view, because it appears after a save from anywhere on the page. `title` names what changed (settings by
 * default; the lead page passes its own).
 */
export function StaleNotice({
  onReload,
  title,
  body,
}: {
  onReload: () => void;
  title?: ReactNode;
  /** Replaces the default "Reload … Nothing of yours was saved." when that isn't true (the lead page's draft conflict). */
  body?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div className="notice notice--error stale" role="alert" ref={ref} tabIndex={-1}>
      <RefreshCw size={20} />
      <div>
        <p>
          <strong>{title ?? "Someone saved these settings since you opened them."}</strong>{" "}
          {body ?? "Reload to see the latest, then make your change again. Nothing of yours was saved."}
        </p>
        <button type="button" className="btn btn--secondary" onClick={onReload}>
          Reload the latest
        </button>
      </div>
    </div>
  );
}
