// M7.3 C7 (ADM-G-05; run file I "Search", L15): `GET /documents?q=` finds proposals and estimates by a number prefix (upper-cased) or a client's code or name
// prefix (no case), the latest version of each group only; an invoice number never matches; an anonymised client is not found by its old name; the keyset and the
// other filters still apply; each statement is driven by its index (EXPLAIN). Invented test data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { searchStatement } from "./documents.ts";
import { insert, mkClient } from "./test-clients.ts";
import { call, sessionFor, type TestSession } from "./test-helpers.ts";
import type { J } from "./test-invoices.ts";

let owner: TestSession;
let n = 0;
const ids: Record<string, string> = {};

async function offer(o: {
  client: string;
  type?: "proposal" | "estimate" | "tax_invoice";
  number?: string | null;
  group?: string;
  version?: number;
  status?: string;
  at: number;
}) {
  const id = uuidv7();
  n++;
  const frozen = o.number !== null && o.number !== undefined;
  await insert("documents", {
    id,
    type: o.type ?? "proposal",
    status: o.status ?? (frozen ? "sent" : "draft"),
    client_id: o.client,
    currency: "INR",
    version_group_id: o.type === "tax_invoice" ? null : (o.group ?? id),
    version: o.version ?? 1,
    taxable_minor: 1_000,
    total_minor: 1_180,
    valid_until: "2026-12-31",
    series: frozen ? (o.type === "tax_invoice" ? "invoice" : (o.type ?? "proposal")) : null,
    fy: frozen ? "2627" : null,
    number: frozen ? n : null,
    number_display: o.number ?? null,
    frozen_at: frozen ? o.at : null,
    sent_at: frozen && o.type !== "tax_invoice" ? o.at : null,
    issue_date: o.type === "tax_invoice" ? "2026-10-01" : null,
    created_at: o.at,
    updated_at: o.at,
  });
  return id;
}

const search = async (q: string, s: TestSession = owner, extra = "") => {
  const res = await call(`/documents?q=${encodeURIComponent(q)}${extra}`, { cookie: s.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { documents: J[]; next: string | null };
};
const idsOf = (b: { documents: J[] }) => b.documents.map((d) => d.id as string);

beforeAll(async () => {
  owner = await sessionFor("owner");
  const acme = await mkClient({
    code: "ACM01",
    display_name: "Acme Traders",
    legal_name: "Acme Traders Pvt Ltd",
  });
  const bolt = await mkClient({ code: "BLT01", display_name: "Bolt Works", legal_name: "Bolt Works" });
  const gone = await mkClient({
    code: "GNE01",
    display_name: "Anonymised client",
    legal_name: "Anonymised client",
    anonymised_at: 5,
  });
  ids.acme = acme;
  ids.p1 = await offer({ client: bolt, number: "PR/2627/0007", at: 1_000 });
  // a group: v1 numbered, v2 a draft with no number of its own (the list shows v2 only)
  ids.g1 = await offer({ client: bolt, number: "PR/2627/0012", status: "revised", at: 2_000 });
  ids.g2 = await offer({ client: bolt, group: ids.g1, version: 2, number: null, at: 3_000 });
  ids.est = await offer({ client: acme, type: "estimate", number: "ES/2627/0003", at: 4_000 });
  ids.acmeDraft = await offer({ client: acme, number: null, at: 5_000 });
  ids.goneOffer = await offer({ client: gone, number: "PR/2627/0099", at: 6_000 });
  // an invoice whose number starts like a proposal's: never in the list
  ids.inv = await offer({
    client: bolt,
    type: "tax_invoice",
    number: "PR/2627/0001",
    status: "issued",
    at: 7_000,
  });
});

describe("GET /documents?q= (C7) [ADM-G-05]", () => {
  it("a number prefix, in any case: the latest version of each matching group; an invoice number never", async () => {
    expect(idsOf(await search("pr/2627/001")).sort()).toEqual([ids.g2]);
    expect(idsOf(await search("PR/2627/00")).sort()).toEqual([ids.p1, ids.g2, ids.goneOffer].sort());
    expect(idsOf(await search("ES/"))).toEqual([ids.est]);
    expect(idsOf(await search("PR/2627/0001"))).toEqual([]);
  });

  it("a client's name (no case) or code prefix: its proposals and estimates, drafts included", async () => {
    expect(idsOf(await search("acme"))).toEqual([ids.acmeDraft, ids.est]);
    expect(idsOf(await search("ACME TR"))).toEqual([ids.acmeDraft, ids.est]);
    expect(idsOf(await search("acm0"))).toEqual([ids.acmeDraft, ids.est]);
    expect(idsOf(await search("blt"))).toEqual([ids.g2, ids.p1]);
    expect(idsOf(await search("zzz"))).toEqual([]);
  });

  it("an anonymised client is not found by its old name; the type, status and client filters and the keyset still apply", async () => {
    await env.DB.prepare("UPDATE clients SET display_name = 'Anonymised client' WHERE id = ?1")
      .bind(ids.acme)
      .run();
    expect(idsOf(await search("Acme"))).toEqual([]);
    await env.DB.prepare("UPDATE clients SET display_name = 'Acme Traders' WHERE id = ?1")
      .bind(ids.acme)
      .run();
    expect(idsOf(await search("acme", owner, "&type=estimate"))).toEqual([ids.est]);
    expect(idsOf(await search("PR/", owner, "&status=draft"))).toEqual([ids.g2]);
    expect(idsOf(await search("PR/", owner, `&clientId=${ids.acme}`))).toEqual([]);
    const first = await search("PR/", owner, "&limit=25");
    expect(first.next).toBeNull();
  });

  it("Sales finds offers only; a blank or over-long text is 400", async () => {
    const sales = await sessionFor("sales");
    expect(idsOf(await search("PR/2627", sales))).not.toContain(ids.inv);
    for (const q of ["%20%20", "x".repeat(41)])
      expect((await call(`/documents?q=${q}`, { cookie: owner.cookie })).status, q).toBe(400);
  });

  it("pages: the keyset continues after the last row, a document found both ways is one row", async () => {
    const c = await mkClient({ code: "PRX01", display_name: "PR Search Co", legal_name: "PR Search Co" });
    for (let i = 0; i < 27; i++)
      await offer({ client: c, number: `PR/2627/5${String(i).padStart(3, "0")}`, at: 10_000 + i });
    // "PR" matches these 27 by number AND by the client's code and name
    const p1 = await search("PR", owner, "&limit=25");
    expect(p1.documents).toHaveLength(25);
    expect(new Set(idsOf(p1)).size).toBe(25);
    const p2 = await search("PR", owner, `&limit=25&after=${p1.next}`);
    const all = [...idsOf(p1), ...idsOf(p2)];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(ids.inv);
  });

  it("each statement is driven by its index range (EXPLAIN)", async () => {
    for (const by of ["number", "client"] as const) {
      const s = searchStatement(by, "proposal", "Ac", { cursor: { k: 5, id: "x" } });
      const plan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${s.sql} 26`)
          .bind(...s.binds)
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
      if (by === "number") {
        expect(plan).toMatch(/documents_number_display \(number_display>\? AND number_display<\?\)/);
        expect(plan).toMatch(/documents_version/);
      } else {
        expect(plan).toMatch(/clients_name_nocase/);
        expect(plan).toMatch(/clients_code/);
        expect(plan).toMatch(/documents_client_type_status/);
      }
      expect(plan, plan).not.toMatch(/SCAN d\b|SCAN documents\b|SCAN clients\b/);
    }
  });
});
