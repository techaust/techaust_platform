// The signed-in frame (ADM-G-01, ADM-G-05, ADM-G-09): the rail for this role, global search, the bell and the account
// menu around every signed-in screen. Loaded with import() after sign-in, with its own stylesheet (shell.css), so the
// sign-in screen's first paint carries neither.
import "../shell.css";
import "../screens.css";
import type { Role } from "@techaust/core/permissions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { type Notification as ApiNotification, api, errorText, paymentsApi } from "../api.ts";
import {
  Building,
  FileText,
  FolderKanban,
  Inbox,
  Package,
  Receipt,
  User,
  Users,
} from "../components/icons.tsx";
import { AppShell } from "../components/shell/app-shell.tsx";
import { GlobalSearch, type SearchGroup } from "../components/shell/global-search.tsx";
import { type NavItem, navFor, navItem } from "../components/shell/nav.tsx";
import { AccountMenu, NotificationBell } from "../components/shell/top-menus.tsx";
import { ComingSoon, NoAccess, NotFound } from "../components/states.tsx";
import { ToastProvider } from "../components/toast.tsx";
import { allowed, canSee, sectionOf } from "../lib/access.ts";
import { reportBellHref } from "../lib/bell-links.ts";
import { ROLE_LABELS } from "../lib/format.ts";
import { GW_UI } from "../lib/gateway.ts";
import { useSession, useUser } from "../session.tsx";

const hrefOf = (item: NavItem) => item.path;
/** How often the bell asks for new notifications while the tab is visible. */
const BELL_POLL_MS = 120_000;

const SEARCH_ICONS = {
  lead: <Inbox />,
  user: <Users />,
  client: <Building />,
  contact: <User />,
  project: <FolderKanban />,
  catalogue: <Package />,
  document: <FileText />,
  invoice: <Receipt />,
} as const;

async function runSearch(q: string): Promise<SearchGroup[]> {
  const r = await api.search(q);
  return r.groups.map((g) => ({
    label: g.label,
    icon: SEARCH_ICONS[g.type],
    results: g.items.map((i) => ({
      id: `${g.type}-${i.id}`,
      title: i.title,
      // Staff results end with the role as stored ("…, owner"): shown as its label.
      sub:
        g.type === "invoice"
          ? // Invoice results end with the status as stored ("…, issued"): shown as its 07-R badge word.
            i.subtitle.replace(/, (issued|void)$/, (_, st: string) => (st === "void" ? ", Void" : ", Issued"))
          : i.subtitle.replace(/, (owner|staff|sales|accountant)$/, (_, r: Role) => `, ${ROLE_LABELS[r]}`),
      href: i.link,
    })),
  }));
}

/**
 * What the box can find for this role today (leads with leads.read; clients by code or name and contacts by email
 * with clients.read, M3.3; staff for the owner), or null for nothing.
 */
/** 07-O §7: the box for a role that also finds proposals and estimates (kept here, not in lib/documents, so the main chunk stays small). */
const SEARCH_BOX = {
  intro: "Search by the start of a name, code or number.",
} as const;

function searchCopy(
  canLeads: boolean,
  canClients: boolean,
  canUsers: boolean,
  canProjects = false,
  canDocuments = false,
) {
  const list = (xs: string[]) =>
    xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  // 07-Q Q1: a role that finds documents gets the 07-O §7 box, built from what it may search in the same words (the owner
  // reads it whole; the Accountant reads "Search clients and documents").
  if (canDocuments) {
    const words = [
      canLeads && "leads",
      canClients && "clients",
      canProjects && "projects",
      "documents",
      canUsers && "people",
    ].filter((k): k is string => typeof k === "string");
    return { placeholder: `Search ${list(words)}`, intro: SEARCH_BOX.intro };
  }
  const kinds = [
    canLeads && "leads",
    canClients && "clients",
    canProjects && "projects",
    canUsers && "staff",
  ].filter((k): k is string => typeof k === "string");
  if (!kinds.length) return null;
  const finds = [
    canLeads && "a lead by its reference or email",
    canClients && "a client by its code or name, or a contact by email",
    canProjects && "a project by its code or name",
    canUsers && "a staff member by name or email",
  ].filter((k): k is string => typeof k === "string");
  const findList =
    finds.length < 2 ? (finds[0] ?? "") : `${finds.slice(0, -1).join("; ")}; or ${finds.at(-1)}`;
  return { placeholder: `Search ${list(kinds)}`, intro: `Find ${findList}.` };
}

function useBell() {
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    api.notifications().then(
      (r) => {
        busy.current = false;
        setItems(r.notifications);
        setUnread(r.unread);
        setNext(r.next);
        setError(null);
      },
      (e) => {
        busy.current = false;
        setError(`Couldn't load notifications. ${errorText(e)}`);
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, BELL_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const more = useCallback(() => {
    if (!next) return;
    api.notifications(next).then(
      (r) => {
        setItems((list) => [...list, ...r.notifications.filter((n) => !list.some((x) => x.id === n.id))]);
        setUnread(r.unread);
        setNext(r.next);
      },
      (e) => setError(`Couldn't load older notifications. ${errorText(e)}`),
    );
  }, [next]);

  const markRead = useCallback(
    (id: string) => {
      const was = items.find((n) => n.id === id);
      if (!was || was.readAt !== null) return;
      setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
      setUnread((u) => Math.max(0, u - 1));
      api.readNotification(id).catch(refresh);
    },
    [items, refresh],
  );

  const markAll = useCallback(() => {
    const t = Date.now();
    setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? t })));
    setUnread(0);
    api.readAllNotifications().catch(refresh);
  }, [refresh]);

  return { items, unread, next, error, refresh, more, markRead, markAll };
}

/**
 * M6.2 (run file G2): the Owner's open "Needs review" items, the count on the Payments item. Read when a section opens and with the bell's poll while the tab is
 * visible; a failed read keeps the last count (it is a hint, the tab is the record).
 */
function useReviewCount(enabled: boolean, pathname: string) {
  const [n, setN] = useState(0);
  const read = useCallback(() => {
    if (!enabled) return;
    paymentsApi.review({ status: "open" }).then(
      (r) => setN(r.openCount),
      () => {},
    );
  }, [enabled]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new section is a fresh read
  useEffect(() => {
    read();
  }, [read, pathname]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, BELL_POLL_MS);
    return () => clearInterval(t);
  }, [enabled, read]);
  return n;
}

export function Component() {
  const user = useUser();
  const { signedOut } = useSession();
  const { pathname } = useLocation();
  const items = useMemo(() => navFor(user.role), [user.role]);
  const bell = useBell();
  const copy = searchCopy(
    allowed(user.role, "leads.read"),
    allowed(user.role, "clients.read"),
    allowed(user.role, "users.read"),
    allowed(user.role, "projects.read"),
    allowed(user.role, "proposals.read"),
  );
  const current = sectionOf(pathname);
  const reviewCount = useReviewCount(allowed(user.role, "payments.review"), pathname);

  function signOut() {
    api.logout().then(
      () => signedOut("You've signed out."),
      () => signedOut("You've signed out."),
    );
  }

  return (
    <ToastProvider>
      <AppShell
        items={items}
        current={current && items.some((i) => i.key === current) ? current : null}
        hrefOf={hrefOf}
        homeHref="/"
        badges={
          reviewCount > 0
            ? {
                payments: {
                  text: reviewCount > 99 ? "99+" : String(reviewCount),
                  label: GW_UI.reviewCount(reviewCount),
                },
              }
            : undefined
        }
        search={
          copy ? <GlobalSearch search={runSearch} placeholder={copy.placeholder} intro={copy.intro} /> : null
        }
        bell={
          <NotificationBell
            items={bell.items.map((n) => ({
              id: n.id,
              title: n.title,
              at: n.createdAt,
              // M5.2: the LUT reminder (07-S §8 "File the LUT for FY … and save its ARN in Settings › Tax.") lands on the list of letters itself.
              // M5.5b: an export stage lands on the realisation list with its invoice marked (lib/reports.ts).
              href:
                n.kind === "lut.reminder" && !n.link.includes("#")
                  ? `${n.link}#luts`
                  : reportBellHref(n.kind, n.link),
              unread: n.readAt === null,
            }))}
            unread={bell.unread}
            error={bell.error}
            onOpen={bell.refresh}
            onOpenItem={bell.markRead}
            onMarkAllRead={bell.markAll}
            onMore={bell.next ? bell.more : undefined}
          />
        }
        account={<AccountMenu user={user} accountHref="/account" onSignOut={signOut} />}
      >
        <Outlet />
      </AppShell>
    </ToastProvider>
  );
}

/** `/:section/*` for the sections a later milestone builds (Leads, Clients…): "coming soon", or 404 for any other name. */
export function Section() {
  const { section } = useParams();
  const user = useUser();
  const key = section ? sectionOf(`/${section}`) : null;
  // Built sections have their own routes; an unknown address under one of them is a 404.
  if (!key || key === "dashboard" || !navItem(key).arrives) return <NotFound />;
  return canSee(user.role, key) ? <ComingSoon section={key} /> : <NoAccess what={navItem(key).label} />;
}
