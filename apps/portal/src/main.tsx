// The client portal SPA. M1.6: sign in with a link, the callback and sign out. M4.5: the portal shell with five sections, home, the
// proposals and estimates (view, accept, decline, downloads) and the single-document email link (`/o`). Every page is `noindex`
// (index.html).
import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import favicon from "@techaust/ui/brand/favicon.svg?url";
import mark from "@techaust/ui/brand/logo-symbol-ink.svg?url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";
import { LoadingCard } from "./components/ui.tsx";
import { captureInvoiceToken, INVOICE_LINK_PATH } from "./lib/invoices.ts";
import { CALLBACK_PATH, captureLinkToken } from "./lib/link.ts";
import { captureOfferToken, OFFER_LINK_PATH } from "./lib/offers.ts";
import { capturePayReturn, PAY_RETURN_PATH } from "./lib/pay.ts";
import { Callback } from "./routes/callback.tsx";
import { InvoiceLinkRoute, InvoiceRoute, InvoicesRoute } from "./routes/invoices.tsx";
import { Failed, NotFound } from "./routes/not-found.tsx";
import { OfferLinkRoute } from "./routes/offer-link.tsx";
import { PayReturnRoute } from "./routes/pay-return.tsx";
import {
  HomeRoute,
  MissingRoute,
  PortalLayout,
  ProposalRoute,
  ProposalsRoute,
  SoonRoute,
} from "./routes/portal.tsx";
import { SessionProvider } from "./session.tsx";

// FIRST, before anything renders or sends a request: take a sign-in link's token from `#t=` and strip the fragment
// from the address bar and history (lib/link.ts, LD3); the same for an offer link's token (lib/offers.ts).
captureLinkToken();
captureOfferToken();
// M5.4: an invoice link's token (`/i#t=…`), the same way.
captureInvoiceToken();
// M6.2: back from Razorpay, its query (`razorpay_payment_id`, `razorpay_signature`, …) leaves the address and history at once and is never read or forwarded.
capturePayReturn();
// A new link opened in a tab already on the callback path changes only the fragment, so the page doesn't reload:
// reload it, which takes and strips the new token above. The same for a second offer link opened in the same tab.
window.addEventListener("hashchange", () => {
  if (
    (location.pathname === CALLBACK_PATH ||
      location.pathname === OFFER_LINK_PATH ||
      location.pathname === INVOICE_LINK_PATH) &&
    location.hash
  )
    location.reload();
});

// The tab icon (pixel-fitted, adapts to a dark browser) and the page's tone-on-tone mark (app.css), both from the
// generated brand files.
const icon = document.createElement("link");
icon.rel = "icon";
icon.type = "image/svg+xml";
icon.href = favicon;
document.head.append(icon);
document.documentElement.style.setProperty("--brand-mark", `url("${mark}")`);

// Dev only: the M4.5 screens with labelled sample data (/preview: the sample API and the emails). In a build `import.meta.env.DEV` is
// false, so the route, the sample API and their dynamic imports are dropped and no sample data reaches dist (checked after the build).
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

// The callback and the offer link sit outside the session: neither asks /me.
const router = createBrowserRouter([
  ...devRoutes,
  { path: CALLBACK_PATH, element: <Callback />, errorElement: <Failed /> },
  { path: OFFER_LINK_PATH, element: <OfferLinkRoute />, errorElement: <Failed /> },
  { path: INVOICE_LINK_PATH, element: <InvoiceLinkRoute />, errorElement: <Failed /> },
  // M6.2: Razorpay's return page for emailed and staff links, signed out (no /me).
  { path: PAY_RETURN_PATH, element: <PayReturnRoute />, errorElement: <Failed /> },
  {
    path: "/",
    HydrateFallback: LoadingCard,
    errorElement: <Failed />,
    element: (
      <SessionProvider>
        <PortalLayout />
      </SessionProvider>
    ),
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "proposals", element: <ProposalsRoute /> },
      { path: "proposals/:id", element: <ProposalRoute /> },
      { path: "invoices", element: <InvoicesRoute /> },
      { path: "invoices/:id", element: <InvoiceRoute /> },
      { path: "projects", element: <SoonRoute section="projects" /> },
      { path: "profile", element: <SoonRoute section="profile" /> },
      { path: "*", element: <MissingRoute /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);

async function start() {
  // Dev only: the sample API answers /api/v1 with labelled sample data once a /preview page switched it on for this tab, so the
  // real screens can be seen in every state without a server. Dropped from every build with its import.
  if (import.meta.env.DEV) (await import("./preview/sample-api.ts")).installSampleApi();
  const root = document.getElementById("root");
  if (!root) throw new Error("#root element missing");
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
start();
