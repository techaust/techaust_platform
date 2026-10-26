// The global search and invoices [ADM-G-05, ADM-INV-01; M5.1 B4]: an invoice number is found by the roles that may read invoices (owner, Staff, the accountant) and
// never by Sales; a draft has no number so it is never found; the read is an index range on the number; a proposal never shows up in the invoice group.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { INVOICES_SQL } from "./search.ts";
import { call, rows, sessionFor } from "./test-helpers.ts";
import {
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putCompany();
  await putBank();
});

const groupsOf = async (cookie: string, q: string) =>
  (await json(await call(`/search?q=${encodeURIComponent(q)}`, { cookie }))).groups as J[];

describe("search finds issued invoices by their number, for the roles that read invoices", () => {
  it("owner, Staff and the accountant find an issued and a void invoice; Sales gets no invoice group at all", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const a = await mkInvoice(o, { clientId: c.clientId });
    const b = await mkInvoice(o, { clientId: c.clientId });
    const na = (await json(await issueInvoice(o, a.id))).number as string;
    const nb = (await json(await issueInvoice(o, b.id))).number as string;
    expect((await voidInvoice(o, b.id)).status).toBe(200);
    for (const role of ["owner", "staff", "accountant"] as const) {
      const s = await sessionFor(role);
      const group = (await groupsOf(s.cookie, na)).find((g) => g.type === "invoice");
      expect(group?.label, role).toBe("Invoices");
      expect(group?.items, role).toEqual([
        { id: a.id, title: na, subtitle: "Tax invoice, issued", link: `/invoices/${a.id}` },
      ]);
      const voided = (await groupsOf(s.cookie, nb)).find((g) => g.type === "invoice");
      expect(voided?.items, role).toEqual([
        { id: b.id, title: nb, subtitle: "Tax invoice, void", link: `/invoices/${b.id}` },
      ]);
    }
    const sales = await sessionFor("sales");
    const groups = await groupsOf(sales.cookie, na);
    expect(groups.find((g) => g.type === "invoice")).toBeUndefined();
    expect(JSON.stringify(groups)).not.toContain(na);
  });

  it("a draft (no number) is not found; a proposal is not in the invoice group; the prefix matches several, at most five", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const draft = await mkInvoice(o, { clientId: c.clientId });
    expect(
      (await groupsOf(o.cookie, "TH/INV/")).flatMap((g) => g.items as J[]).map((i) => i.id),
    ).not.toContain(draft.id);
    await env.DB.prepare(
      "INSERT INTO documents (id, type, client_id, currency, version, series, fy, number, number_display, frozen_at, status, version_group_id) VALUES ('prop-srch', 'proposal', ?1, 'INR', 1, 'proposal', '2627', 7001, 'TH/INV/PROP-7001', 1, 'sent', 'prop-srch')",
    )
      .bind(c.clientId)
      .run();
    const found = (await groupsOf(o.cookie, "TH/INV/PROP-7001")).find((g) => g.type === "invoice");
    expect(found?.items ?? []).toEqual([]);
    for (let i = 0; i < 6; i++) {
      const m = await mkInvoice(o, { clientId: c.clientId });
      expect((await issueInvoice(o, m.id)).status).toBe(200);
    }
    const many = (await groupsOf(o.cookie, "TH/INV/")).find((g) => g.type === "invoice");
    expect(many?.items).toHaveLength(5);
  });

  it("the read is an index range on the number, never a scan of the documents table", async () => {
    const plan = await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${INVOICES_SQL}`, "TH/INV/", "TH/INV/￿");
    const text = plan.map((p) => p.detail).join(" | ");
    expect(text).toMatch(/documents_number_display/);
    expect(text).not.toMatch(/SCAN documents(?! USING)/);
  });
});
