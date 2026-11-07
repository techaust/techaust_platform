// M7.5 (A2 findings A and C, L17): the D1 budget of the advance invoice and of the stale-link cancel. The advance invoice's lines (the proforma's SAC/rate
// groups, up to MAX_GROUPS) are ONE `json_each` statement, so with 8 groups both the Owner's route and the gateway's automatic advance stay within the
// house rule of 45 statements; the stale-link cancel makes at most 10 gateway calls and 10 D1 calls per invocation. All data is made up.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { type AdvanceLine, advanceLinesJson, advanceLinesStatement } from "@techaust/db/issue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent, STALE_CANCEL_MAX, staleCanceller } from "./gateway/events.ts";
import type { RazorpayApi } from "./gateway/razorpay.ts";
import { countingEnv, eventRow, issued, linkFor, owner, stub } from "./test-gateway.ts";
import { call, rows } from "./test-helpers.ts";
import { putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { mkInvoice, putBank, putCompany } from "./test-invoices.ts";
import { mkService } from "./test-quotes.ts";

/** The house rule (T7): at most 45 D1 statements per invocation (D1 Free allows 50 queries; docs read 2026-11-07). */
const HOUSE_STATEMENTS = 45;
const SACS = ["998311", "998312", "998313", "998314", "998315", "998316", "998319", "998391"];

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(() => {
  setStubTransport(null);
  vi.restoreAllMocks();
});

/** Eight services, one per SAC: a proforma with eight SAC/rate groups. */
const eightGroups = async () =>
  Promise.all(
    SACS.map(async (sac, i) => ({ catalogueItemId: (await mkService(10_000 + i * 1_000, { sac })).id })),
  );

const linesOf = (documentId: string) =>
  rows<{
    position: number;
    sac: string;
    taxable_minor: number;
    line_total_minor: number;
    qty_milli: number;
    gst_rate_bp: number;
  }>(
    "SELECT position, sac, taxable_minor, line_total_minor, qty_milli, gst_rate_bp FROM document_lines WHERE document_id = ?1 ORDER BY position",
    documentId,
  );

describe("L17 A: the advance invoice with 8 SAC/rate groups stays within 45 statements", () => {
  it("the Owner's route: one statement for all 8 lines, each line as the split made it", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma", { services: await eightGroups() });
    const { env: e, counter } = countingEnv();
    counter.n = 0;
    const res = await call(
      `/invoices/${pf.id}/advance-invoice`,
      {
        cookie: o.cookie,
        body: {
          expectedProformaUpdatedAt: pf.updatedAt,
          amountMinor: pf.total,
          receivedOn: todayIso(),
          reference: `UTR M75 ${Date.now()}`,
        },
      },
      e,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    console.log(`D1 statements, advance invoice (Owner, 8 groups): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(HOUSE_STATEMENTS);
    const id = ((await res.json()) as { id: string }).id;
    const lines = await linesOf(id);
    expect(lines).toHaveLength(8);
    expect(lines.map((l) => l.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(lines.map((l) => l.sac))).toEqual(new Set(SACS));
    for (const l of lines) {
      expect(Number.isInteger(l.taxable_minor) && Number.isInteger(l.line_total_minor)).toBe(true);
      expect(typeof l.qty_milli).toBe("number");
    }
    // L35: every column's storage class on the issued lines, through the real route
    const stored = await storedLines(id, 1);
    expect(stored).toHaveLength(8);
    for (const row of stored) {
      expect(row.document_id).toBe(id);
      for (const [column] of LINE_COLUMNS)
        expect(ROUTE_CLASSES[column], `typeof(${column})`).toContain(row[`t_${column}`]);
    }
    const doc = (
      await rows<{ total_minor: number; taxable_minor: number; round_off_minor: number }>(
        "SELECT total_minor, taxable_minor, round_off_minor FROM documents WHERE id = ?1",
        id,
      )
    )[0];
    // the lines add up to the total before its round-off
    expect(lines.reduce((s, l) => s + l.line_total_minor, 0) + (doc?.round_off_minor ?? 0)).toBe(
      doc?.total_minor,
    );
    expect(lines.reduce((s, l) => s + l.taxable_minor, 0)).toBe(doc?.taxable_minor);
  });

  it("the gateway's automatic advance (a proforma paid by Razorpay): within 45 too", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma", { services: await eightGroups() });
    const l = await linkFor(o, pf);
    const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
    const { env: e, counter } = countingEnv();
    counter.n = 0;
    expect((await issueGatewayAdvance(e, r.next?.paymentId as string)).result).toBe("issued");
    console.log(`D1 statements, issueGatewayAdvance (8 groups): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(HOUSE_STATEMENTS);
    const child = await rows<{ id: string }>("SELECT id FROM documents WHERE parent_id = ?1", pf.id);
    expect(child).toHaveLength(1);
    expect(await linesOf((child[0] as { id: string }).id)).toHaveLength(8);
  });

  it("advanceLinesJson carries exactly the line fields and refuses a non-integer amount", () => {
    const line = {
      id: "l1",
      position: 1,
      description: "Payment received",
      detail: null,
      sac: "998314",
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 100,
      taxableMinor: 100,
      gstRateBp: 1800,
      cgstMinor: 9,
      sgstMinor: 9,
      igstMinor: 0,
      lineTotalMinor: 118,
    };
    expect(JSON.parse(advanceLinesJson([{ ...line, extra: "x" } as typeof line]))).toEqual([line]);
    expect(() => advanceLinesJson([{ ...line, taxableMinor: 1.5 }])).toThrow(RangeError);
  });
});

// ---- L35 (the early check's F4): every column of the one-statement insert, value and storage class ------------------------------------------------------

/** The 15 columns the advance insert writes, in its order, with the AdvanceLine field each comes from (`document_id` is the statement's own ?1). */
const LINE_COLUMNS = [
  ["id", "id"],
  ["document_id", null],
  ["position", "position"],
  ["description", "description"],
  ["detail", "detail"],
  ["sac", "sac"],
  ["qty_milli", "qtyMilli"],
  ["unit", "unit"],
  ["rate_minor", "rateMinor"],
  ["taxable_minor", "taxableMinor"],
  ["gst_rate_bp", "gstRateBp"],
  ["cgst_minor", "cgstMinor"],
  ["sgst_minor", "sgstMinor"],
  ["igst_minor", "igstMinor"],
  ["line_total_minor", "lineTotalMinor"],
] as const satisfies readonly (readonly [string, keyof AdvanceLine | null])[];

/** Every column and its `typeof()`, by position, for one document. */
const storedLines = (documentId: string, fromPosition = 100) =>
  rows<Record<string, unknown>>(
    `SELECT ${LINE_COLUMNS.map(([c]) => `${c}, typeof(${c}) AS t_${c}`).join(", ")} FROM document_lines WHERE document_id = ?1 AND position >= ?2 ORDER BY position`,
    documentId,
    fromPosition,
  );

/** The storage class each column must have on an issued advance invoice (`detail` is text or null). */
const ROUTE_CLASSES: Record<(typeof LINE_COLUMNS)[number][0], readonly string[]> = {
  id: ["text"],
  document_id: ["text"],
  position: ["integer"],
  description: ["text"],
  detail: ["text", "null"],
  sac: ["text"],
  qty_milli: ["integer"],
  unit: ["text"],
  rate_minor: ["integer"],
  taxable_minor: ["integer"],
  gst_rate_bp: ["integer"],
  cgst_minor: ["integer"],
  sgst_minor: ["integer"],
  igst_minor: ["integer"],
  line_total_minor: ["integer"],
};

/** SQLite's storage class of a JS value as the lines carry it (integers, strings, null: the conventions allow nothing else). */
const storageOf = (v: unknown) =>
  v === null ? "null" : typeof v === "string" ? "text" : Number.isInteger(v) ? "integer" : "real";

/** The pre-L17 path: one INSERT per line with bound values, as the batch did before `json_each`. */
const boundInsert = (documentId: string, l: AdvanceLine) =>
  env.DB.prepare(
    `INSERT INTO document_lines (id, document_id, position, description, detail, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp,
       cgst_minor, sgst_minor, igst_minor, line_total_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
  ).bind(
    l.id,
    documentId,
    l.position,
    l.description,
    l.detail,
    l.sac,
    l.qtyMilli,
    l.unit,
    l.rateMinor,
    l.taxableMinor,
    l.gstRateBp,
    l.cgstMinor,
    l.sgstMinor,
    l.igstMinor,
    l.lineTotalMinor,
  );

describe("L35: the advance lines' one-statement insert stores every column as the lines say", () => {
  const made = (position: number, over: Partial<AdvanceLine>): AdvanceLine => ({
    id: uuidv7(),
    position,
    description: "Payment received",
    detail: null,
    sac: "998314",
    qtyMilli: 1000,
    unit: "fixed",
    rateMinor: 100_000,
    taxableMinor: 100_000,
    gstRateBp: 1800,
    cgstMinor: 9_000,
    sgstMinor: 9_000,
    igstMinor: 0,
    lineTotalMinor: 118_000,
    ...over,
  });
  const lines = (): AdvanceLine[] => [
    // detail NULL, a description with double and single quotes
    made(100, { description: `Advance for "Website rebuild", the client's 'first' stage` }),
    // detail set, a newline, a tab, a backslash and non-ASCII text (Devanagari, Bengali, the rupee sign, an em dash, an emoji) in both
    made(101, {
      description: "Advance — ₹ 50 %\nदूसरी पंक्ति \\ বাংলা\t😀",
      detail: 'Line one\nLine "two" — ₹ ১২৩\r\nthird',
      sac: "998311",
      gstRateBp: 500,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 5_000,
      lineTotalMinor: 105_000,
    }),
    // an empty detail stays an empty string (never NULL); amounts beyond 32 bits stay integers; zero rate
    made(102, {
      detail: "",
      qtyMilli: 2_500,
      unit: "hour",
      rateMinor: 4_000_000_000,
      taxableMinor: 10_000_000_000,
      gstRateBp: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      lineTotalMinor: 10_000_000_000,
    }),
  ];

  it("every value and every typeof() of all 15 columns equals the AdvanceLine, and the pre-L17 bound insert stores exactly the same", async () => {
    const o = await owner();
    const viaJson = await mkInvoice(o);
    const viaBound = await mkInvoice(o);
    const ls = lines();
    await advanceLinesStatement(env.DB, viaJson.id, ls).run();
    await env.DB.batch(ls.map((l) => boundInsert(viaBound.id, { ...l, id: uuidv7() })));
    const stored = await storedLines(viaJson.id);
    expect(stored).toHaveLength(ls.length);
    for (const [i, l] of ls.entries()) {
      const row = stored[i] as Record<string, unknown>;
      for (const [column, field] of LINE_COLUMNS) {
        const want = field === null ? viaJson.id : l[field];
        expect(row[column], `${column} of line ${l.position}`).toStrictEqual(want);
        expect(row[`t_${column}`], `typeof(${column}) of line ${l.position}`).toBe(storageOf(want));
      }
    }
    // the old path, column for column (the ids and the document differ by construction)
    const bound = await storedLines(viaBound.id);
    const strip = (r: Record<string, unknown>) => {
      const { id: _i, document_id: _d, ...rest } = r;
      return rest;
    };
    expect(bound.map(strip)).toStrictEqual(stored.map(strip));
  });

  it("an empty list inserts nothing", async () => {
    const o = await owner();
    const doc = await mkInvoice(o);
    await advanceLinesStatement(env.DB, doc.id, []).run();
    expect(await storedLines(doc.id)).toEqual([]);
  });
});

describe("L17 C: the stale-link cancel is capped at 10 per invocation", () => {
  it("13 stale links: 10 gateway calls and 10 D1 calls, one line naming how many were left", async () => {
    let cancels = 0;
    const api = {
      cancelLink: async () => {
        cancels++;
        return { ok: false as const, code: "gateway_unavailable" };
      },
    } as unknown as RazorpayApi;
    const { env: e, counter } = countingEnv();
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const links = Array.from({ length: 13 }, (_, i) => ({ id: `chk-${i}`, linkId: `plink_${i}` }));
    await staleCanceller(e as never, api, Date.now())(links);
    expect(STALE_CANCEL_MAX).toBe(10);
    expect(cancels).toBe(10);
    expect(counter.n).toBe(0); // a failed cancel writes nothing; a successful one writes one row (below)
    expect(
      logs.mock.calls
        .map((x) => String(x[0]))
        .some((x) => x.includes('"stale_cancel_capped"') && x.includes('"left":3')),
    ).toBe(true);
    const ok = { cancelLink: async () => ({ ok: true as const, value: null }) } as unknown as RazorpayApi;
    counter.n = 0;
    await staleCanceller(e as never, ok, Date.now())(links);
    expect(counter.n).toBe(10);
  });
});
