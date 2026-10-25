// What the M4.3 screens needed from the API (designer, 2026-10-26; ADM-APR-01, 07-O §4): the owner's queue carries each draft's total
// and the decider's name, the document view names who requested and who decided, and the bell speaks 07-O's words ("Approval needed:
// {title} v{version}", "{Approved/Rejected}: {title} v{version}").
import { beforeAll, describe, expect, it } from "vitest";
import { bellDecidedTitle, bellRequestTitle } from "./approvals.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
import { discount, getDoc, type J, json, mkDraft, mkTerms, patchDoc } from "./test-quotes.ts";

const S9 = 20_000_000; // a catalogue price of 2,00,000 rupees in paise

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const request = (cookie: string, id: string, expectedUpdatedAt: number) =>
  call(`/documents/${id}/approval-request`, {
    cookie,
    body: { expectedUpdatedAt, reason: "Long-standing client" },
  });
const decide = (cookie: string, id: string, decision: "approve" | "reject", note?: string) =>
  call(`/approvals/${id}/decide`, { cookie, body: { decision, ...(note ? { note } : {}) } });

describe("the owner's queue and the approval names [ADM-APR-01; 07-O §4]", () => {
  it("each row carries the draft's total and, once decided, the decider's name; the view names both people", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const sales = await sessionFor("sales");
    const made = await mkDraft(sales, { price: S9 });
    const titled = await patchDoc(sales, made.id, {
      expectedUpdatedAt: made.updatedAt,
      fields: { title: "Tally pilot" },
    });
    expect(titled.status).toBe(200);
    const v = await discount(sales, made.id, "fixed", 5_000_000); // 25 % off the catalogue: 2500 bp
    const req = await request(sales.cookie, made.id, v.updatedAt);
    expect(req.status, await req.clone().text()).toBe(201);
    const approvalId = (await json(req)).id as string;

    const queued = await json(await call("/approvals?status=pending", { cookie: o.cookie }));
    const row = queued.approvals.find((a: J) => a.id === approvalId);
    expect(row.totalMinor).toBe(v.totals.totalMinor);
    expect(row.deciderName).toBeNull();
    expect(row.requesterName).toBe(sales.email);

    // the bell row of the request uses the title and the version
    const bell = await one<{ title: string; link: string }>(
      "SELECT title, link FROM notifications WHERE entity_id = ? AND kind = 'approval.requested'",
      approvalId,
    );
    expect(bell).toEqual({ title: "Approval needed: Tally pilot v1", link: `/approvals/${approvalId}` });

    expect((await decide(o.cookie, approvalId, "approve", "Fine")).status).toBe(200);
    const decided = await json(await call("/approvals", { cookie: o.cookie }));
    expect(decided.approvals.find((a: J) => a.id === approvalId).deciderName).toBe(o.email);
    const answer = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'approval.decided'",
      approvalId,
    );
    expect(answer?.title).toBe("Approved: Tally pilot v1");

    const view = await getDoc(sales, made.id);
    expect(view.approval).toMatchObject({
      state: "approved",
      requestedByName: sales.email,
      decidedByName: o.email,
    });
  });

  it("a draft pinned to older terms names the newest version, in GET and in the save answer (07-O §3)", async () => {
    const staff = await sessionFor("staff");
    const made = await mkDraft(staff);
    const newestId = await mkTerms();
    const newest = await one<{ version: number }>(
      "SELECT version FROM terms_versions WHERE id = ?",
      newestId,
    );
    const view = await getDoc(staff, made.id);
    expect(view.termsOutdated).toBe(true);
    expect(view.newestTermsVersion).toBe(newest?.version);
    const saved = await json(
      await patchDoc(staff, made.id, { expectedUpdatedAt: view.updatedAt, fields: { title: "Terms check" } }),
    );
    expect(saved.newestTermsVersion).toBe(newest?.version);
    const adopted = await json(
      await patchDoc(staff, made.id, { expectedUpdatedAt: saved.updatedAt, fields: { refreshTerms: true } }),
    );
    expect([adopted.termsOutdated, adopted.terms.version]).toEqual([false, newest?.version]);
  });

  it("the bell words for a draft with no title, and for a rejection", () => {
    expect(bellRequestTitle(null, 3)).toBe("Approval needed: Untitled v3");
    expect(bellDecidedTitle("rejected", "Website rebuild", 2)).toBe("Rejected: Website rebuild v2");
    expect(bellDecidedTitle("approved", "x".repeat(200), 1)).toBe(`Approved: ${"x".repeat(120)} v1`);
  });
});
