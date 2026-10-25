import "./lib/zod-jitless.ts"; // first: it must run before any module builds a zod schema (CSP: no 'unsafe-eval')
import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  type RouteObject,
  RouterProvider,
  useLocation,
} from "react-router";
import { StepUpDialog } from "./components/step-up-dialog.tsx";
import { Card } from "./components/ui.tsx";
import { applyStoredTheme } from "./lib/theme.ts";
import { SignIn } from "./routes/sign-in.tsx";
import { SessionProvider, useSession } from "./session.tsx";

// The theme chosen on this device (system, light or dark), before the first paint.
applyStoredTheme();

// Sign-in is in the main chunk (every visit needs it). The shell (with shell.css) and every screen inside it load with
// import() once someone is signed in, so the first load stays small (NFR-3: initial JS ≤ 250 KB gzip).

/** The invite screen works signed in or not; everything else needs a session (the sign-in screen otherwise). */
function Root() {
  const { user } = useSession();
  const { pathname } = useLocation();
  if (pathname === "/invite") return <Outlet />;
  if (user === undefined) return <Loading />;
  if (!user) return <SignIn />;
  return (
    <>
      <Outlet />
      <StepUpDialog />
    </>
  );
}

/** While the session (or the first screen's code) loads. */
function Loading() {
  return (
    <Card title="TecHaust admin" busy>
      <p className="hint" role="status">
        Loading…
      </p>
    </Card>
  );
}

/** A screen failed to load or crashed (e.g. its code changed with a new release): a calm way out, no stack trace. */
function Failed() {
  return (
    <Card title="This screen didn't load">
      <p>Reload the page to try again. If it keeps happening, tell the owner.</p>
      <button type="button" className="btn btn--primary btn--block" onClick={() => location.reload()}>
        Reload
      </button>
    </Card>
  );
}

const shell = () => import("./routes/shell.tsx");
const settings = () => import("./routes/settings.tsx");

// Dev only: the M4.5 send-dialog preview with sample data (dropped from every build with its import).
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/preview/send",
        HydrateFallback: Loading,
        errorElement: <Failed />,
        lazy: async () => ({ Component: (await import("./preview/send.tsx")).SendPreview }),
      },
    ]
  : [];

const router = createBrowserRouter([
  ...devRoutes,
  {
    path: "/",
    HydrateFallback: Loading,
    errorElement: <Failed />,
    element: (
      <SessionProvider>
        <Root />
      </SessionProvider>
    ),
    children: [
      { path: "invite", lazy: () => import("./routes/invite.tsx") },
      {
        lazy: shell,
        children: [
          { index: true, lazy: async () => ({ Component: (await shell()).Dashboard }) },
          { path: "account", lazy: () => import("./routes/account.tsx") },
          { path: "settings", lazy: async () => ({ Component: (await settings()).SettingsIndex }) },
          { path: "settings/users", lazy: () => import("./routes/users.tsx") },
          { path: "settings/:group", lazy: async () => ({ Component: (await settings()).SettingsGroup }) },
          { path: "audit", lazy: () => import("./routes/audit.tsx") },
          { path: "leads", lazy: () => import("./routes/leads.tsx") },
          { path: "leads/new", lazy: () => import("./routes/leads/new.tsx") },
          { path: "leads/:id", lazy: () => import("./routes/leads/lead.tsx") },
          { path: "clients", lazy: () => import("./routes/clients.tsx") },
          { path: "clients/new", lazy: () => import("./routes/clients/new.tsx") },
          { path: "clients/:id", lazy: () => import("./routes/clients/client.tsx") },
          // The M1.5 address of the staff screen.
          { path: "users", element: <Navigate to="/settings/users" replace /> },
          { path: ":section/*", lazy: async () => ({ Component: (await shell()).Section }) },
        ],
      },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
