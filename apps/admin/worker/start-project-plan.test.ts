// What "Start project" makes from an accepted proposal (M4.5; ADM-PRJ-01, ADM-PROP-09): the pure plan. The figures are worked by hand in the comments
// (paise), not by the engine's own helpers. VERIFY WITH CA/LEGAL: the draft types, the place of supply and merging SACs.
import { istDate } from "@techaust/core/dates";
import { type ComputedDocument, computeDocument, type InclusiveGroup } from "@techaust/core/tax";
import { describe, expect, it } from "vitest";
import { type ClientRow, readSettings, taxContext, taxInputOf } from "./quote-model.ts";
import { mergeByRate, missingClientFields, planStartProject, type StepFacts } from "./start-project-plan.ts";

const TODAY = istDate(Date.UTC(2026, 9, 26, 6, 0, 0));
const settings = readSettings([]);
const client = (over: Partial<ClientRow> = {}): ClientRow => ({
  id: "c1",
  code: "C0001",
  legal_name: "Sample Traders",
  display_name: "Sample",
  type: "business",
  country: "IN",
  gst_status: "unregistered",
  gstin: null,
  state_code: "19",
  billing_address: null,
  currency: "INR",
  attach_pdf: 0,
  anonymised_at: null,
  payment_terms_days: null,
  updated_at: 1,
  ...over,
});

function proposalOf(
  c: ClientRow,
  lines: { sac: string; rateMinor: number; gstRateBp: number }[],
  currency: "INR" | "USD" = "INR",
) {
  const r = computeDocument(
    {
      currency,
      documentDate: TODAY,
      recipient: taxInputOf(c),
      lines: lines.map((l) => ({ ...l, qtyMilli: 1000, discount: null })),
    },
    taxContext(settings),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

const step = (
  label: string,
  trigger: string,
  pct: number,
  amount: number,
  target: string | null = null,
): StepFacts => ({
  label,
  trigger,
  pct_bp: pct,
  amount_minor: amount,
  target_date: target,
});

describe("planStartProject: milestones and the budget", () => {
  // 100,000.00 at 18 %, intra-state: taxable 10,000,000; CGST 900,000; SGST 900,000; total 11,800,000 (the supplier and the client are in West Bengal).
  const computed = proposalOf(client(), [{ sac: "998314", rateMinor: 10_000_000, gstRateBp: 1800 }]);
  const schedule = [
    step("On acceptance", "on_accept", 4000, 4_720_000, "2026-11-01"), // 40 % of 11,800,000
    step("On delivery", "delivery", 6000, 7_080_000, null), // 60 %
  ];
  const plan = planStartProject({
    proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed },
    schedule,
    client: client(),
    settings,
    today: TODAY,
  });

  it("one milestone per step, with the step's title, exact amount and target date; the budget is the total", () => {
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.milestones).toEqual([
      { title: "On acceptance", amountMinor: 4_720_000, dueDate: "2026-11-01" },
      { title: "On delivery", amountMinor: 7_080_000, dueDate: null },
    ]);
    expect(plan.milestones.reduce((a, m) => a + m.amountMinor, 0)).toBe(11_800_000);
    expect(plan.budgetMinor).toBe(11_800_000);
  });

  it("the first instalment is step 1, tax included: 47,200.00 splits into 40,000.00 + 3,600.00 + 3,600.00 and totals exactly the step", () => {
    if (!plan.ok) throw new Error("plan");
    const inst = plan.firstInstalment;
    expect(inst).not.toBeNull();
    expect(inst?.type).toBe("proforma"); // the default advance mode
    expect(inst?.amountMinor).toBe(4_720_000);
    expect(inst?.pctBp).toBe(4000);
    // taxable 4,000,000 at 18 %: CGST 360,000 + SGST 360,000 -> 4,720,000, no round-off
    const k = inst?.split.document as ComputedDocument;
    expect([k.taxableMinor, k.cgstMinor, k.sgstMinor, k.igstMinor, k.roundOffMinor, k.totalMinor]).toEqual([
      4_000_000, 360_000, 360_000, 0, 0, 4_720_000,
    ]);
    expect(inst?.split.lines).toHaveLength(1);
    expect(inst?.supply).toMatchObject({ type: "intra", placeOfSupplyCode: "19" });
  });

  it("the type follows the advance mode: tax invoice upfront; an export invoice for an overseas client", () => {
    const upfront = { ...settings, tax: { ...settings.tax, advanceMode: "invoice_upfront" as const } };
    const a = planStartProject({
      proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed },
      schedule,
      client: client(),
      settings: upfront,
      today: TODAY,
    });
    expect(a.ok && a.firstInstalment?.type).toBe("tax_invoice");
    const receipt = { ...settings, tax: { ...settings.tax, advanceMode: "receipt_voucher" as const } };
    const b = planStartProject({
      proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed },
      schedule,
      client: client(),
      settings: receipt,
      today: TODAY,
    });
    expect(b.ok && b.firstInstalment?.type).toBe("proforma");
  });

  it("an overseas client: an export invoice upfront; a USD instalment is exact (no tax under LUT)", () => {
    const overseas = client({ gst_status: "overseas", country: "US", state_code: null, currency: "USD" });
    const usd = proposalOf(overseas, [{ sac: "998314", rateMinor: 100_000, gstRateBp: 1800 }], "USD"); // $1,000.00
    const upfront = { ...settings, tax: { ...settings.tax, advanceMode: "invoice_upfront" as const } };
    const p = planStartProject({
      proposal: { currency: "USD", total_minor: usd.totalMinor, export_mode: null, computed: usd },
      schedule: [
        step("On acceptance", "on_accept", 5000, 50_000),
        step("On delivery", "delivery", 5000, 50_000),
      ],
      client: overseas,
      settings: upfront,
      today: TODAY,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.firstInstalment?.type).toBe("export_invoice");
    expect(p.firstInstalment?.split.document.totalMinor).toBe(50_000);
  });
});

describe("planStartProject: no advance step", () => {
  const computed = proposalOf(client(), [{ sac: "998314", rateMinor: 10_000_000, gstRateBp: 1800 }]);
  const base = {
    proposal: { currency: "INR" as const, total_minor: 11_800_000, export_mode: null, computed },
    client: client(),
    settings,
    today: TODAY,
  };
  for (const [name, schedule] of [
    [
      "step 1 is not paid on acceptance",
      [
        step("At the midpoint", "milestone", 5000, 5_900_000),
        step("On delivery", "delivery", 5000, 5_900_000),
      ],
    ],
    [
      "step 1 is nothing",
      [step("On acceptance", "on_accept", 0, 0), step("On delivery", "delivery", 10_000, 11_800_000)],
    ],
    ["there is no schedule", []],
  ] as const)
    it(`${name}: milestones only, no draft, with the reason`, () => {
      const p = planStartProject({ ...base, schedule });
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(p.firstInstalment).toBeNull();
      expect(p.reason).toBe("no_advance_step");
      expect(p.milestones).toHaveLength(schedule.length);
    });
});

describe("planStartProject: refusals and merging", () => {
  it("an instalment that is not a whole rupee is refused with the engine's code, not rounded", () => {
    const computed = proposalOf(client(), [{ sac: "998314", rateMinor: 10_000_000, gstRateBp: 1800 }]);
    const p = planStartProject({
      proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed },
      schedule: [step("On acceptance", "on_accept", 4000, 4_720_050)],
      client: client(),
      settings,
      today: TODAY,
    });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.code).toBe("instalment_failed");
      expect(p.issues.map((i) => i.code)).toContain("gross_not_whole_unit");
    }
  });

  it("a client the engine cannot place (no state) is refused, nothing is guessed", () => {
    const computed = proposalOf(client(), [{ sac: "998314", rateMinor: 10_000_000, gstRateBp: 1800 }]);
    const p = planStartProject({
      proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed },
      schedule: [step("On acceptance", "on_accept", 4000, 4_720_000)],
      client: client({ state_code: null }),
      settings,
      today: TODAY,
    });
    expect(p.ok).toBe(false);
    // M4.5 fix L11: the refusal names the empty client field.
    if (!p.ok) expect(p.missing).toEqual(["state_code"]);
  });

  it("missingClientFields names the client fields behind the engine's codes, once each, and nothing for other causes", () => {
    const at = (code: string) => ({ code, path: ["recipient"] }) as never;
    expect(missingClientFields([at("state_required")])).toEqual(["state_code"]);
    expect(missingClientFields([at("state_invalid"), at("state_not_allowed")])).toEqual(["state_code"]);
    expect(missingClientFields([at("gstin_invalid"), at("country_mismatch")])).toEqual(["gstin", "country"]);
    expect(missingClientFields([at("gross_not_whole_unit"), at("supply_invalid")])).toEqual([]);
    expect(missingClientFields([])).toEqual([]);
  });

  it("a stored proposal without its computed result cannot start an instalment", () => {
    const p = planStartProject({
      proposal: { currency: "INR", total_minor: 11_800_000, export_mode: null, computed: null },
      schedule: [step("On acceptance", "on_accept", 4000, 4_720_000)],
      client: client(),
      settings,
      today: TODAY,
    });
    expect(p).toEqual({ ok: false, code: "not_computed", issues: [], missing: [] });
  });

  it("more than 10 (SAC, rate) groups are merged by rate, the SAC kept only when shared, and the draft still totals the step exactly", () => {
    // 11 services at 18 %, each 10,000.00 (1,000,000 paise) with its own SAC: tax 180,000 each, 1,180,000 gross each, 12,980,000 in all.
    const lines = Array.from({ length: 11 }, (_, i) => ({
      sac: `99${8300 + i}`,
      rateMinor: 1_000_000,
      gstRateBp: 1800,
    }));
    const computed = proposalOf(client(), lines);
    expect(computed.summary).toHaveLength(11);
    const p = planStartProject({
      proposal: { currency: "INR", total_minor: computed.totalMinor, export_mode: null, computed },
      schedule: [
        step("On acceptance", "on_accept", 5000, 6_490_000),
        step("On delivery", "delivery", 5000, 6_490_000),
      ], // half of 12,980,000
      client: client(),
      settings,
      today: TODAY,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.warnings).toEqual([{ code: "instalment_sac_merged" }]);
    expect(p.firstInstalment?.groups).toEqual([{ sac: null, gstRateBp: 1800, weightMinor: 12_980_000 }]);
    // 5,500,000 taxable + 495,000 CGST + 495,000 SGST = 6,490,000 exactly
    expect(p.firstInstalment?.split.document.totalMinor).toBe(6_490_000);
    expect(p.firstInstalment?.split.document.taxableMinor).toBe(5_500_000);
  });

  it("mergeByRate keeps a SAC that every member shares, and reports when it dropped one", () => {
    const g = (sac: string | null, rate: number, w: number): InclusiveGroup => ({
      sac,
      gstRateBp: rate,
      weightMinor: w,
    });
    expect(mergeByRate([g("1", 1800, 5), g("1", 1800, 7), g("2", 500, 1)])).toEqual({
      groups: [g("1", 1800, 12), g("2", 500, 1)],
      sacMerged: false,
    });
    expect(mergeByRate([g("1", 1800, 5), g("2", 1800, 7)])).toEqual({
      groups: [g(null, 1800, 12)],
      sacMerged: true,
    });
    expect(mergeByRate([g(null, 1800, 5), g(null, 1800, 7)]).sacMerged).toBe(false);
  });
});
