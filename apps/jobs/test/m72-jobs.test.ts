// M7.2 the jobs side of notifications and the digest [ADM-G-09, JOB-CRON-03, ADM-PAY-08, ADM-MAIL-01, ADM-AUTH-09; run file D, C.5, I]: the hourly tick, the
// `staff.notify` expansion by the members' switches (routed ahead of the generic email path), the weekly digest (owners only, once per week, the one-click
// headers on the email itself), `/u` (POST valid, tampered, another member's MAC, missing; GET never changes anything), the unfinished sign-in scan (Q3 A), the
// refund email (Q4 A, the C.2 recipient rule), the dead letter (early check finding 4 and the `job.failed` bell) and the magic link whose token is gone.
import { env as realEnv } from "cloudflare:workers";
import type { EmailMessage } from "@techaust/core";
import { uuidv7 } from "@techaust/core/ids";
import { staffNotify } from "@techaust/core/notifications";
import type { SendInput, Transport } from "@techaust/email";
import { describe, expect, it } from "vitest";
import { hourlyMessages } from "../src/billing.ts";
import { processDigest } from "../src/digest.ts";
import { DEAD_LETTER_SQL, emailLogId, processDeadLetter, processEmail } from "../src/email.ts";
import { processGateway } from "../src/gateway.ts";
import { processPortalAlert } from "../src/portal-alerts.ts";
import { handleQueue } from "../src/queue.ts";
import { processRefundNotify, refundCopyGate } from "../src/refund-notify.ts";
import { processRefundFamily } from "../src/refunds.ts";
import { istHourKey, processSigninUnfinished } from "../src/signin-unfinished.ts";
import { processStaffNotify } from "../src/staff-notify.ts";
import {
  unsubscribeGet,
  unsubscribePost,
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribe,
} from "../src/unsubscribe.ts";
import {
  all,
  fakes,
  logs,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  mkSend,
  one,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

const KEY = ["unsubscribe", "key", "made", "up", "for", "tests"].join("-");
const HOOKS = "https://jobs.example.test/";
/** Monday 2 November 2026, 09:00 IST (03:30 UTC). */
const MONDAY_9 = Date.parse("2026-11-02T03:30:00Z");
const istTick = (iso: string, hour: number) =>
  Date.parse(`${iso}T${String(hour).padStart(2, "0")}:00:00+05:30`);

function recorder() {
  const sent: SendInput[] = [];
  let n = 0;
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return { kind: "sent", messageId: `m72-${Date.now()}-${++n}` };
    },
  };
  return { sent, transport };
}

const emailsOf = (template: string) =>
  fakes.email.map((s) => s.body as EmailMessage).filter((b) => b?.template === template);

/** A bell row as a producer writes it. */
async function bell(userId: string, kind: string, entityType: string, entityId: string, title = "A bell") {
  await run(
    "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '/invoices/x')",
    `n_${uuidv7()}`,
    userId,
    kind,
    entityType,
    entityId,
    title,
  );
}

describe("the hourly tick (enqueue only)", () => {
  it("the digest only on IST Mondays at 09:00, 10:00 and 11:00; the sign-in scan and the bells sweep every hour", () => {
    for (let h = 0; h < 24; h++) {
      const kinds = hourlyMessages(istTick("2026-11-02", h)).map((m) => m.kind);
      expect(kinds.includes("digest.weekly"), `Monday ${h}`).toBe(h >= 9 && h <= 11);
      expect(kinds).toContain("signin.unfinished");
      expect(kinds).toContain("bells.sweep");
      expect(hourlyMessages(istTick("2026-11-03", h)).map((m) => m.kind)).not.toContain("digest.weekly");
    }
    expect(hourlyMessages(MONDAY_9).find((m) => m.kind === "digest.weekly")).toEqual({
      v: 1,
      kind: "digest.weekly",
      weekStart: "2026-11-02",
    });
  });
});

describe("staff.notify (L9, Q1 A, Q2 A)", () => {
  it("one email per bell row by the members' switches; a member with the switch off, or inactive, gets none", async () => {
    const on = await staff("owner");
    const off = await staff("owner");
    const gone = await staff("owner", { status: "deactivated" });
    await run(
      "INSERT INTO staff_notification_prefs (user_id, email_payment_received) VALUES (?1, 0)",
      off.id,
    );
    const pay = `pay-${uuidv7()}`;
    for (const u of [on, off, gone])
      await bell(u.id, "payment.online", "payment", pay, "₹100.00 paid online");
    const e = makeEnv();
    expect(await processStaffNotify(e, staffNotify("payment.online", pay))).toBe("queued");
    const mails = emailsOf("staff.notification");
    expect(mails.map((m) => m.to)).toEqual([on.email]);
    expect(mails[0]?.data).toMatchObject({
      title: "₹100.00 paid online",
      url: "https://admin.example/invoices/x",
      settings_url: "https://admin.example/account/notifications",
    });
    expect(mails[0]?.entity.type).toBe("notification");
  });

  it("offer.viewed is off by default (Q2 A) and goes once switched on; another kind's bell on the same entity is not read", async () => {
    const sender = await staff("staff");
    const owner = await staff("owner");
    await run("INSERT INTO staff_notification_prefs (user_id, email_offer_viewed) VALUES (?1, 1)", sender.id);
    const doc = `doc-${uuidv7()}`;
    await bell(sender.id, "offer.viewed", "document", doc);
    await bell(owner.id, "offer.viewed", "document", doc);
    await bell(owner.id, "payment.online", "document", doc);
    await processStaffNotify(makeEnv(), staffNotify("offer.viewed", doc));
    expect(emailsOf("staff.notification").map((m) => m.to)).toEqual([sender.email]);
  });

  it("an unreadable body is acknowledged and nothing is sent", async () => {
    expect(await processStaffNotify(makeEnv(), { kind: "staff.notify", bell: "x", entityId: "y" })).toBe(
      "invalid",
    );
    expect(
      await processStaffNotify(makeEnv(), {
        kind: "staff.notify",
        bell: "payment.online",
        entityId: "y",
        to: "a@b.co",
      }),
    ).toBe("invalid");
    expect(fakes.email).toHaveLength(0);
  });

  it("the queue routes staff.notify AHEAD of the generic email path (never logged as an invalid email)", async () => {
    const owner = await staff("owner");
    const pay = `pay-${uuidv7()}`;
    await bell(owner.id, "payment.online", "payment", pay);
    const acked: string[] = [];
    await handleQueue(
      {
        queue: "techaust-local-email",
        messages: [
          {
            body: staffNotify("payment.online", pay),
            attempts: 1,
            ack: () => acked.push("ack"),
            retry: () => acked.push("retry"),
          },
        ],
      } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(acked).toEqual(["ack"]);
    expect(emailsOf("staff.notification").map((m) => m.to)).toEqual([owner.email]);
    expect(await one("SELECT count(*) AS n FROM email_log WHERE template = 'staff.notify'")).toEqual({
      n: 0,
    });
  });
});

describe("the weekly digest (JOB-CRON-03, L7, L8)", () => {
  it("owners only, switch respected, once per owner per week through the email log; the email carries the one-click headers", async () => {
    // Every earlier owner of this shared database switched off, so the counts are this test's.
    await run(
      "INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via) SELECT id, 0, 'settings' FROM staff_users WHERE role = 'owner' ON CONFLICT (user_id) DO UPDATE SET digest_weekly = 0, digest_off_via = 'settings'",
    );
    const a = await staff("owner");
    const b = await staff("owner");
    const s = await staff("staff");
    const off = await staff("owner");
    await run(
      "INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via) VALUES (?1, 0, 'settings')",
      off.id,
    );
    const e = makeEnv({ PUBLIC_HOOKS_URL: HOOKS, UNSUBSCRIBE_KEY: KEY });
    expect(await processDigest(e, { v: 1, kind: "digest.weekly", weekStart: "2026-11-02" }, MONDAY_9)).toBe(
      "queued",
    );
    expect(
      await processDigest(e, { v: 1, kind: "digest.weekly", weekStart: "2026-11-02" }, MONDAY_9 + 3_600_000),
    ).toBe("queued");
    const queued = emailsOf("digest.weekly");
    expect(new Set(queued.map((m) => m.to))).toEqual(new Set([a.email, b.email]));
    expect(queued.map((m) => m.to)).not.toContain(s.email);
    expect(queued[0]?.entity.id).toMatch(/:2026-11-02$/);
    // Through the real email consumer: two ticks, one email per owner.
    const { sent, transport } = recorder();
    const env = makeEnv({
      PUBLIC_HOOKS_URL: HOOKS,
      SES_MARKETING_CONFIGURATION_SET: "techaust-marketing",
    });
    for (const m of queued) await processEmail(env, m, transport, MONDAY_9);
    expect(sent).toHaveLength(2);
    const first = sent[0] as SendInput;
    // The positive one-click path (C.4): the digest alone carries List-Unsubscribe + List-Unsubscribe-Post and the marketing set.
    expect(first.headers).toEqual({
      "List-Unsubscribe": expect.stringMatching(
        /^<https:\/\/jobs\.example\.test\/u\?t=[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}>$/,
      ),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(first.configurationSet).toBe("techaust-marketing");
    expect(first.subject).toBe("Your week at TecHaust: 02 Nov 2026");
    expect(first.text).toContain(
      "Why you're receiving this: you're an owner of TecHaust admin and the weekly digest is on.",
    );
  });

  it("a message for another week is skipped; a malformed one is invalid", async () => {
    const e = makeEnv({ PUBLIC_HOOKS_URL: HOOKS, UNSUBSCRIBE_KEY: KEY });
    expect(await processDigest(e, { v: 1, kind: "digest.weekly", weekStart: "2026-10-26" }, MONDAY_9)).toBe(
      "stale_week",
    );
    expect(await processDigest(e, { v: 1, kind: "digest.weekly", weekStart: "2026-11-03" }, MONDAY_9)).toBe(
      "invalid",
    );
    expect(fakes.email).toHaveLength(0);
  });

  it("the digest figures equal the dashboard's own SQL (one source: db `digestStatements`, parity-tested in admin)", async () => {
    await staff("owner");
    const e = makeEnv({ PUBLIC_HOOKS_URL: HOOKS, UNSUBSCRIBE_KEY: KEY });
    await processDigest(e, { v: 1, kind: "digest.weekly", weekStart: "2026-11-02" }, MONDAY_9);
    const d = emailsOf("digest.weekly")[0]?.data ?? {};
    for (const k of ["pipeline", "invoiced", "collected", "overdue", "new_leads", "reminders_due"])
      expect(d[k], k).toBeTypeOf("string");
  });
});

describe("/u one-click (C.5, RFC 8058)", () => {
  const post = (t: string | null, e = makeEnv({ UNSUBSCRIBE_KEY: KEY })) =>
    unsubscribePost(
      new Request(`${HOOKS}u${t === null ? "" : `?t=${encodeURIComponent(t)}`}`, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      e as never,
      Date.parse("2026-11-02T05:00:00Z"),
    );
  const prefs = (id: string) =>
    one<{ digest_weekly: number; digest_off_via: string | null }>(
      "SELECT digest_weekly, digest_off_via FROM staff_notification_prefs WHERE user_id = ?1",
      id,
    );

  it("a valid token switches that member's digest off with one audit row; a repeat writes nothing more", async () => {
    const o = await staff("owner");
    const token = await unsubscribeToken(KEY, o.id);
    expect(await verifyUnsubscribe(KEY, token)).toBe(o.id);
    expect(unsubscribeUrl(HOOKS, token)).toMatch(
      /^https:\/\/jobs\.example\.test\/u\?t=[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}$/,
    );
    const res = await post(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await prefs(o.id)).toEqual({ digest_weekly: 0, digest_off_via: "one_click" });
    expect((await post(token)).status).toBe(200);
    expect(
      await one(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'notification.unsubscribe' AND entity_id = ?1 AND actor_type = 'system'",
        o.id,
      ),
    ).toEqual({ n: 1 });
    expect(logs.join("\n")).not.toContain(token);
  });

  it("tampered, another member's MAC, missing or malformed: 400, nothing changed, counted per window (never per address)", async () => {
    const a = await staff("owner");
    const b = await staff("owner");
    const ta = await unsubscribeToken(KEY, a.id);
    const mac = ta.split(".")[0] as string;
    const tampered = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}.${a.id}`;
    const crossed = `${mac}.${b.id}`;
    for (const t of [tampered, crossed, null, "", "x.y", `${mac}.${a.id}.extra`]) {
      const r = await post(t);
      expect(r.status, String(t)).toBe(400);
    }
    expect(await prefs(a.id)).toBeNull();
    expect(await prefs(b.id)).toBeNull();
    const key = `unsub:${Date.parse("2026-11-02T05:00:00Z") - (Date.parse("2026-11-02T05:00:00Z") % 3_600_000)}`;
    expect((await one<{ count: number }>("SELECT count FROM hook_failures WHERE key = ?1", key))?.count).toBe(
      6,
    );
  });

  it("GET /u never changes anything (a link scanner can't unsubscribe), even with a valid token", async () => {
    const o = await staff("owner");
    const token = await unsubscribeToken(KEY, o.id);
    const { exports } = await import("cloudflare:workers");
    const res = await exports.default.fetch(`${HOOKS}u?t=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("To change your email settings, open Notifications in TecHaust admin.\n");
    expect(await prefs(o.id)).toBeNull();
    expect((await unsubscribeGet().text()).trim()).toBe(
      "To change your email settings, open Notifications in TecHaust admin.",
    );
  });

  it("POST /u through the real Worker uses the configured key", async () => {
    const o = await staff("owner");
    const { exports } = await import("cloudflare:workers");
    const res = await exports.default.fetch(`${HOOKS}u?t=${await unsubscribeToken(KEY, o.id)}`, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect((await prefs(o.id))?.digest_weekly).toBe(0);
  });
});

describe("the unfinished sign-in scan (Q3 A)", () => {
  const T = Date.parse("2026-11-05T08:00:00Z");
  const pending = (userId: string, at: number) =>
    run(
      "INSERT INTO staff_signin_pending (id, user_id, at) VALUES (?1, ?2, ?3)",
      uuidv7().slice(0, 22),
      userId,
      at,
    );

  it("one email per active member and hour, the owners' bell, rows marked; young rows wait; an inactive member gets nothing", async () => {
    const owner = await staff("owner");
    const m = await staff("staff");
    const gone = await staff("staff", { status: "deactivated" });
    await pending(m.id, T - 30 * 60_000);
    await pending(m.id, T - 20 * 60_000);
    await pending(gone.id, T - 40 * 60_000);
    await pending(owner.id, T - 60_000); // still within the challenge's 5 minutes
    expect(await processSigninUnfinished(makeEnv(), { v: 1, kind: "signin.unfinished", asOf: T }, T)).toBe(
      "queued",
    );
    const mails = emailsOf("staff.signin_unfinished");
    expect(mails.map((x) => x.to)).toEqual([m.email]);
    expect(mails[0]?.entity).toEqual({ type: "signin_unfinished", id: `${m.id}:${istHourKey(T)}` });
    expect(
      await all(
        "SELECT user_id FROM notifications WHERE kind = 'signin.unfinished' AND entity_id = ?1",
        `${m.id}:${istHourKey(T)}`,
      ),
    ).toEqual(expect.arrayContaining([{ user_id: owner.id }]));
    expect(
      await all(
        "SELECT user_id FROM notifications WHERE kind = 'signin.unfinished' AND entity_id LIKE ?1",
        `${gone.id}:%`,
      ),
    ).toEqual([]);
    expect(
      await one(
        "SELECT count(*) AS n FROM staff_signin_pending WHERE user_id IN (?1, ?2) AND notified_at IS NULL",
        m.id,
        gone.id,
      ),
    ).toEqual({ n: 0 });
    expect(await one("SELECT notified_at FROM staff_signin_pending WHERE user_id = ?1", owner.id)).toEqual({
      notified_at: null,
    });
    // A second run in the same hour finds the rows marked: nothing more.
    const before = fakes.email.length;
    await processSigninUnfinished(makeEnv(), { v: 1, kind: "signin.unfinished", asOf: T }, T + 60_000);
    expect(emailsOf("staff.signin_unfinished").filter((x) => x.to === m.email)).toHaveLength(1);
    expect(fakes.email.length - before).toBeLessThanOrEqual(1); // the owner's own young row, now old enough
  });

  it("notified rows older than a day are deleted by the next scan", async () => {
    const m = await staff("staff");
    await run(
      "INSERT INTO staff_signin_pending (id, user_id, at, notified_at) VALUES (?1, ?2, ?3, ?3)",
      uuidv7().slice(0, 22),
      m.id,
      T - 2 * 86_400_000,
    );
    await processSigninUnfinished(makeEnv(), { v: 1, kind: "signin.unfinished", asOf: T }, T);
    expect(await one("SELECT count(*) AS n FROM staff_signin_pending WHERE user_id = ?1", m.id)).toEqual({
      n: 0,
    });
  });
});

describe("the refund email (Q4 A; C.2 recipient rule)", () => {
  /** A pending Razorpay payment for an issued invoice, and a refund of it (`origin`), succeeded. */
  async function refundOf(origin: "outside" | "chargeback", o: { anonymised?: boolean } = {}) {
    const now = Date.now();
    const owner = await staff("owner");
    const clientId = await mkClient();
    const doc = await mkDoc(clientId, null);
    const checkoutId = `co-m72-${uuidv7()}`;
    await run(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'razorpay', ?2, ?3, ?6, 'staff', 'INR', 50000, 'creating', ?4, ?5, ?5)`,
      checkoutId,
      doc.id,
      clientId,
      now + 86_400_000,
      now - 30 * 60_000,
      owner.id,
    );
    const paymentId = `rzp_pay_M72${uuidv7().slice(-12)}`;
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_by, recorded_at,
         provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
       VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 50000, 0, '2026-10-28', 'upi', ?3, NULL, ?4, ?5, ?6, 0, ?4)`,
      paymentId,
      clientId,
      `PAY-M72${uuidv7().slice(-10)}`,
      now - 60_000,
      `pay_M72${uuidv7().slice(-10)}`,
      checkoutId,
    );
    const refundId = uuidv7();
    await run(
      `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, provider_refund_id,
         requested_by, requested_at, settled_at, settled_on, updated_at)
       VALUES (?1, ?2, ?3, 'razorpay', ?4, 'succeeded', 'original', ?5, 'INR', 50000, ?6, ?7, ?8, ?8, '2026-11-04', ?8)`,
      refundId,
      paymentId,
      clientId,
      origin,
      origin === "chargeback" ? "chargeback" : "duplicate",
      `rfnd_${uuidv7().slice(-12)}`,
      owner.id,
      now,
    );
    if (o.anonymised) await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", clientId);
    return { refundId, clientId, doc };
  }
  /** 11:00 IST: inside the window. */
  const IN_WINDOW = Date.parse("2026-11-05T05:30:00Z");
  const env = () => makeEnv({ ENVIRONMENT: "local" });

  it("an outside refund emails the client's finance contacts only (portal access AND can see finance), once by its entity", async () => {
    const r = await refundOf("outside");
    const fin = await mkContact(r.clientId, { email: `fin${uuidv7().slice(-8)}@example.test` });
    await mkContact(r.clientId, { finance: false });
    await mkContact(r.clientId, { portal: false });
    await mkContact(r.clientId, { anonymised: true });
    const other = await mkClient();
    await mkContact(other, { email: `other${uuidv7().slice(-8)}@example.test` });
    expect(await processRefundNotify(env(), { kind: "refund.notify", refundId: r.refundId }, IN_WINDOW)).toBe(
      "queued",
    );
    const mails = emailsOf("refund.sent");
    expect(mails.map((m) => m.to)).toEqual([fin.email]);
    expect(mails[0]?.entity).toEqual({ type: "refund", id: r.refundId });
    expect(mails[0]?.data).toMatchObject({
      amount: "₹500.00",
      document_number: r.doc.numberDisplay,
      date: "04 Nov 2026",
    });
  });

  it("a chargeback, an anonymised client or a refund that isn't succeeded: nothing", async () => {
    const cb = await refundOf("chargeback");
    await mkContact(cb.clientId);
    expect(
      await processRefundNotify(env(), { kind: "refund.notify", refundId: cb.refundId }, IN_WINDOW),
    ).toBe("none");
    const anon = await refundOf("outside", { anonymised: true });
    await mkContact(anon.clientId);
    expect(
      await processRefundNotify(env(), { kind: "refund.notify", refundId: anon.refundId }, IN_WINDOW),
    ).toBe("none");
    expect(await processRefundNotify(env(), { kind: "refund.notify", refundId: uuidv7() }, IN_WINDOW)).toBe(
      "none",
    );
    expect(emailsOf("refund.sent")).toHaveLength(0);
  });

  it("outside 09:00 to 19:00 IST the same message comes back with a delay; unapproved copy keeps it off staging", async () => {
    const r = await refundOf("outside");
    await mkContact(r.clientId);
    const night = Date.parse("2026-11-05T16:00:00Z"); // 21:30 IST
    expect(await processRefundNotify(env(), { kind: "refund.notify", refundId: r.refundId }, night)).toBe(
      "delayed",
    );
    expect(fakes.email.at(-1)?.body).toEqual({ kind: "refund.notify", refundId: r.refundId });
    expect(fakes.email.at(-1)?.delaySeconds).toBe(11.5 * 3_600);
    expect(refundCopyGate.approved()).toBe(false);
    expect(
      await processRefundNotify(
        makeEnv({ ENVIRONMENT: "staging" }),
        { kind: "refund.notify", refundId: r.refundId },
        IN_WINDOW,
      ),
    ).toBe("held");
  });
});

describe("the dead letter (early check finding 4; L13)", () => {
  it("a sent row keeps its status and message id; a queued row becomes failed; the owners get one job.failed bell per queue and IST day", async () => {
    const owner = await staff("owner");
    const sentMsg: EmailMessage = {
      template: "lead.acknowledgement",
      to: `dlq-sent-${uuidv7().slice(-6)}@example.test`,
      data: { first_name: "A", service_name: "B", ref: "L-1" },
      entity: { type: "lead", id: `L-${uuidv7().slice(-6)}` },
    };
    const queuedMsg: EmailMessage = { ...sentMsg, to: `dlq-q-${uuidv7().slice(-6)}@example.test` };
    for (const [m, status, mid] of [
      [sentMsg, "sent", "ses-mid-1"],
      [queuedMsg, "queued", null],
    ] as const)
      await run(
        "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, ses_message_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1)",
        emailLogId(m),
        m.to,
        m.template,
        m.entity.type,
        m.entity.id,
        status,
        mid,
      );
    const { transport } = recorder();
    const e = makeEnv();
    await processDeadLetter(e, "techaust-local-email-dlq", sentMsg, transport);
    await processDeadLetter(e, "techaust-local-email-dlq", queuedMsg, transport);
    expect(
      await one("SELECT status, ses_message_id FROM email_log WHERE id = ?1", emailLogId(sentMsg)),
    ).toEqual({
      status: "sent",
      ses_message_id: "ses-mid-1",
    });
    expect(
      (await one<{ status: string }>("SELECT status FROM email_log WHERE id = ?1", emailLogId(queuedMsg)))
        ?.status,
    ).toBe("failed");
    const bells = await all<{ title: string }>(
      "SELECT title FROM notifications WHERE user_id = ?1 AND kind = 'job.failed' AND entity_id LIKE 'techaust-local-email-dlq:%'",
      owner.id,
    );
    expect(bells).toEqual([
      {
        title:
          "A background job ran out of tries (techaust-local-email-dlq). The details are in the alert email.",
      },
    ]);
    expect(DEAD_LETTER_SQL).toContain("status IN ('queued', 'sending')");
  });
});

describe("the M3.3 follow-up: a sign-in link whose token row is gone", () => {
  it("is skipped as token_gone and never sent; a live token's link is sent", async () => {
    const { sent, transport } = recorder();
    const gone = "a".repeat(64);
    const live = `${uuidv7().replace(/-/g, "")}`.padEnd(64, "b");
    const contact = await mkContact(await mkClient());
    await realEnv.DB.prepare(
      "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) VALUES (?1, ?2, ?3)",
    )
      .bind(live, contact.id, Date.now() + 900_000)
      .run();
    const link = (hash: string): EmailMessage => ({
      template: "portal.magic_link",
      to: `ml-${hash.slice(0, 6)}@example.test`,
      data: {
        url: "https://portal.example/auth#t=x",
        org_name: "Sample",
        expires_at: String(Date.now() + 900_000),
        accounts: "1",
      },
      entity: { type: "magic_link", id: hash },
    });
    expect(await processEmail(makeEnv(), link(gone), transport)).toBe("skipped");
    expect(
      (await one<{ error: string }>("SELECT error FROM email_log WHERE id = ?1", emailLogId(link(gone))))
        ?.error,
    ).toBe("token_gone");
    expect(await processEmail(makeEnv(), link(live), transport)).toBe("sent");
    expect(sent).toHaveLength(1);
  });
});

describe("the offer-viewed bell through portal.alert (E, Q2 A)", () => {
  it("a contact's first view rings the owners and the sender (named by the number), then queues staff.notify; a repeat adds nothing", async () => {
    const owner = await staff("owner");
    const sender = await staff("staff");
    const bystander = await staff("staff");
    const clientId = await mkClient();
    const contact = await mkContact(clientId);
    const doc = await mkDoc(clientId, null, { type: "proposal", status: "viewed" });
    await mkSend(doc, clientId, contact, { createdBy: sender.id, queued: true });
    const auditId = uuidv7();
    await run(
      "INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id) VALUES (?1, 'contact', ?2, 'document.view', 'document', ?3)",
      auditId,
      contact.id,
      doc.id,
    );
    const e = makeEnv();
    expect(await processPortalAlert(e, { kind: "portal.alert", auditId })).toBe("belled");
    const bells = await all<{ user_id: string; title: string; link: string }>(
      "SELECT user_id, title, link FROM notifications WHERE kind = 'offer.viewed' AND entity_id = ?1 ORDER BY user_id",
      doc.id,
    );
    const users = bells.map((b) => b.user_id);
    expect(users).toContain(owner.id);
    expect(users).toContain(sender.id);
    expect(users).not.toContain(bystander.id);
    expect(bells[0]?.title).toBe(`${doc.numberDisplay} was opened by the client`);
    expect(bells[0]?.link).toBe(`/documents/${doc.id}`);
    expect(fakes.email.map((s) => s.body)).toEqual([staffNotify("offer.viewed", doc.id)]);
    const n = bells.length;
    await processPortalAlert(e, { kind: "portal.alert", auditId });
    expect(
      (await all("SELECT 1 FROM notifications WHERE kind = 'offer.viewed' AND entity_id = ?1", doc.id))
        .length,
    ).toBe(n);
    // a staff member's audit row of the same action is not a client's view
    const staffAudit = uuidv7();
    await run(
      "INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id) VALUES (?1, 'staff', ?2, 'document.view', 'document', ?3)",
      staffAudit,
      owner.id,
      doc.id,
    );
    expect(await processPortalAlert(e, { kind: "portal.alert", auditId: staffAudit })).toBe("ignored");
  });
});

describe("the refund email's RPC producers (D, producers 3 and 4)", () => {
  it("processEvent answering next refund.notify queues it on the email queue", async () => {
    const e = makeEnv({
      ADMIN_GATEWAY: {
        processEvent: async () => ({ result: "processed", refundNotify: "rf_1" }),
      },
    });
    expect(await processGateway(e, { kind: "gateway.event", eventId: uuidv7() } as never, 1)).toBe("ack");
    expect(fakes.email.map((s) => s.body)).toContainEqual({ kind: "refund.notify", refundId: "rf_1" });
  });

  it("the sweep's checkRefund answering succeeded queues refund.notify; any other answer queues nothing", async () => {
    for (const [result, n] of [
      ["succeeded", 1],
      ["unchanged", 0],
      ["failed", 0],
    ] as const) {
      fakes.email.length = 0;
      const e = makeEnv({
        ADMIN_GATEWAY: {
          processEvent: async () => ({ result: "processed" }),
          checkRefund: async () => ({ result }),
        },
      });
      const refundId = uuidv7();
      await processRefundFamily(e, { kind: "refund.check", refundId } as never, 1);
      expect(
        fakes.email.filter((s) => (s.body as { kind?: string }).kind === "refund.notify"),
        result,
      ).toHaveLength(n);
    }
  });
});
