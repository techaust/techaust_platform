// Shared helpers of the admin API tests (workerd, a fresh D1 per test file with every migration applied).
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  b64url,
  currentStep,
  DEFAULT_PARAMS,
  newSalt,
  newToken,
  passwordHmac,
  randomBytes,
  SITEVERIFY_URL,
  sealTotpSecret,
  secretFromBase32,
  tokenHash,
  totpCode,
} from "@techaust/auth";
import type { Role } from "@techaust/core";
import { uuidv7 } from "@techaust/core";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { RouteDef } from "./context.ts";
import app from "./index.ts";

export const ORIGIN = "https://admin.example";
export const hash = () => b64url(randomBytes(32));

// ---- D1 wrappers ---------------------------------------------------------------------------------------------

type Around = <T>(run: () => Promise<T>) => Promise<T>;

class Stmt {
  constructor(
    readonly real: D1PreparedStatement,
    private readonly around: Around,
  ) {}
  bind(...v: unknown[]) {
    return new Stmt(this.real.bind(...v), this.around);
  }
  first(...a: unknown[]) {
    return this.around(() => (this.real.first as (...x: unknown[]) => Promise<unknown>)(...a));
  }
  run() {
    return this.around(() => this.real.run());
  }
  all() {
    return this.around(() => this.real.all());
  }
  raw(...a: unknown[]) {
    return this.around(() => (this.real.raw as (...x: unknown[]) => Promise<unknown>)(...a));
  }
}

/** A D1 whose first/run/all/raw/batch calls go through `around` (a batch is ONE call, as on D1). */
function wrap(db: D1Database, around: Around): D1Database {
  return {
    prepare: (q: string) => new Stmt(db.prepare(q), around),
    batch: (stmts: Stmt[]) => around(() => db.batch(stmts.map((s) => s.real))),
  } as unknown as D1Database;
}

/** `env` with another DB. */
export const withDb = (db: D1Database): Env =>
  new Proxy(env, { get: (t, k) => (k === "DB" ? db : Reflect.get(t, k)) }) as Env;

export type Counted = { env: Env; db: D1Database; calls: () => number };

/** `env` whose DB counts calls (a batch counts once, as it does on D1). Pass a barrier DB to count through it. */
export function counted(base: D1Database = env.DB): Counted {
  let n = 0;
  const db = wrap(base, (run) => {
    n++;
    return run();
  });
  return { env: withDb(db), db, calls: () => n };
}

/**
 * Holds the RESULT of each of the first `n` calls until the n-th call has been issued, so `n` parallel requests
 * all see the database as it was before any of them wrote (the calls themselves still run in issue order).
 * Later calls are not held.
 */
export function barrierDb(base: D1Database, n: number): D1Database {
  let issued = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return wrap(base, (run) => {
    const mine = issued++;
    if (issued === n) release();
    const p = run();
    if (mine >= n) return p;
    return p.then(
      async (r) => {
        await gate;
        return r;
      },
      async (e) => {
        await gate;
        throw e;
      },
    );
  });
}

// ---- requests ------------------------------------------------------------------------------------------------

type Requester = {
  request: (
    input: string,
    init: RequestInit,
    env: Env,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
};

/**
 * A request into a Hono app WITH an execution context, answered only after everything the request put in
 * `waitUntil` has settled (the access-log write rides there since audit L5): so a test sees the same database a
 * caller would see a moment after the response.
 */
export async function sendTo(
  target: Requester,
  input: string,
  init: RequestInit,
  e: Env = env,
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await target.request(input, init, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** `sendTo` the real app. */
export const send = (input: string, init: RequestInit, e: Env = env) => sendTo(app, input, init, e);

export type CallInit = {
  body?: unknown;
  cookie?: string | undefined;
  method?: string;
  headers?: Record<string, string>;
};

/** A request to `/api/v1<path>` as the SPA would send it (same origin, JSON), straight into the Hono app. */
export const call = async (path: string, init: CallInit = {}, e: Env = env) =>
  send(
    `${ORIGIN}/api/v1${path}`,
    {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        Origin: ORIGIN,
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? null : JSON.stringify(init.body),
    },
    e,
  );

/** One request on a counting DB: the response and how many D1 calls it made. */
export async function counting(path: string, init: CallInit = {}, base: D1Database = env.DB) {
  const c = counted(base);
  const res = await call(path, init, c.env);
  return { res, calls: c.calls() };
}

export const cookieOf = (res: Response, name = "__Host-ta_admin") =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0] ?? null;

/** The response body without `request_id` (it differs per request by design). */
export async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const { request_id: _ignored, ...rest } = (await res.clone().json()) as Record<string, unknown>;
  return rest;
}

// ---- D1 reads ------------------------------------------------------------------------------------------------

export const one = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .first<T>();

export const rows = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;

export const countOf = async (table: string, where = "1 = 1", ...params: unknown[]) =>
  (
    (await one<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...params)) as {
      n: number;
    }
  ).n;

export const attemptsRow = (key: string) =>
  one<{ failures: number; locked_until: number | null; window_start: number }>(
    "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
    key,
  );

export const userId = async (email: string) =>
  ((await one<{ id: string }>("SELECT id FROM staff_users WHERE email = ?", email)) as { id: string }).id;

// ---- accounts ------------------------------------------------------------------------------------------------

/** A live invite straight in the database (the owner's `invite` script does the same). */
export async function invite(email: string, role = "owner", ttlMs = 60_000) {
  const token = newToken();
  await env.DB.prepare("INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), email, role, Date.now() + ttlMs)
    .run();
  return token;
}

export type Enrolled = {
  email: string;
  clientHash: string;
  secret: Uint8Array;
  /** The TOTP step used at enrolment: the next sign-in needs a later one. */
  step: number;
  cookie: string;
  deviceCookie: string | null;
  recoveryCodes: string[];
  inviteToken: string;
};

/** Accept an invite token through the real API: start, finish (name + password hash), authenticator code. */
export async function accept(inviteToken: string, name = "Test Person", e_: Env = env): Promise<Enrolled> {
  const start = await call("/auth/invite/start", { body: { token: inviteToken } }, e_);
  expect(start.status).toBe(200);
  const { email } = (await start.json()) as { email: string };
  const clientHash = hash();
  const finish = await call("/auth/invite/finish", { body: { token: inviteToken, clientHash, name } }, e_);
  expect(finish.status).toBe(200);
  const f = (await finish.json()) as { secret: string; challenge: string; totpUri: string };
  expect(f.totpUri).toMatch(/^otpauth:\/\/totp\/TecHaust:/);
  const secret = secretFromBase32(f.secret);
  const step = currentStep(Date.now());
  const done = await call(
    "/auth/invite/totp",
    { body: { challenge: f.challenge, code: totpCode(secret, step) } },
    e_,
  );
  expect(done.status).toBe(200);
  const body = (await done.clone().json()) as { recoveryCodes: string[] };
  return {
    email,
    clientHash,
    secret,
    step,
    cookie: cookieOf(done) as string,
    deviceCookie: cookieOf(done, "__Host-ta_device"),
    recoveryCodes: body.recoveryCodes,
    inviteToken,
  };
}

/** The first two steps of accepting an invite (name + password, authenticator secret), stopping before the code. */
export async function finishOnly(inviteToken: string, name = "Test Person") {
  const clientHash = hash();
  const finish = await call("/auth/invite/finish", { body: { token: inviteToken, clientHash, name } });
  expect(finish.status).toBe(200);
  const f = (await finish.json()) as { secret: string; challenge: string };
  return { clientHash, secret: secretFromBase32(f.secret), challenge: f.challenge };
}

/** The enrolment code step with the member's current authenticator code. */
export const enrolCode = (challenge: string, secret: Uint8Array) =>
  call("/auth/invite/totp", { body: { challenge, code: totpCode(secret, currentStep(Date.now())) } });

/** A new member through a database invite (the owner's `invite` script does the same). */
export async function enrol(
  email: string,
  role = "owner",
  name = "Test Person",
  e: Env = env,
): Promise<Enrolled> {
  return accept(await invite(email, role), name, e);
}

/** The token inside an invite link (`…/invite#t=<token>`). */
export const tokenOfLink = (link: string) => new URL(link).hash.replace(/^#t=/, "");

/** Password step: a challenge for the code step. */
export async function challengeFor(email: string, clientHash: string, e: Env = env) {
  const res = await call("/auth/login", { body: { email, clientHash } }, e);
  expect(res.status).toBe(200);
  return ((await res.json()) as { challenge: string }).challenge;
}

/** Full password + code sign-in. */
export async function login(
  email: string,
  clientHash: string,
  secret: Uint8Array,
  step: number,
  cookie?: string,
) {
  const l = await call("/auth/login", { body: { email, clientHash } });
  if (l.status !== 200) return { status: l.status, cookie: null as string | null, res: l };
  const { challenge } = (await l.json()) as { challenge: string };
  const t = await call("/auth/totp", { body: { challenge, code: totpCode(secret, step) }, cookie });
  return { status: t.status, cookie: cookieOf(t), device: cookieOf(t, "__Host-ta_device"), res: t };
}

/** A 6-digit code that is valid for none of the steps the server would try. */
export function wrongCode(secret: Uint8Array) {
  const now = currentStep(Date.now());
  const valid = new Set([-2, -1, 0, 1, 2].map((d) => totpCode(secret, now + d)));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
}

let seq = 0;

export type TestSession = {
  id: string;
  email: string;
  role: Role;
  /** `__Host-ta_admin=<token>` */
  cookie: string;
  sessionId: string;
  secret: Uint8Array;
  /** The password's client hash (only with `password: true`): what the browser would send to /login. */
  clientHash: string;
};

/**
 * An active member with a live session, written straight to the database (no password hashing): for tests of
 * what a signed-in member can do. `stepUp`: true = a step-up in force for ten minutes, or the end time in ms.
 */
export async function sessionFor(
  role: Role,
  opts: { email?: string; stepUp?: boolean | number; name?: string; password?: boolean } = {},
): Promise<TestSession> {
  const id = uuidv7();
  const email = opts.email ?? `${role}-${++seq}-${id.slice(-6)}@example.com`;
  const secret = randomBytes(20);
  const token = newToken();
  const sessionId = await tokenHash(token);
  const now = Date.now();
  const stepUp = opts.stepUp === true ? now + 10 * 60_000 : opts.stepUp || null;
  const clientHash = hash();
  const salt = newSalt();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_users (id, email, name, role, status, pw_salt, pw_hmac, pw_params, totp_secret_enc, totp_enabled_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7, ?8, ?9)",
    ).bind(
      id,
      email,
      opts.name ?? email,
      role,
      opts.password ? salt : null,
      opts.password ? await passwordHmac(env.PASSWORD_PEPPER, salt, clientHash) : null,
      opts.password ? JSON.stringify(DEFAULT_PARAMS) : null,
      await sealTotpSecret(env.TOTP_ENC_KEY, id, secret),
      now,
    ),
    env.DB.prepare(
      "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    ).bind(sessionId, id, now, now + 12 * 3_600_000, now + 7 * 24 * 3_600_000, stepUp),
  ]);
  return { id, email, role, cookie: `__Host-ta_admin=${token}`, sessionId, secret, clientHash };
}

/**
 * A fresh password + code sign-in of a `password: true` member (the authenticator "shows" the current code: the
 * replay guard's last step is cleared first, so the helper can sign in as often as a test needs).
 */
export async function signIn(s: TestSession, cookie?: string, e: Env = env) {
  await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?").bind(s.id).run();
  const challenge = await challengeFor(s.email, s.clientHash, e);
  const res = await call(
    "/auth/totp",
    { body: { challenge, code: totpCode(s.secret, currentStep(Date.now())) }, cookie },
    e,
  );
  return { res, cookie: cookieOf(res), device: cookieOf(res, "__Host-ta_device"), challenge };
}

/** A request that reaches the handler of `route`: a valid body, and a made-up id where the path needs one. */
export function sampleRequest(route: RouteDef) {
  const path = route.path
    .replace("/api/v1", "")
    .replace(":tokenHash", "a".repeat(64))
    .replace(":group", "tax")
    .replace(":kind", "INR")
    .replace(":block", "standard_terms")
    .replace(":id", "no-such-id");
  const body =
    route.method === "GET" || route.method === "DELETE"
      ? undefined
      : route.path.endsWith("/invites")
        ? { email: `new-${Math.random().toString(36).slice(2)}@example.com`, role: "staff" }
        : route.method === "PATCH"
          ? { role: "staff" }
          : {};
  return { path, init: { method: route.method, body } };
}

/** Another live session for the same member. */
export async function extraSession(s: TestSession) {
  const token = newToken();
  const sessionId = await tokenHash(token);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(sessionId, s.id, now, now + 12 * 3_600_000, now + 7 * 24 * 3_600_000)
    .run();
  return { cookie: `__Host-ta_admin=${token}`, sessionId };
}

/** A code that opens a step-up now: the first step after the member's last used one. */
export async function nextCode(s: TestSession) {
  const last = (
    await one<{ totp_last_step: number | null }>("SELECT totp_last_step FROM staff_users WHERE id = ?", s.id)
  )?.totp_last_step;
  const now = currentStep(Date.now());
  const step = Math.max((last ?? 0) + 1, now - 1);
  expect(step).toBeLessThanOrEqual(now + 1); // the server accepts one step of drift either way
  return { code: totpCode(s.secret, step), step };
}

// ---- Turnstile and the email queue (M2.4b) -------------------------------------------------------------------

export type SiteverifyAnswer =
  | Record<string, unknown>
  | "network-error"
  | "not-json"
  | { httpStatus: number };

export type Siteverify = {
  /** What the stub answers. A successful answer is single-use per token (a second use is `timeout-or-duplicate`). */
  answer: SiteverifyAnswer;
  /** The form body of every siteverify call, in order. */
  calls: URLSearchParams[];
};

let tokenSeq = 0;
/** A fresh Turnstile token for the stub (tokens starting `bad` are always refused). */
export const token = () => `tok-${++tokenSeq}`;

/**
 * Replaces `fetch` for the length of each test with Cloudflare's siteverify: every token is real once, and `bad…` tokens
 * never are. The Workers make no other fetch, so anything else throws. Call it once per file, in the describe scope.
 */
export function stubSiteverify(): Siteverify {
  const sv: Siteverify = { answer: { success: true }, calls: [] };
  const used = new Set<string>();
  beforeEach(() => {
    sv.answer = { success: true };
    sv.calls = [];
    used.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) !== SITEVERIFY_URL) throw new Error(`unexpected fetch: ${String(input)}`);
      const body = init?.body as URLSearchParams;
      sv.calls.push(body);
      const a = sv.answer;
      if (a === "network-error") throw new TypeError("fetch failed");
      if (a === "not-json") return new Response("<html>bad gateway</html>", { status: 200 });
      if ("httpStatus" in a) return new Response("{}", { status: a.httpStatus as number });
      const t = body.get("response") ?? "";
      if (a.success === true && (t.startsWith("bad") || used.has(t)))
        return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      if (a.success === true) used.add(t);
      return Response.json(a);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  return sv;
}

/** `base` with some bindings or vars replaced. */
export const withEnv = (base: Env, over: Record<string, unknown>): Env =>
  new Proxy(base, { get: (t, k) => (k in over ? over[k as string] : Reflect.get(t, k)) }) as Env;

export type CapturedQueue = { env: Env; sent: unknown[]; batches: number; singles: number };

/** `base` whose EMAIL_QUEUE records what is sent (the real queue would hand it to the jobs Worker). */
export function captureQueue(base: Env = env, fail?: () => unknown): CapturedQueue {
  const out = { sent: [] as unknown[], batches: 0, singles: 0 };
  const queue = {
    send: async (m: unknown) => {
      out.singles++;
      if (fail) throw fail();
      out.sent.push(m);
    },
    sendBatch: async (ms: { body: unknown }[]) => {
      out.batches++;
      if (fail) throw fail();
      for (const m of ms) out.sent.push(m.body);
    },
  };
  return Object.assign(out, { env: withEnv(base, { EMAIL_QUEUE: queue }) });
}
