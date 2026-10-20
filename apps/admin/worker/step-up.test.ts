// Step-up [ADM-AUTH-08]: sensitive routes need a FRESH authenticator code; it lasts ten minutes on that session.
import { STEP_UP_MS, totpCode } from "@techaust/auth";
import { decide, ROLES } from "@techaust/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./guard.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  counting,
  countOf,
  enrol,
  extraSession,
  nextCode,
  one,
  sampleRequest,
  sessionFor,
  userId,
  wrongCode,
} from "./test-helpers.ts";

afterEach(() => vi.useRealTimers());

const stepUp = (s: { cookie: string }, code: string) =>
  call("/auth/step-up", { body: { code }, cookie: s.cookie });
const STEP_UP_BODY = {
  error: { code: "step_up_required", message: "Confirm with a fresh code from your authenticator first" },
};

describe("every step-up route refuses without a step-up [ADM-AUTH-08]", () => {
  const stepUpRoutes = ROUTES.flatMap((route) => {
    const access = route.access;
    if (access === "public") return [];
    return ROLES.filter((role) => decide(role, access) === "step-up").map((role) => ({ route, role }));
  });

  it("there are step-up routes for the owner (users.manage) and for everyone (recovery codes)", () => {
    const names = new Set(stepUpRoutes.map((x) => `${x.route.method} ${x.route.path}`));
    expect(names.has("POST /api/v1/users/invites")).toBe(true);
    expect(names.has("POST /api/v1/auth/recovery/regenerate")).toBe(true);
    expect(
      stepUpRoutes
        .filter((x) => x.route.access === "account.recoveryCodes")
        .map((x) => x.role)
        .sort(),
    ).toEqual([...ROLES].sort());
  });

  for (const { route, role } of stepUpRoutes) {
    it(`${role}: ${route.method} ${route.path} → 403 step_up_required, then passes the guard with a step-up`, async () => {
      const without = await sessionFor(role);
      const { path, init } = sampleRequest(route);
      const refused = await call(path, { ...init, cookie: without.cookie });
      expect(refused.status).toBe(403);
      expect(await bodyOf(refused)).toEqual(STEP_UP_BODY);

      const withIt = await sessionFor(role, { stepUp: true });
      const passed = await call(path, { ...init, cookie: withIt.cookie });
      expect(passed.status, `${path}: ${await passed.clone().text()}`).not.toBe(403);
      expect(passed.status).not.toBe(401);
    });
  }
});

describe("how long a step-up lasts [ADM-AUTH-08]", () => {
  it("passes at 9:59 and is refused at 10:01", async () => {
    const s = await sessionFor("owner");
    const { code } = await nextCode(s);
    const t0 = Date.now();
    const res = await stepUp(s, code);
    expect(res.status).toBe(200);
    const until = ((await res.json()) as { stepUpUntil: number }).stepUpUntil;
    expect(until - t0).toBeGreaterThanOrEqual(STEP_UP_MS - 2_000);
    expect(until - t0).toBeLessThanOrEqual(STEP_UP_MS + 2_000);

    const invite = () =>
      call("/users/invites", {
        body: { email: `late-${Math.random().toString(36).slice(2)}@example.com`, role: "staff" },
        cookie: s.cookie,
      });
    expect((await invite()).status).toBe(201); // right after
    vi.useFakeTimers({ toFake: ["Date"], now: until - 1_000 }); // 9:59 after the step-up
    expect((await invite()).status).toBe(201);
    vi.setSystemTime(until + 1_000); // 10:01
    const late = await invite();
    expect(late.status).toBe(403);
    expect(await bodyOf(late)).toEqual(STEP_UP_BODY);
  });

  it("/me reports when the step-up ends, or null when there is none", async () => {
    const plain = await sessionFor("staff");
    expect(
      ((await (await call("/auth/me", { cookie: plain.cookie })).json()) as { stepUpUntil: unknown })
        .stepUpUntil,
    ).toBeNull();
    const fresh = await sessionFor("staff", { stepUp: true });
    const body = (await (await call("/auth/me", { cookie: fresh.cookie })).json()) as { stepUpUntil: number };
    expect(body.stepUpUntil).toBeGreaterThan(Date.now());
    const expired = await sessionFor("staff", { stepUp: Date.now() - 1_000 });
    expect(
      ((await (await call("/auth/me", { cookie: expired.cookie })).json()) as { stepUpUntil: unknown })
        .stepUpUntil,
    ).toBeNull();
  });

  it("applies to the session that did it, not to the member's other sessions", async () => {
    const s = await sessionFor("owner");
    const other = await extraSession(s);
    const { code } = await nextCode(s);
    expect((await stepUp(s, code)).status).toBe(200);
    const probe = (cookie: string) => call("/auth/recovery/regenerate", { method: "POST", cookie });
    expect((await probe(s.cookie)).status).toBe(200);
    expect((await probe(other.cookie)).status).toBe(403);
  });
});

describe("the step-up code [ADM-AUTH-08]", () => {
  it("a wrong code is counted, refused with 400 invalid_code, and opens nothing", async () => {
    const s = await sessionFor("owner");
    const r = await counting("/auth/step-up", { body: { code: wrongCode(s.secret) }, cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([400, 3]);
    expect(await bodyOf(r.res)).toEqual({
      error: { code: "invalid_code", message: "That code didn't work. Wait for the next one." },
    });
    expect((await attemptsRow(`code:${s.id}`))?.failures).toBe(1);
    const row = await one<{ step_up_until: number | null }>(
      "SELECT step_up_until FROM staff_sessions WHERE id = ?",
      s.sessionId,
    );
    expect(row?.step_up_until).toBeNull();
  });

  it("the sign-in code can't be replayed: the step-up needs a later 30-second step", async () => {
    const e = await enrol("stepup-replay@example.com");
    const used = await stepUp(e, totpCode(e.secret, e.step)); // the code that signed this member in
    expect(used.status).toBe(400);
    expect((await attemptsRow(`code:${await userId(e.email)}`))?.failures).toBe(1);
    const fresh = await stepUp(e, totpCode(e.secret, e.step + 1));
    expect(fresh.status).toBe(200);
    // and the code that just opened it can't open it again
    expect((await stepUp(e, totpCode(e.secret, e.step + 1))).status).toBe(400);
  });

  it("success: 3 calls, one audit row, a cleared counter, no new session and no cookie change", async () => {
    const s = await sessionFor("accountant");
    await call("/auth/step-up", { body: { code: wrongCode(s.secret) }, cookie: s.cookie });
    expect(await attemptsRow(`code:${s.id}`)).not.toBeNull();
    const sessions = await countOf("staff_sessions", "user_id = ?", s.id);
    const { code } = await nextCode(s);
    const r = await counting("/auth/step-up", { body: { code }, cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([200, 3]);
    expect(r.res.headers.getSetCookie()).toEqual([]); // no rotation: the session cookie stays
    expect(await countOf("staff_sessions", "user_id = ?", s.id)).toBe(sessions);
    expect(await attemptsRow(`code:${s.id}`)).toBeNull();
    expect(await countOf("audit_log", "action = 'auth.step_up' AND actor_id = ?", s.id)).toBe(1);
    expect(await call("/auth/me", { cookie: s.cookie }).then((x) => x.status)).toBe(200);
  });

  it("10 wrong codes lock it: 429, even for the right code (the counter is shared with sign-in)", async () => {
    const s = await sessionFor("owner");
    for (let i = 0; i < 10; i++) expect((await stepUp(s, wrongCode(s.secret))).status).toBe(400);
    const { code } = await nextCode(s);
    const r = await counting("/auth/step-up", { body: { code }, cookie: s.cookie });
    expect([r.res.status, r.calls]).toEqual([429, 3]);
    expect(await countOf("audit_log", "action = 'alert.lockout' AND entity_id = ?", s.id)).toBe(1);
  });

  it("needs a session and a well-formed code", async () => {
    expect((await call("/auth/step-up", { body: { code: "123456" } })).status).toBe(401);
    const s = await sessionFor("staff");
    expect((await stepUp(s, "12345")).status).toBe(400);
    expect((await stepUp(s, "abcdef")).status).toBe(400);
  });
});
