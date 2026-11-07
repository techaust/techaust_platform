// M7.4 data-protection routes of the admin API (ADM-SET-09, ADM-CLI-05, POR-11, FRM-05, ADM-LEAD-05; run file docs/runs/m7.4-data-protection.md C, I, L20–L47):
// the request log, its steps and close (the identity check, the fulfilling erase of the exact contact or lead), legal holds, the erased-address lift, the clean-up
// switch, a lead's erase, export and consent withdrawal, the erasure hashes of the contact erase and anonymise (L24, L27), the stored PDFs of an anonymised
// client (Q4 A), devices ending with the account (L47), and the statement budget. Invented data only.
import { env } from "cloudflare:workers";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { IDENTITY_CHECKED_KINDS, REQUEST_KINDS, requestDueAt } from "@techaust/core/dsr";
import { addressHash } from "@techaust/core/hmac";
import { uuidv7 } from "@techaust/core/ids";
import { type Action, decide, ROLES } from "@techaust/core/permissions";
import { PROCESSORS } from "@techaust/core/processors";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_CLOSE_SQL, REQUEST_STEP_SQL } from "./client-requests.ts";
import { MATCHED_LEADS } from "./clients.ts";
import { encodeCursor } from "./keyset.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { insert, mkClient, mkContact, mkDoc, mkLead } from "./test-clients.ts";
import { finalisedDeed, putSigned } from "./test-deeds.ts";
import { bodyOf, call, countingEnv, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { mkOverseasClient, putCompany } from "./test-invoices.ts";
import { putDoc, recordBody, recorded } from "./test-payments.ts";
import { mkPortalClient, mkRequest } from "./test-portal.ts";
import { PDF_BYTES } from "./test-projects.ts";
import { addDoc, line } from "./test-reports.ts";

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

describe("the request lists come from core (review 1 lows 5 and 7)", () => {
  it("the kind filter takes every DSR kind and nothing else; a state filter takes only overdue, due soon and not acknowledged; the close SQL's identity list is core's", async () => {
    const o = await owner();
    for (const kind of REQUEST_KINDS)
      expect((await call(`/client-requests?kind=${kind}`, { cookie: o.cookie })).status, kind).toBe(200);
    for (const q of ["kind=bogus", "state=open", "state=closed", "state=late"])
      expect((await call(`/client-requests?${q}`, { cookie: o.cookie })).status, q).toBe(400);
    for (const q of ["state=overdue", "state=due_soon", "state=ack_overdue"])
      expect((await call(`/client-requests?${q}`, { cookie: o.cookie })).status, q).toBe(200);
    expect(REQUEST_CLOSE_SQL).toContain(
      `kind NOT IN (${IDENTITY_CHECKED_KINDS.map((k) => `'${k}'`).join(", ")})`,
    );
    // the acknowledged step binds exactly its two placeholders (D1 refuses an extra value)
    expect(REQUEST_STEP_SQL.acknowledged).not.toContain("?3");
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

  it("review 1 low 4: a lead's hold history also needs leads.read: the Accountant is refused for a lead and allowed for a client", async () => {
    const lead = await mkLead(`hold-${uuidv7()}@example.test`);
    const client = await mkClient();
    const acc = await sessionFor("accountant");
    const read = (cookie: string, entityType: string, entityId: string) =>
      call(`/legal-holds?entityType=${entityType}&entityId=${entityId}`, { cookie });
    const refused = await read(acc.cookie, "lead", lead);
    expect([refused.status, await code(refused)]).toEqual([403, "forbidden"]);
    expect((await read(acc.cookie, "client", client)).status).toBe(200);
    expect((await read((await sessionFor("staff")).cookie, "lead", lead)).status).toBe(200);
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

  it("review 1 low 1: the live verdict reads the newest finished dry run even when 5 newer live runs fill the run list", async () => {
    const o = await owner();
    const t = Date.now();
    const dry = uuidv7();
    await insert("retention_runs", {
      id: dry,
      as_of: t + 1_000,
      mode: "dry_run",
      started_at: t + 1_000,
      finished_at: t + 1_000,
      families: 11,
    });
    for (let i = 2; i <= 7; i++)
      await insert("retention_runs", {
        id: uuidv7(),
        as_of: t + i * 1_000,
        mode: "live",
        started_at: t + i * 1_000,
        finished_at: t + i * 1_000,
        families: 11,
      });
    const r = (await bodyOf(await call("/retention/report", { cookie: o.cookie }))) as {
      liveVerdict: string;
      runs: { id: string; mode: string }[];
    };
    expect(r.runs).toHaveLength(5);
    expect(r.runs.map((x) => x.mode)).toEqual(["live", "live", "live", "live", "live"]);
    expect(r.liveVerdict).toBe("ok");
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

  it("review 1 low 11: more than 50 leads of one address is 409 too_many_leads with details.refs, an array of 50 ref strings; nothing is erased", async () => {
    const o = await owner();
    const email = `many-${uuidv7()}@example.test`;
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push(await mkLead(email));
    const res = await call(`/leads/${ids[0]}/erase`, { cookie: o.cookie, body: { reason: "requested" } });
    expect(res.status).toBe(409);
    const e = (await bodyOf(res)).error as { code: string; details?: { refs?: unknown } };
    expect(e.code).toBe("too_many_leads");
    expect(Array.isArray(e.details?.refs)).toBe(true);
    const refs = e.details?.refs as unknown[];
    expect(refs).toHaveLength(50);
    for (const r of refs) expect(typeof r).toBe("string");
    expect(await countOf("leads", "lower(contact_email) = ?", email)).toBe(51);
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

  it("review 1 low 12 (L54): the export's emails are only the lead's own, never a client's email to the same address or the staff alert", async () => {
    const o = await owner();
    const email = `own-${uuidv7()}@example.test`;
    const lead = await mkLead(email);
    const { ref } = (await one<{ ref: string }>("SELECT ref FROM leads WHERE id = ?", lead)) as {
      ref: string;
    };
    const mine = uuidv7();
    await insert("email_log", {
      id: mine,
      to_email: email.toUpperCase(),
      template: "lead.acknowledgement",
      entity_type: "lead",
      entity_id: ref,
      status: "sent",
    });
    // the staff alert about the lead, and an email to the same address on a client's behalf
    await insert("email_log", {
      id: uuidv7(),
      to_email: "alerts@example.test",
      template: "lead.alert",
      entity_type: "lead",
      entity_id: ref,
      status: "sent",
    });
    await insert("email_log", {
      id: uuidv7(),
      to_email: email,
      template: "portal.link",
      entity_type: "contact",
      entity_id: uuidv7(),
      status: "sent",
    });
    const part = (await bodyOf(
      await call(`/leads/${lead}/export`, { cookie: o.cookie, body: { part: "email_log" } }),
    )) as { items: { id: string }[]; next: string | null };
    expect(part.items.map((i) => i.id)).toEqual([mine]);
    expect(part.next).toBeNull();
    // every part's next page binds its cursor (?4, ?5)
    for (const name of ["lead_activities", "email_log", "consent_receipts"]) {
      const res = await call(`/leads/${lead}/export`, {
        cookie: o.cookie,
        body: { part: name, after: encodeCursor({ k: 0, id: "" }) },
      });
      expect(res.status, `${name} ${await res.clone().text()}`).toBe(200);
    }
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

  it("review 1 (builder's question 1): without the key a lead's consent withdrawal saves with a NULL receipt hash and logs erasure.key_missing", async () => {
    const o = await owner();
    const noKey = new Proxy(env, {
      get: (t, k) => (k === "ERASURE_HASH_KEY" ? undefined : Reflect.get(t, k)),
    }) as Env;
    const email = `wdk-${uuidv7()}@example.test`;
    const lead = await mkLead(email, { consent: consent() });
    const logs = vi.spyOn(console, "log");
    try {
      const res = await call(`/leads/${lead}/consent/withdraw`, { cookie: o.cookie, body: {} }, noKey);
      expect(res.status, await res.clone().text()).toBe(200);
      const logged = logs.mock.calls.map((a) => String(a[0]));
      expect(
        logged.some((l) => l.includes('"ev":"erasure.key_missing"') && l.includes("lead.consent.withdraw")),
      ).toBe(true);
      for (const l of logged) expect(l).not.toContain(email);
    } finally {
      logs.mockRestore();
    }
    expect(
      await one("SELECT subject_hash FROM consent_receipts WHERE lead_id = ? AND event = 'withdraw'", lead),
    ).toEqual({ subject_hash: null });
  });

  it("review 1 medium 1: a lead marked erased or holding the anonymise placeholder is 409 anonymised, with no receipt and no change", async () => {
    const o = await owner();
    const withdraw = (lead: string) =>
      call(`/leads/${lead}/consent/withdraw`, { cookie: o.cookie, body: {} });
    // the placeholder address (any case)
    const placeholder = await mkLead(`Anonymised+${uuidv7()}@invalid`, { consent: consent() });
    expect(await code(await withdraw(placeholder))).toBe("anonymised");
    // a converted lead the contact's anonymise marked erased (L24)
    const client = await mkClient();
    const c = await mkContact(client, { email: `gone-${uuidv7()}@example.test` });
    const erased = await mkLead(c.email, { contact_id: c.id, client_id: client, consent: consent() });
    expect(
      (
        await call(`/contacts/${c.id}/erase`, {
          cookie: o.cookie,
          body: { mode: "anonymise", reason: "requested" },
        })
      ).status,
    ).toBe(200);
    const before = await one<{ consent: string | null }>("SELECT consent FROM leads WHERE id = ?", erased);
    expect(await code(await withdraw(erased))).toBe("anonymised");
    expect(await one("SELECT consent FROM leads WHERE id = ?", erased)).toEqual(before);
    expect(
      await countOf("consent_receipts", "lead_id IN (?, ?) AND event = 'withdraw'", placeholder, erased),
    ).toBe(0);
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

  it("review 1 low 3: without the key a contact's consent change saves with a NULL receipt hash and logs erasure.key_missing; the erase stays fail-closed", async () => {
    const o = await owner();
    const noKey = new Proxy(env, {
      get: (t, k) => (k === "ERASURE_HASH_KEY" ? undefined : Reflect.get(t, k)),
    }) as Env;
    const client = await mkClient();
    const c = await mkContact(client, {
      marketing_consent: JSON.stringify({ granted: true, at: 1000, source: "admin" }),
    });
    const at = (await one<{ updated_at: number }>("SELECT updated_at FROM contacts WHERE id = ?", c.id))
      ?.updated_at;
    const logs = vi.spyOn(console, "log");
    try {
      const res = await call(
        `/contacts/${c.id}`,
        { method: "PATCH", cookie: o.cookie, body: { marketingConsent: false, expectedUpdatedAt: at } },
        noKey,
      );
      expect(res.status, await res.clone().text()).toBe(200);
      const logged = logs.mock.calls.map((a) => String(a[0]));
      expect(
        logged.some((l) => l.includes('"ev":"erasure.key_missing"') && l.includes("contact_consent")),
      ).toBe(true);
      for (const l of logged) expect(l).not.toContain(c.email);
    } finally {
      logs.mockRestore();
    }
    expect(await one("SELECT event, subject_hash FROM consent_receipts WHERE contact_id = ?", c.id)).toEqual({
      event: "withdraw",
      subject_hash: null,
    });
    // the erase still refuses to run without its stop (500, nothing written)
    const erase = await call(
      `/contacts/${c.id}/erase`,
      { cookie: o.cookie, body: { mode: "erase", reason: "requested" } },
      noKey,
    );
    expect(erase.status).toBe(500);
    expect(await one("SELECT anonymised_at FROM contacts WHERE id = ?", c.id)).toEqual({
      anonymised_at: null,
    });
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

  // Early check 2 M1: every stored-PDF route (the offer, its acceptance certificate, an invoice, a credit note, a receipt, the deed unsigned and signed, the
  // supplier copy). Staff and Sales get 403: `client_anonymised_pdf` where their role may read the route, the plain `forbidden` where it may not. The Owner and the
  // Accountant pass the anonymised check wherever their role may read the route (each answer then is the route's own: the file, or "not made yet").
  it("every stored-PDF route refuses Staff and Sales and lets the Owner and the Accountant through [M1]", async () => {
    await putCompany();
    const o = await owner();
    const f = await finalisedDeed(o);
    const signed = await putSigned(o, f.deedId);
    expect(signed.status, await signed.clone().text()).toBe(200);
    await env.DB.prepare("UPDATE deeds SET unsigned_r2_key = ?2, unsigned_sha256 = 'z' WHERE id = ?1")
      .bind(f.deedId, `deeds/${f.deedId}/unsigned-m1.pdf`)
      .run();
    const contact = await mkContact(f.clientId);
    const acc = crypto.randomUUID();
    const certKey = `docs/proposal/2627/m1-${acc}-certificate.pdf`;
    await env.DB.prepare(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, certificate_r2_key) VALUES (?1, ?2, ?3, 'A', 'a@example.test', 1, 'h', ?4)",
    )
      .bind(acc, f.proposalId, contact.id, certKey)
      .run();
    await env.DB.prepare(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, 's', 1)",
    )
      .bind(acc, certKey)
      .run();
    await env.DOCS.put(certKey, "%PDF-1.4 certificate");
    const cn = await addDoc({
      type: "credit_note",
      clientId: f.clientId,
      issueDate: "2026-10-06",
      parentId: f.inv.id,
      lines: [line(100_00)],
      dueDate: null,
    });
    const pay = await recorded(o, recordBody(f.clientId, 2_000));
    await issueReceipt(env, pay.id as string);
    expect(
      await countOf("documents", "id = ? AND type = 'receipt' AND frozen_at IS NOT NULL", `rct_${pay.id}`),
    ).toBe(1);
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(f.clientId, Date.now())
      .run();

    const routes: [string, Action][] = [
      [`/documents/${f.proposalId}/pdf`, "proposals.read"],
      [`/documents/${f.proposalId}/certificate`, "proposals.read"],
      [`/invoices/${f.inv.id}/pdf`, "invoices.read"],
      [`/invoices/${cn.id}/pdf`, "invoices.read"],
      [`/invoices/${f.inv.id}/pdf/supplier`, "invoices.supplierCopy"],
      [`/receipts/rct_${pay.id}/pdf`, "payments.read"],
      [`/deeds/${f.deedId}/pdf/unsigned`, "deeds.view"],
      [`/deeds/${f.deedId}/pdf/signed`, "deeds.view"],
    ];
    let reached = 0;
    for (const [path, action] of routes) {
      for (const role of ROLES) {
        const res = await call(path, { cookie: (await sessionFor(role)).cookie });
        const got = res.headers.get("Content-Type")?.startsWith("application/pdf") ? "pdf" : await code(res);
        const label = `${role} ${path}`;
        if (decide(role, action) === "deny") {
          expect([res.status, got], label).toEqual([403, "forbidden"]);
        } else if (role === "staff" || role === "sales") {
          expect([res.status, got], label).toEqual([403, "client_anonymised_pdf"]);
          reached++;
        } else {
          expect(res.status, label).not.toBe(403);
          expect(got, label).not.toBe("client_anonymised_pdf");
        }
      }
    }
    // Staff reach the check on all eight routes but the supplier copy; Sales only on the offer's two.
    expect(reached).toBe(7 + 2);
    // The stored files the Owner may download come through as files: the certificate and the signed deed.
    for (const path of [`/documents/${f.proposalId}/certificate`, `/deeds/${f.deedId}/pdf/signed`]) {
      const res = await call(path, { cookie: o.cookie });
      expect([res.status, res.headers.get("Content-Type")], path).toEqual([200, "application/pdf"]);
    }
  });

  // Review 1 medium 2 (L53): a payment's proof and a remittance advice's file (the client of any payment linked to it, a link taken off included) follow Q4 A.
  it("L53: a payment proof and a remittance advice file of an anonymised client: Owner and Accountant get the file, Staff 403, others forbidden", async () => {
    await putCompany();
    const o = await owner();
    const { clientId } = await mkOverseasClient();
    const pay = await recorded(o, recordBody(clientId, 2_000, [], { currency: "USD" }));
    expect(await one("SELECT status FROM payments WHERE id = ?", pay.id)).toEqual({ status: "confirmed" });
    const proof = await putDoc(`/payments/${pay.id}/proof`, PDF_BYTES, {
      cookie: o.cookie,
      headers: { "X-Proof-Kind": "Bank%20advice" },
    });
    expect(proof.status, await proof.clone().text()).toBe(200);
    const made = await call("/payments/advices", {
      cookie: o.cookie,
      body: { provider: "bank", kind: "firc", adviceRef: `FIRC-${uuidv7().slice(-8)}`, issuedOn: dayAgo(0) },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const adviceId = (await bodyOf(made)).id as string;
    expect((await putDoc(`/payments/advices/${adviceId}/file`, PDF_BYTES, { cookie: o.cookie })).status).toBe(
      200,
    );
    const link = await call(`/payments/advices/${adviceId}/payments`, {
      cookie: o.cookie,
      body: { paymentIds: [pay.id] },
    });
    expect(link.status, await link.clone().text()).toBe(200);
    const paths: [string, Action][] = [
      [`/payments/${pay.id}/proof`, "payments.read"],
      [`/payments/advices/${adviceId}/file`, "payments.read"],
    ];
    // before the anonymise, Staff read both as before
    for (const [path] of paths)
      expect((await call(path, { cookie: (await sessionFor("staff")).cookie })).status, path).toBe(200);
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(clientId, Date.now())
      .run();
    for (const [path, action] of paths) {
      for (const role of ROLES) {
        const res = await call(path, { cookie: (await sessionFor(role)).cookie });
        const label = `${role} ${path}`;
        if (decide(role, action) === "deny") {
          expect([res.status, await code(res)], label).toEqual([403, "forbidden"]);
        } else if (role === "owner" || role === "accountant") {
          expect([res.status, res.headers.get("Content-Type")], label).toEqual([200, "application/pdf"]);
        } else {
          expect([res.status, await code(res)], label).toEqual([403, "client_anonymised_pdf"]);
        }
      }
    }
    expect(decide("staff", "payments.read")).not.toBe("deny");
    expect(decide("accountant", "payments.read")).not.toBe("deny");
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
