// M1.4 auth CPU benchmark (docs/09 M1.4 gate). Runs from the owner-only workflow `.github/workflows/bench-auth.yml`
// against the STAGING admin, through Cloudflare Access with a service token. It:
//   1. creates throwaway staff invites in staging D1 (emails @bench.invalid, 1 h expiry),
//   2. enrols each one over HTTP (browser-style Argon2id done here with Node's built-in argon2),
//   3. runs real logins (salt → login → TOTP → /me) for the chosen duration, plus unknown-email logins,
//   4. deletes the bench users, sessions, invites and lockout rows (the append-only audit log keeps its
//      'auth.login' rows, as it should).
// Nothing secret is printed: tokens, hashes and TOTP secrets stay in memory. CPU time per request is read
// afterwards from Workers Logs for the printed time window (docs/runbooks/cpu-baseline.md).
import { execFileSync } from "node:child_process";
import { argon2Sync, createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN =
  process.env.ADMIN_URL ?? "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev";
const ACCESS = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
};
// BENCH_TARGET=local runs the same flow against `pnpm --filter @techaust/admin dev` and the local D1 (a dry run).
const LOCAL = process.env.BENCH_TARGET === "local";
if (!LOCAL && (!ACCESS["CF-Access-Client-Id"] || !ACCESS["CF-Access-Client-Secret"])) {
  throw new Error("Access service token missing");
}
const USERS = Number(process.env.BENCH_USERS ?? 12);
const MINUTES = Number(process.env.BENCH_MINUTES ?? 5);
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

// ---------- D1 (staging) through the jobs app's wrangler ----------
const jobs = fileURLToPath(new URL("../apps/jobs/", import.meta.url));
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
function d1(sql) {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  try {
    const file = join(dir, "q.sql");
    writeFileSync(file, sql);
    const target = LOCAL
      ? ["--local", "--persist-to", "../../.wrangler/state"]
      : ["--remote", "--env", "staging"];
    execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, "--file", file], {
      cwd: jobs,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

// ---------- HTTP ----------
const timings = [];
async function call(route, body, cookie) {
  const started = performance.now();
  const res = await fetch(`${ADMIN}/api/v1/auth${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(LOCAL ? {} : ACCESS),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const ms = performance.now() - started;
  timings.push({ route, status: res.status, ms: Math.round(ms), ray: res.headers.get("cf-ray") });
  if (res.status >= 300 && res.status < 400)
    throw new Error(`Redirected (Cloudflare Access refused the service token?) on ${route}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

// ---------- the browser's work ----------
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

// ---------- 1 + 2. invites and enrolment ----------
const users = Array.from({ length: USERS }, (_, i) => ({
  email: `bench-${RUN}-${i}@bench.invalid`,
  password: randomBytes(18).toString("base64url"),
  token: randomBytes(32).toString("base64url"),
}));
console.log(`Run ${RUN}: ${USERS} throwaway users, ${MINUTES} min of logins against ${ADMIN}`);
const windowStart = new Date();
d1(
  users
    .map(
      (u) =>
        `INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (${q(createHash("sha256").update(u.token).digest("hex"))}, ${q(u.email)}, 'staff', ${Date.now() + 3_600_000});`,
    )
    .join("\n"),
);

let failures = 0;
try {
  for (const u of users) {
    const start = await call("/invite/start", { token: u.token });
    if (start.status !== 200) throw new Error(`invite/start → ${start.status}`);
    const finish = await call("/invite/finish", {
      token: u.token,
      clientHash: clientHash(u.password, start.data.salt, start.data.params),
    });
    if (finish.status !== 200) throw new Error(`invite/finish → ${finish.status}`);
    u.secret = base32(finish.data.secret);
    u.lastStep = step();
    const done = await call("/invite/totp", {
      challenge: finish.data.challenge,
      code: totp(u.secret, u.lastStep),
    });
    if (done.status !== 200) throw new Error(`invite/totp → ${done.status}`);
  }

  // ---------- 3. logins ----------
  const until = Date.now() + MINUTES * 60_000;
  let logins = 0;
  while (Date.now() < until) {
    for (const u of users) {
      const s = Math.max(u.lastStep + 1, step() - 1);
      if (s > step() + 1) continue; // this user's next code isn't valid yet
      const salt = await call("/salt", { email: u.email });
      const login = await call("/login", {
        email: u.email,
        clientHash: clientHash(u.password, salt.data.salt, salt.data.params),
      });
      if (login.status !== 200) {
        failures++;
        continue;
      }
      const t = await call("/totp", { challenge: login.data.challenge, code: totp(u.secret, s) });
      if (t.status !== 200) {
        failures++;
        continue;
      }
      u.lastStep = s;
      logins++;
      await call("/me", undefined, t.cookie);
      if (logins % 10 === 0) {
        // Unknown-email path (fake salt, no account): must cost the same as a real one.
        const email = `nobody-${RUN}-${logins}@bench.invalid`;
        const fake = await call("/salt", { email });
        await call("/login", {
          email,
          clientHash: clientHash("wrong-password", fake.data.salt, fake.data.params),
        });
      }
    }
    await sleep(2_000);
  }
  console.log(`Completed ${logins} logins (${failures} unexpected failures).`);
} finally {
  // ---------- 4. cleanup ----------
  const emails = users.map((u) => q(u.email)).join(", ");
  const keys = users
    .map((u) => q(`acct:${createHash("sha256").update(u.email).digest("hex").slice(0, 32)}`))
    .join(", ");
  d1(
    [
      `DELETE FROM staff_sessions WHERE user_id IN (SELECT id FROM staff_users WHERE email IN (${emails}));`,
      `DELETE FROM staff_users WHERE email IN (${emails});`,
      `DELETE FROM staff_invites WHERE email IN (${emails});`,
      `DELETE FROM auth_attempts WHERE key IN (${keys});`,
      `DELETE FROM auth_attempts WHERE key LIKE 'acct:%' AND window_start >= ${windowStart.getTime()} AND failures <= 1;`,
    ].join("\n"),
  );
  console.log("Cleaned up the bench users.");
}

// ---------- report (no secrets) ----------
const windowEnd = new Date();
const byRoute = {};
for (const t of timings) {
  byRoute[t.route] = [...(byRoute[t.route] ?? []), t.ms];
}
const pct = (xs, p) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const summary = Object.fromEntries(
  Object.entries(byRoute).map(([r, xs]) => [
    r,
    { n: xs.length, wallP50ms: pct(xs, 50), wallP99ms: pct(xs, 99) },
  ]),
);
const report = {
  run: RUN,
  windowUtc: [windowStart.toISOString(), windowEnd.toISOString()],
  failures,
  wallClock: summary,
};
writeFileSync("bench-auth-result.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures > 0) process.exitCode = 1;
