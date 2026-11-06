// M7.3's screen rules and words (run file H; ADM-REP-01, -02, -03, -05; ADM-DASH-01; ADM-G-05): the copy placed word for word, the C22 delta sentence, months and
// FY labels, "Total in INR" only from INR values, the billed state, and the CSVs built from the screen's data.
import { describe, expect, it } from "vitest";
import { DOC_PENDING } from "./documents.ts";
import {
  AGEING_COPY,
  AGEING_LABELS,
  ageingCsv,
  BAND_LABELS,
  billedText,
  CARE_HOURS_COPY,
  careHoursCsv,
  csvAmount,
  DASH_M73,
  deltaText,
  fyLabel,
  KIND_LABELS,
  M73_TITLES,
  monthChoices,
  monthName,
  monthShort,
  PIPELINE_COPY,
  pipelineCsv,
  REVENUE_COPY,
  rateText,
  revenueClientsCsv,
  sumMinor,
  totalInInr,
  yearInInr,
} from "./m73-reports.ts";
import { REPORTS } from "./reports.ts";

describe("copy C1 to C24 (run file H), word for word", () => {
  it("names the four reports (C1 to C4) in the index and the titles alike", () => {
    expect(M73_TITLES).toEqual({
      revenue: "Revenue and collections",
      ageing: "Outstanding and ageing",
      pipeline: "Pipeline and win rate",
      careHours: "Care plan hours",
    });
    const byKey = Object.fromEntries(REPORTS.map((r) => [r.key, r.label]));
    expect(byKey.revenue).toBe(M73_TITLES.revenue);
    expect(byKey.ageing).toBe(M73_TITLES.ageing);
    expect(byKey.pipeline).toBe(M73_TITLES.pipeline);
    expect(byKey["care-hours"]).toBe(M73_TITLES.careHours);
  });

  it("places C5 to C11, C20, C21", () => {
    expect([R.month, R.invoicedBefore, R.invoicedWith, R.collected, R.tds, R.refunded]).toEqual([
      "Month",
      "Invoiced (before GST)",
      "Invoiced (with GST)",
      "Collected",
      "TDS deducted",
      "Refunded",
    ]);
    expect(R.inrNote).toBe(
      "INR equivalent: invoices at the rate on the invoice; payments at the INR amount on the bank advice.",
    );
    // review 1, finding 5: payments and refunds alike, the singular apart (lead's words)
    expect(R.inrMissing(3)).toBe(
      "3 USD payments or refunds have no INR amount recorded, so the INR total is not shown.",
    );
    expect(R.inrMissing(1)).toBe(
      "1 USD payment or refund has no INR amount recorded, so the INR total is not shown.",
    );
    // the lead's triage of D1, Q3 (the same singular rule)
    expect(R.invoicedInrMissing(2)).toBe("2 USD invoices have no INR value, so the INR total is not shown.");
    expect(R.invoicedInrMissing(1)).toBe("1 USD invoice has no INR value, so the INR total is not shown.");
    expect(R.lede).toBe(
      "Management figures, not a GST return. Credit notes count on the day they are issued.",
    );
    expect(Object.values(KIND_LABELS)).toEqual(["Care plans (recurring)", "Projects", "Other"]);
    expect(R.noCategory).toBe("Not from the catalogue");
    expect(R.categoryNote).toBe("A service's category is today's category in the catalogue.");
    expect(R.empty("2026-27")).toBe("Nothing invoiced in 2026-27.");
    expect(R.exportCsv).toBe("Export CSV");
  });

  it("places C12, C13, C20 (ageing)", () => {
    expect([...Object.values(AGEING_LABELS), AGEING_COPY.creditHeld, AGEING_COPY.statement]).toEqual([
      "Not yet due",
      "1–30 days",
      "31–60 days",
      "61–90 days",
      "Over 90 days",
      "Credit held",
      "Statement",
    ]);
    expect(AGEING_COPY.lede("06 Nov 2026")).toBe(
      "As at today (06 Nov 2026). Credit held is shown apart and is not taken off the amounts due.",
    );
    expect(AGEING_COPY.empty).toBe("Nothing outstanding.");
  });

  it("places C14, C15, C20, C24 (pipeline)", () => {
    expect([P.leads, P.won, P.conversion, P.winRate, P.medianToWin]).toEqual([
      "Leads in this period",
      "Won",
      "Conversion",
      "Offer win rate",
      "Median time to win",
    ]);
    expect(P.retention).toBe(
      "Leads are deleted 12 months after their last activity, so older periods are not shown.",
    );
    expect(P.empty).toBe("No leads in this period.");
    // review 1, finding 1: each block's own empty line (drafted by D2 for the re-check)
    expect([P.emptyLost, P.emptySources, P.emptyWins]).toEqual([
      "No leads were lost in this period.",
      "No lead sources recorded in this period.",
      "No wins in this period.",
    ]);
    expect(P.usdNote).toBe(
      "USD offers are shown in USD: an offer has no exchange rate until it is invoiced.",
    );
    expect(Object.keys(BAND_LABELS)).toEqual(["d0_7", "d8_30", "d31_90", "d90_plus"]);
  });

  it("places C17 to C20, C18b and the month line (care hours)", () => {
    const C = CARE_HOURS_COPY;
    expect([C.period, C.included, C.used, C.over, C.billedOn]).toEqual([
      "Period",
      "Included",
      "Used",
      "Over",
      "Billed on",
    ]);
    expect(C.notBilled).toBe("Not billed yet");
    expect(C.discarded).toBe("Draft discarded");
    expect(C.overageNote).toBe("Overage is priced on the care invoice.");
    expect(C.empty).toBe("No active care plans this month.");
    expect(C.monthInvalid).toBe("Choose a month up to this one");
    // review 1, finding 6 (lead's words)
    expect(C.starts("15 Nov 2026")).toBe("Starts 15 Nov 2026");
  });

  it("names the leads sparkline by the day of its last nightly count (review 1, finding 12)", () => {
    expect(DASH_M73.trendLabel(4, 6, "05 Nov 2026")).toBe(
      "Open leads over the last 30 days: 4 then, 6 on 05 Nov 2026",
    );
  });

  it("places C23 on the offer list's search, and its no-match line (lead's triage of D1, Q2)", () => {
    expect(DOC_PENDING.searchNumberOrClient).toBe("Search by number or client");
    expect(`${DOC_PENDING.searchNoMatchTitle}. ${DOC_PENDING.searchNoMatchBody}`).toBe(
      "No proposals or estimates match. Search for the start of a number, a client code or a client name.",
    );
  });
});

const R = REVENUE_COPY;
const P = PIPELINE_COPY;

describe("C22: a figure against the previous month, in words", () => {
  it("says more, less or the same, with the amount through core and never a minus sign", () => {
    expect(deltaText(1_250_000, "INR", "October 2026")).toBe("₹12,500.00 more than October 2026");
    expect(deltaText(-1_250_000, "INR", "October 2026")).toBe("₹12,500.00 less than October 2026");
    expect(deltaText(0, "USD", "March 2026")).toBe("Same as March 2026");
    expect(deltaText(-50, "USD", "March 2026")).toBe("$0.50 less than March 2026");
  });
});

describe("months and years", () => {
  it("names months and FYs", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(monthName("2026-01-01")).toBe("January 2026");
    expect(monthName("bad")).toBe("bad");
    expect(monthShort("2027-03")).toBe("Mar");
    expect(fyLabel("2627")).toBe("2026-27");
  });

  it("offers this month and the eleven before it, newest first, across a year end", () => {
    const m = monthChoices("2026-02-14");
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ value: "2026-02", label: "February 2026" });
    expect(m[1]?.value).toBe("2026-01");
    expect(m[2]?.value).toBe("2025-12");
    expect(m[11]?.value).toBe("2025-03");
  });
});

describe("figures", () => {
  it("adds one currency's minor units through core", () => {
    expect(sumMinor([1, 2, 3], "INR")).toBe(6);
    expect(sumMinor([], "USD")).toBe(0);
  });

  it("gives a Total in INR only from INR values, null when a USD figure has none", () => {
    expect(
      totalInInr([
        { currency: "INR", minor: 100_00, inrMinor: null },
        { currency: "USD", minor: 10_00, inrMinor: 850_00 },
      ]),
    ).toBe(950_00);
    expect(
      totalInInr([
        { currency: "INR", minor: 100_00, inrMinor: null },
        { currency: "USD", minor: 10_00, inrMinor: null },
      ]),
    ).toBeNull();
  });

  it("prints a rate in whole or tenth per cent", () => {
    expect(rateText(0)).toBe("0 %");
    expect(rateText(3_333)).toBe("33.3 %");
    expect(rateText(5_000)).toBe("50 %");
    expect(rateText(10_000)).toBe("100 %");
  });

  it("says a care period's billed state", () => {
    const day = (iso: string) => `d:${iso}`;
    expect(billedText(null, day)).toBe("Not billed yet");
    const b = { documentId: "x", number: "TH/INV/2627/0001", issueDate: "2026-11-01", status: "issued" };
    expect(billedText(b, day)).toBe("d:2026-11-01 (TH/INV/2627/0001)");
    expect(billedText({ ...b, status: "draft", number: null, issueDate: null }, day)).toBe("Draft");
    expect(billedText({ ...b, status: "void" }, day)).toBe("Void");
    expect(billedText({ documentId: null, number: null, issueDate: null, status: "discarded" }, day)).toBe(
      "Draft discarded",
    );
  });
});

describe("CSVs from the screen's data", () => {
  const inv = (c: "INR" | "USD") => ({
    currency: c,
    count: 1,
    taxableMinor: 100_00,
    totalMinor: 118_00,
    inrTaxableMinor: c === "USD" ? 8_500_00 : null,
    inrTotalMinor: c === "USD" ? 8_500_00 : null,
    inrMissing: 0,
  });
  const col = (c: "INR" | "USD") => ({
    currency: c,
    payments: 1,
    receivedMinor: 50_00,
    refundedMinor: 0,
    collectedMinor: 50_00,
    tdsMinor: 0,
    inrCollectedMinor: null,
    inrMissing: 1,
  });

  it("writes the per-client revenue with CRLF and defused cells; INR columns only for USD", () => {
    const text = revenueClientsCsv(
      [{ client: { code: "X1", name: "=Sample, Ltd" }, invoiced: inv("INR"), collected: col("INR") }],
      "INR",
    );
    expect(text.endsWith("\r\n")).toBe(true);
    const [head, row] = text.trim().split("\r\n");
    expect(head?.split(",")).toHaveLength(8);
    expect(row).toBe(`X1,"'=Sample, Ltd",INR,100.00,118.00,50.00,0.00,0.00`);
    const usd = revenueClientsCsv(
      [{ client: { code: "X2", name: "B" }, invoiced: inv("USD"), collected: col("USD") }],
      "USD",
    );
    expect(usd.trim().split("\r\n")[1]).toBe("X2,B,USD,100.00,118.00,50.00,0.00,0.00,8500.00,");
  });

  it("writes the ageing with its buckets", () => {
    const b = { count: 0, balanceMinor: 0 };
    const text = ageingCsv(
      [
        {
          client: { code: "X1", name: "A" },
          currency: "INR",
          buckets: {
            not_due: { count: 1, balanceMinor: 10_00 },
            d1_30: b,
            d31_60: b,
            d61_90: b,
            d90_plus: b,
          },
          totalMinor: 10_00,
          creditHeldMinor: 5_00,
        },
      ],
      "2026-11-06",
      ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"],
    );
    expect(text.trim().split("\r\n")[1]).toBe("2026-11-06,X1,A,INR,10.00,0.00,0.00,0.00,0.00,10.00,5.00");
  });

  it("writes a negative amount as a number a spreadsheet adds up: ASCII minus, never defused (review 1, finding 10)", () => {
    expect(csvAmount(-1_234_50, "INR")).toEqual({ num: "-1234.50" });
    expect(csvAmount(null, "USD")).toBe("");
    const credit = { ...inv("INR"), taxableMinor: -100_00, totalMinor: -118_00 };
    const text = revenueClientsCsv(
      [{ client: { code: "X1", name: "-Sample" }, invoiced: credit, collected: col("INR") }],
      "INR",
    );
    const row = text.trim().split("\r\n")[1] ?? "";
    expect(row).toBe("X1,'-Sample,INR,-100.00,-118.00,50.00,0.00,0.00");
    expect(row).not.toContain("\u2212");
  });

  it("writes care hours in minutes and the pipeline as section, item, value", () => {
    const text = careHoursCsv(
      [
        {
          client: { code: "X1", name: "A" },
          period: { start: "2026-11-01", end: "2026-11-30" },
          includedMinutes: 600,
          availableMinutes: 600,
          usedMinutes: 90,
          overageMinutes: 0,
          billed: null,
        },
      ],
      "2026-11",
      "2026-11-06",
    );
    expect(text.trim().split("\r\n")[1]).toBe(
      "2026-11,X1,A,2026-11-01,2026-11-30,600,600,90,0,Not billed yet",
    );
    // a period that starts after today says so, as on screen (finding 6)
    const later = careHoursCsv(
      [
        {
          client: { code: "X1", name: "A" },
          period: { start: "2026-11-20", end: "2026-12-19" },
          includedMinutes: 600,
          availableMinutes: 600,
          usedMinutes: 0,
          overageMinutes: 0,
          billed: null,
        },
      ],
      "2026-11",
      "2026-11-06",
    );
    expect(later.trim().split("\r\n")[1]).toBe("2026-11,X1,A,2026-11-20,2026-12-19,600,,,,Starts 2026-11-20");
    expect(pipelineCsv([["Won", "", "3"]])).toBe("Section,Item,Value\r\nWon,,3\r\n");
  });
});

describe("Total in INR over the year, from a revenue answer (mocked: the API's `inrMissing` on invoiced figures, B3's field)", () => {
  const invoiced = (currency: "INR" | "USD", inrTotalMinor: number | null, inrMissing: number) => ({
    currency,
    count: 2,
    taxableMinor: 1_000_00,
    totalMinor: 1_180_00,
    inrTaxableMinor: currency === "USD" ? inrTotalMinor : null,
    inrTotalMinor: currency === "USD" ? inrTotalMinor : null,
    inrMissing,
  });
  const collected = (currency: "INR" | "USD", inrCollectedMinor: number | null, inrMissing: number) => ({
    currency,
    payments: 1,
    receivedMinor: 500_00,
    refundedMinor: 0,
    collectedMinor: 500_00,
    tdsMinor: 0,
    inrCollectedMinor,
    inrMissing,
  });

  it("adds INR and the frozen INR values of USD when every USD figure has one", () => {
    const t = yearInInr([
      {
        invoiced: [invoiced("INR", null, 0), invoiced("USD", 99_000_00, 0)],
        collected: [collected("INR", null, 0)],
      },
    ]);
    expect(t).toEqual({
      usd: true,
      inr: true,
      invInr: 1_00_180_00,
      colInr: 500_00,
      invMissing: 0,
      missing: 0,
    });
  });

  it("counts the USD invoices with no INR value across months and hides the invoiced total", () => {
    const t = yearInInr([
      { invoiced: [invoiced("USD", null, 2)], collected: [] },
      {
        invoiced: [invoiced("INR", null, 0), invoiced("USD", null, 1)],
        collected: [collected("USD", null, 1)],
      },
    ]);
    expect(t.invMissing).toBe(3);
    expect(t.invInr).toBeNull();
    expect(t.missing).toBe(1);
    expect(t.colInr).toBeNull();
    expect(R.invoicedInrMissing(t.invMissing)).toBe(
      "3 USD invoices have no INR value, so the INR total is not shown.",
    );
  });

  it("says nothing of INR for a year in rupees only", () => {
    const t = yearInInr([{ invoiced: [invoiced("INR", null, 0)], collected: [collected("INR", null, 0)] }]);
    expect(t.usd).toBe(false);
    expect(t.invMissing).toBe(0);
  });
});
