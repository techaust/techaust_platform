// The local first-request probe (CPU warm-up task (b)4, 2026-11-01; docs/runs/cpu-warmup.md). ADVISORY: never part of CI's pass/fail.
//
// Why: the Free plan stops an invocation at 10 ms CPU, and on staging the first request each route gets in a fresh isolate costs most (V8 compiles the
// route's code lazily, its inline caches start cold, the router's regexes compile), inside the metered request. This probe reproduces that locally:
//   1. a seed process loads the REAL minified bundles (the three admin Workers and jobs) into one Node process, with D1 stood in by `node:sqlite` (every
//      migration plus the seed), signs a made-up Owner in through the API (invite, enrol, TOTP), and makes the sample data through the API (the e2e
//      sample set, apps/admin/e2e/sample-data.ts, plus drafts, proformas, payment links and webhook events for the hot routes);
//   2. for each hot route, N fresh processes each copy that database, load ONE Worker bundle, let its start-up finish, then time the route's FIRST call and
//      a few later calls. A time is wall time minus the time spent inside SQLite (D1 runs outside the Worker's CPU) and includes `waitUntil` work (it counts
//      on Workers). Node is not workerd: staging read about x2.3 to x3.4 the local figure (the M6.2 CPU diagnosis), so the target is <= 2.5 ms locally.
// Forwarded rows are timed in the Worker that answers them and, separately, in the front with a target that answers at once (the gate adds the two).
//
//   node scripts/cpu-probe.mjs [--runs 5] [--later 4] [--only <case,...>] [--build] [--json <file>]
// Build first (or pass --build): `pnpm --filter @techaust/admin exec vite build` and `pnpm --filter @techaust/jobs build`. Run it through
// `bash tools/heavy.sh --log cpu-probe node scripts/cpu-probe.mjs` (it spawns about 100 processes). Made-up data only (@example.test, "(sample)").
import { execFileSync, spawnSync } from "node:child_process";
import { argon2Sync, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseJsonc } from "./check-worker-config.mjs";
import {
  d1Over,
  dbClock,
  installWorkersStandIns,
  queueStub,
  r2In,
  rateLimitStub,
} from "./cpu-probe-runtime.mjs";
import { createInviteStatements } from "./create-invite-sql.mjs";

const here = fileURLToPath(import.meta.url);
const root = resolve(here, "..", "..");
const at = (p) => join(root, p);

export const BUNDLES = {
  front: "apps/admin/dist/techaust_platform_admin",
  api: "apps/admin/dist/techaust_platform_admin_api",
  finance: "apps/admin/dist/techaust_platform_admin_finance",
  jobs: "apps/jobs/dist",
};
const ORIGIN = "http://localhost:5173";
const TEST_KEY = (n) => Buffer.alloc(32, n).toString("base64");
/** Made-up secret values (the admin tests' own), never a real one. */
const SECRETS = {
  PASSWORD_PEPPER: TEST_KEY(1),
  SALT_PEPPER: TEST_KEY(2),
  TOTP_ENC_KEY: TEST_KEY(3),
  SESSION_HMAC_KEY: TEST_KEY(4),
  TURNSTILE_SECRET: "probe-turnstile-secret",
  RAZORPAY_KEY_ID: "rzp_test_PROBEKEY000001",
  RAZORPAY_KEY_SECRET: "probe-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "probe-webhook-secret-made-up",
  SES_ACCESS_KEY_ID: "PROBEKEYID",
  SES_SECRET_ACCESS_KEY: "probe-ses-secret",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Inside a child process: the Workers, their env and the timer.

const pending = [];
const ctx = () => ({
  waitUntil(p) {
    pending.push(Promise.resolve(p).catch(() => {}));
  },
  passThroughOnException() {},
  props: {},
});
async function drain() {
  while (pending.length) await pending.shift();
}

function configOf(worker) {
  if (worker === "jobs") return parseJsonc(readFileSync(at("apps/jobs/wrangler.jsonc"), "utf8"));
  return JSON.parse(readFileSync(at(`${BUNDLES[worker]}/wrangler.json`), "utf8"));
}

/** A Worker's env from its own config's top level (the local scope): vars, the stood-in bindings, made-up secrets; `services` fills the service bindings. */
function envOf(worker, shared, services = {}) {
  const c = configOf(worker);
  const env = { ...(c.vars ?? {}) };
  for (const name of c.secrets?.required ?? []) env[name] = SECRETS[name] ?? "probe-secret";
  if (worker === "jobs") env.RAZORPAY_WEBHOOK_SECRET = SECRETS.RAZORPAY_WEBHOOK_SECRET;
  for (const d of c.d1_databases ?? []) env[d.binding] = shared.db;
  for (const b of c.r2_buckets ?? []) env[b.binding] = shared.r2(b.binding);
  for (const q of c.queues?.producers ?? []) env[q.binding] = queueStub();
  for (const r of c.ratelimits ?? []) env[r.name] = rateLimitStub();
  for (const s of c.services ?? [])
    env[s.binding] = services[s.binding] ?? { fetch: async () => new Response("no", { status: 502 }) };
  return env;
}

/**
 * Node's OWN lazy start-up, paid before the bundle loads: its fetch classes (Request, Response, Headers and body reading initialise on first use, about 20 ms;
 * see scripts/cold-start.mjs), WebCrypto and the URL parser. workerd has these natively, so they are not the Worker's cost. Nothing of the bundle runs here.
 */
async function warmNode() {
  const req = new Request("http://localhost/x?y=1", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "a=b" },
    body: JSON.stringify({ a: 1 }),
  });
  await req.clone().json();
  await req.arrayBuffer();
  const res = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { "Set-Cookie": "a=b; Path=/" },
  });
  res.headers.getSetCookie();
  await res.clone().text();
  await new Response(new Response("x").body).text();
  await new Response(new Uint8Array([1, 2])).arrayBuffer();
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  await crypto.subtle.sign("HMAC", key, new Uint8Array(8));
  await crypto.subtle.digest("SHA-256", new Uint8Array(8));
  const aes = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, aes, new Uint8Array(8));
  crypto.getRandomValues(new Uint8Array(8));
  new URL("http://localhost/a/b?c=d").searchParams.get("c");
  new TextDecoder().decode(new TextEncoder().encode("x"));
  // Node's fetch classes are JavaScript (undici), workerd's are native: a throwaway Hono app (its OWN copy from node_modules, so none of the bundle's
  // functions are compiled by it) drives the Headers, Request and Response paths a Hono answer takes, so their first-use cost isn't charged to the Worker.
  const { Hono } = await import(pathToFileURL(adminRequire.resolve("hono/tiny")).href);
  const { secureHeaders } = await import(pathToFileURL(adminRequire.resolve("hono/secure-headers")).href);
  const app = new Hono().basePath("/api");
  app.use(secureHeaders({ strictTransportSecurity: "max-age=1", permissionsPolicy: { camera: [] } }));
  app.use(async (c, next) => {
    c.req.header("cookie");
    c.req.header("origin");
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.get("/a/:id", (c) => c.json({ id: c.req.param("id"), list: [1, 2] }));
  app.post("/a/:id", async (c) => {
    const body = await c.req.json();
    c.header("Set-Cookie", "x=y; Path=/; HttpOnly");
    return c.json({ body }, 201);
  });
  app.notFound((c) => c.json({ error: "nf" }, 404));
  for (let i = 0; i < 3; i++) {
    for (const r of [
      new Request("http://localhost/api/a/1", { headers: { Cookie: "a=b", Origin: "http://localhost" } }),
      new Request("http://localhost/api/a/2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "7", Origin: "http://localhost" },
        body: '{"a":1}',
      }),
      new Request("http://localhost/api/none"),
    ]) {
      const res = await app.fetch(r, {}, { waitUntil() {}, passThroughOnException() {} });
      res.headers.getSetCookie();
      await res.text();
    }
  }
}
const adminRequire = createRequire(at("apps/admin/package.json"));

let nodeWarm;
async function loadWorker(worker) {
  installWorkersStandIns();
  nodeWarm ??= warmNode();
  await nodeWarm;
  const file = worker === "jobs" ? at("apps/jobs/dist/index.js") : at(`${BUNDLES[worker]}/index.js`);
  if (!existsSync(file)) throw new Error(`cpu-probe: ${file} is missing; build first (or pass --build)`);
  const mod = await import(pathToFileURL(file).href);
  // Let the start-up's own async work (key imports, warm-ups) finish, as an isolate does before its first request.
  await new Promise((r) => setTimeout(r, 100));
  return mod;
}

function sharedOf(dir) {
  const db = d1Over(join(dir, "probe.db"));
  const buckets = new Map();
  return {
    db,
    r2: (name) => {
      if (!buckets.has(name)) buckets.set(name, r2In(join(dir, "r2", name)));
      return buckets.get(name);
    },
  };
}

const quietConsole = () => {
  const keep = { log: console.log, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  return keep;
};

function requestOf(path, { method, body, cookie, headers = {} } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    h["Content-Type"] ??= "application/json";
    h["Content-Length"] = String(Buffer.byteLength(payload));
  }
  return new Request(`${ORIGIN}/api/v1${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: h,
    body: payload,
  });
}

/** One timed call: wall time minus SQLite time, through the answer's body and every waitUntil. */
async function timed(run) {
  dbClock.ms = 0;
  dbClock.statements = 0;
  const t0 = performance.now();
  const out = await run();
  let status = 0;
  let text = "";
  if (out instanceof Response) {
    status = out.status;
    text = await out.text();
  } else {
    status = 200;
    text = JSON.stringify(out ?? null);
  }
  await drain();
  const wall = performance.now() - t0;
  return { ms: wall - dbClock.ms, wall, dbMs: dbClock.ms, statements: dbClock.statements, status, text };
}

// ---- the seed (one process, every Worker) -------------------------------------------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s) {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
}
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const step = () => Math.floor(Date.now() / 30_000);
const clientHash = (password, salt, p) =>
  argon2Sync("argon2id", {
    message: password.normalize("NFKC"),
    nonce: Buffer.from(salt, "base64url"),
    parallelism: p.p,
    passes: p.t,
    memory: p.m,
    tagLength: 32,
  }).toString("base64url");
const cookiePair = (setCookies, name) =>
  setCookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0] ?? null;
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** A Razorpay `payment_link.paid` event for a stub link (the simulator's ids carry the amount and our reference; worker/gateway/config.ts). */
export function paidEvent(checkoutId, amount) {
  const ref = checkoutId.replaceAll("-", "");
  return JSON.stringify({
    entity: "event",
    event: "payment_link.paid",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment_link: {
        entity: {
          id: `plink_A${amount}R${ref}`,
          amount,
          currency: "INR",
          status: "paid",
          reference_id: checkoutId,
        },
      },
      payment: {
        entity: { id: `pay_A${amount}R${ref}`, amount, currency: "INR", method: "upi", status: "captured" },
      },
    },
  });
}
const signed = (body) => createHmac("sha256", SECRETS.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");

async function seed(dir, extra) {
  const keep = quietConsole();
  const shared = sharedOf(dir);
  const raw = shared.db.sqlite;
  for (const f of readdirSync(at("packages/db/migrations"))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort())
    raw.exec(readFileSync(at(`packages/db/migrations/${f}`), "utf8"));
  raw.exec(readFileSync(join(dir, "seed.sql"), "utf8"));

  const [front, api, finance, jobs] = await Promise.all(["front", "api", "finance", "jobs"].map(loadWorker));
  const apiEnv = envOf("api", shared);
  const financeEnv = envOf("finance", shared);
  const frontEnv = envOf("front", shared, {
    ADMIN_API: { fetch: (r) => api.default.fetch(r, apiEnv, ctx()) },
    ADMIN_FINANCE: { fetch: (r) => finance.default.fetch(r, financeEnv, ctx()) },
  });
  const jobsEnv = envOf("jobs", shared);
  const via = async (path, init) => {
    const res = await front.default.fetch(requestOf(path, init), frontEnv, ctx());
    await drain();
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, cookies: res.headers.getSetCookie() };
  };
  const must = (what, r, ok = [200, 201]) => {
    if (!ok.includes(r.status))
      throw new Error(`cpu-probe seed: ${what} answered ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  };

  // A made-up Owner, enrolled exactly as the enrolment screen does it.
  const email = `probe-${Date.now().toString(36)}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  raw.exec(
    createInviteStatements({
      email,
      role: "owner",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      now,
      expiresAt: now + 3_600_000,
      auditId: randomUUID(),
    }).join("\n"),
  );
  const start = must("invite/start", await via("/auth/invite/start", { body: { token } }));
  const finish = must(
    "invite/finish",
    await via("/auth/invite/finish", {
      body: {
        token,
        clientHash: clientHash(password, start.salt, start.params),
        name: "Probe Owner (sample)",
      },
    }),
  );
  const secret = base32(finish.secret);
  const done = await via("/auth/invite/totp", {
    body: { challenge: finish.challenge, code: totpAt(secret, step()) },
  });
  must("invite/totp", done);
  const session = cookiePair(done.cookies, "__Host-ta_admin");
  const device = cookiePair(done.cookies, "__Host-ta_device");
  const cookie = [session, device].filter(Boolean).join("; ");
  const call = async (path, init = {}) => {
    const r = await via(path, {
      method: init.method,
      cookie,
      ...(init.raw !== undefined
        ? {
            body: Buffer.from(init.raw).toString("latin1"),
            headers: { "Content-Type": "application/octet-stream" },
          }
        : init.body === undefined
          ? {}
          : { body: init.body }),
    });
    return { status: r.status, data: r.data };
  };
  // The raw signature upload needs bytes, not text: send it as a Uint8Array body.
  const callRaw = async (path, init = {}) => {
    if (init.raw === undefined) return call(path, init);
    const req = new Request(`${ORIGIN}/api/v1${path}`, {
      method: init.method ?? "PUT",
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(init.raw.byteLength),
      },
      body: init.raw,
    });
    const res = await front.default.fetch(req, frontEnv, ctx());
    await drain();
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  // Leads for the list (made up).
  for (let i = 1; i <= 12; i++)
    must(
      "POST /leads",
      await call("/leads", {
        body: {
          name: `Sample Lead ${i} (probe)`,
          email: `sample-lead-${i}@example.test`,
          company: `Sample Company ${i} (probe)`,
          country: "IN",
          message: "A made-up enquiry for the local CPU probe. Not a real lead.",
        },
      }),
    );

  // The e2e sample set (settings, signature, bank accounts, two clients, a project, time, a care plan, five invoice-family documents).
  const made = [];
  const { sampleData } = await import(pathToFileURL(at("apps/admin/e2e/sample-data.ts")).href);
  await sampleData({
    d1: (sql) => raw.exec(sql),
    secret,
    email,
    call: async (path, init) => {
      const r = await callRaw(path, init);
      if (path === "/invoices" && init?.body && r.status === 201) made.push(r.data.id);
      return r;
    },
  });
  const inr = raw.prepare("SELECT id FROM clients WHERE code = 'X0001'").get().id;
  raw
    .prepare("UPDATE contacts SET portal_access = 1, can_see_finance = 1, is_billing = 1 WHERE client_id = ?")
    .run(inr);
  const cat = must("GET /catalogue", await call("/catalogue"));
  const services = cat.items
    .filter((i) => i.active !== false && i.priceInrMinor && i.priceUsdMinor)
    .slice(0, 2)
    .map((i) => ({ catalogueItemId: i.id }));
  const draft = async (kind) =>
    must(
      "POST /invoices",
      await call("/invoices", { body: { clientId: inr, services, ...(kind ? { kind } : {}) } }),
    ).id;
  const read = async (id) => must(`GET /invoices/${id}`, await call(`/invoices/${id}`));
  const issueBody = async (id) => {
    const d = await read(id);
    return { expectedUpdatedAt: d.updatedAt, expectedContentSha256: d.contentSha256 };
  };
  const issue = async (id) =>
    must(`issue ${id}`, await call(`/invoices/${id}/issue`, { body: await issueBody(id) }));
  const n = extra + 1;

  const issueDrafts = [];
  for (let i = 0; i < n; i++) {
    const id = await draft();
    issueDrafts.push({ id, body: await issueBody(id) });
  }
  const patchDrafts = [];
  for (let i = 0; i < n; i++) {
    const id = await draft();
    const d = await read(id);
    const lines = (d.lines ?? []).map((l) => {
      const o = {};
      for (const k of [
        "id",
        "catalogueItemId",
        "description",
        "detail",
        "sac",
        "gstRateBp",
        "qtyMilli",
        "unit",
        "rateMinor",
        "discount",
      ])
        if (l[k] !== undefined) o[k] = l[k];
      return o;
    });
    if (lines[0]) lines[0].qtyMilli = 2000;
    const body = { expectedUpdatedAt: d.updatedAt, fields: { serviceCompletedOn: istToday() }, lines };
    patchDrafts.push({ id, body });
  }
  const proformas = [];
  for (let i = 0; i < n; i++) {
    const id = await draft("proforma");
    await issue(id);
    const updatedAt = raw.prepare("SELECT updated_at FROM documents WHERE id = ?").get(id).updated_at;
    proformas.push({
      id,
      body: {
        expectedProformaUpdatedAt: updatedAt,
        amountMinor: 59_000,
        receivedOn: istToday(),
        reference: `UTR PROBE ${i + 1}`,
      },
    });
  }
  // Issued invoices with a staff payment link each, and the webhook event the jobs hook stores for its payment (signed with the made-up secret).
  const events = [];
  let hookTemplate = null;
  for (let i = 0; i < n; i++) {
    const id = await draft();
    await issue(id);
    const doc = raw.prepare("SELECT updated_at, total_minor FROM documents WHERE id = ?").get(id);
    const link = must(
      "payment-link",
      await call(`/invoices/${id}/payment-link`, {
        body: { amountMinor: doc.total_minor, expectedUpdatedAt: doc.updated_at },
      }),
    );
    const body = paidEvent(link.checkoutId, doc.total_minor);
    const eventId = `evt_PROBESEED${String(i).padStart(5, "0")}`;
    const res = await jobs.default.fetch(
      new Request("http://localhost:8787/razorpay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": signed(body),
          "X-Razorpay-Event-Id": eventId,
        },
        body,
      }),
      jobsEnv,
      ctx(),
    );
    await drain();
    if (res.status !== 200)
      throw new Error(`cpu-probe seed: the hook answered ${res.status} ${await res.text()}`);
    events.push(raw.prepare("SELECT id FROM webhook_events WHERE event_id = ?").get(eventId).id);
    if (i === 0) hookTemplate = { checkoutId: link.checkoutId, amount: doc.total_minor };
  }
  const manifest = {
    email,
    password,
    secretHex: secret.toString("hex"),
    cookie,
    device,
    detail: made[0], // the tax invoice with its credit note and debit draft
    issueDrafts,
    patchDrafts,
    proformas,
    events,
    hookTemplate,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  keep.log(
    JSON.stringify({ seeded: true, documents: raw.prepare("SELECT COUNT(*) AS n FROM documents").get().n }),
  );
}

// ---- the cases ------------------------------------------------------------------------------------------------------------------------------------------

const answer = () => new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
/** The front with targets that answer at once: the front's own share of a forwarded row. */
const FRONT_TARGETS = {
  ADMIN_API: { fetch: async () => answer() },
  ADMIN_FINANCE: { fetch: async () => answer() },
};

/** Each hot route: the Worker that answers it and the call for attempt `i` (0 = the first, then the later ones). */
export const CASES = {
  // The floor: the lightest route through the whole middleware chain (no session, one row).
  "GET /health": { worker: "front", call: () => ({ path: "/health" }) },
  "GET /auth/me": { worker: "front", call: (m) => ({ path: "/auth/me", cookie: m.cookie }) },
  "POST /auth/totp": { worker: "front", totp: true },
  "fwd GET /invoices/:id": {
    worker: "front",
    call: (m) => ({ path: `/invoices/${m.detail}`, cookie: m.cookie }),
  },
  "fwd POST /invoices/:id/issue": {
    worker: "front",
    call: (m, i) => ({
      path: `/invoices/${m.issueDrafts[i].id}/issue`,
      cookie: m.cookie,
      body: m.issueDrafts[i].body,
    }),
  },
  "fwd GET /notifications": { worker: "front", call: (m) => ({ path: "/notifications", cookie: m.cookie }) },
  "fwd GET /leads": { worker: "front", call: (m) => ({ path: "/leads", cookie: m.cookie }) },
  "fwd GET /dashboard": { worker: "front", call: (m) => ({ path: "/dashboard", cookie: m.cookie }) },
  "POST /invoices/:id/issue": {
    worker: "finance",
    call: (m, i) => ({
      path: `/invoices/${m.issueDrafts[i].id}/issue`,
      cookie: m.cookie,
      body: m.issueDrafts[i].body,
    }),
  },
  "GET /invoices/:id": {
    worker: "finance",
    call: (m) => ({ path: `/invoices/${m.detail}`, cookie: m.cookie }),
  },
  "GET /invoices/:id/payments": {
    worker: "finance",
    call: (m) => ({ path: `/invoices/${m.detail}/payments`, cookie: m.cookie }),
  },
  "PATCH /invoices/:id": {
    worker: "finance",
    call: (m, i) => ({
      path: `/invoices/${m.patchDrafts[i].id}`,
      method: "PATCH",
      cookie: m.cookie,
      body: m.patchDrafts[i].body,
    }),
  },
  "POST /invoices/:id/advance-invoice": {
    worker: "finance",
    call: (m, i) => ({
      path: `/invoices/${m.proformas[i].id}/advance-invoice`,
      cookie: m.cookie,
      body: m.proformas[i].body,
    }),
  },
  "GET /dashboard": { worker: "finance", call: (m) => ({ path: "/dashboard", cookie: m.cookie }) },
  "GET /invoices": { worker: "finance", call: (m) => ({ path: "/invoices", cookie: m.cookie }) },
  "GET /payments/review": {
    worker: "finance",
    call: (m) => ({ path: "/payments/review", cookie: m.cookie }),
  },
  "GET /notifications": { worker: "api", call: (m) => ({ path: "/notifications", cookie: m.cookie }) },
  "GET /leads": { worker: "api", call: (m) => ({ path: "/leads", cookie: m.cookie }) },
  "rpc GatewayEvents.processEvent": { worker: "finance", rpc: true },
  "jobs POST /razorpay": { worker: "jobs", hook: true },
};

/** Signs in up to the TOTP challenge (salt, then login with the made-up password), untimed. */
async function challengeOf(mod, env, m) {
  const call = async (path, body) => {
    const res = await mod.default.fetch(requestOf(path, { body, cookie: m.device }), env, ctx());
    await drain();
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const salt = await call("/auth/salt", { email: m.email });
  const login = await call("/auth/login", {
    email: m.email,
    clientHash: clientHash(m.password, salt.data.salt, salt.data.params),
  });
  if (login.status !== 200)
    throw new Error(`cpu-probe: login answered ${login.status} ${JSON.stringify(login.data)}`);
  return login.data.challenge;
}

async function runCase(dir, name, later, givenChallenge) {
  const keep = quietConsole();
  const c = CASES[name];
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const shared = sharedOf(dir);
  const mod = await loadWorker(c.worker);
  const env = envOf(c.worker, shared, c.worker === "front" ? FRONT_TARGETS : {});
  const secret = Buffer.from(m.secretHex, "hex");
  const results = [];
  const attempts = c.totp ? Math.min(later, 2) + 1 : later + 1;
  for (let i = 0; i < attempts; i++) {
    let run;
    if (c.totp) {
      // The first TOTP of the process uses the challenge made by another process (so nothing of the sign-in ran here before it); later ones sign in again.
      const challenge = i === 0 ? givenChallenge : await challengeOf(mod, env, m);
      const code = totpAt(secret, step() - 1 + i);
      run = () =>
        mod.default.fetch(
          requestOf("/auth/totp", { body: { challenge, code }, cookie: m.device }),
          env,
          ctx(),
        );
    } else if (c.rpc) {
      const entry = new mod.GatewayEvents(ctx(), env);
      run = () => entry.processEvent({ eventId: m.events[i] });
    } else if (c.hook) {
      const t = m.hookTemplate;
      const body = paidEvent(t.checkoutId, t.amount);
      const headers = {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signed(body),
        "X-Razorpay-Event-Id": `evt_PROBERUN${String(i).padStart(6, "0")}`,
      };
      run = () =>
        mod.default.fetch(
          new Request("http://localhost:8787/razorpay", { method: "POST", headers, body }),
          env,
          ctx(),
        );
    } else {
      const a = c.call(m, i);
      run = () => mod.default.fetch(requestOf(a.path, a), env, ctx());
    }
    const r = await timed(run);
    results.push({
      ms: r.ms,
      wall: r.wall,
      dbMs: r.dbMs,
      statements: r.statements,
      status: r.status,
      text: i === 0 ? r.text.slice(0, 200) : undefined,
    });
  }
  keep.log(JSON.stringify({ case: name, results }));
}

async function makeChallenge(dir) {
  const keep = quietConsole();
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const shared = sharedOf(dir);
  const mod = await loadWorker("front");
  const env = envOf("front", shared, FRONT_TARGETS);
  keep.log(JSON.stringify({ challenge: await challengeOf(mod, env, m) }));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The parent: seed once, then fresh processes per case and run.

function child(args, what) {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", here, ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0)
    throw new Error(
      `cpu-probe: ${what} failed (exit ${r.status})\n${(r.stderr || r.stdout).split("\n").slice(0, 30).join("\n")}`,
    );
  const last = r.stdout.trim().split("\n").at(-1);
  return JSON.parse(last);
}

/** A fresh copy of the seeded database for one process, with the session's step-up open and the sign-in counters cleared (made-up rows only). */
function freshCopy(seedDir, runDir) {
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  copyFileSync(join(seedDir, "probe.db"), join(runDir, "probe.db"));
  copyFileSync(join(seedDir, "manifest.json"), join(runDir, "manifest.json"));
  if (existsSync(join(seedDir, "r2"))) cpSync(join(seedDir, "r2"), join(runDir, "r2"), { recursive: true });
  const db = new DatabaseSync(join(runDir, "probe.db"));
  const now = Date.now();
  db.prepare(
    "UPDATE staff_sessions SET step_up_until = ?, idle_expires_at = ?, last_seen_at = ? WHERE revoked_at IS NULL",
  ).run(now + 30 * 60_000, now + 60 * 60_000, now);
  db.exec("UPDATE staff_users SET totp_last_step = 0; DELETE FROM auth_attempts;");
  db.close();
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : Number.NaN;
};
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: "string", default: "5" },
      later: { type: "string", default: "4" },
      only: { type: "string" },
      build: { type: "boolean", default: false },
      json: { type: "string" },
      keep: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
  });
  const runs = Number(values.runs);
  const later = Number(values.later);
  if (values.build) {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    execFileSync(pnpm, ["--filter", "@techaust/admin", "exec", "vite", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    execFileSync(pnpm, ["--filter", "@techaust/jobs", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
  const names = values.only ? values.only.split(",").map((s) => s.trim()) : Object.keys(CASES);
  for (const nm of names) if (!CASES[nm]) throw new Error(`cpu-probe: no case "${nm}"`);
  const work = mkdtempSync(join(tmpdir(), "cpu-probe-"));
  try {
    const seedDir = join(work, "seed");
    mkdirSync(seedDir, { recursive: true });
    execFileSync(process.execPath, [at("packages/db/scripts/seed-sql.ts"), join(seedDir, "seed.sql")], {
      cwd: at("packages/db"),
    });
    const seeded = child(["--seed", seedDir, String(later)], "the seed");
    console.log(`seeded: ${seeded.documents} documents`);
    const rows = [];
    for (const name of names) {
      const firsts = [];
      const laters = [];
      let status = "";
      let stmts = 0;
      for (let r = 0; r < runs; r++) {
        const runDir = join(work, "run");
        freshCopy(seedDir, runDir);
        const args = ["--case", runDir, name, String(later)];
        if (CASES[name].totp) args.push(child(["--challenge", runDir], "the sign-in challenge").challenge);
        const out = child(args, name);
        const [first, ...rest] = out.results;
        firsts.push(first.ms);
        laters.push(...rest.map((x) => x.ms));
        status = [...new Set(out.results.map((x) => x.status))].join("/");
        stmts = first.statements;
        if (r === 0 && (first.status >= 400 || values.verbose))
          console.log(`  ${name}: first answered ${first.status} ${first.text}`);
      }
      rows.push({
        name,
        worker: CASES[name].worker,
        first: median(firsts),
        firstMin: Math.min(...firsts),
        firstMax: Math.max(...firsts),
        later: median(laters),
        status,
        stmts,
      });
      console.log(
        `${name}: first ${f1(median(firsts))} ms (${f1(Math.min(...firsts))}-${f1(Math.max(...firsts))}), later ${f1(median(laters))} ms`,
      );
    }
    console.log(
      "\n| Case | Worker | First (median of " +
        runs +
        ") | First min-max | Later (median) | Status | D1 statements (first) |",
    );
    console.log("|---|---|---|---|---|---|---|");
    for (const r of rows)
      console.log(
        `| ${r.name} | ${r.worker} | ${f1(r.first)} | ${f1(r.firstMin)}-${f1(r.firstMax)} | ${f1(r.later)} | ${r.status} | ${r.stmts} |`,
      );
    if (values.json)
      writeFileSync(
        values.json,
        `${JSON.stringify({ at: new Date().toISOString(), node: process.version, runs, rows }, null, 2)}\n`,
      );
  } finally {
    if (!values.keep) rmSync(work, { recursive: true, force: true });
    else console.log(`kept ${work}`);
  }
}

const argv = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  if (argv[0] === "--seed") await seed(argv[1], Number(argv[2]));
  else if (argv[0] === "--case") await runCase(argv[1], argv[2], Number(argv[3]), argv[4]);
  else if (argv[0] === "--challenge") await makeChallenge(argv[1]);
  else await main();
}
