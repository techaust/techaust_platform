import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import { can } from "@techaust/core/permissions";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { StepUpDialog } from "./components/step-up-dialog.tsx";
import { Card } from "./components/ui.tsx";
import { Home } from "./routes/home.tsx";
import { SignIn } from "./routes/sign-in.tsx";
import { SessionProvider, useSession } from "./session.tsx";

// Sign-in and the landing card are in the main chunk (every visit needs them). The invite, account and staff
// screens load with import() when opened, so the first load stays small (NFR-3: initial JS ≤ 250 KB gzip).

/** The invite screen works signed in or not; everything else needs a session (the sign-in screen otherwise). */
function Root() {
  const { user } = useSession();
  const { pathname } = useLocation();
  if (pathname === "/invite") return <Outlet />;
  if (user === undefined) {
    return (
      <Card title="TecHaust admin" busy>
        <p className="hint" role="status">
          Loading…
        </p>
      </Card>
    );
  }
  if (!user) return <SignIn />;
  return (
    <>
      <Outlet />
      <StepUpDialog />
    </>
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

const router = createBrowserRouter([
  {
    path: "/",
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
