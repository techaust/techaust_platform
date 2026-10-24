import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import "./shell.css";
import { can } from "@techaust/core/permissions";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { StepUpDialog } from "./components/step-up-dialog.tsx";
import { Card } from "./components/ui.tsx";
import { applyStoredTheme } from "./lib/theme.ts";
import { Home } from "./routes/home.tsx";
import { SignIn } from "./routes/sign-in.tsx";
import { SessionProvider, useSession } from "./session.tsx";

// The theme chosen on this device (system, light or dark), before the first paint.
applyStoredTheme();

// Sign-in and the landing card are in the main chunk (every visit needs them). The invite, account and staff
// screens load with import() when opened, so the first load stays small (NFR-3: initial JS ≤ 250 KB gzip).

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

function OwnerOnly({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return user && can(user.role, "users.read") ? children : <Navigate to="/" replace />;
}

function NotFound() {
  return (
    <Card title="Page not found" back={{ to: "/", label: "Home" }}>
      <p>There's nothing at this address.</p>
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

const router = createBrowserRouter([
  // M3.1 design preview: `vite dev` only. In a build `import.meta.env.DEV` is the literal false, so this entry, its
  // import() and the whole src/preview folder (sample data included) are left out of the bundle.
  ...(import.meta.env.DEV
    ? [{ path: "/preview/*", HydrateFallback: Loading, lazy: () => import("./preview/index.tsx") }]
    : []),
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
      { index: true, element: <Home /> },
      { path: "invite", lazy: () => import("./routes/invite.tsx") },
      { path: "account", lazy: () => import("./routes/account.tsx") },
      {
        path: "users",
        lazy: async () => {
          const { Component } = await import("./routes/users.tsx");
          return {
            Component: () => (
              <OwnerOnly>
                <Component />
              </OwnerOnly>
            ),
          };
        },
      },
      { path: "*", element: <NotFound /> },
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
