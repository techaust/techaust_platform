// M7.2 SES events in the database [ADM-MAIL-02, JOB-HOOK-01..03; run file A, B, I "db", L4, L5, L15]: 0073 creates and adds only, 0074's lists equal the schema's,
// every rule of `email_event_triggers` accepts and refuses (each guard shown to be what refuses: the trigger dropped, the same write passes, the trigger re-created
// from the generator), every existing `email_log` move (Step 0.7) still works, and the hook's batch: the outcome twin of core, the moves, the suppression only on a
// message-id AND address match, the contact flag without `updated_at`, the bells, a duplicate with no second write, the batch size and the index it uses. Raw
// SQL on purpose. All names, ids and addresses are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import {
  type BounceKind,
  type EmailEventType,
  emailEventMove,
  parseSesEvent,
  type SesEvent,
} from "@techaust/core/email-events";
import { PREF_DEFAULTS } from "@techaust/core/notifications";
import { describe, expect, it } from "vitest";
import {
  EMAIL_EVENT_READ_SQL,
  SES_TOKEN_ALERT_AT,
  sesEventRecordStatement,
  sesEventStatements,
  sesTokenFailureKey,
  sesTokenFailureStatements,
} from "../src/email-events.ts";
import {
  BOUNCE_TYPES,
  DIGEST_OFF_VIA,
  EMAIL_EVENT_OUTCOMES,
  EMAIL_EVENT_TYPES,
  EMAIL_STATUSES,
  SUPPRESSION_REASONS,
} from "../src/schema/email.ts";
import {
  BOUNCE_TYPES_0074,
  DIGEST_OFF_VIA_0074,
  EMAIL_EVENT_OUTCOMES_0074,
  EMAIL_EVENT_TYPES_0074,
  emailEventTriggerStatements,
  SUPPRESSION_REASONS_0074,
} from "../src/triggers.ts";
import { auditAf2TriggerStatements, DIGEST_OFF_VIA_AF2 } from "../src/triggers-audit-af2.ts";
import { mkClientRow, mkContact, mkMember } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const migration = (name: string) => env.TEST_MIGRATIONS.find((m) => m.name === name);
const statementsOf = (name: string) =>
  (migration(name)?.queries ?? []).map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim()).filter((q) => q !== "");

/** Runs `fn` with trigger `name` dropped, then re-creates its newest definition (the audit fix set 0082 re-created the switches' two, else 0074's). */
async function withoutTrigger(name: string, fn: () => Promise<unknown>): Promise<void> {
  const create = [...auditAf2TriggerStatements(), ...emailEventTriggerStatements()].find((s) =>
    s.startsWith(`CREATE TRIGGER \`${name}\``),
  );
  if (!create) throw new Error(`no trigger ${name}`);
  await run(`DROP TRIGGER \`${name}\``);
  try {
    await fn();
  } finally {
    await run(create);
  }
}

/** An `email_log` row (the consumer's shape), returning its id. */
async function mkLog(
  over: { to?: string; status?: string; messageId?: string | null; bounceType?: string | null } = {},
) {
  const id = uuidv7();
  await run(
    "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, ses_message_id, status, bounce_type, created_at, updated_at) VALUES (?1, ?2, 'invoice.sent', 'document_send', ?3, ?4, ?5, ?6, 1, 1)",
    id,
    over.to ?? `${id}@example.test`,
    uuidv7(),
    over.messageId === undefined ? `m-${id}` : over.messageId,
    over.status ?? "sent",
    over.bounceType ?? null,
  );
  return id;
}
const logRow = (id: string) =>
  first<{ status: string; bounce_type: string | null; last_event_at: number | null; updated_at: number }>(
    "SELECT status, bounce_type, last_event_at, updated_at FROM email_log WHERE id = ?1",
    id,
  );

let nowSeq = 1_800_000_000_000;
const tick = () => (nowSeq += 1_000);

function mkEvent(
  messageId: string,
  type: Exclude<EmailEventType, "other">,
  over: {
    kind?: BounceKind | undefined;
    recipients?: string[];
    eventId?: string;
    subType?: string | null;
  } = {},
): SesEvent {
  const base = { eventId: over.eventId ?? uuidv7(), source: "aws.ses", messageId, env: "local" };
  if (type === "delivery") return { ...base, type };
  if (type === "complaint") return { ...base, type, complaint: { recipients: over.recipients ?? [] } };
  return {
    ...base,
    type,
    bounce: {
      kind: over.kind ?? "permanent",
      subType: over.subType ?? "General",
      recipients: over.recipients ?? [],
    },
  };
}

/** Runs the hook's batch; returns the read-back. */
async function apply(ev: SesEvent, now = tick()) {
  const res = await env.DB.batch(sesEventStatements(env.DB, ev, now));
  return res.at(-1)?.results[0] as { outcome: string; fresh: number };
}
const eventRow = (id: string) =>
  first<Record<string, unknown>>("SELECT * FROM email_events WHERE id = ?1", id);
const suppression = (email: string) =>
  first<{ reason: string; at: number }>("SELECT reason, at FROM email_suppressions WHERE email = ?1", email);
const bells = (userId: string, entityId: string) =>
  all<{ kind: string; title: string; link: string }>(
    "SELECT kind, title, link FROM notifications WHERE user_id = ?1 AND entity_id = ?2 ORDER BY kind",
    userId,
    entityId,
  );

describe("0073 and 0074", () => {
  it("0073 only creates tables and indexes and adds columns (no rebuild, no CHECK on email_log)", () => {
    const qs = statementsOf("0073_email_events.sql");
    for (const q of qs) expect(q).toMatch(/^(CREATE (UNIQUE )?(TABLE|INDEX) |ALTER TABLE `email_log` ADD `)/);
    expect(qs.join("\n")).not.toMatch(/DROP |__new_|INSERT INTO|CHECK/i);
  });

  it("0074 only creates triggers, exactly the generator's", () => {
    const qs = statementsOf("0074_email_event_triggers.sql");
    // The migrations reader drops each statement's closing semicolon.
    expect(qs).toEqual(emailEventTriggerStatements().map((s) => s.replace(/;$/, "")));
    for (const q of qs) expect(q).toMatch(/^CREATE TRIGGER `/);
  });

  it("the frozen lists equal the schema's", () => {
    expect(EMAIL_EVENT_TYPES_0074).toEqual(EMAIL_EVENT_TYPES);
    expect(BOUNCE_TYPES_0074).toEqual(BOUNCE_TYPES);
    expect(EMAIL_EVENT_OUTCOMES_0074).toEqual(EMAIL_EVENT_OUTCOMES);
    expect(SUPPRESSION_REASONS_0074).toEqual(SUPPRESSION_REASONS);
    // AU20 (0082): the spam report of the digest is the third way; 0074's two come first.
    expect(DIGEST_OFF_VIA_AF2).toEqual(DIGEST_OFF_VIA);
    expect(DIGEST_OFF_VIA.slice(0, 2)).toEqual(DIGEST_OFF_VIA_0074);
  });

  it("the hook finds a row by message id through the partial index", async () => {
    const plan = await all<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id FROM email_log WHERE ses_message_id = ?1 LIMIT 1",
      "m-x",
    );
    expect(plan.map((p) => p.detail).join(" ")).toMatch(/USING (COVERING )?INDEX email_log_ses_message/);
    const upd = await all<{ detail: string }>(
      "EXPLAIN QUERY PLAN UPDATE email_log SET status = 'delivered' WHERE ses_message_id = ?1",
      "m-x",
    );
    expect(upd.map((p) => p.detail).join(" ")).toMatch(/INDEX email_log_ses_message/);
  });
});

describe("email_log_event_flow (L15)", () => {
  it("every existing move still works (Step 0.7)", async () => {
    const id = await mkLog({ status: "queued", messageId: null });
    const set = (status: string) => run("UPDATE email_log SET status = ?2 WHERE id = ?1", id, status);
    await set("sending"); // the claim
    await set("sending"); // an abandoned claim taken again
    await set("queued"); // a retry gives the claim back
    await set("sending");
    await set("sent"); // setStatus sent
    for (const end of ["skipped", "failed"]) {
      const other = await mkLog({ status: "sending", messageId: null });
      await run("UPDATE email_log SET status = ?2 WHERE id = ?1", other, end);
      await run("UPDATE email_log SET status = 'failed' WHERE id = ?1", other); // a dead letter
    }
    await run("UPDATE email_log SET status = 'failed' WHERE id = ?1", await mkLog({ status: "queued" })); // a dead letter before the claim
    await set("delivered"); // offer-erasure.test.ts: sent → delivered by hand
  });

  it("an event status comes only from sent, delivered or bounced, and only moves up", async () => {
    const id = await mkLog({ status: "sent" });
    const set = (status: string) => run("UPDATE email_log SET status = ?2 WHERE id = ?1", id, status);
    await set("delivered");
    await set("delivered");
    await rejects(set("sent"), /email_log_event_flow/);
    await set("bounced");
    await rejects(set("delivered"), /email_log_event_flow/);
    await set("complained");
    await rejects(set("delivered"), /email_log_event_flow/);
    await rejects(set("bounced"), /email_log_event_flow/);
    await rejects(set("failed"), /email_log_event_flow/);
    await rejects(set("queued"), /email_log_event_flow/);
    for (const from of ["queued", "sending", "failed", "skipped"]) {
      const other = await mkLog({ status: from, messageId: null });
      for (const to of ["delivered", "bounced", "complained"])
        await rejects(
          run("UPDATE email_log SET status = ?2 WHERE id = ?1", other, to),
          /email_log_event_flow/,
        );
    }
  });

  it("the trigger is what refuses", async () => {
    const id = await mkLog({ status: "complained" });
    await withoutTrigger("email_log_event_flow", () =>
      run("UPDATE email_log SET status = 'delivered' WHERE id = ?1", id),
    );
    expect((await logRow(id))?.status).toBe("delivered");
  });

  it("email_log_bounce_type holds the values", async () => {
    const id = await mkLog();
    await run("UPDATE email_log SET bounce_type = 'transient' WHERE id = ?1", id);
    await rejects(
      run("UPDATE email_log SET bounce_type = 'Permanent' WHERE id = ?1", id),
      /email_log_bounce_type/,
    );
    await withoutTrigger("email_log_bounce_type", () =>
      run("UPDATE email_log SET bounce_type = 'hard' WHERE id = ?1", id),
    );
  });
});

describe("email_events, email_suppressions and staff_notification_prefs triggers", () => {
  const ins = (over: Record<string, unknown> = {}) => {
    const row = {
      id: uuidv7(),
      ses_message_id: "m-1",
      type: "delivery",
      bounce_type: null,
      bounce_sub_type: null,
      email_log_id: null,
      outcome: "applied",
      received_at: 5,
      ...over,
    };
    return run(
      "INSERT INTO email_events (id, ses_message_id, type, bounce_type, bounce_sub_type, email_log_id, outcome, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      ...Object.values(row),
    );
  };

  it("an event has known values, bounded ids and bounce details only on a bounce", async () => {
    await ins();
    await ins({ type: "bounce", bounce_type: "permanent", bounce_sub_type: "OnAccountSuppressionList" });
    for (const t of EMAIL_EVENT_TYPES) if (t !== "bounce") await ins({ type: t });
    for (const o of EMAIL_EVENT_OUTCOMES) await ins({ outcome: o });
    const refused = [
      { type: "open" },
      { outcome: "done" },
      { id: "" },
      { id: "x".repeat(129) },
      { id: new Uint8Array([1, 2]) }, // a blob (an integer would take the TEXT affinity first)
      { ses_message_id: "" },
      { ses_message_id: "m".repeat(129) },
      { type: "delivery", bounce_type: "permanent" },
      { type: "complaint", bounce_sub_type: "General" },
      { type: "bounce", bounce_type: null },
      { type: "bounce", bounce_type: "hard" },
      { type: "bounce", bounce_type: "permanent", bounce_sub_type: "s".repeat(65) },
      { email_log_id: "e".repeat(129) },
      { received_at: "soon" },
    ];
    for (const r of refused)
      await rejects(ins(r), /email_events_values_insert/).catch((e) => {
        throw new Error(`${JSON.stringify(r)}: ${e}`);
      });
    await withoutTrigger("email_events_values_insert", () => ins({ type: "open" }));
  });

  it("an event is never changed; it may be deleted (M7.4's pruning)", async () => {
    const id = uuidv7();
    await ins({ id });
    await rejects(
      run("UPDATE email_events SET outcome = 'stale' WHERE id = ?1", id),
      /email_events_no_update/,
    );
    await run("DELETE FROM email_events WHERE id = ?1", id);
    expect(await eventRow(id)).toBeNull();
    await ins({ id });
    await withoutTrigger("email_events_no_update", () =>
      run("UPDATE email_events SET outcome = 'stale' WHERE id = ?1", id),
    );
  });

  it("a suppression has a known reason and a lower-cased address, at insert and on change", async () => {
    for (const r of SUPPRESSION_REASONS)
      await run(
        "INSERT INTO email_suppressions (email, reason, at) VALUES (?1, ?2, 1)",
        `${r}@example.test`,
        r,
      );
    await rejects(
      run("INSERT INTO email_suppressions (email, reason, at) VALUES ('b@example.test', 'bounce', 1)"),
      /email_suppressions_reason/,
    );
    await rejects(
      run("INSERT INTO email_suppressions (email, reason, at) VALUES ('Up@example.test', 'manual', 1)"),
      /email_suppressions_reason/,
    );
    await rejects(
      run("UPDATE email_suppressions SET reason = 'x' WHERE email = 'manual@example.test'"),
      /email_suppressions_reason_update/,
    );
    await rejects(
      run("UPDATE email_suppressions SET email = 'MANUAL@example.test' WHERE email = 'manual@example.test'"),
      /email_suppressions_reason_update/,
    );
    await withoutTrigger("email_suppressions_reason", () =>
      run("INSERT INTO email_suppressions (email, reason, at) VALUES ('old@example.test', 'bounce', 1)"),
    );
    await withoutTrigger("email_suppressions_reason_update", () =>
      run("UPDATE email_suppressions SET reason = 'x' WHERE email = 'manual@example.test'"),
    );
  });

  it("the notification switches are 0/1, and how the digest went off is kept only while it is off", async () => {
    const userId = await mkMember("owner");
    const row = await first<Record<string, number>>(
      "INSERT INTO staff_notification_prefs (user_id) VALUES (?1) RETURNING digest_weekly, email_offer_viewed, email_payment_received, email_approvals, email_hook_failed",
      userId,
    );
    // The defaults follow Q1 A and Q2 A, and equal core's defaults for a missing row.
    expect(row).toEqual(PREF_DEFAULTS);
    expect(row).toEqual({
      digest_weekly: 1,
      email_offer_viewed: 0,
      email_payment_received: 1,
      email_approvals: 1,
      email_hook_failed: 1,
    });
    await run(
      "UPDATE staff_notification_prefs SET digest_weekly = 0, digest_off_via = 'one_click' WHERE user_id = ?1",
      userId,
    );
    await rejects(
      run("UPDATE staff_notification_prefs SET digest_weekly = 1 WHERE user_id = ?1", userId),
      /staff_notification_prefs_values_update/,
    );
    await run(
      "UPDATE staff_notification_prefs SET digest_weekly = 1, digest_off_via = NULL WHERE user_id = ?1",
      userId,
    );
    for (const col of [
      "digest_weekly",
      "email_offer_viewed",
      "email_payment_received",
      "email_approvals",
      "email_hook_failed",
    ])
      await rejects(
        run(`UPDATE staff_notification_prefs SET ${col} = 2 WHERE user_id = ?1`, userId),
        /staff_notification_prefs_values_update/,
      );
    await rejects(
      run(
        "UPDATE staff_notification_prefs SET digest_weekly = 0, digest_off_via = 'email' WHERE user_id = ?1",
        userId,
      ),
      /staff_notification_prefs_values_update/,
    );
    const other = await mkMember("staff");
    await rejects(
      run("INSERT INTO staff_notification_prefs (user_id, email_approvals) VALUES (?1, 7)", other),
      /staff_notification_prefs_values/,
    );
    await rejects(
      run("INSERT INTO staff_notification_prefs (user_id, digest_off_via) VALUES (?1, 'settings')", other),
      /staff_notification_prefs_values/,
    );
    await withoutTrigger("staff_notification_prefs_values", () =>
      run("INSERT INTO staff_notification_prefs (user_id, email_approvals) VALUES (?1, 7)", other),
    );
    await withoutTrigger("staff_notification_prefs_values_update", () =>
      run("UPDATE staff_notification_prefs SET email_approvals = 3 WHERE user_id = ?1", userId),
    );
    // A member that doesn't exist is refused by the foreign key.
    await rejects(run("INSERT INTO staff_notification_prefs (user_id) VALUES ('nobody')"), /FOREIGN KEY/);
  });
});

describe("the hook's batch (sesEventStatements)", () => {
  it("has at most 6 statements, every kind", () => {
    for (const ev of [
      mkEvent("m", "delivery"),
      mkEvent("m", "bounce", { kind: "permanent", recipients: ["a@example.test"] }),
      mkEvent("m", "bounce", { kind: "transient" }),
      mkEvent("m", "complaint", { recipients: ["a@example.test"] }),
    ])
      expect(sesEventStatements(env.DB, ev, 1).length).toBeLessThanOrEqual(6);
    expect(() => sesEventStatements(env.DB, { ...mkEvent("m", "delivery"), type: "other" }, 1)).toThrow();
  });

  it("the outcome in SQL is the twin of core emailEventMove, over every status, type and bounce type", async () => {
    const types = [
      ["delivery"],
      ["complaint"],
      ["bounce", "permanent"],
      ["bounce", "transient"],
      ["bounce", "undetermined"],
    ] as const;
    for (const status of EMAIL_STATUSES)
      for (const bounceType of [null, ...BOUNCE_TYPES])
        for (const [type, kind] of types) {
          const logId = await mkLog({ status, bounceType });
          const ev = mkEvent(`m-${logId}`, type, { kind: kind as BounceKind | undefined });
          const got = await apply(ev);
          const want = emailEventMove(
            { status, bounceType },
            { type, bounceKind: (kind as BounceKind) ?? null },
          );
          expect(got.outcome, `${status}/${bounceType}/${type}/${kind}`).toBe(want);
        }
  }, 60_000);

  it("a delivery moves a sent row to delivered; a delivery after a bounce stays bounced (stale)", async () => {
    const id = await mkLog();
    const t = tick();
    expect(await apply(mkEvent(`m-${id}`, "delivery"), t)).toEqual({ outcome: "applied", fresh: 1 });
    const row = await logRow(id);
    expect(row).toMatchObject({ status: "delivered", last_event_at: t, updated_at: 1 });
    const bounced = await mkLog({ status: "bounced", bounceType: "permanent" });
    expect((await apply(mkEvent(`m-${bounced}`, "delivery"))).outcome).toBe("stale");
    expect((await logRow(bounced))?.status).toBe("bounced");
    expect((await logRow(bounced))?.last_event_at).toBeNull();
  });

  it("a message we never sent is unknown_message, with no link and nothing else written", async () => {
    const ev = mkEvent("m-nobody", "bounce", { recipients: ["stranger@example.test"] });
    expect(await apply(ev)).toEqual({ outcome: "unknown_message", fresh: 1 });
    expect(await eventRow(ev.eventId)).toMatchObject({
      email_log_id: null,
      type: "bounce",
      bounce_type: "permanent",
    });
    expect(await suppression("stranger@example.test")).toBeNull();
  });

  it("a Permanent bounce: bounced, the address stopped, every live contact flagged (two clients) without updated_at, the owners' bell by client code", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const email = `asha-${uuidv7()}@example.test`;
    const [c1, c2] = [await mkClientRow(), await mkClientRow()];
    const [k1, k2] = [await mkContact(c1, { email }), await mkContact(c2, { email })];
    // An anonymised contact with the same address at a third client: never touched (`contacts_anonymised_frozen` would abort the whole batch).
    const gone = await mkContact(await mkClientRow(), { anonymised: true, email });
    await run("UPDATE contacts SET updated_at = 777 WHERE id IN (?1, ?2)", k1, k2);
    const id = await mkLog({ to: email });
    const t = tick();
    const ev = mkEvent(`m-${id}`, "bounce", { recipients: [email.toUpperCase()], subType: "General" });
    expect((await apply(ev, t)).outcome).toBe("applied");
    expect(await logRow(id)).toMatchObject({ status: "bounced", bounce_type: "permanent", last_event_at: t });
    expect(await suppression(email)).toEqual({ reason: "hard_bounce", at: t });
    const contacts = await all<{ id: string; bounced_at: number | null; updated_at: number }>(
      "SELECT id, bounced_at, updated_at FROM contacts WHERE id IN (?1, ?2, ?3) ORDER BY id",
      k1,
      k2,
      gone,
    );
    expect(contacts.find((c) => c.id === k1)).toMatchObject({ bounced_at: t, updated_at: 777 });
    expect(contacts.find((c) => c.id === k2)).toMatchObject({ bounced_at: t, updated_at: 777 });
    expect(contacts.find((c) => c.id === gone)?.bounced_at).toBeNull();
    const codes = await all<{ code: string }>(
      "SELECT code FROM clients WHERE id IN (?1, ?2) ORDER BY code",
      c1,
      c2,
    );
    expect(await bells(owner, id)).toEqual([
      {
        kind: "email.bounced",
        title: `An email to a contact at ${codes[0]?.code} bounced. Emails to that address are stopped.`,
        link: `/emails/${id}`,
      },
    ]);
    expect(await bells(staff, id)).toEqual([]);
    const ev2 = await eventRow(ev.eventId);
    expect(ev2).toMatchObject({
      email_log_id: id,
      bounce_sub_type: "General",
      outcome: "applied",
      received_at: t,
    });
    expect(JSON.stringify(ev2)).not.toContain("@");
    // A second, later bounce for the same contact keeps the first flag time.
    const id2 = await mkLog({ to: email });
    await apply(mkEvent(`m-${id2}`, "bounce", { recipients: [email] }));
    expect(
      (await first<{ bounced_at: number }>("SELECT bounced_at FROM contacts WHERE id = ?1", k1))?.bounced_at,
    ).toBe(t);
  });

  it("the suppression needs the message id AND the address: a forged event for an address we never emailed stops nothing", async () => {
    const owner = await mkMember("owner");
    const sent = `real-${uuidv7()}@example.test`;
    const victim = `victim-${uuidv7()}@example.test`;
    const client = await mkClientRow();
    await mkContact(client, { email: victim });
    const id = await mkLog({ to: sent });
    // Our message id, someone else's address.
    expect((await apply(mkEvent(`m-${id}`, "bounce", { recipients: [victim] }))).outcome).toBe("applied");
    expect(await suppression(victim)).toBeNull();
    expect(await suppression(sent)).toBeNull();
    expect(await bells(owner, id)).toEqual([]);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM contacts WHERE email = ?1 AND bounced_at IS NOT NULL",
          victim,
        )
      )?.n,
    ).toBe(0);
    // Our address, a message id we never sent.
    const other = mkEvent("m-forged", "complaint", { recipients: [sent] });
    expect((await apply(other)).outcome).toBe("unknown_message");
    expect(await suppression(sent)).toBeNull();
  });

  it("a complaint: complained, the address stopped, no bounced_at, the owners' bell", async () => {
    const owner = await mkMember("owner");
    const email = `pat-${uuidv7()}@example.test`;
    const contact = await mkContact(await mkClientRow(), { email });
    const id = await mkLog({ to: email, status: "delivered" });
    expect((await apply(mkEvent(`m-${id}`, "complaint", { recipients: [email] }))).outcome).toBe("applied");
    expect((await logRow(id))?.status).toBe("complained");
    expect((await suppression(email))?.reason).toBe("complaint");
    expect(
      (await first<{ b: number | null }>("SELECT bounced_at AS b FROM contacts WHERE id = ?1", contact))?.b,
    ).toBeNull();
    expect((await bells(owner, id)).map((b) => b.kind)).toEqual(["email.complaint"]);
    // A later Permanent bounce on that row is stale but still a known event: the address stays stopped for its first reason.
    expect((await apply(mkEvent(`m-${id}`, "bounce", { recipients: [email] }))).outcome).toBe("stale");
    expect((await suppression(email))?.reason).toBe("complaint");
    expect((await bells(owner, id)).map((b) => b.kind)).toEqual(["email.bounced", "email.complaint"]);
  });

  it("Transient and Undetermined bounces move the row but stop nothing; a Permanent one after them is applied and stops the address", async () => {
    const email = `soft-${uuidv7()}@example.test`;
    const contact = await mkContact(await mkClientRow(), { email });
    const id = await mkLog({ to: email });
    expect(
      (await apply(mkEvent(`m-${id}`, "bounce", { kind: "transient", recipients: [email] }))).outcome,
    ).toBe("applied");
    expect(await logRow(id)).toMatchObject({ status: "bounced", bounce_type: "transient" });
    expect(
      (await apply(mkEvent(`m-${id}`, "bounce", { kind: "undetermined", recipients: [email] }))).outcome,
    ).toBe("stale");
    expect(await suppression(email)).toBeNull();
    expect(
      (await apply(mkEvent(`m-${id}`, "bounce", { kind: "permanent", recipients: [email] }))).outcome,
    ).toBe("applied");
    expect(await logRow(id)).toMatchObject({ status: "bounced", bounce_type: "permanent" });
    expect((await suppression(email))?.reason).toBe("hard_bounce");
    expect(
      (await first<{ b: number | null }>("SELECT bounced_at AS b FROM contacts WHERE id = ?1", contact))?.b,
    ).not.toBeNull();
  });

  it("a duplicate event id writes nothing a second time anywhere", async () => {
    const owner = await mkMember("owner");
    const email = `dup-${uuidv7()}@example.test`;
    await mkContact(await mkClientRow(), { email });
    const id = await mkLog({ to: email });
    const ev = mkEvent(`m-${id}`, "bounce", { recipients: [email] });
    const t1 = tick();
    expect(await apply(ev, t1)).toEqual({ outcome: "applied", fresh: 1 });
    const snapshot = async () => ({
      event: await eventRow(ev.eventId),
      log: await logRow(id),
      suppression: await suppression(email),
      contacts: await all("SELECT id, bounced_at, updated_at FROM contacts WHERE email = ?1", email),
      bells: await all("SELECT id, kind FROM notifications WHERE entity_id = ?1 ORDER BY id", id),
      events: (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM email_events WHERE ses_message_id = ?1",
          `m-${id}`,
        )
      )?.n,
    });
    const before = await snapshot();
    // Clear the suppression and the bell to prove the duplicate doesn't write them back.
    await run("DELETE FROM email_suppressions WHERE email = ?1", email);
    await run("DELETE FROM notifications WHERE entity_id = ?1 AND user_id = ?2", id, owner);
    expect(await apply(ev, tick())).toEqual({ outcome: "applied", fresh: 0 });
    const after = await snapshot();
    expect(after.event).toEqual(before.event);
    expect(after.log).toEqual(before.log);
    expect(after.suppression).toBeNull();
    expect(after.contacts).toEqual(before.contacts);
    expect(await bells(owner, id)).toEqual([]);
    expect(after.events).toBe(1);
  });

  it("a recorded-only event (wrong env, ignored type) is stored once and changes nothing", async () => {
    const id = await mkLog();
    const parsed = parseSesEvent({
      id: uuidv7(),
      source: "aws.ses",
      "detail-type": "Email Sent",
      detail: { eventType: "Send", mail: { messageId: `m-${id}` } },
    });
    if (!parsed.ok) throw new Error("parse");
    const t = tick();
    await env.DB.batch([sesEventRecordStatement(env.DB, parsed.value, "ignored_type", t)]);
    expect(await eventRow(parsed.value.eventId)).toMatchObject({
      outcome: "ignored_type",
      email_log_id: id,
      type: "other",
    });
    const wrong = mkEvent(`m-${id}`, "bounce", { recipients: ["x@example.test"] });
    await env.DB.batch([sesEventRecordStatement(env.DB, wrong, "wrong_env", t)]);
    await env.DB.batch([sesEventRecordStatement(env.DB, wrong, "wrong_env", tick())]);
    expect(await eventRow(wrong.eventId)).toMatchObject({
      outcome: "wrong_env",
      email_log_id: null,
      received_at: t,
    });
    expect((await logRow(id))?.status).toBe("sent");
    expect(await first(EMAIL_EVENT_READ_SQL, wrong.eventId, t)).toEqual({ outcome: "wrong_env", fresh: 1 });
  });
});

describe("the token-failure counter", () => {
  it("counts per clock hour, rings the owners' bell once at 5, and never writes past 50", async () => {
    const owner = await mkMember("owner");
    const now = 1_900_000_000_000;
    const key = sesTokenFailureKey(now);
    expect(key).toBe(`ses:${now - (now % 3_600_000)}`);
    const count = async () => {
      const res = await env.DB.batch(sesTokenFailureStatements(env.DB, now + 1));
      return (res.at(-1)?.results[0] as { count: number } | undefined)?.count;
    };
    for (let i = 1; i < SES_TOKEN_ALERT_AT; i++) expect(await count()).toBe(i);
    expect(await bells(owner, key)).toEqual([]);
    expect(await count()).toBe(5);
    expect(await bells(owner, key)).toEqual([
      {
        kind: "email.hook_token",
        title: "Email delivery updates were refused 5 times this hour (wrong token).",
        link: "/settings/email",
      },
    ]);
    for (let i = 6; i <= 55; i++) await count();
    expect(
      (await first<{ count: number }>("SELECT count FROM hook_failures WHERE key = ?1", key))?.count,
    ).toBe(50);
    expect(await bells(owner, key)).toHaveLength(1);
    // The next hour starts again.
    expect(sesTokenFailureKey(now + 3_600_000)).not.toBe(key);
  });
});
