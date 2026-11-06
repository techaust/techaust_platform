// M7.5 I1/I2 (owner's Q1 A): the route and load bench for the STAGING admin, portal and website (never production), run from the owner-only workflow
// `.github/workflows/bench-auth.yml` (`suite: routes | load`) or locally against `pnpm dev` (BENCH_TARGET=local, a dry run). Node 24 `fetch`, no package.
//
//   node scripts/bench-routes.mjs --mode routes   every GET row of the route inventory (>= 20 calls in all) and the bench's safe writes (>= 5 each)
//   node scripts/bench-routes.mjs --mode load     5 virtual users for 10 minutes at about 2 requests a second (80 % reads, 20 % safe writes), then the
//                                                 60-second refusal burst (portal /auth/magic with no token, the website's contact form, and LAST the
//                                                 admin's wrong-password logins, which trip the 100-an-hour address lock)
//
// Safety (brief I1, I2; L21):
//   - hosts: only `https://techaust-platform-{admin,portal,web}-staging.techaust-technologies-153.workers.dev` or localhost; anything else is refused before
//     the first request;
//   - Cloudflare Access: the benchmark service token from CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (staging only);
//   - caps per UTC day (I2): at most 5,000 requests, counted in `.logs/bench-day.json` (and a run never exceeds what is left); the D1 rows read and written
//     are read by the lead from D1 metrics before and after (budget-audit.md);
//   - stop at once on error 1027 (the account's daily request limit), on a 5xx burst (3 of the last 20 answers), or on a redirect to the Access sign-in;
//   - bench users: throwaway `@bench.invalid` invites per role (Owner, Accountant, Staff, Sales), enrolled over HTTP; afterwards they are DEACTIVATED and
//     every session they hold is revoked, never deleted (their audit and access rows stay, as they must);
//   - portal sessions: links minted by the `portal:link` SQL for the sample clients' contacts (@example.test), used once each; no Turnstile is weakened.
// Nothing secret is printed. CPU per request is read afterwards from Workers Logs for the printed UTC window (docs/runbooks/cpu-baseline.md).
import { execFileSync } from "node:child_process";
import { argon2Sync, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------- pure rules (tested in packages/core/test/bench-routes.test.ts) ----------

export const STAGING_HOST =
  /^https:\/\/techaust-platform-(admin|portal|web)-staging\.techaust-technologies-153\.workers\.dev$/;
export const LOCAL_HOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** The base URL if it may be benched, else null (a path, a query, production or any other host is refused). */
export function allowedBase(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const base = `${u.protocol}//${u.host}`;
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
  return STAGING_HOST.test(base) || LOCAL_HOST.test(base) ? base : null;
}

/** I2's caps for this bench's own traffic per UTC day. */
export const DAY_CAP_REQUESTS = 5_000;

/** Requests still allowed today, from the day file's content (another day's count restarts at 0). */
export function remainingToday(dayFile, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = dayFile?.day === day ? Number(dayFile.requests) || 0 : 0;
  return { day, used, left: Math.max(0, DAY_CAP_REQUESTS - used) };
}

/**
 * Whether to stop at once: Cloudflare's error 1027 (the daily request limit; a 429 whose body names it), a 5xx burst (3 or more of the last 20 answers), or
 * a redirect to the Access sign-in. `recent` is the last answers, newest last: `{status, body}`.
 */
export function stopReason(recent) {
  const last = recent.at(-1);
  if (last && /error code:?\s*1027|\b1027\b.*limit/i.test(String(last.body ?? "")))
    return "error 1027: the account's daily request limit";
  if (
    last &&
    last.status >= 300 &&
    last.status < 400 &&
    /cloudflareaccess\.com/.test(String(last.location ?? ""))
  )
    return "Cloudflare Access refused the service token";
  const window = recent.slice(-20);
  if (window.filter((r) => r.status >= 500).length >= 3) return "a 5xx burst (3 of the last 20 answers)";
  return null;
}

/** Fills a path pattern's `:params` from `ids` (`{ id: "…", group: "…" }`); null when one is missing. */
export function fillPath(pattern, ids) {
  let missing = false;
  const path = pattern.replace(/:(\w+)/g, (_, name) => {
    const v = ids[name];
    if (typeof v !== "string" || v === "") missing = true;
    return encodeURIComponent(String(v ?? ""));
  });
  return missing ? null : path;
}

/** The first `id` of the first array of objects in a list answer (the keyset lists answer `{ items: [...] }` or `{ rows: [...] }`). */
export function firstId(body) {
  const seen = new Set();
  const walk = (v, depth) => {
    if (depth > 3 || v === null || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object" && typeof x.id === "string") return x.id;
      return null;
    }
    for (const x of Object.values(v)) {
      const found = walk(x, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(body, 0);
}

/** The list route that names a pattern's first `:id` (`/api/v1/invoices/:id/pdf` -> `/api/v1/invoices`). */
export const listOf = (pattern) => {
  const i = pattern.indexOf("/:");
  return i > 0 ? pattern.slice(0, i) : null;
};

/** p99 by nearest rank (with <= 100 samples it is the max, brief I1). */
export function p99(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.99 * s.length) - 1)];
}

// ---------- the run ----------

const LOCAL = process.env.BENCH_TARGET === "local";
const env = (k, d) => process.env[k] ?? d;
const DEFAULT_HOSTS = LOCAL
  ? { admin: "http://localhost:5173", portal: "http://localhost:5174", web: "http://localhost:8787" }
  : {
      admin: "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
      portal: "https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev",
      web: "https://techaust-platform-web-staging.techaust-technologies-153.workers.dev",
    };

const jobs = join(ROOT, "apps/jobs");
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
/** One SQL file through the jobs app's wrangler: staging remote, or the local dev database. */
function d1(statements, { json = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-routes-"));
  try {
    const file = join(dir, "q.sql");
    writeFileSync(file, statements.join("\n"));
    const target = LOCAL
      ? ["--local", "--persist-to", "../../.wrangler/state"]
      : ["--remote", "--env", "staging"];
    return execFileSync(
      process.execPath,
      [wrangler, "d1", "execute", "DB", ...target, ...(json ? ["--json"] : []), "--file", file],
      {
        cwd: jobs,
        encoding: "utf8",
        stdio: ["ignore", json ? "pipe" : "ignore", "inherit"],
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const fromB64url = (s) => Buffer.from(s, "base64url");
const clientHash = (password, salt, p) =>
  argon2Sync("argon2id", {
    message: password.normalize("NFKC"),
    nonce: fromB64url(salt),
    parallelism: p.p,
    passes: p.t,
    memory: p.m,
    tagLength: 32,
  }).toString("base64url");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (s) => {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => Number.parseInt(b, 2)));
};
const step = () => Math.floor(Date.now() / 30_000);
function totp(secret, s) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(s));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Stop extends Error {}

function makeClient(hosts, access, budget) {
  const recent = [];
  const timings = [];
  async function call(app, method, path, { body, cookie, headers = {} } = {}) {
    if (budget.left <= 0) throw new Stop(`the day's cap of ${DAY_CAP_REQUESTS} requests is reached`);
    budget.left--;
    budget.sent++;
    const base = hosts[app];
    const started = performance.now();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(LOCAL ? {} : access),
        Origin: base,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Math.round(performance.now() - started);
    const json = res.headers.get("content-type")?.includes("application/json") ?? false;
    const text = await res.text();
    recent.push({
      status: res.status,
      body: json ? "" : text.slice(0, 300),
      location: res.headers.get("location"),
    });
    if (recent.length > 40) recent.shift();
    timings.push({ app, method, path, status: res.status, ms, ray: res.headers.get("cf-ray") });
    const reason = stopReason(recent);
    if (reason) throw new Stop(reason);
    let data = {};
    if (json) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    const cookies = res.headers.getSetCookie();
    const named = (n) => cookies.find((c) => c.startsWith(`${n}=`))?.split(";")[0] ?? null;
    return {
      status: res.status,
      data,
      cookie: named("__Host-ta_admin") ?? named("__Host-ta_portal"),
      device: named("__Host-ta_device"),
    };
  }
  return { call, timings };
}

const ROLES = ["owner", "accountant", "staff", "sales"];

async function enrol(client, run) {
  const now = Date.now();
  const { createInviteStatements } = await import("./create-invite-sql.mjs");
  const users = ROLES.map((role) => ({
    role,
    email: `bench-${run}-${role}@bench.invalid`,
    password: randomBytes(18).toString("base64url"),
    token: randomBytes(32).toString("base64url"),
  }));
  d1(
    users.flatMap((u) =>
      createInviteStatements({
        email: u.email,
        role: u.role,
        tokenHash: createHash("sha256").update(u.token).digest("hex"),
        now,
        expiresAt: now + 3_600_000,
        auditId: randomUUID(),
      }),
    ),
  );
  for (const u of users) {
    const start = await client.call("admin", "POST", "/api/v1/auth/invite/start", {
      body: { token: u.token },
    });
    if (start.status !== 200) throw new Error(`invite/start (${u.role}) answered ${start.status}`);
    const finish = await client.call("admin", "POST", "/api/v1/auth/invite/finish", {
      body: {
        token: u.token,
        clientHash: clientHash(u.password, start.data.salt, start.data.params),
        name: `Bench ${u.role}`,
      },
    });
    if (finish.status !== 200) throw new Error(`invite/finish (${u.role}) answered ${finish.status}`);
    u.secret = base32(finish.data.secret);
    u.lastStep = step();
    const done = await client.call("admin", "POST", "/api/v1/auth/invite/totp", {
      body: { challenge: finish.data.challenge, code: totp(u.secret, u.lastStep) },
    });
    if (done.status !== 200) throw new Error(`invite/totp (${u.role}) answered ${done.status}`);
    u.cookie = done.cookie;
    u.device = done.device;
  }
  return users;
}

/** A fresh code for a user (each TOTP step is single use: wait for the next one if needed). */
async function nextCode(u) {
  while (step() <= u.lastStep) await sleep(1_000);
  u.lastStep = step();
  return totp(u.secret, u.lastStep);
}

/** L21: deactivate the bench users and revoke every session they hold. Never deleted: their audit and access rows stay. */
function retire(users) {
  if (users.length === 0) return;
  const emails = users.map((u) => q(u.email)).join(", ");
  const now = Date.now();
  d1([
    `UPDATE staff_sessions SET revoked_at = ${now} WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM staff_users WHERE email IN (${emails}));`,
    `UPDATE staff_users SET status = 'deactivated' WHERE email IN (${emails}) AND status <> 'deactivated';`,
    `UPDATE staff_invites SET expires_at = ${now} WHERE email IN (${emails}) AND used_at IS NULL AND expires_at > ${now};`,
  ]);
}

/** Portal sessions for the sample clients' contacts with portal access, through the `portal:link` SQL (one 15-minute link each, used at once). */
async function portalSessions(client) {
  const { SAMPLE, linkStatements } = await import("./portal-sql.mjs");
  const out = [];
  for (const c of SAMPLE.flatMap((s) => s.contacts)
    .filter((x) => x.portal === 1)
    .slice(0, 2)) {
    const token = randomBytes(32).toString("base64url");
    d1(
      linkStatements({
        contactId: c.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        now: Date.now(),
        auditId: randomUUID(),
      }),
    );
    const v = await client.call("portal", "POST", "/api/v1/auth/magic/verify", { body: { token } });
    if (v.status === 200 && v.cookie) out.push({ contact: c.id, cookie: v.cookie, finance: c.finance === 1 });
  }
  return out;
}

/** Every GET row (and the safe writes) of one app, with its path filled from the lists; unresolved patterns are reported, not guessed. */
async function resolveRows(client, app, rows, cookie) {
  const ids = new Map();
  const ready = [];
  const unresolved = [];
  for (const r of rows) {
    if (!r.path.includes("/:")) {
      ready.push({ ...r, url: r.path });
      continue;
    }
    const list = listOf(r.path);
    if (!ids.has(list) && list) {
      const res = await client.call(app, "GET", list, { cookie });
      ids.set(list, res.status === 200 ? firstId(res.data) : null);
    }
    const url = fillPath(r.path, { id: ids.get(list) ?? "" });
    if (url) ready.push({ ...r, url });
    else unresolved.push(r.id);
  }
  return { ready, unresolved };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[args.indexOf("--mode") + 1];
  if (!["routes", "load"].includes(mode))
    throw new Error("usage: node scripts/bench-routes.mjs --mode routes|load");
  const hosts = {
    admin: allowedBase(env("ADMIN_URL", DEFAULT_HOSTS.admin)),
    portal: allowedBase(env("PORTAL_URL", DEFAULT_HOSTS.portal)),
    web: allowedBase(env("WEB_URL", DEFAULT_HOSTS.web)),
  };
  for (const [app, h] of Object.entries(hosts))
    if (!h) throw new Error(`${app}: only the staging hosts or localhost may be benched (never production)`);
  if (!LOCAL && Object.values(hosts).some((h) => LOCAL_HOST.test(h)))
    throw new Error("a local host needs BENCH_TARGET=local");
  const access = {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
  };
  if (!LOCAL && (!access["CF-Access-Client-Id"] || !access["CF-Access-Client-Secret"]))
    throw new Error("the Access service token (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET) is missing");

  const dayPath = join(ROOT, ".logs", "bench-day.json");
  // The day file is this machine's count; a workflow run starts empty, so the owner passes earlier runs' count (BENCH_SENT_TODAY). The larger one counts.
  const fileDay = existsSync(dayPath) ? JSON.parse(readFileSync(dayPath, "utf8")) : null;
  const told = Number.parseInt(process.env.BENCH_SENT_TODAY ?? "0", 10) || 0;
  const nowDay = new Date().toISOString().slice(0, 10);
  const today = remainingToday({
    day: nowDay,
    requests: Math.max(told, fileDay?.day === nowDay ? Number(fileDay.requests) || 0 : 0),
  });
  const budget = { left: today.left, sent: 0 };
  console.log(
    `bench ${mode}: ${today.used} requests already sent today (UTC ${today.day}), ${today.left} left of ${DAY_CAP_REQUESTS}`,
  );
  const client = makeClient(hosts, access, budget);
  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const windowStart = new Date();
  let users = [];
  let stopped = null;
  const unresolvedAll = [];
  try {
    users = await enrol(client, run);
    const owner = users.find((u) => u.role === "owner");
    const { buildRows } = await import("./route-inventory.mjs");
    const rows = buildRows();
    const gets = (worker) => rows.filter((r) => worker(r.worker) && r.method === "GET" && r.kind !== "login");
    const admin = await resolveRows(
      client,
      "admin",
      gets((w) => w.startsWith("admin-")),
      owner.cookie,
    );
    const portal = await portalSessions(client);
    const portalRows = portal[0]
      ? await resolveRows(
          client,
          "portal",
          gets((w) => w === "portal"),
          portal[0].cookie,
        )
      : { ready: [], unresolved: [] };
    unresolvedAll.push(...admin.unresolved, ...portalRows.unresolved);

    // The step-up window (10 minutes) for the Owner's step-up reads.
    await client.call("admin", "POST", "/api/v1/auth/step-up", {
      body: { code: await nextCode(owner) },
      cookie: owner.cookie,
    });

    const read = async (r) => {
      if (r.worker === "portal") return client.call("portal", "GET", r.url, { cookie: portal[0]?.cookie });
      if (r.worker === "web") return client.call("web", "GET", r.url);
      return client.call("admin", "GET", r.url, { cookie: owner.cookie });
    };
    const safeWrites = async () => {
      // Mark-read and the switches re-saved unchanged (BENCH_WRITES); each is undone by its nature.
      await client.call("admin", "POST", "/api/v1/notifications/read-all", {
        body: {},
        cookie: owner.cookie,
      });
      const prefs = await client.call("admin", "GET", "/api/v1/notifications/prefs", {
        cookie: owner.cookie,
      });
      if (prefs.status === 200)
        await client.call("admin", "PUT", "/api/v1/notifications/prefs", {
          body: prefs.data,
          cookie: owner.cookie,
        });
    };
    const webRows = rows
      .filter((r) => r.worker === "web" && r.method === "GET")
      .map((r) => ({ ...r, url: r.path }));
    const all = [...admin.ready, ...portalRows.ready, ...webRows];
    if (mode === "routes") {
      // Three sessions are the workflow's (S1 after the deploy, S2 three minutes later, S3 an hour later): each pass calls every row 7 times, so three
      // passes give >= 20 calls a row; the safe writes 2 times a pass (>= 5 in all).
      const passes = Number(env("BENCH_PASSES", "7"));
      for (let p = 0; p < passes; p++) {
        for (const r of all) await read(r);
        if (p % 3 === 0) await safeWrites();
      }
    } else {
      // 5 virtual users x 10 minutes at about 2 requests a second together; 80 % reads, 20 % safe writes.
      const until = Date.now() + Number(env("BENCH_MINUTES", "10")) * 60_000;
      const vu = async () => {
        while (Date.now() < until) {
          if (Math.random() < 0.8) await read(all[Math.floor(Math.random() * all.length)]);
          else await safeWrites();
          await sleep(2_500);
        }
      };
      await Promise.all(Array.from({ length: 5 }, vu));
      // The 60-second burst at 20 a second: refusals only (400/429), nothing written past the counters. The wrong-password logins LAST (L21).
      const burst = async (fn) => {
        const end = Date.now() + 20_000;
        while (Date.now() < end) {
          await Promise.all(Array.from({ length: 20 }, fn));
          await sleep(1_000);
        }
      };
      await burst(() =>
        client.call("portal", "POST", "/api/v1/auth/magic", { body: { email: "nobody@bench.invalid" } }),
      );
      await burst(() => client.call("web", "POST", "/api/forms/contact", { body: {} }));
      await burst(() =>
        client.call("admin", "POST", "/api/v1/auth/login", {
          body: { email: `nobody-${run}@bench.invalid`, clientHash: randomBytes(32).toString("base64url") },
        }),
      );
    }
  } catch (e) {
    if (e instanceof Stop) stopped = e.message;
    else throw e;
  } finally {
    retire(users);
    mkdirSync(dirname(dayPath), { recursive: true });
    writeFileSync(dayPath, `${JSON.stringify({ day: today.day, requests: today.used + budget.sent })}\n`);
  }
  const by = {};
  for (const t of client.timings) {
    const k = `${t.app} ${t.method} ${t.path.replace(/\/[0-9a-z_-]{16,}/gi, "/:id")}`;
    by[k] = [...(by[k] ?? []), t];
  }
  const report = {
    run,
    mode,
    windowUtc: [windowStart.toISOString(), new Date().toISOString()],
    requests: budget.sent,
    stopped,
    unresolved: unresolvedAll,
    statuses: Object.fromEntries(
      Object.entries(by).map(([k, ts]) => [
        k,
        { n: ts.length, s: [...new Set(ts.map((t) => t.status))], wallP99ms: p99(ts.map((t) => t.ms)) },
      ]),
    ),
  };
  writeFileSync(join(ROOT, ".logs", `bench-routes-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `bench ${mode}: ${budget.sent} requests; window ${report.windowUtc.join(" to ")}; unresolved ${unresolvedAll.length}; ${stopped ? `STOPPED: ${stopped}` : "completed"}`,
  );
  console.log("bench users deactivated and their sessions revoked (never deleted).");
  if (stopped) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
