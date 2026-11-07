import { firstRun } from "@techaust/auth";
import { matchedRoutes } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono/tiny";
import { forms } from "./forms.ts";

// Runs ONLY for the run_worker_first paths in wrangler.jsonc (/api/health, /api/geo, /api/forms/*): add every new route there
// (test/worker-config.test.ts fails otherwise). Static pages and other /api paths never invoke this Worker.

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// M7.5 L20: one diagnostic line per request, so the staging CPU gate reads first runs (`f: 1`) on the website too. Exactly these
// keys [NFR-6]: the route PATTERN (or "other"), the status, and `f: 1` only on the first run of that method and pattern in this
// isolate. No path, query, IP, country, user agent, email or form field.
app.use(async (c, next) => {
  await next();
  // Middleware is registered on `/api/*`; the handlers' patterns never end in `*` (the forms route answers every method).
  const route = matchedRoutes(c)
    .filter((m) => !m.path.endsWith("*"))
    .at(-1);
  const r = route?.path ?? "other";
  console.log(JSON.stringify({ ev: "req", r, s: c.res.status, f: firstRun(`${c.req.method} ${r}`) }));
});

// WEB-G-12 for the API answers too (_headers covers only static assets). JSON only, so the CSP is "nothing".
app.use(
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  }),
);

// M7.5 C4: the deploy health check (scripts/staging-health.mjs). No D1 (the website has none) and nothing about the caller.
app.get("/health", (c) =>
  c.json({ ok: true, service: "web", env: c.env.ENVIRONMENT }, 200, { "Cache-Control": "no-store" }),
);

// Default currency for the ₹/$ toggle (WEB-G-06): India sees INR, everyone else (and an unknown country) USD. Only the
// currency is returned, never the country or IP. Private and never stored by a shared cache (the answer depends on who
// asks); the browser keeps it for 30 days in localStorage, and a choice the visitor made wins (scripts/currency.ts).
app.get("/geo", (c) => {
  const country = (c.req.raw.cf?.country as string | undefined)?.toUpperCase();
  return c.json({ currency: country === "IN" ? "INR" : "USD" }, 200, {
    "Cache-Control": "private, no-store",
  });
});

// Lead forms (FRM-*, M2.4): /api/forms/contact and /api/forms/quote (src/forms.ts).
app.route("/", forms);

app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
