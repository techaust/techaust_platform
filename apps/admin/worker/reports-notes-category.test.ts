// M7.3 early check 2 (ADM-REP-01; run file C1, L8): revenue by category over notes made through the REAL routes, not hand-written `header_extras`. An invoice of two
// lines in two categories, then a lines-mode credit note, an amount-mode credit note (spread over both lines) and a tax-only debit note ("Tax charged too low",
// taxable 0), each drafted and issued as the SPA does. A note's lines carry no catalogue item (M5.3 `noteLines`), so each note line must land in the category of
// the parent line its take came from (`header_extras.noteOf.request.takes`), and nothing may fall into "Not from the catalogue". Invented test data only.
import { env } from "cloudflare:workers";
import { fyOf } from "@techaust/core/dates";
import type { RevenueByKey } from "@techaust/core/reports";
import { INVOICED_SQL } from "@techaust/db/reports";
import { beforeEach, describe, expect, it } from "vitest";
import { call } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { farSession, issueInvoice, json, mkInvoiceClient, putBank, putCompany } from "./test-invoices.ts";
import { draftCredit, draftDebit, issueCredit, issueDebit } from "./test-notes.ts";
import { mkService } from "./test-quotes.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});

type Take = { line: number; taxableMinor: number };

describe("revenue by category over notes made through the routes (early check 2) [ADM-REP-01]", () => {
  it("each note line takes its parent line's category: lines mode, amount mode and a tax-only debit note", async () => {
    const o = await farSession("owner");
    // the parent: line 0 "build" (1,000.00), line 1 "run" (500.00), both priced by their own catalogue service
    const run = await mkService(50_000, { category: "run" });
    const client = await mkInvoiceClient();
    const build = await mkService(100_000, { category: "build" });
    const res = await call("/invoices", {
      cookie: o.cookie,
      body: {
        clientId: client.clientId,
        services: [{ catalogueItemId: build.id }, { catalogueItemId: run.id }],
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const inv = await json(res);
    const issued = await issueInvoice(o, inv.id);
    expect(issued.status, await issued.clone().text()).toBe(200);

    // a lines-mode credit note on line 1 ("run") only
    const linesCredit = await issueCredit(o, inv.id, {
      mode: "lines",
      lines: [{ line: 1, taxableMinor: 10_000 }],
    });
    // an amount-mode credit note: the engine spreads it over both lines
    const amountDraft = await draftCredit(o, inv.id, { mode: "amount", grossMinor: 17_700 });
    expect(amountDraft.status, await amountDraft.clone().text()).toBe(201);
    const amount = await json(amountDraft);
    expect(amount.request.mode).toBe("amount");
    const amountTakes = amount.request.takes as Take[];
    expect((await issueInvoice(o, amount.id)).status).toBe(200);
    // a tax-only debit note: taxable 0, the tax over the invoice's heads
    const taxOnly = await draftDebit(o, inv.id, { reasonCode: "tax_charged_too_low", taxAmountMinor: 1_800 });
    expect(taxOnly.status, await taxOnly.clone().text()).toBe(201);
    const debit = await json(taxOnly);
    expect((await issueInvoice(o, debit.id)).status).toBe(200);
    // a lines-mode debit note on line 0 ("build"): its own lines renumber the computed index (M7.3 Step 0.3), the takes still name the parent line
    const linesDebit = await issueDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 5_000 }] });

    // every note's lines, as stored: none carries a catalogue item, so only the takes can give the category
    const noteIds = [linesCredit.id, amount.id, debit.id, linesDebit.id];
    const noteLines = await env.DB.prepare(
      `SELECT d.id, d.type, l.position, l.catalogue_item_id, l.taxable_minor, json_extract(d.header_extras, '$.noteOf.request.takes') AS takes
       FROM documents d JOIN document_lines l ON l.document_id = d.id WHERE d.id IN (SELECT value FROM json_each(?1)) ORDER BY d.id, l.position`,
    )
      .bind(JSON.stringify(noteIds))
      .all<{
        id: string;
        type: string;
        position: number;
        catalogue_item_id: string | null;
        taxable_minor: number;
        takes: string;
      }>();
    expect(noteLines.results.every((l) => l.catalogue_item_id === null)).toBe(true);
    // the rule the SQL relies on: a note's line n was made from take n − 1 (the takes are stored in line order, one note line per take)
    for (const id of noteIds) {
      const ls = noteLines.results.filter((l) => l.id === id);
      const takes = JSON.parse(ls[0]?.takes ?? "[]") as Take[];
      expect(ls.length, `${id}: one line per take`).toBe(takes.length);
      for (const l of ls) {
        const take = takes[l.position - 1] as Take;
        // a tax-only debit note's lines are taxable 0; every other note line is its take's taxable value
        expect(l.taxable_minor, `${id} line ${l.position}`).toBe(
          l.type === "debit_note" && id === debit.id ? 0 : take.taxableMinor,
        );
      }
    }

    // what the categories must be, from the requests alone: line 0 is "build", line 1 is "run"
    const categoryOf = (line: number) => (line === 0 ? "build" : "run");
    const expected = { build: 100_000, run: 50_000 } as Record<string, number>;
    expected.run = (expected.run as number) - 10_000;
    for (const t of amountTakes)
      expected[categoryOf(t.line)] = (expected[categoryOf(t.line)] as number) - t.taxableMinor;
    expected.build = (expected.build as number) + 5_000;

    const fy = fyOf(Date.now());
    const report = await call(`/reports/revenue?fy=${fy.token}&by=category`, { cookie: o.cookie });
    expect(report.status, await report.clone().text()).toBe(200);
    const body = (await report.json()) as RevenueByKey<string>;
    const inr = (key: string) =>
      body.rows.find((r) => r.key === key)?.invoiced.find((x) => x.currency === "INR");
    expect(inr("build")?.taxableMinor).toBe(expected.build);
    expect(inr("run")?.taxableMinor).toBe(expected.run);
    expect(inr("none")).toBeUndefined(); // no note line fell out of its category
    // and Σ categories + round-off = the FY's invoiced figure (the dashboard's statement), totals with GST included
    const invoiced = await env.DB.prepare(INVOICED_SQL)
      .bind(`${fy.startYear}-04-01`, `${fy.startYear + 1}-03-31`, `${fy.startYear}-04-01`)
      .all<{ currency: string; fy_taxable: number; fy_total: number }>();
    const fyInr = invoiced.results.find((r) => r.currency === "INR");
    const rows = body.rows.flatMap((r) => r.invoiced.filter((x) => x.currency === "INR"));
    const roundOff = body.roundOff?.find((r) => r.currency === "INR")?.roundOffMinor ?? 0;
    expect(rows.reduce((a, r) => a + r.taxableMinor, 0)).toBe(fyInr?.fy_taxable);
    expect(rows.reduce((a, r) => a + r.totalMinor, 0) + roundOff).toBe(fyInr?.fy_total);
  });
});
