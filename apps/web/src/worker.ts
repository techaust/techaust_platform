import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// Runs ONLY for /api/* (run_worker_first). Static pages never invoke this Worker.

const app = new Hono<{ Bindings: Env }>().basePath("/api");
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

// Default currency for the ₹/$ toggle (WEB-G-06): India sees INR, everyone else (and an unknown country) USD. Only the
// currency is returned, never the country or IP. Private and never stored by a shared cache (the answer depends on who
// asks); the browser keeps it for 30 days in localStorage, and a choice the visitor made wins (scripts/currency.ts).
app.get("/geo", (c) => {
  const country = (c.req.raw.cf?.country as string | undefined)?.toUpperCase();
  return c.json({ currency: country === "IN" ? "INR" : "USD" }, 200, {
    "Cache-Control": "private, no-store",
  });
});

// Lead forms (FRM-*) are implemented in M2.4.
app.post("/forms/*", (c) => c.json({ ok: false, error: "not_implemented" }, 501));

app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
