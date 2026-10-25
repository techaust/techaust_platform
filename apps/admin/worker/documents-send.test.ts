// Sending, numbering, versions, the discount guard and approvals [ADM-PROP-04, -05, -06, ADM-APR-01, -02, ADM-LEAD-02, ADM-INV-03].
// The scenarios V1 to V10 and the discount cases of the run file are here. Figures are typed by hand with the arithmetic beside them.
import { env } from "cloudflare:workers";
import { fyOf } from "@techaust/core/dates";
import { beforeAll, describe, expect, it } from "vitest";
import { mkLead } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  beforeSendBatch,
  codeOf,
  counter,
  dbRow,
  discount,
  getDoc,
  type J,
  json,
  mkDraft,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";
import { putPaymentTerms } from "./test-catalogue.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const FY = fyOf(Date.now()).token;
const S9 = 20_000_000; // a catalogue price of 2,00,000 rupees in paise (D1 and D2 of the run file)

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const audit = (action: string, entityId: string) =>
  one<{ summary: string; role: string }>(
    "SELECT summary, role FROM audit_log WHERE action = ? AND entity_id = ?",
    action,
    entityId,
  );
const request = (cookie: string, id: string, expectedUpdatedAt: number, reason?: string) =>
  call(`/documents/${id}/approval-request`, { cookie, body: { expectedUpdatedAt, ...(reason ? { reason } : {}) } });
const decide = (cookie: string, id: string, decision: "approve" | "reject", note?: string) =>
  call(`/approvals/${id}/decide`, { cookie, body: { decision, ...(note ? { note } : {}) } });

// ---------------------------------------------------------------------------------------------------------------
describe("the discount guard at send [ADM-PROP-04; run file D1, D2; V1]", () => {
  it("D1: exactly 10 % off the catalogue: Staff and Sales send", async () => {
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      const made = await mkDraft(s, { price: S9 });
      const v = await discount(s, made.id, "percent", 1000); // 10 % of 20,000,000 = 2,000,000: T = 18,000,000
      expect(v.guard).toMatchObject({ referenceMinor: S9, taxableMinor: 18_000_000, discountBp: 1000, needsApproval: false });
      const res = await sendDoc(s, made.id, v.updatedAt);
      expect(res.status, role).toBe(200);
      expect((await json(res)).discountBp).toBe(1000);
    }
  });

  it("D2: 2,000,100 off is 1001 bp: Staff and Sales are refused with 403 approval_required, and nothing changes", async () => {
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      const made = await mkDraft(s, { price: S9 });
      const v = await discount(s, made.id, "fixed", 2_000_100); // T = 20,000,000 - 2,000,100 = 17,999,900; 1000.05 bp rounds up to 1001
      expect(v.guard).toMatchObject({ taxableMinor: 17_999_900, discountMinor: 2_000_100, discountBp: 1001, needsApproval: true });
      const before = await counter();
      const res = await sendDoc(s, made.id, v.updatedAt);
      expect(res.status, role).toBe(403);
      expect(await codeOf(res)).toBe("approval_required");
      expect(await counter()).toBe(before);
      expect((await dbRow(made.id))?.status).toBe("draft");
      expect(await audit("document.send", made.id)).toBeNull();
    }
  });

  it("V1: the owner sends at 25 % and the audit row records discountBp 2500", async () => {
    const o = await owner();
    const made = await mkDraft(o, { price: S9 });
    const v = await discount(o, made.id, "percent", 2500);
    const res = await sendDoc(o, made.id, v.updatedAt);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).discountBp).toBe(2500);
    const row = await audit("document.send", made.id);
    expect(JSON.parse(row?.summary ?? "{}")).toMatchObject({ discountBp: 2500, version: 1, type: "proposal", approvalId: null });
  });

  it("the guard counts only catalogue lines: a custom line cannot offset a discount (D5) and is listed", async () => {
    const s = await sessionFor("sales");
    const made = await mkDraft(s, { price: S9 });
    const doc = await getDoc(s, made.id);
    const line = doc.lines[0];
    // S9 typed 17,000,000 (3,000,000 below the catalogue) plus a custom line of 5,000,000: R = 20,000,000, T = 17,000,000, 1500 bp.
    const res = await patchDoc(s, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        { id: line.id, description: line.description, qtyMilli: 1000, unit: "fixed", rateMinor: 17_000_000 },
        { description: "Pass-through costs", qtyMilli: 1000, unit: "fixed", rateMinor: 5_000_000 },
      ],
    });
    const v = await json(res);
    expect(v.guard).toMatchObject({ referenceMinor: S9, taxableMinor: 17_000_000, discountBp: 1500, needsApproval: true });
    expect(v.guard.customLines).toEqual([{ position: 2, description: "Pass-through costs", taxableMinor: 5_000_000 }]);
    expect((await sendDoc(s, made.id, v.updatedAt)).status).toBe(403);
  });

  it("Staff is held to the same limit as Sales; the accountant cannot send at all", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    const acc = await sessionFor("accountant", { stepUp: true });
    expect((await sendDoc(acc, made.id, v.updatedAt)).status).toBe(403);
    expect((await dbRow(made.id))?.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("approvals: one request for one version's exact content [ADM-APR-01, -02; V2, V3, V4, V10]", () => {
  async function pendingFor(sales: Awaited<ReturnType<typeof sessionFor>>) {
    const made = await mkDraft(sales, { price: S9 });
    const v = await discount(sales, made.id, "fixed", 5_000_000); // 25 %: 2500 bp
    const req = await request(sales.cookie, made.id, v.updatedAt, "Strategic account");
    expect(req.status, await req.clone().text()).toBe(201);
    return { made, v, approvalId: (await json(req)).id as string };
  }

  it("V2: requested, approved by the owner, then Sales sends; the frozen content hash is the one approved", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const { made, v, approvalId } = await pendingFor(sales);
    expect((await getDoc(sales, made.id)).approval).toMatchObject({ state: "pending", id: approvalId });
    // the owner has a bell row; the requester has none yet
    expect(await countOf("notifications", "entity_id = ? AND user_id = ?", approvalId, o.id)).toBe(1);
    expect(await countOf("notifications", "entity_id = ? AND user_id = ?", approvalId, sales.id)).toBe(0);
    expect((await sendDoc(sales, made.id, v.updatedAt)).status).toBe(403); // pending is not approved
    const ok = await decide(o.cookie, approvalId, "approve", "Fine");
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await countOf("notifications", "entity_id = ? AND user_id = ? AND kind = 'approval.decided'", approvalId, sales.id)).toBe(1);
    const sent = await sendDoc(sales, made.id, v.updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
    const stored = await one<{ content_sha256: string }>("SELECT content_sha256 FROM documents WHERE id = ?", made.id);
    expect(stored?.content_sha256).toBe(v.contentSha256);
    expect((await one<{ content_sha256: string }>("SELECT content_sha256 FROM approvals WHERE id = ?", approvalId))?.content_sha256).toBe(v.contentSha256);
    expect(JSON.parse((await audit("document.send", made.id))?.summary ?? "{}")).toMatchObject({ discountBp: 2500, approvalId });
  });

  it("V3: an edit after the approval expires it in the same batch; reverting the text does not revive it", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const { made, v, approvalId } = await pendingFor(sales);
    expect((await decide(o.cookie, approvalId, "approve")).status).toBe(200);
    const sections = v.sections.map((s: J) => ({ id: s.id, kind: s.kind, title: s.title, bodyMd: s.bodyMd }));
    const edited = await json(
      await patchDoc(sales, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: sections.map((s: J) => (s.kind === "estimate" ? { ...s, bodyMd: "A changed sentence" } : s)),
      }),
    );
    expect(edited.contentSha256).not.toBe(v.contentSha256);
    expect((await one("SELECT status FROM approvals WHERE id = ?", approvalId))).toEqual({ status: "expired" });
    expect(edited.approval.state).toBe("expired");
    expect(await codeOf(await sendDoc(sales, made.id, edited.updatedAt))).toBe("approval_required");
    // back to the text that was approved: the hash is the old one again, the approval stays expired
    const reverted = await json(await patchDoc(sales, made.id, { expectedUpdatedAt: edited.updatedAt, sections }));
    expect(reverted.contentSha256).toBe(v.contentSha256);
    expect((await one("SELECT status FROM approvals WHERE id = ?", approvalId))).toEqual({ status: "expired" });
    expect(await codeOf(await sendDoc(sales, made.id, reverted.updatedAt))).toBe("approval_required");
    // and a new request for the reverted content is a new record
    const again = await request(sales.cookie, made.id, reverted.updatedAt);
    expect(again.status).toBe(201);
    expect((await json(again)).id).not.toBe(approvalId);
  });

  it("V4: the approval of v1 does not cover v2; v2 needs its own", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const { made, v, approvalId } = await pendingFor(sales);
    expect((await decide(o.cookie, approvalId, "approve")).status).toBe(200);
    expect((await sendDoc(sales, made.id, v.updatedAt)).status).toBe(200);
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: sales.cookie, body: {} }));
    const draft = await getDoc(sales, v2.id);
    expect(draft.guard.needsApproval).toBe(true);
    expect(draft.approval.state).toBe("none");
    expect(await codeOf(await sendDoc(sales, v2.id, draft.updatedAt))).toBe("approval_required");
    const req = await json(await request(sales.cookie, v2.id, draft.updatedAt));
    expect((await decide(o.cookie, req.id, "approve")).status).toBe(200);
    const sent = await sendDoc(sales, v2.id, draft.updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
  });

  it("V10: deciding after an edit is a 409 approval_expired; a request at or under 10 % is a 409; a second pending request is a 409", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const { made, v, approvalId } = await pendingFor(sales);
    expect(await codeOf(await request(sales.cookie, made.id, v.updatedAt))).toBe("approval_pending");
    const edited = await json(await patchDoc(sales, made.id, { expectedUpdatedAt: v.updatedAt, fields: { title: "Edited after the request" } }));
    const late = await decide(o.cookie, approvalId, "approve");
    expect(late.status).toBe(409);
    expect(await codeOf(late)).toBe("approval_expired");
    expect((await one("SELECT status FROM approvals WHERE id = ?", approvalId))).toEqual({ status: "expired" });
    // under the threshold: nothing to approve
    const small = await mkDraft(sales, { price: S9 });
    const s = await discount(sales, small.id, "percent", 1000);
    const r = await request(sales.cookie, small.id, s.updatedAt);
    expect(r.status).toBe(409);
    expect(await codeOf(r)).toBe("approval_not_needed");
    expect(edited.approval.state).toBe("expired");
  });

  it("V10: a rejected request, then an edit and a new request, is fine; Staff and Sales cannot decide; Sales sees only their own", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const staff = await sessionFor("staff");
    const { made, v, approvalId } = await pendingFor(sales);
    const other = await pendingFor(staff);
    for (const s of [sales, staff]) expect((await decide(s.cookie, approvalId, "approve")).status).toBe(403);
    const accountant = await sessionFor("accountant", { stepUp: true });
    expect((await call("/approvals", { cookie: accountant.cookie })).status).toBe(403);
    const reject = await decide(o.cookie, approvalId, "reject", "Too deep a discount");
    expect(reject.status).toBe(200);
    expect((await getDoc(sales, made.id)).approval).toMatchObject({ state: "rejected", note: "Too deep a discount" });
    expect(await codeOf(await decide(o.cookie, approvalId, "approve"))).toBe("approval_decided");
    expect(await codeOf(await sendDoc(sales, made.id, v.updatedAt))).toBe("approval_required");
    // a rejected one does not block a new request, even for the same content
    const again = await request(sales.cookie, made.id, v.updatedAt);
    expect(again.status, await again.clone().text()).toBe(201);
    // lists: the owner sees them all, each of Sales and Staff only their own
    const everyone = await json(await call("/approvals?limit=50", { cookie: o.cookie }));
    expect(everyone.approvals.map((a: J) => a.id)).toEqual(expect.arrayContaining([approvalId, other.approvalId]));
    const mine = await json(await call("/approvals?limit=50", { cookie: sales.cookie }));
    expect(mine.approvals.length).toBeGreaterThan(0);
    expect(mine.approvals.every((a: J) => a.requestedBy === sales.id)).toBe(true);
    expect(mine.approvals.map((a: J) => a.id)).not.toContain(other.approvalId);
    // the queue row carries what the owner decides on
    const row = everyone.approvals.find((a: J) => a.id === other.approvalId);
    expect(row).toMatchObject({ state: "pending", discountBp: 2500, referenceMinor: S9, customLineCount: 0, document: { id: other.made.id, version: 1 } });
    const pending = await json(await call("/approvals?status=pending&limit=25", { cookie: o.cookie }));
    expect(pending.approvals.every((a: J) => a.state === "pending")).toBe(true);
    expect((await call("/approvals?status=bogus", { cookie: o.cookie })).status).toBe(400);
  });

  it("a request is refused for a stale draft, a sent one and a draft that does not compute; an unknown approval is a 404", async () => {
    const sales = await sessionFor("sales");
    const made = await mkDraft(sales, { price: S9 });
    const v = await discount(sales, made.id, "fixed", 5_000_000);
    const stale = await request(sales.cookie, made.id, v.updatedAt - 1);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    const o = await owner();
    expect((await decide(o.cookie, "no-such-approval", "approve")).status).toBe(404);
    const sent = await mkDraft(o);
    const view = await getDoc(o, sent.id);
    await sendDoc(o, sent.id, view.updatedAt);
    expect(await codeOf(await request(o.cookie, sent.id, view.updatedAt))).toBe("frozen");
    const broken = await mkDraft(sales, { price: S9 });
    const cleared = await json(await patchDoc(sales, broken.id, { expectedUpdatedAt: (await getDoc(sales, broken.id)).updatedAt, lines: [] }));
    expect(await codeOf(await request(sales.cookie, broken.id, cleared.updatedAt))).toBe("tax_errors");
    expect(await countOf("approvals", "document_id IN (?, ?)", sent.id, broken.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("numbering and versions [ADM-PROP-05, ADM-INV-03; V5, V6, V7, V8, V9]", () => {
  it("V5: v1 takes the next number; v2 keeps it and v1 becomes revised; the counter does not move", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const before = await counter();
    const v1 = await json(await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt));
    expect(v1.number).toBe(`TH/PRP/${FY}/${String(before).padStart(4, "0")}`);
    expect(v1.status).toBe("sent");
    expect(await counter()).toBe(before + 1);
    const v2made = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    expect((await dbRow(made.id))?.status).toBe("sent"); // acceptable until v2 is sent
    const v2 = await json(await sendDoc(o, v2made.id, (await getDoc(o, v2made.id)).updatedAt));
    expect(v2.number).toBe(v1.number);
    expect(await dbRow(v2made.id)).toMatchObject({ version: 2, status: "sent", number_display: v1.number, fy: FY });
    expect((await dbRow(made.id))?.status).toBe("revised");
    expect(await counter()).toBe(before + 1);
    expect((await getDoc(o, v2made.id)).versions.map((v: J) => [v.version, v.status])).toEqual([
      [1, "revised"],
      [2, "sent"],
    ]);
  });

  it("an estimate has its own series", async () => {
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate" });
    const sent = await json(await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt));
    expect(sent.number).toMatch(new RegExp(`^TH/EST/${FY}/\\d{4}$`));
  });

  it("V8: 20 drafts sent in parallel get 20 consecutive numbers; two sends of one draft: one wins", async () => {
    const o = await owner();
    const drafts = [];
    for (let i = 0; i < 20; i++) drafts.push(await mkDraft(o));
    const first = await counter();
    const views = await Promise.all(drafts.map((d) => getDoc(o, d.id)));
    const results = await Promise.all(drafts.map((d, i) => sendDoc(o, d.id, (views[i] as J).updatedAt)));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    const numbers = (await Promise.all(results.map((r) => json(r)))).map((r) => Number(String(r.number).slice(-4))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => first + i));
    expect(await counter()).toBe(first + 20);

    const one1 = await mkDraft(o);
    const v = await getDoc(o, one1.id);
    const before = await counter();
    const pair = await Promise.all([sendDoc(o, one1.id, v.updatedAt), sendDoc(o, one1.id, v.updatedAt)]);
    expect(pair.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await counter()).toBe(before + 1);
    expect(await countOf("audit_log", "action = 'document.send' AND entity_id = ?", one1.id)).toBe(1);
  });

  it("V9: a stale send is a 409, the counter does not move, the lead does not move, and there is no audit row", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService();
    const lead = await mkLead("stale@example.com", { client_id: client.clientId, stage: "qualified" });
    const res = await call("/documents", { cookie: o.cookie, body: { type: "proposal", clientId: client.clientId, leadId: lead, services: [{ catalogueItemId: item.id }] } });
    const id = (await json(res)).id as string;
    const v = await getDoc(o, id);
    const before = await counter();
    const stale = await sendDoc(o, id, v.updatedAt - 1);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    expect(await counter()).toBe(before);
    expect(await one("SELECT stage FROM leads WHERE id = ?", lead)).toEqual({ stage: "qualified" });
    expect(await countOf("lead_activities", "lead_id = ? AND kind = 'stage'", lead)).toBe(0);
    expect(await audit("document.send", id)).toBeNull();
    expect((await dbRow(id))?.status).toBe("draft");
  });

  it("a save between the read and the send batch refuses the send whole (the unguarded post-condition): counter, lead and audit untouched", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService();
    const lead = await mkLead("race@example.com", { client_id: client.clientId, stage: "new" });
    const id = (await json(await call("/documents", { cookie: o.cookie, body: { type: "proposal", clientId: client.clientId, leadId: lead, services: [{ catalogueItemId: item.id }] } }))).id as string;
    const v = await getDoc(o, id);
    const before = await counter();
    const e = beforeSendBatch(async () => {
      await env.DB.prepare("UPDATE documents SET updated_at = updated_at + 1 WHERE id = ?").bind(id).run();
    });
    const res = await call(`/documents/${id}/send`, { cookie: o.cookie, body: { expectedUpdatedAt: v.updatedAt } }, e);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("stale_version");
    expect(await counter()).toBe(before);
    expect(await one("SELECT stage FROM leads WHERE id = ?", lead)).toEqual({ stage: "new" });
    expect(await audit("document.send", id)).toBeNull();
    expect((await dbRow(id))?.status).toBe("draft");
  });

  it("a change of the numbering settings between the read and the batch is a 409 numbering_changed; the counter does not move", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    const before = await counter();
    const e = beforeSendBatch(async () => {
      await env.DB.prepare(
        "INSERT INTO settings (key, value, version) VALUES ('numbering', ?1, 1) ON CONFLICT(key) DO UPDATE SET version = version + 1",
      )
        .bind(JSON.stringify({}))
        .run();
    });
    try {
      const res = await call(`/documents/${made.id}/send`, { cookie: o.cookie, body: { expectedUpdatedAt: v.updatedAt } }, e);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("numbering_changed");
      expect(await counter()).toBe(before);
    } finally {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'numbering'").run();
    }
  });

  it("V7: after any version is accepted, a later version cannot be sent and nothing changes", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run(); // acceptance arrives with M4.5
    const before = await counter();
    const view = await getDoc(o, v2.id);
    const res = await sendDoc(o, v2.id, view.updatedAt);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("already_accepted");
    expect(await counter()).toBe(before);
    expect((await dbRow(made.id))?.status).toBe("accepted");
    expect((await dbRow(v2.id))?.status).toBe("draft");
    expect(await audit("document.send", v2.id)).toBeNull();
  });

  it("a sent version is final: sending again is a 409 frozen and burns no number", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    await sendDoc(o, made.id, v.updatedAt);
    const before = await counter();
    const again = await sendDoc(o, made.id, v.updatedAt);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("frozen");
    expect(await counter()).toBe(before);
  });

  it("the issue date is the IST day of the send and the offer is valid through that day plus its validity", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await json(await patchDoc(o, made.id, { expectedUpdatedAt: (await getDoc(o, made.id)).updatedAt, fields: { validityDays: 10 } }));
    const sent = await json(await sendDoc(o, made.id, v.updatedAt));
    const row = await dbRow(made.id);
    const ist = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
    expect(row?.issue_date).toBe(ist);
    const until = new Date(Date.parse(`${ist}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(row?.valid_until).toBe(until);
    expect(sent.validUntil).toBe(until);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("what a send refuses [ADM-PROP-05, ADM-CAT-03]", () => {
  it("an unresolved placeholder, a missing title, no lines, missing sections, no schedule: 409 with the reasons; nothing is numbered", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    const before = await counter();
    const text = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: v.sections.map((s: J) => ({ id: s.id, kind: s.kind, title: s.title, bodyMd: s.kind === "estimate" ? "Dear {{client.name}} and {{ unknown.thing }}" : s.bodyMd })),
      }),
    );
    const res = await sendDoc(o, made.id, text.updatedAt);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("unresolved_placeholders");
    expect(body.reasons).toContainEqual({ code: "unresolved_placeholders", names: ["client.name", "unknown.thing"] });

    const empty = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: text.updatedAt,
        fields: { title: null },
        lines: [],
        schedule: [],
        sections: [{ kind: "estimate" }, { kind: "terms" }],
      }).then((r) => (r.status === 400 ? patchDoc(o, made.id, { expectedUpdatedAt: text.updatedAt, fields: { title: null }, lines: [], schedule: [] }) : r)),
    );
    const reasons = (await json(await sendDoc(o, made.id, empty.updatedAt))).reasons.map((r: J) => r.code);
    expect(reasons).toEqual(expect.arrayContaining(["title_required", "no_lines", "schedule_missing"]));
    expect(await counter()).toBe(before);
    expect((await dbRow(made.id))?.status).toBe("draft");
  });

  it("no proposal terms yet: terms_missing; and a content the person has not saved: content_changed", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    await env.DB.prepare("UPDATE documents SET terms_version_id = NULL WHERE id = ?").bind(made.id).run();
    // The terms are part of the content: save once so the stored hash follows, then the send is refused for the terms.
    const v = await json(await patchDoc(o, made.id, { expectedUpdatedAt: (await getDoc(o, made.id)).updatedAt }));
    const res = await sendDoc(o, made.id, v.updatedAt);
    expect(res.status).toBe(409);
    expect((await json(res)).reasons.map((r: J) => r.code)).toContain("terms_missing");
    // adopting the newest terms is a save
    const fixed = await json(await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, fields: { refreshTerms: true } }));
    expect((await sendDoc(o, made.id, fixed.updatedAt)).status).toBe(200);

    const other = await mkDraft(o, { price: 1_000_000 });
    const view = await getDoc(o, other.id);
    await env.DB.prepare("UPDATE clients SET state_code = '27' WHERE id = ?").bind(other.clientId).run(); // the tax moves, the stored hash does not
    const stale = await sendDoc(o, other.id, view.updatedAt);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("content_changed");
  });

  it("an anonymised contact or client is refused", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    await env.DB.prepare("UPDATE contacts SET anonymised_at = ?, name = 'Removed contact' WHERE id = ?").bind(Date.now(), made.contactId).run();
    const res = await sendDoc(o, made.id, v.updatedAt);
    expect(res.status).toBe(409);
    expect((await json(res)).reasons.map((r: J) => r.code)).toContain("contact_anonymised");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the lead moves with the first send [ADM-LEAD-02]", () => {
  async function leadDraft(stage: string) {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService();
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, { client_id: client.clientId, stage, ...(stage === "lost" ? { lost_reason: "price" } : {}) });
    const id = (await json(await call("/documents", { cookie: o.cookie, body: { type: "proposal", clientId: client.clientId, leadId: lead, services: [{ catalogueItemId: item.id }] } }))).id as string;
    return { o, lead, id, client };
  }

  it("v1 moves a new or qualified lead to proposal_sent with one timeline row; a won or lost lead is left alone", async () => {
    for (const stage of ["new", "qualified"]) {
      const { o, lead, id } = await leadDraft(stage);
      await sendDoc(o, id, (await getDoc(o, id)).updatedAt);
      expect(await one("SELECT stage FROM leads WHERE id = ?", lead), stage).toEqual({ stage: "proposal_sent" });
      expect(await rows("SELECT kind, actor_id FROM lead_activities WHERE lead_id = ? AND kind = 'stage'", lead)).toEqual([{ kind: "stage", actor_id: null }]);
    }
    for (const stage of ["won", "lost"]) {
      const { o, lead, id } = await leadDraft(stage);
      await sendDoc(o, id, (await getDoc(o, id)).updatedAt);
      expect(await one("SELECT stage FROM leads WHERE id = ?", lead), stage).toEqual({ stage });
      expect(await countOf("lead_activities", "lead_id = ? AND kind = 'stage'", lead)).toBe(0);
    }
  });

  it("a later version's send changes nothing on the lead", async () => {
    const { o, lead, id } = await leadDraft("qualified");
    await sendDoc(o, id, (await getDoc(o, id)).updatedAt);
    const v2 = await json(await call(`/documents/${id}/revise`, { cookie: o.cookie, body: {} }));
    await sendDoc(o, v2.id, (await getDoc(o, v2.id)).updatedAt);
    expect(await one("SELECT stage FROM leads WHERE id = ?", lead)).toEqual({ stage: "proposal_sent" });
    expect(await countOf("lead_activities", "lead_id = ? AND kind = 'stage'", lead)).toBe(1);
  });

  it("an estimate never moves a lead", async () => {
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate" });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, { client_id: made.clientId, stage: "qualified", proposal_id: made.id });
    await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
    expect(await one("SELECT stage FROM leads WHERE id = ?", lead)).toEqual({ stage: "qualified" });
  });
});
