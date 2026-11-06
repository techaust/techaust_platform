// M7.5 (A2 findings A and C, L17): the D1 budget of the advance invoice and of the stale-link cancel. The advance invoice's lines (the proforma's SAC/rate
// groups, up to MAX_GROUPS) are ONE `json_each` statement, so with 8 groups both the Owner's route and the gateway's automatic advance stay within the
// house rule of 45 statements; the stale-link cancel makes at most 10 gateway calls and 10 D1 calls per invocation. All data is made up.
import { env } from "cloudflare:workers";
import { advanceLinesJson } from "@techaust/db/issue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent, STALE_CANCEL_MAX, staleCanceller } from "./gateway/events.ts";
import type { RazorpayApi } from "./gateway/razorpay.ts";
import { countingEnv, eventRow, issued, linkFor, owner, stub } from "./test-gateway.ts";
import { call, rows } from "./test-helpers.ts";
import { putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { putBank, putCompany } from "./test-invoices.ts";
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
