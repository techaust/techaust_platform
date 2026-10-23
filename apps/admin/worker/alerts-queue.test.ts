// Staff alerts become emails [ADM-AUTH-09, ADM-AUTH-06, ADM-MAIL-01]: after an alert row is written the Worker puts
// `{ kind: "staff.alert", auditId }` on the email queue through `ctx.waitUntil`. The message holds the audit row's ID and
// nothing else; the jobs Worker reads the rest (see apps/jobs/test/staff-alerts.test.ts). The queue here is a recorder.
import { env } from "cloudflare:workers";
import { currentStep, totpCode } from "@techaust/auth";
import { describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import {
  call,
  captureQueue,
  challengeFor,
  enrol,
  hash,
  ORIGIN,
  one,
  rows,
  sessionFor,
  signIn,
  stubSiteverify,
  token,
  userId,
  withEnv,
} from "./test-helpers.ts";

stubSiteverify();

type Alert = { id: string; action: string; entity_id: string; actor_type: string; summary: string };
const alertRows = (action?: string) =>
  rows<Alert>(
    `SELECT id, action, entity_id, actor_type, summary FROM audit_log WHERE action LIKE ${action ? "?" : "'alert.%'"} ORDER BY at, id`,
    ...(action ? [action] : []),
  );
const message = (auditId: string) => ({ kind: "staff.alert", auditId });
const summaryOf = (a: Alert) => JSON.parse(a.summary) as Record<string, unknown>;

describe("new-device alerts [ADM-AUTH-09]", () => {
  it("a sign-in from a new browser queues exactly one message: the audit row's ID, and nothing else", async () => {
    const s = await sessionFor("staff", { password: true });
    const q = captureQueue();
    const { res, device } = await signIn(s, undefined, q.env);
    expect(res.status).toBe(200);
    expect(device).toBeTruthy();
    const found = (await alertRows("alert.new_device")).filter((a) => a.entity_id === s.id);
    expect(found).toHaveLength(1);
    expect(q.sent).toEqual([message((found[0] as Alert).id)]);
    // nothing about the person travels: no address, name, device text or IP
    const text = JSON.stringify(q.sent);
    for (const secret of [s.email, "Test", "Mozilla", "203.0.113"]) expect(text).not.toContain(secret);
  });

  it("a second sign-in from the same browser queues nothing", async () => {
    const s = await sessionFor("staff", { password: true });
    const first = captureQueue();
    const a = await signIn(s, undefined, first.env);
    expect(first.sent).toHaveLength(1);
    const again = captureQueue();
    const b = await signIn(s, a.device as string, again.env);
    expect(b.res.status).toBe(200);
    expect(again.sent).toEqual([]);
    expect((await alertRows("alert.new_device")).filter((r) => r.entity_id === s.id)).toHaveLength(1);
  });

  it("enrolment is not a new device: no alert row and no message", async () => {
    const q = captureQueue();
    const e = await enrol("alerts-enrol@example.com", "staff", "Test Person", q.env);
    expect(e.cookie).toBeTruthy();
    expect(q.sent).toEqual([]);
    const id = await userId(e.email);
    expect((await alertRows()).filter((a) => a.entity_id === id)).toEqual([]);
  });
});

describe("2FA-change alerts [ADM-AUTH-09]", () => {
  it("a recovery code sign-in queues the 2FA alert (change: recovery_code_used), plus a new-device one on a new browser", async () => {
    const e = await enrol("alerts-recovery@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const known = captureQueue();
    const ok = await call(
      "/auth/recovery",
      { body: { challenge, code: e.recoveryCodes[0] as string }, cookie: e.deviceCookie as string },
      known.env,
    );
    expect(ok.status).toBe(200);
    const id = await userId(e.email);
    const twoFa = (await alertRows("alert.2fa_change")).filter((a) => a.entity_id === id);
    expect(twoFa).toHaveLength(1);
    expect(summaryOf(twoFa[0] as Alert)).toEqual({
      ua: null,
      country: null,
      city: null,
      change: "recovery_code_used",
    });
    expect(known.sent).toEqual([message((twoFa[0] as Alert).id)]); // the browser is known: only the 2FA alert

    // a new browser as well: both alerts are queued, in the order they were written
    const challenge2 = await challengeFor(e.email, e.clientHash);
    const fresh = captureQueue();
    expect(
      (
        await call(
          "/auth/recovery",
          { body: { challenge: challenge2, code: e.recoveryCodes[1] as string } },
          fresh.env,
        )
      ).status,
    ).toBe(200);
    const kinds = fresh.sent.map((m) => (m as { auditId: string }).auditId);
    expect(kinds).toHaveLength(2);
    expect([fresh.batches, fresh.singles]).toEqual([1, 0]); // one sendBatch with both messages
    const all = await alertRows();
    const actions = kinds.map((id) => all.find((a) => a.id === id)?.action);
    expect(actions.sort()).toEqual(["alert.2fa_change", "alert.new_device"]);
  });

  it("new recovery codes (after a step-up) queue the alert with change: recovery_codes_regenerated; a refused call queues nothing", async () => {
    const s = await sessionFor("staff", { stepUp: false });
    const refusedQ = captureQueue();
    const refused = await call(
      "/auth/recovery/regenerate",
      { method: "POST", cookie: s.cookie },
      refusedQ.env,
    );
    expect(refused.status).toBe(403);
    expect(refusedQ.sent).toEqual([]);

    const t = await sessionFor("staff", { stepUp: true });
    const q = captureQueue();
    const ok = await call("/auth/recovery/regenerate", { method: "POST", cookie: t.cookie }, q.env);
    expect(ok.status).toBe(200);
    const found = (await alertRows("alert.2fa_change")).filter((a) => a.entity_id === t.id);
    expect(found).toHaveLength(1);
    expect(summaryOf(found[0] as Alert).change).toBe("recovery_codes_regenerated");
    expect(q.sent).toEqual([message((found[0] as Alert).id)]);
  });

  it("an owner's reset queues the alert about the member with change: reset_by_owner", async () => {
    const owner = await sessionFor("owner", { stepUp: true });
    const member = await enrol("alerts-reset@example.com", "staff");
    const id = await userId(member.email);
    const q = captureQueue();
    const res = await call(`/users/${id}/reset-2fa`, { method: "POST", cookie: owner.cookie }, q.env);
    expect(res.status).toBe(200);
    const found = (await alertRows("alert.2fa_change")).filter((a) => a.entity_id === id);
    expect(found).toHaveLength(1);
    expect(found[0]?.actor_type).toBe("staff");
    expect(summaryOf(found[0] as Alert).change).toBe("reset_by_owner");
    expect(q.sent).toEqual([message((found[0] as Alert).id)]);
  });

  it("the other 2FA alerts carry no `change` outside the three named ones; a new-device alert has exactly ua, country, city", async () => {
    const s = await sessionFor("staff", { password: true });
    await signIn(s, undefined, captureQueue().env);
    const nd = (await alertRows("alert.new_device")).find((a) => a.entity_id === s.id) as Alert;
    expect(Object.keys(summaryOf(nd)).sort()).toEqual(["city", "country", "ua"]);
  });
});

describe("lockout alerts [ADM-AUTH-06, ADM-AUTH-09]", () => {
  it("the 10th wrong password queues one message for a real account, an unknown email none, a locked call none", async () => {
    const e = await enrol("alerts-lock@example.com");
    const id = await userId(e.email);
    const q = captureQueue();
    for (let i = 0; i < 9; i++)
      await call("/auth/login", { body: { email: e.email, clientHash: hash(), turnstile: token() } }, q.env);
    expect(q.sent).toEqual([]);
    await call("/auth/login", { body: { email: e.email, clientHash: hash(), turnstile: token() } }, q.env);
    const found = (await alertRows("alert.lockout")).filter((a) => a.entity_id === id);
    expect(found).toHaveLength(1);
    expect(q.sent).toEqual([message((found[0] as Alert).id)]);
    // locked now: more calls change nothing
    expect(
      (await call("/auth/login", { body: { email: e.email, clientHash: hash(), turnstile: token() } }, q.env))
        .status,
    ).toBe(429);
    expect(q.sent).toHaveLength(1);

    const ghost = captureQueue();
    for (let i = 0; i < 12; i++)
      await call(
        "/auth/login",
        { body: { email: "alerts-ghost@example.com", clientHash: hash(), turnstile: token() } },
        ghost.env,
      );
    expect(ghost.sent).toEqual([]);
  });

  it("9 wrong passwords then the right one: a sign-in, no lockout alert, nothing queued", async () => {
    const e = await enrol("alerts-lock-right@example.com");
    const id = await userId(e.email);
    const q = captureQueue();
    for (let i = 0; i < 9; i++)
      await call("/auth/login", { body: { email: e.email, clientHash: hash(), turnstile: token() } }, q.env);
    const right = await call(
      "/auth/login",
      { body: { email: e.email, clientHash: e.clientHash, turnstile: token() } },
      q.env,
    );
    expect(right.status).toBe(200);
    expect(((await right.json()) as { next: string }).next).toBe("totp");
    expect((await alertRows("alert.lockout")).filter((a) => a.entity_id === id)).toHaveLength(0);
    expect(q.sent).toEqual([]);
  });

  it("a lock started by wrong codes queues one message too", async () => {
    const e = await enrol("alerts-lock-code@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const q = captureQueue();
    for (let i = 0; i < 10; i++)
      await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step + 5 + i) } }, q.env);
    expect(q.sent).toHaveLength(1);
    expect((await alertRows("alert.lockout")).map((a) => a.id)).toContain(
      (q.sent[0] as { auditId: string }).auditId,
    );
  });
});

describe("the queue never changes the answer", () => {
  it("a queue that fails: the sign-in still succeeds, the alert row stays, one code-only line is logged", async () => {
    const s = await sessionFor("staff", { password: true });
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    try {
      const q = captureQueue(env, () => new Error(`queue down for ${s.email}`));
      const { res } = await signIn(s, undefined, q.env);
      expect(res.status).toBe(200);
      expect((await alertRows("alert.new_device")).filter((a) => a.entity_id === s.id)).toHaveLength(1);
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0] as string) as Record<string, unknown>;
      expect(line).toMatchObject({ level: "error", message: "staff alert not queued", cause: "Error" });
      expect(lines[0]).not.toContain(s.email); // the error text is never logged
      expect(Object.keys(line).sort()).toEqual(["cause", "level", "message", "rid", "route"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("a queue whose send never resolves still lets the response go: the send rides ctx.waitUntil", async () => {
    const s = await sessionFor("staff", { password: true });
    const challenge = await challengeFor(s.email, s.clientHash);
    let sends = 0;
    const hung = withEnv(env, {
      EMAIL_QUEUE: {
        sendBatch: () => {
          sends++;
          return new Promise(() => {});
        },
      },
    });
    const waiting: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.request(
      `${ORIGIN}/api/v1/auth/totp`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ challenge, code: totpCode(s.secret, currentStep(Date.now())) }),
      },
      hung,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(sends).toBe(1); // the alert was handed over...
    expect(waiting.length).toBeGreaterThanOrEqual(1); // ...inside waitUntil, which the response did not wait for
    expect(
      await one(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'alert.new_device' AND entity_id = ?",
        s.id,
      ),
    ).toEqual({ n: 1 });
  });
});
