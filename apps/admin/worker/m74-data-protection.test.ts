// M7.4 data-protection routes of the admin API (ADM-SET-09, ADM-CLI-05, POR-11, FRM-05, ADM-LEAD-05; run file docs/runs/m7.4-data-protection.md C, I, L20–L47):
// the request log, its steps and close (the identity check, the fulfilling erase of the exact contact or lead), legal holds, the erased-address lift, the clean-up
// switch, a lead's erase, export and consent withdrawal, the erasure hashes of the contact erase and anonymise (L24, L27), the stored PDFs of an anonymised
// client (Q4 A), devices ending with the account (L47), and the statement budget. Invented data only.
import { env } from "cloudflare:workers";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { requestDueAt } from "@techaust/core/dsr";
import { addressHash } from "@techaust/core/hmac";
import { uuidv7 } from "@techaust/core/ids";
import { PROCESSORS } from "@techaust/core/processors";
import { describe, expect, it } from "vitest";
import { MATCHED_LEADS } from "./clients.ts";
import { insert, mkClient, mkContact, mkDoc, mkLead } from "./test-clients.ts";
import { bodyOf, call, countingEnv, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { mkPortalClient, mkRequest } from "./test-portal.ts";

const DAY = 86_400_000;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)).error as { code: string } | undefined)?.code;
const hashOf = (email: string) => addressHash(env.ERASURE_HASH_KEY, email);
const dayAgo = (days: number) => toIsoDate(istDate(Date.now() - days * DAY));
const log = (cookie: string, b: Record<string, unknown>) =>
  call("/client-requests", { cookie, body: { channel: "email", receivedOn: dayAgo(0), ...b } });
const consent = (purposes = ["respond_to_enquiry", "marketing_updates"]) =>
  JSON.stringify({ noticeVersion: "v1", purposes, at: Date.now() - DAY, ipHash: "abc123", marketing: true });
/** A grant receipt linked to a lead or a contact (the back-fill's shape, no hash yet). */
const receiptFor = (link: { leadId?: string; contactId?: string }) =>
  insert("consent_receipts", {
    id: uuidv7(),
    lead_id: link.leadId ?? null,
    contact_id: link.contactId ?? null,
    event: "grant",
    source: link.leadId ? "web_form" : "staff",
    notice_version: "v1",
    purposes: '["respond_to_enquiry"]',
    marketing: 0,
    at: Date.now() - DAY,
  });
const bounce = (email: string) =>
  insert("email_suppressions", { email, reason: "hard_bounce", at: Date.now() });

describe("the request log, steps and close [ADM-SET-09, POR-11; C.2–C.4]", () => {
  it("staff log a request by address (an erasure may name only an address, L28); the clock is core's; the audit row holds no address", async () => {
    const staff = await sessionFor("staff");
    const email = `asker-${uuidv7()}@example.test`;
    const res = await log(staff.cookie, {
      kind: "data_erasure",
      requesterEmail: email.toUpperCase(),
      receivedOn: dayAgo(3),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const id = ((await bodyOf(res)).request as { id: string }).id;
    const row = await one<Record<string, unknown>>("SELECT * FROM client_requests WHERE id = ?", id);
    expect(row).toMatchObject({
      requester_email: email,
      channel: "email",
      logged_by: staff.id,
      identity_checked_at: null,
    });
    expect(row?.due_at).toBe(requestDueAt(row?.received_at as number));
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'client_request.log' AND entity_id = ?",
      id,
    );
    expect(audit?.summary).not.toContain(email);
    // the same address and kind while open: 409
    expect(await code(await log(staff.cookie, { kind: "data_erasure", requesterEmail: email }))).toBe(
      "request_open",
    );
    // Sales may not log
    const sales = await sessionFor("sales");
    expect((await log(sales.cookie, { kind: "grievance", requesterEmail: email, details: "x" })).status).toBe(
      403,
    );
  });

  it("an erasure against a client alone is 400; a future day 400; a contact of another client 404; a converted lead 409 lead_converted", async () => {
    const o = await owner();
    const a = await mkPortalClient();
    const b = await mkPortalClient();
    expect(await code(await log(o.cookie, { kind: "data_erasure", clientId: a.clientId }))).toBe(
      "bad_request",
    );
    expect(
      (
        await log(o.cookie, {
          kind: "data_access",
          clientId: a.clientId,
          receivedOn: toIsoDate(istDate(Date.now() + 2 * DAY)),
        })
      ).status,
    ).toBe(400);
    const before = await countOf("client_requests");
    expect(
      (await log(o.cookie, { kind: "data_access", clientId: a.clientId, contactId: b.contactId })).status,
    ).toBe(404);
    expect(await countOf("client_requests")).toBe(before);
    const converted = await mkLead(`c-${uuidv7()}@example.test`, { client_id: a.clientId });
    expect(await code(await log(o.cookie, { kind: "data_access", leadId: converted }))).toBe(
      "lead_converted",
    );
    // a contact with its own client is fine, and its client is taken from the contact
    const ok = await log(o.cookie, { kind: "data_access", contactId: b.contactId });
    expect(ok.status).toBe(201);
  });

  it("the state filter reads the reply date: overdue, due soon, not acknowledged", async () => {
    const o = await owner();
    const late = await log(o.cookie, {
      kind: "grievance",
      requesterEmail: `l-${uuidv7()}@example.test`,
      details: "Late",
      receivedOn: dayAgo(40),
    });
    const soon = await log(o.cookie, {
      kind: "grievance",
      requesterEmail: `s-${uuidv7()}@example.test`,
      details: "Soon",
      receivedOn: dayAgo(27),
    });
    const unack = await log(o.cookie, {
      kind: "grievance",
      requesterEmail: `u-${uuidv7()}@example.test`,
      details: "Ack",
      receivedOn: dayAgo(3),
    });
    const idOf = async (r: Response) => ((await bodyOf(r)).request as { id: string }).id;
    const [lateId, soonId, unackId] = [await idOf(late), await idOf(soon), await idOf(unack)];
    const page = async (state: string) =>
      (await bodyOf(await call(`/client-requests?state=${state}`, { cookie: o.cookie }))).items as {
        id: string;
        state: string;
        daysLeft: number;
      }[];
    const overdue = await page("overdue");
    expect(overdue.find((i) => i.id === lateId)).toMatchObject({ state: "overdue" });
    expect((overdue.find((i) => i.id === lateId)?.daysLeft ?? 0) < 0).toBe(true);
    expect(overdue.map((i) => i.id)).not.toContain(soonId);
    expect((await page("due_soon")).find((i) => i.id === soonId)).toMatchObject({ state: "due_soon" });
    expect((await page("ack_overdue")).find((i) => i.id === unackId)).toMatchObject({ state: "ack_overdue" });
    // acknowledging takes it off the list; a second acknowledgement is 409 step_done
    expect(
      (await call(`/client-requests/${unackId}/step`, { cookie: o.cookie, body: { step: "acknowledged" } }))
        .status,
    ).toBe(200);
    expect((await page("ack_overdue")).map((i) => i.id)).not.toContain(unackId);
    expect(
      await code(
        await call(`/client-requests/${unackId}/step`, { cookie: o.cookie, body: { step: "acknowledged" } }),
      ),
    ).toBe("step_done");
  });

  it("L42: a logged access request closes done only after the identity check; a decline needs its reason; the export date only on a done access request", async () => {
    const o = await owner();
    const res = await log(o.cookie, { kind: "data_access", requesterEmail: `a-${uuidv7()}@example.test` });
    const id = ((await bodyOf(res)).request as { id: string }).id;
    const close = (b: Record<string, unknown>) =>
      call(`/client-requests/${id}/close`, { cookie: o.cookie, body: b });
    expect(await code(await close({ outcome: "done" }))).toBe("identity_not_checked");
    expect(await code(await close({ outcome: "declined" }))).toBe("decline_reason_required");
    expect(
      await code(await close({ outcome: "declined", declineReason: "other", exportSentAt: Date.now() })),
    ).toBe("export_sent_not_allowed");
    expect(
      (await call(`/client-requests/${id}/step`, { cookie: o.cookie, body: { step: "identity_checked" } }))
        .status,
    ).toBe(200);
    expect(await one("SELECT identity_checked_by AS by FROM client_requests WHERE id = ?", id)).toEqual({
      by: o.id,
    });
    const sentAt = Date.now() - 1000;
    expect((await close({ outcome: "done", exportSentAt: sentAt })).status).toBe(200);
    expect(
      await one(
        "SELECT outcome, export_sent_at AS at, decline_reason AS r FROM client_requests WHERE id = ?",
        id,
      ),
    ).toEqual({
      outcome: "done",
      at: sentAt,
      r: null,
    });
    expect(await code(await close({ outcome: "done" }))).toBe("request_closed");
  });

  it("round 4: contact Y's erasure request can't close against contact X's erase; it closes against Y's own; an address-only one only as declined", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const x = await mkContact(p.clientId);
    const req = await mkRequest(p, "data_erasure", null);
    const erase = (id: string) =>
      call(`/contacts/${id}/erase`, { cookie: o.cookie, body: { mode: "erase", reason: "requested" } });
    expect((await erase(x.id)).status).toBe(200);
    const xAudit = await one<{ id: string }>(
      "SELECT id FROM audit_log WHERE action = 'contact.erase' AND json_extract(summary, '$.contactId') = ?",
      x.id,
    );
    const close = (actionAuditId?: string) =>
      call(`/client-requests/${req}/close`, {
        cookie: o.cookie,
        body: { outcome: "done", ...(actionAuditId ? { actionAuditId } : {}) },
      });
    expect(await code(await close())).toBe("action_required");
    expect(await code(await close(xAudit?.id))).toBe("action_missing");
    expect((await erase(p.contactId)).status).toBe(200);
    const yAudit = await one<{ id: string }>(
      "SELECT id FROM audit_log WHERE action = 'contact.erase' AND json_extract(summary, '$.contactId') = ?",
      p.contactId,
    );
    expect((await close(yAudit?.id)).status).toBe(200);
    // an address-only erasure request
    const only = (
      await bodyOf(
        await log(o.cookie, { kind: "data_erasure", requesterEmail: `o-${uuidv7()}@example.test` }),
      )
    ).request as { id: string };
    const closeOnly = (b: Record<string, unknown>) =>
      call(`/client-requests/${only.id}/close`, { cookie: o.cookie, body: b });
    expect((await closeOnly({ outcome: "declined", declineReason: "legal_hold" })).status).toBe(409);
    expect((await closeOnly({ outcome: "declined", declineReason: "not_on_record" })).status).toBe(200);
  });

  it("round 6 and L22: a lead an open erasure request names is never converted (409 erasure_request_open); the request closes against its lead erase", async () => {
    const o = await owner();
    const lead = await mkLead(`r6-${uuidv7()}@example.test`);
    const req = (
      (await bodyOf(await log(o.cookie, { kind: "data_erasure", leadId: lead }))).request as { id: string }
    ).id;
    const convert = await call(`/leads/${lead}/convert`, {
      cookie: o.cookie,
      body: { type: "business", country: "IN", gstStatus: "unregistered", stateCode: "19", currency: "INR" },
    });
    expect(convert.status).toBe(409);
    expect(await code(convert)).toBe("erasure_request_open");
    expect(
      (await call(`/client-requests/${req}/step`, { cookie: o.cookie, body: { step: "identity_checked" } }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/leads/${lead}/erase`, { cookie: o.cookie, body: { reason: "requested" } })).status,
    ).toBe(200);
    const audit = await one<{ id: string }>(
      "SELECT id FROM audit_log WHERE action = 'lead.erase' AND entity_id = ?",
      lead,
    );
    expect(
      (
        await call(`/client-requests/${req}/close`, {
          cookie: o.cookie,
          body: { outcome: "done", actionAuditId: audit?.id },
        })
      ).status,
    ).toBe(200);
    expect(await one("SELECT lead_id, lead_ref FROM client_requests WHERE id = ?", req)).toEqual({
      lead_id: null,
      lead_ref: lead,
    });
  });
});

describe("legal holds [ADM-CLI-05, RA-25; C.5]", () => {
  it("the Owner with a fresh code sets and clears a hold; the history is kept; unchanged 409; Staff 403; without step-up 403; an anonymised contact 409", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const hold = (cookie: string, b: Record<string, unknown>) =>
      call("/legal-holds", {
        cookie,
        body: { entityType: "client", entityId: p.clientId, reason: "GST notice", ...b },
      });
    // L44: the hold INSERT fires the mirror trigger (D1 counts its rows too); the route reads the audit row, never `changes === 1`.
    expect((await hold(o.cookie, { on: true })).status).toBe(200);
    expect(await one("SELECT legal_hold FROM clients WHERE id = ?", p.clientId)).toEqual({ legal_hold: 1 });
    expect(await code(await hold(o.cookie, { on: true }))).toBe("hold_unchanged");
    const plain = await sessionFor("owner");
    expect(await code(await hold(plain.cookie, { on: false }))).toBe("step_up_required");
    const staff = await sessionFor("staff", { stepUp: true });
    expect((await hold(staff.cookie, { on: false })).status).toBe(403);
    expect((await hold(o.cookie, { on: false, reason: "Notice closed" })).status).toBe(200);
    const history = (await bodyOf(
      await call(`/legal-holds?entityType=client&entityId=${p.clientId}`, { cookie: staff.cookie }),
    )) as {
      held: boolean;
      history: { action: string; reason: string }[];
    };
    expect(history.held).toBe(false);
    expect(history.history.map((h) => h.action)).toEqual(["clear", "set"]);
    expect(
      await countOf(
        "audit_log",
        "action IN ('legal_hold.set', 'legal_hold.clear') AND entity_id = ?",
        p.clientId,
      ),
    ).toBe(2);
    // the reason's words are in the history only, never the audit row
    expect(await countOf("audit_log", "entity_id = ? AND summary LIKE '%GST notice%'", p.clientId)).toBe(0);
    // an anonymised contact
    const gone = await mkContact(p.clientId, { anonymised_at: Date.now() });
    expect(
      await code(
        await call("/legal-holds", {
          cookie: o.cookie,
          body: { entityType: "contact", entityId: gone.id, on: true, reason: "x" },
        }),
      ),
    ).toBe("anonymised");
    expect(
      (
        await call("/legal-holds", {
          cookie: o.cookie,
          body: { entityType: "lead", entityId: uuidv7(), on: true, reason: "x" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("the erased-address lift (L20) [C.6]", () => {
  it("the Owner with a fresh code removes the h: row of an address; the audit row holds the hash, never the address; none is 409", async () => {
    const o = await owner();
    const email = `back-${uuidv7()}@example.test`;
    const hash = await hashOf(email);
    await insert("email_suppressions", { email: `h:${hash}`, reason: "erased", at: Date.now() });
    const lift = (cookie: string) =>
      call("/suppressions/lift", { cookie, body: { email: email.toUpperCase() } });
    expect(await code(await lift((await sessionFor("owner")).cookie))).toBe("step_up_required");
    expect((await lift(o.cookie)).status).toBe(200);
    expect(await countOf("email_suppressions", "email = ?", `h:${hash}`)).toBe(0);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'suppression.lift' AND actor_id = ?",
      o.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({ hash });
    expect(audit?.summary).not.toContain("example.test");
    expect(await code(await lift(o.cookie))).toBe("not_suppressed");
  });
});

describe("the clean-up report and the real-deletion switch (Q1 A) [ADM-SET-09; C.7]", () => {
  it("on needs a dry run finished within 7 days (no report, stale report: 409); on twice 409; the lead view follows the switch; off always", async () => {
    const o = await owner();
    const live = (on: boolean) => call("/retention/live", { cookie: o.cookie, body: { on } });
    const report = async () =>
      (await bodyOf(await call("/retention/report", { cookie: o.cookie }))) as Record<string, unknown>;
    expect((await report()).live).toBe(false);
    expect(await code(await live(true))).toBe("no_trial_report");
    const t = Date.now();
    await insert("retention_runs", {
      id: uuidv7(),
      as_of: t - 9 * DAY,
      mode: "dry_run",
      started_at: t - 9 * DAY,
      finished_at: t - 8 * DAY,
      families: 11,
    });
    expect(await code(await live(true))).toBe("trial_report_stale");
    const run = uuidv7();
    await insert("retention_runs", {
      id: run,
      as_of: t - 1000,
      mode: "dry_run",
      started_at: t - 1000,
      finished_at: t,
      families: 11,
    });
    await insert("retention_run_counts", {
      run_id: run,
      family: "sessions",
      due: 3,
      held_skipped: 0,
      done: 1,
    });
    expect(
      (await call("/retention/live", { cookie: (await sessionFor("owner")).cookie, body: { on: true } }))
        .status,
    ).toBe(403);
    expect((await live(true)).status).toBe(200);
    expect(await code(await live(true))).toBe("switch_unchanged");
    const r = await report();
    expect(r.live).toBe(true);
    expect(
      (r.runs as { id: string; counts: { family: string; due: number }[] }[]).find((x) => x.id === run)
        ?.counts,
    ).toEqual([expect.objectContaining({ family: "sessions", due: 3 })]);
    const leadsView = (await bodyOf(await call("/leads?deletion=1", { cookie: o.cookie }))) as {
      purgeMode: string;
    };
    expect(leadsView.purgeMode).toBe("live");
    expect((await live(false)).status).toBe(200);
    expect(
      ((await bodyOf(await call("/leads?deletion=1", { cookie: o.cookie }))) as { purgeMode: string })
        .purgeMode,
    ).toBe("dry_run");
    expect((await call("/retention/report", { cookie: (await sessionFor("staff")).cookie })).status).toBe(
      403,
    );
  });
});

describe("a lead's erase, export and consent withdrawal [ADM-CLI-05, FRM-05; C.8]", () => {
  it("round 5: two leads of one person (any case) go in one batch: one lead.erase row each, exactly one h: row, the plain row gone, receipts stamped and ended", async () => {
    const o = await owner();
    const email = `two-${uuidv7()}@example.test`;
    const a = await mkLead(email, { consent: consent() });
    const b = await mkLead(email.toUpperCase(), { consent: consent() });
    await receiptFor({ leadId: a });
    await receiptFor({ leadId: b });
    await bounce(email);
    const c = countingEnv();
    const res = await call(`/leads/${a}/erase`, { cookie: o.cookie, body: { reason: "requested" } }, c.env);
    expect(res.status, await res.clone().text()).toBe(200);
    console.log(`D1 statements, lead erase (2 leads): ${c.count()} (budget 45)`);
    expect(c.count()).toBeLessThanOrEqual(45);
    const hash = await hashOf(email);
    expect(await countOf("leads", "id IN (?, ?)", a, b)).toBe(0);
    expect(await countOf("audit_log", "action = 'lead.erase' AND entity_id IN (?, ?)", a, b)).toBe(2);
    expect(await countOf("email_suppressions", "email = ?", `h:${hash}`)).toBe(1);
    expect(await countOf("email_suppressions", "email = ?", email)).toBe(0);
    expect(
      await countOf("consent_receipts", "subject_hash = ? AND event = 'grant' AND lead_id IS NULL", hash),
    ).toBe(2);
    expect(await countOf("consent_receipts", "subject_hash = ? AND event = 'ended'", hash)).toBe(2);
  });

  it("N4: a held lead of the address is 409 legal_hold with nothing changed; a converted lead 409 lead_converted; Staff 403", async () => {
    const o = await owner();
    const email = `held-${uuidv7()}@example.test`;
    const a = await mkLead(email);
    await mkLead(email, { legal_hold: 1 });
    await bounce(email);
    const res = await call(`/leads/${a}/erase`, { cookie: o.cookie, body: { reason: "requested" } });
    expect(await code(res)).toBe("legal_hold");
    expect(await countOf("leads", "lower(contact_email) = ? AND erased_hash IS NULL", email)).toBe(2);
    expect(await countOf("email_suppressions", "email = ?", email)).toBe(1);
    const p = await mkPortalClient();
    const converted = await mkLead(`cv-${uuidv7()}@example.test`, { client_id: p.clientId });
    expect(
      await code(
        await call(`/leads/${converted}/erase`, { cookie: o.cookie, body: { reason: "requested" } }),
      ),
    ).toBe("lead_converted");
    const staff = await sessionFor("staff", { stepUp: true });
    expect(
      (await call(`/leads/${a}/erase`, { cookie: staff.cookie, body: { reason: "requested" } })).status,
    ).toBe(403);
  });

  it("round 4: a lead erase with a live contact at the same address writes no h: stop and keeps the contact's bounce row", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const live = await mkContact(p.clientId, { email: `shared-${uuidv7()}@example.test` });
    const lead = await mkLead(live.email);
    await bounce(live.email);
    expect(
      (await call(`/leads/${lead}/erase`, { cookie: o.cookie, body: { reason: "requested" } })).status,
    ).toBe(200);
    expect(await countOf("email_suppressions", "email = ?", `h:${await hashOf(live.email)}`)).toBe(0);
    expect(await countOf("email_suppressions", "email = ?", live.email)).toBe(1);
  });

  it("the export: the lead, its activities, its emails by address and its receipts, in parts; audit ids and counts only; L31's months", async () => {
    const o = await owner();
    const email = `ex-${uuidv7()}@example.test`;
    const lead = await mkLead(email, { consent: consent() });
    await receiptFor({ leadId: lead });
    const summary = (await bodyOf(
      await call(`/leads/${lead}/export`, { cookie: o.cookie, body: {} }),
    )) as Record<string, unknown>;
    expect(summary.manifest).toEqual(["lead_activities", "email_log", "consent_receipts"]);
    expect(summary.keyedFormMonths).toBe(36);
    expect(summary.lead).not.toHaveProperty("erased_hash");
    const part = (await bodyOf(
      await call(`/leads/${lead}/export`, { cookie: o.cookie, body: { part: "consent_receipts" } }),
    )) as { items: unknown[] };
    expect(part.items).toHaveLength(1);
    const audits = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'lead.export' AND entity_id = ?",
      lead,
    );
    expect(audits).toHaveLength(2);
    for (const a of audits) expect(a.summary).not.toContain(email);
    expect(
      (await call(`/leads/${lead}/export`, { cookie: (await sessionFor("owner")).cookie, body: {} })).status,
    ).toBe(403);
  });

  it("consent withdrawal: the consent gains withdrawnAt and one withdraw receipt with the keyed hash; a second is 409", async () => {
    const o = await owner();
    const email = `wd-${uuidv7()}@example.test`;
    const lead = await mkLead(email, { consent: consent() });
    const res = await call(`/leads/${lead}/consent/withdraw`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await one<Record<string, unknown>>(
      "SELECT * FROM consent_receipts WHERE lead_id = ? AND event = 'withdraw'",
      lead,
    );
    expect(r).toMatchObject({ subject_hash: await hashOf(email), source: "staff", marketing: 0 });
    expect(JSON.parse(r?.purposes as string)).toEqual(["respond_to_enquiry", "marketing_updates"]);
    expect(await code(await call(`/leads/${lead}/consent/withdraw`, { cookie: o.cookie, body: {} }))).toBe(
      "nothing_to_withdraw",
    );
  });
});

describe("the erasure hashes of the contact erase and anonymise (L24, L27, L37) [ADM-CLI-05]", () => {
  const erase = (cookie: string, id: string, mode: "erase" | "anonymise") =>
    call(`/contacts/${id}/erase`, { cookie, body: { mode, reason: "requested" } });

  it("L27 (b): a contact erase with one unconverted matched lead writes exactly one h: row and no plain row; the lead and its receipts take the hash", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client, { email: `b-${uuidv7()}@example.test` });
    const lead = await mkLead(c.email.toUpperCase());
    await receiptFor({ leadId: lead });
    await receiptFor({ contactId: c.id });
    await bounce(c.email);
    expect((await erase(o.cookie, c.id, "erase")).status).toBe(200);
    const hash = await hashOf(c.email);
    expect(await countOf("email_suppressions", "email = ?", `h:${hash}`)).toBe(1);
    expect(await countOf("email_suppressions", "email = ?", c.email)).toBe(0);
    expect(await one("SELECT erased_hash FROM leads WHERE id = ?", lead)).toEqual({ erased_hash: hash });
    expect(await countOf("consent_receipts", "subject_hash = ? AND event = 'grant'", hash)).toBe(2);
  });

  it("L27 (c): erasing a contact at client A while the address is live at client B writes no stop and keeps the plain row", async () => {
    const o = await owner();
    const email = `c-${uuidv7()}@example.test`;
    const a = await mkContact(await mkClient(), { email });
    await mkContact(await mkClient(), { email });
    await bounce(email);
    expect((await erase(o.cookie, a.id, "anonymise")).status).toBe(200);
    expect(await countOf("email_suppressions", "email = ?", `h:${await hashOf(email)}`)).toBe(0);
    expect(await countOf("email_suppressions", "email = ?", email)).toBe(1);
    // the anonymise still binds the contact's own hash (+0 statements)
    expect(await one("SELECT erased_hash FROM contacts WHERE id = ?", a.id)).toEqual({
      erased_hash: await hashOf(email),
    });
  });

  it("L24: a lead matched only by contact_id with another address gets its own address's hash and stop", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client, { email: `new-${uuidv7()}@example.test` });
    const oldEmail = `old-${uuidv7()}@example.test`;
    const lead = await mkLead(oldEmail, { contact_id: c.id, client_id: client });
    await bounce(oldEmail);
    expect((await erase(o.cookie, c.id, "anonymise")).status).toBe(200);
    const oldHash = await hashOf(oldEmail);
    expect(await one("SELECT erased_hash FROM leads WHERE id = ?", lead)).toEqual({ erased_hash: oldHash });
    expect(await countOf("email_suppressions", "email = ?", `h:${oldHash}`)).toBe(1);
    expect(await countOf("email_suppressions", "email = ?", oldEmail)).toBe(0);
  });

  it("M1: MATCHED_LEADS reads both indexes (by contact, by the lower-cased address)", async () => {
    const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${MATCHED_LEADS}`, "x"))
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toContain("leads_contact");
    expect(plan).toContain("leads_contact_email_lower");
    expect(plan).not.toMatch(/SCAN l\b/);
  });

  it("C.9: the export summary names the processors (07-A §3) and the keyed form's months; consent receipts are a part; Staff never see the person's IP", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client);
    await receiptFor({ contactId: c.id });
    const summary = (await bodyOf(
      await call(`/contacts/${c.id}/export`, { cookie: o.cookie, body: {} }),
    )) as {
      processors: { rows: unknown[]; privacyPage: string };
      keyedFormMonths: number;
      manifest: string[];
    };
    expect(summary.processors.rows).toEqual(PROCESSORS);
    expect(summary.processors.privacyPage).toBe("https://techaust.com/privacy");
    expect(summary.keyedFormMonths).toBe(36);
    expect(summary.manifest).toContain("consent_receipts");
    expect(summary.manifest).not.toContain("time_notes");
    const part = (await bodyOf(
      await call(`/contacts/${c.id}/export`, { cookie: o.cookie, body: { part: "consent_receipts" } }),
    )) as { items: unknown[] };
    expect(part.items).toHaveLength(1);
  });

  it("C.9: withdrawing and granting a contact's marketing consent appends its receipt with the keyed hash", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client, {
      marketing_consent: JSON.stringify({ granted: true, at: 1000, source: "admin" }),
    });
    const read = async () =>
      one<{ updated_at: number }>("SELECT updated_at FROM contacts WHERE id = ?", c.id);
    const patch = async (marketingConsent: boolean) =>
      call(`/contacts/${c.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { marketingConsent, expectedUpdatedAt: (await read())?.updated_at },
      });
    expect((await patch(false)).status).toBe(200);
    expect((await patch(true)).status).toBe(200);
    const events = await rows<{ event: string; subject_hash: string }>(
      "SELECT event, subject_hash FROM consent_receipts WHERE contact_id = ? ORDER BY at, rowid",
      c.id,
    );
    expect(events.map((e) => e.event)).toEqual(["withdraw", "grant"]);
    for (const e of events) expect(e.subject_hash).toBe(await hashOf(c.email));
  });
});

describe("Q4 A (L43): an anonymised client's stored PDFs are the Owner's and the Accountant's only", () => {
  it("Staff are refused 403 client_anonymised_pdf; the Accountant and the Owner pass that check (no PDF made yet: 409 pdf_pending)", async () => {
    const client = await mkClient({ type: "individual" });
    const inv = await mkDoc(client, "tax_invoice", { frozen: true });
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(client, Date.now())
      .run();
    const get = async (role: "staff" | "accountant" | "owner") =>
      call(`/invoices/${inv}/pdf`, { cookie: (await sessionFor(role)).cookie });
    const staff = await get("staff");
    expect(staff.status).toBe(403);
    expect(await code(staff)).toBe("client_anonymised_pdf");
    for (const role of ["accountant", "owner"] as const)
      expect(await code(await get(role)), role).toBe("pdf_pending");
    // a live client's stored PDF stays Staff's to read as before
    const liveClient = await mkClient();
    const other = await mkDoc(liveClient, "tax_invoice", { frozen: true });
    expect(
      await code(await call(`/invoices/${other}/pdf`, { cookie: (await sessionFor("staff")).cookie })),
    ).toBe("pdf_pending");
  });
});

describe("L47: a member's known devices end with the account", () => {
  it("deactivating a member deletes their staff_known_devices rows in the same batch", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    await insert("staff_known_devices", {
      user_id: staff.id,
      device_hash: "d".repeat(64),
      user_agent: "Test/1.0",
    });
    const res = await call(`/users/${staff.id}/deactivate`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await countOf("staff_known_devices", "user_id = ?", staff.id)).toBe(0);
  });
});
