// M7.5 B2: the route inventory's pure parsers (no I/O, so the apps' workerd tests import them for parity with the real tables). Each takes a source
// file's TEXT and returns rows; `scripts/route-inventory.mjs` reads the files and writes `.logs/route-inventory.json`.

/** Line comments out (paths and actions never hold `//`), so a commented-out row is not a row. */
const uncomment = (text) => text.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/[^\n"]*$/gm, "");

const ADMIN_HELPER = { R: "admin-api", F: "admin-front", X: "admin-finance", I: "admin-invoices" };

/**
 * Admin `ROUTES` (apps/admin/worker/guard.ts): `R(...)` rows run on the API Worker, `F` the front, `X` finance, `I` invoices (CLAUDE.md "The admin API is four
 * Workers"). Paths get the `/api/v1` prefix the helper adds.
 */
export function adminRows(text) {
  const body = uncomment(text.slice(text.indexOf("export const ROUTES")));
  const end = body.indexOf("\n];");
  const table = end > 0 ? body.slice(0, end) : body;
  const rows = [];
  for (const m of table.matchAll(/\b([RFXI])\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)",\s*"([^"]+)"/g))
    rows.push({ worker: ADMIN_HELPER[m[1]], method: m[2], path: `/api/v1${m[3]}`, permission: m[4] });
  return rows;
}

/** Portal `ROUTES` (apps/portal/worker/guard.ts): one Worker, every row `R(...)` with the `/api/v1` prefix. */
export function portalRows(text) {
  const body = uncomment(text.slice(text.indexOf("export const ROUTES")));
  const end = body.indexOf("\n];");
  const table = end > 0 ? body.slice(0, end) : body;
  return [...table.matchAll(/\bR\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => ({
    worker: "portal",
    method: m[1],
    path: `/api/v1${m[2]}`,
    permission: m[3],
  }));
}

/**
 * The website Worker's rows: each `app.get|post("/x"` of src/worker.ts under `/api`, and the forms route (`forms.all("/forms/:kind"`, POST only in practice:
 * every other method is refused before any work). `runWorkerFirst` (wrangler.jsonc) must cover every one.
 */
export function webRows(workerText, formsText) {
  const rows = [...uncomment(workerText).matchAll(/\bapp\.(get|post)\(\s*"([^"]+)"/g)].map((m) => ({
    worker: "web",
    method: m[1].toUpperCase(),
    path: `/api${m[2]}`,
  }));
  for (const m of uncomment(formsText).matchAll(/\bforms\.(?:all|post)\(\s*"([^"]+)"/g))
    rows.push({ worker: "web", method: "POST", path: `/api${m[1]}` });
  return rows;
}

/** The jobs Worker's fetch routes (src/index.ts `app.get|post("/x"`): the webhooks and `/u` are hooks, `/healthz` a route. */
export function jobsFetchRows(text) {
  return [...uncomment(text).matchAll(/\bapp\.(get|post)\(\s*"([^"]+)"/g)].map((m) => ({
    worker: "jobs",
    method: m[1].toUpperCase(),
    path: m[2],
  }));
}

/** The cron rows: one per IST branch (`cronBranchOf` in apps/jobs/src/billing.ts), checked against the configured crons. */
export const CRON_BRANCHES = [
  {
    branch: "daily",
    cron: "0 22 * * *",
    what: "03:30 IST: lead clean-up, PDF sweep, statistics, expiry, statement purge, data-protection start",
  },
  {
    branch: "h06",
    cron: "30 * * * *",
    what: "06:00 to 08:00 IST: the care scan with the hourly messages; at 06:00 the Free-plan usage reading (L50)",
  },
  {
    branch: "h09",
    cron: "30 * * * *",
    what: "09:00 to 11:00 IST: owner alerts, realisation, recon, digest, request clock with the hourly messages",
  },
  {
    branch: "hourly",
    cron: "30 * * * *",
    what: "every other hour: reminders, gateway and refund sweeps, sign-in and bell sweeps, receipt sweep",
  },
];

/**
 * The queue kinds the jobs consumers take (apps/jobs/src/queue.ts routes each; apps/jobs/test/route-inventory.test.ts proves the list against the
 * consumers' own predicates both ways). `lead` is a form submission (no kind), `email` an ordinary email (by template), and the three dead-letter
 * consumers are rows of their own.
 */
export const QUEUE_KINDS = [
  "alerts.daily",
  "approval.notify",
  "bells.sweep",
  "care.bill",
  "care.issue",
  "care.scan",
  "consent.hash",
  "deed.signed",
  "digest.weekly",
  "documents.expire",
  "edf.reminder",
  "gateway.advance",
  "gateway.event",
  "gateway.refresh",
  "gateway.sweep",
  "invoice.send",
  "lead.purge",
  "lead.purge.scan",
  "lut.check",
  "offer.accepted",
  "offer.decided",
  "offer.send",
  "offer.sweep",
  "pdf.certificate",
  "pdf.deed",
  "pdf.rebuild",
  "pdf.render",
  "pdf.snapshot",
  "pdf.statement",
  "pdf.supplier",
  "pdf.sweep",
  "portal.alert",
  "r2.drain",
  "r2.sweep",
  "realisation.scan",
  "receipt.issue",
  "receipt.render",
  "receipt.sweep",
  "recon.fetch",
  "refund.check",
  "refund.notify",
  "refund.sweep",
  "reminder.scan",
  "reminder.send",
  "requests.clock",
  "retention.page",
  "retention.start",
  "signin.unfinished",
  "staff.alert",
  "staff.notify",
  "statement.purge",
  "stats.metric",
  "usage.daily",
];
export const QUEUE_EXTRA = ["lead", "email", "leads-dlq", "email-dlq", "pdf-dlq"];

/**
 * L55 (audit B6 L10): the queue row a test invocation's label `queue <queue> <kind>` belongs to (apps/jobs/test/setup.ts names the queue without its
 * `techaust-<env>-` prefix and the body by its `kind`, else its `template`, else "other"). Every email, whatever its template, is the `email` row (a template
 * name can equal a queue kind, `deed.signed`); a leads message with no kind is a form submission, the `lead` row; a dead-letter queue is its own row,
 * whatever it carries. Pure (the jobs tests run it in workerd).
 */
export function queueRowOf(queue, kind) {
  if (queue === "email") return "email";
  if (/^(leads|email|pdf)-dlq$/.test(queue)) return queue;
  if (queue === "leads" && kind === "other") return "lead";
  return kind;
}

/** `<METHOD> <path pattern>` keys. */
const key = (method, path) => `${method} ${path}`;

/** Sign-in rows (NFR-2: 5 ms). The M1.4 exception (6 ms) is the staff password check, `LOGIN_EXCEPTIONS`. */
export const LOGIN_ROWS = new Set([
  key("POST", "/api/v1/auth/salt"),
  key("POST", "/api/v1/auth/login"),
  key("POST", "/api/v1/auth/totp"),
  key("POST", "/api/v1/auth/recovery"),
  key("POST", "/api/v1/auth/magic"),
  key("POST", "/api/v1/auth/magic/verify"),
]);
export const LOGIN_EXCEPTIONS = new Set(["admin-front POST /api/v1/auth/login"]);

/**
 * Writes a bench suite makes on staging, keyed `<worker> <METHOD> <path>`: the sign-in rows by `suite: auth` (scripts/bench-auth.mjs: salt, login, code,
 * step-up), the enrolment, mark-read, the notification switches re-saved unchanged and the portal's link sign-in by `suite: routes`, and the refusal
 * paths (portal link with no token, the contact form) by `suite: load`'s burst. Only what the scripts really call is listed: the drafts I1 also names
 * (create, save, delete) are not scripted yet, so their rows stay proxies (M7.5 B2 report).
 */
export const BENCH_WRITES = new Set([
  "admin-front POST /api/v1/auth/salt",
  "admin-front POST /api/v1/auth/login",
  "admin-front POST /api/v1/auth/totp",
  "admin-front POST /api/v1/auth/step-up",
  "admin-front POST /api/v1/auth/invite/start",
  "admin-front POST /api/v1/auth/invite/finish",
  "admin-front POST /api/v1/auth/invite/totp",
  "admin-api POST /api/v1/notifications/read-all",
  "portal POST /api/v1/auth/magic",
  "portal POST /api/v1/auth/magic/verify",
  "web POST /api/forms/:kind",
]);

/**
 * Writes read from the owner's scripted write session on staging (I1): one each of issue, confirm and refund; anonymise with 10 offers; the proof upload
 * twice; 20 sample proposal sends; one sandbox webhook per gateway; the portal's accept and Pay.
 */
export const OWNER_SESSION_WRITES = new Set([
  "admin-invoices POST /api/v1/invoices/:id/issue",
  "admin-finance POST /api/v1/payments",
  "admin-finance POST /api/v1/payments/:id/verify",
  "admin-finance POST /api/v1/payments/:id/refunds",
  "admin-finance PUT /api/v1/payments/:id/proof",
  "admin-api POST /api/v1/contacts/:id/erase",
  "admin-api POST /api/v1/documents/:id/send",
  "portal POST /api/v1/offers/:id/accept",
  "portal POST /api/v1/invoices/:id/pay",
  "jobs POST /razorpay",
  "jobs POST /stripe",
  "jobs POST /paypal",
  "jobs POST /ses",
]);

const PROXY_REASON =
  "a state-changing write the bench can't undo on staging and the owner's write session doesn't cover; its first run is read locally (scripts/cpu-probe.mjs)";

/** The measure a row gets before I1 (the readings' figures are added later). */
export function plannedMeasure(row) {
  const id = `${row.worker} ${row.method} ${row.path}`;
  if (row.kind === "cron" || row.kind === "queue" || row.kind === "rpc")
    return { type: "reading", via: "staging-logs" };
  if (row.method === "GET" || BENCH_WRITES.has(id)) return { type: "reading", via: "bench" };
  if (OWNER_SESSION_WRITES.has(id)) return { type: "reading", via: "owner-session" };
  return { type: "proxy", name: "local-first-request-probe", reason: PROXY_REASON };
}

/** The row's kind from where it sits. */
export function kindOf(worker, method, path) {
  if (LOGIN_ROWS.has(key(method, path))) return "login";
  if (worker === "jobs" && path !== "/healthz") return "hook";
  return "route";
}

/**
 * The RPC methods of every `class X extends WorkerEntrypoint` in a Worker entry's text (apps/admin/worker/finance.ts, invoicing.ts): the public async
 * methods, which are the RPC surface (split.test.ts keeps them exact).
 */
export function rpcRows(text, worker) {
  const rows = [];
  const src = uncomment(text);
  for (const m of src.matchAll(/export class (\w+) extends WorkerEntrypoint<[^>]*>[^{]*\{/g)) {
    // The class body: up to the first line that is exactly "}" after it.
    const start = (m.index ?? 0) + m[0].length;
    const end = src.indexOf("\n}\n", start);
    const body = src.slice(start, end < 0 ? undefined : end);
    for (const k of body.matchAll(/^ {2}async (\w+)\(/gm))
      rows.push({ worker, entrypoint: m[1], method: k[1] });
  }
  return rows;
}
