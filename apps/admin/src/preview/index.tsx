// M3.1 DESIGN PREVIEW (dev server only). main.tsx adds /preview/* only when `import.meta.env.DEV` is true, so the
// production build has no preview route, no sample data and no preview chunk (checked after `vite build`).
// Everything here is sample data; nothing is saved or sent and no API is called.
import "./preview.css";
import { useCallback, useState } from "react";
import { Link, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { EmptyState, PageHeader } from "../components/display.tsx";
import {
  AlertTriangle,
  Building,
  Compass,
  FileText,
  FolderKanban,
  Inbox,
  ShieldAlert,
  User,
} from "../components/icons.tsx";
import { AppShell } from "../components/shell/app-shell.tsx";
import { GlobalSearch, type SearchGroup } from "../components/shell/global-search.tsx";
import { NAV, type NavItem, type NavKey, navItem } from "../components/shell/nav.tsx";
import { AccountMenu, NotificationBell } from "../components/shell/top-menus.tsx";
import { ToastProvider, useToast } from "../components/toast.tsx";
import { AuditPreview } from "./audit.tsx";
import { ME, NOTIFICATIONS, NOW, SEARCH } from "./sample.ts";
import { SettingsGroupPreview, SettingsIndexPreview } from "./settings.tsx";
import { StatesPreview } from "./states.tsx";
import { UsersPreview } from "./users.tsx";

export const P = "/preview";

const hrefOf = (item: NavItem) =>
  item.key === "dashboard"
    ? `${P}/shell`
    : item.key === "settings"
      ? `${P}/settings`
      : item.key === "audit"
        ? `${P}/audit`
        : `${P}/shell/${item.key}`;

const sectionHref = (section: string) =>
  section === "users" ? `${P}/users` : section === "audit" ? `${P}/audit` : `${P}/shell/${section}`;

const ICONS = {
  Leads: <Inbox />,
  Clients: <Building />,
  Contacts: <User />,
  Projects: <FolderKanban />,
  Documents: <FileText />,
};

function search(q: string): SearchGroup[] {
  const t = q.toLowerCase();
  const hits = SEARCH.filter((h) => `${h.title} ${h.sub}`.toLowerCase().includes(t));
  return (Object.keys(ICONS) as (keyof typeof ICONS)[]).map((label) => ({
    label,
    icon: ICONS[label],
    results: hits
      .filter((h) => h.type === label)
      .map((h) => ({ id: `${h.type}-${h.title}`, title: h.title, sub: h.sub, href: sectionHref(h.section) })),
  }));
}

function currentKey(pathname: string): NavKey | null {
  const rest = pathname.slice(P.length + 1);
  if (rest === "" || rest === "shell") return "dashboard";
  if (rest.startsWith("shell/")) {
    const k = rest.slice(6) as NavKey;
    return NAV.some((n) => n.key === k) ? k : null;
  }
  if (rest.startsWith("settings") || rest.startsWith("users")) return "settings";
  if (rest.startsWith("audit")) return "audit";
  return null;
}

const SCREENS = [
  { to: `${P}/shell`, label: "Shell" },
  { to: `${P}/users`, label: "Users" },
  { to: `${P}/settings`, label: "Settings" },
  { to: `${P}/audit`, label: "Audit log" },
  { to: `${P}/states`, label: "States" },
];

function Banner() {
  return (
    <div className="pv-band">
      <p className="pv-band__label">
        <AlertTriangle size={16} />
        <strong>Preview — sample data.</strong>
        <span className="pv-band__more"> Nothing here is saved or sent.</span>
      </p>
      <nav aria-label="Preview screens" className="pv-band__nav">
        {SCREENS.map((s) => (
          <Link key={s.to} to={s.to}>
            {s.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Frame() {
  const { pathname } = useLocation();
  const toast = useToast();
  const [notes, setNotes] = useState(() =>
    NOTIFICATIONS.map((n) => ({ ...n, href: sectionHref(n.section) })),
  );
  const markRead = useCallback(
    (id: string) => setNotes((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n))),
    [],
  );
  return (
    <AppShell
      current={currentKey(pathname)}
      hrefOf={hrefOf}
      homeHref={`${P}/shell`}
      banner={<Banner />}
      search={<GlobalSearch search={search} />}
      bell={
        <NotificationBell
          items={notes}
          now={NOW}
          onOpenItem={markRead}
          onMarkAllRead={() => setNotes((list) => list.map((n) => ({ ...n, unread: false })))}
        />
      }
      account={
        <AccountMenu
          user={ME}
          accountHref={`${P}/account`}
          onSignOut={() => toast("success", "Preview: signing out is switched off here.")}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}

function ComingSoon({ k }: { k: NavKey }) {
  const item = navItem(k);
  return (
    <>
      <PageHeader title={item.label} />
      {item.arrives && (
        <EmptyState
          icon={item.icon}
          note={`Arrives in milestone ${item.arrives.milestone}`}
          title={`${item.label} isn't built yet`}
          action={
            <Link to={`${P}/settings`} className="btn btn--secondary">
              Go to settings
            </Link>
          }
        >
          <p>{item.arrives.what}</p>
          <p className="hint">Until then, settings, users and the audit log are ready to use.</p>
        </EmptyState>
      )}
    </>
  );
}

function SectionSoon() {
  const { section } = useParams();
  const item = NAV.find((n) => n.key === section && n.arrives);
  return item ? <ComingSoon k={item.key} /> : <NotFound />;
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={<Compass />}
        title="There's nothing at this address"
        action={
          <Link to={`${P}/shell`} className="btn btn--primary">
            Go to the dashboard
          </Link>
        }
      >
        <p>The link may be old, or the record was removed. Use search above, or start from the dashboard.</p>
      </EmptyState>
    </>
  );
}

export function NoAccess() {
  return (
    <>
      <PageHeader title="You don't have access" crumbs={[{ label: "Settings", to: `${P}/settings` }]} />
      <EmptyState
        icon={<ShieldAlert />}
        title="Bank details are for the owner"
        action={
          <Link to={`${P}/shell`} className="btn btn--secondary">
            Go to the dashboard
          </Link>
        }
      >
        <p>
          Your role is Staff, which can't open this page. If you need it for your work, ask the owner to
          change your role.
        </p>
      </EmptyState>
    </>
  );
}

function AccountStub() {
  return (
    <>
      <PageHeader title="Your account" />
      <EmptyState icon={<User />} title="Your account moves into the shell">
        <p>
          Where you're signed in, signing out elsewhere and your recovery codes: the screen built in M1.5,
          shown inside this frame after the build. It needs a real sign-in, so the preview doesn't show it.
        </p>
      </EmptyState>
    </>
  );
}

function PreviewIndex() {
  return (
    <>
      <PageHeader
        title="Admin design preview"
        lede="The admin shell and its key screen types with sample data, for the owner's approval before the build (M3.1)."
      />
      <ul className="pv-index">
        {[
          {
            to: `${P}/shell`,
            t: "Shell",
            d: "Navigation, search, notifications, account menu, theme, a section that's coming soon.",
          },
          {
            to: `${P}/users`,
            t: "Users",
            d: "A list with filters in the address, sorting, paging, row actions and the invite dialog.",
          },
          {
            to: `${P}/settings`,
            t: "Settings",
            d: "All ten groups; company profile and bank details in full.",
          },
          {
            to: `${P}/audit`,
            t: "Audit log",
            d: "Who did what and when, with before and after for changes.",
          },
          {
            to: `${P}/states`,
            t: "States",
            d: "Toasts, a confirmation with the code, form errors, no access, not found.",
          },
        ].map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="pv-index__link">
              <span className="pv-index__title">{s.t}</span>
              <span className="pv-index__desc">{s.d}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Component() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Frame />}>
          <Route index element={<PreviewIndex />} />
          <Route path="shell" element={<ComingSoon k="dashboard" />} />
          <Route path="shell/:section" element={<SectionSoon />} />
          <Route path="users" element={<UsersPreview />} />
          <Route path="settings" element={<SettingsIndexPreview />} />
          <Route path="settings/:group" element={<SettingsGroupPreview />} />
          <Route path="audit" element={<AuditPreview />} />
          <Route path="states" element={<StatesPreview />} />
          <Route path="states/403" element={<NoAccess />} />
          <Route path="account" element={<AccountStub />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
