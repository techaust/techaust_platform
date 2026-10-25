// The client portal SPA. M1.6 (portal auth): sign in with a link, the callback, an interim signed-in page and sign
// out. No portal shell or navigation yet (M4.5). Every page is `noindex` (index.html).
import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import favicon from "@techaust/ui/brand/favicon.svg?url";
import mark from "@techaust/ui/brand/logo-symbol-ink.svg?url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";
import { LoadingCard } from "./components/ui.tsx";
import { CALLBACK_PATH, captureLinkToken } from "./lib/link.ts";
import { Callback } from "./routes/callback.tsx";
import { Home } from "./routes/home.tsx";
import { Failed, NotFound, Unreachable } from "./routes/not-found.tsx";
import { SignIn } from "./routes/sign-in.tsx";
import { SessionProvider, useSession } from "./session.tsx";

// FIRST, before anything renders or sends a request: take a sign-in link's token from `#t=` and strip the fragment
// from the address bar and history (lib/link.ts, LD3).
captureLinkToken();
// A new link opened in a tab already on the callback path changes only the fragment, so the page doesn't reload:
// reload it, which takes and strips the new token above.
window.addEventListener("hashchange", () => {
  if (location.pathname === CALLBACK_PATH && location.hash) location.reload();
});

// The tab icon (pixel-fitted, adapts to a dark browser) and the page's tone-on-tone mark (app.css), both from the
// generated brand files.
const icon = document.createElement("link");
icon.rel = "icon";
icon.type = "image/svg+xml";
icon.href = favicon;
document.head.append(icon);
document.documentElement.style.setProperty("--brand-mark", `url("${mark}")`);

/** `/`: the signed-in page, or the sign-in form. */
function Index() {
  const { me } = useSession();
  if (me === undefined) return <LoadingCard />;
  if (me === "unreachable") return <Unreachable />;
  if (!me) return <SignIn />;
  return <Home />;
}

// Dev only: the M4.5 design preview with sample data (/preview/*). In a build `import.meta.env.DEV` is false, so the
// route and its dynamic import are dropped and no preview code or sample data reaches dist (checked after the build).
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/preview/*",
        HydrateFallback: LoadingCard,
        errorElement: <Failed />,
        lazy: async () => ({ Component: (await import("./preview/routes.tsx")).PreviewApp }),
      },
    ]
  : [];

// The callback sits outside the session: it asks nothing of the server until "Continue" is pressed.
const router = createBrowserRouter([
  ...devRoutes,
  { path: CALLBACK_PATH, element: <Callback />, errorElement: <Failed /> },
  {
    path: "/",
    HydrateFallback: LoadingCard,
    errorElement: <Failed />,
    element: (
      <SessionProvider>
        <Index />
      </SessionProvider>
    ),
  },
  { path: "*", element: <NotFound /> },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
