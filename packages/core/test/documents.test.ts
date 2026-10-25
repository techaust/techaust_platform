// Proposals and estimates, pure (M4.3; ADM-PROP-02, -04, -06, ADM-APR-02, ADM-EST-01). The discount-guard figures are typed by hand, with
// the arithmetic beside each; they are never computed by the code under test.
import { describe, expect, it } from "vitest";
import { placeholdersOf } from "../src/catalogue.ts";
import {
  ACCEPTABLE_STATUSES,
  approvalState,
  canMoveStatus,
  catalogueGuard,
  checkSections,
  contentHash,
  contentHashInput,
  DOC_STATUS_FLOW,
  type DraftContent,
  documentSnapshot,
  type GuardLine,
  isQuoteType,
  MAX_SECTIONS,
  REQUIRED_SECTIONS,
  SECTION_BODY_MAX,
  SECTIONS_TOTAL_MAX,
  type SectionDraft,
  sectionsFromTemplate,
  snapshotSha256,
  UNRESOLVED_RE,
  unresolvedIn,
  validUntil,
} from "../src/documents.ts";
import { canonicalJson, sha256Hex } from "../src/hash.ts";
import { SELF_SEND_DISCOUNT_BPS } from "../src/permissions.ts";
import type { Discount, LineInput } from "../src/tax/index.ts";
import { computeDocument } from "../src/tax/index.ts";
import { DATE, DEFAULTS, OVERSEAS_US, REG_WB } from "./tax/fixtures.ts";

// ---- the discount guard: figures typed by hand (rule A, owner O-Q1 and O-Q2) ----------------------------------------------------

type Row = {
  /** null = a custom line (not from the catalogue). */
  cat: number | null;
  qty?: number;
  typed: number;
  lineDiscount?: Discount;
};

function guardOf(rows: Row[], documentDiscount: Discount | null = null, overseas = false) {
  const lines: LineInput[] = rows.map((r) => ({
    sac: "998314",
    qtyMilli: r.qty ?? 1000,
    rateMinor: r.typed,
    discount: r.lineDiscount ?? null,
  }));
  const computed = computeDocument(
    {
      currency: overseas ? "USD" : "INR",
      documentDate: DATE,
      recipient: overseas ? OVERSEAS_US : REG_WB,
      lines,
      documentDiscount,
    },
    DEFAULTS,
  );
  if (!computed.ok) throw new Error(`fixture does not compute: ${JSON.stringify(computed.errors)}`);
  const guardLines: GuardLine[] = rows.map((r) => ({
    catalogueItemId: r.cat === null ? null : "item",
    catalogueRateMinor: r.cat,
    qtyMilli: r.qty ?? 1000,
  }));
  return catalogueGuard(guardLines, computed.value);
}

describe("the discount guard: D1 to D10 (INR in paise unless stated)", () => {
  it("D1: S9 at 20,000,000, document discount 10 %: R 20,000,000, T 18,000,000, D 2,000,000, 1000 bp, allowed (exactly 10 %)", () => {
    // 10 % of 20,000,000 = 2,000,000; T = 20,000,000 - 2,000,000 = 18,000,000; 10,000 x 2,000,000 = 20,000,000,000 is not
    // greater than 1,000 x 20,000,000 = 20,000,000,000.
    const g = guardOf([{ cat: 20_000_000, typed: 20_000_000 }], { kind: "percent", bp: 1000 });
    expect(g).toEqual({
      referenceMinor: 20_000_000,
      taxableMinor: 18_000_000,
      discountMinor: 2_000_000,
      discountBp: 1000,
      needsApproval: false,
    });
  });

  it("D2: the same with a fixed 2,000,100: T 17,999,900, D 2,000,100, 1001 bp (rounded up), needs approval", () => {
    // D / R = 2,000,100 / 20,000,000 = 0.100005, which is 1000.05 bp; rounded up it is 1001.
    // 10,000 x 2,000,100 = 20,001,000,000 > 1,000 x 20,000,000 = 20,000,000,000.
    const g = guardOf([{ cat: 20_000_000, typed: 20_000_000 }], { kind: "fixed", minor: 2_000_100 });
    expect(g).toEqual({
      referenceMinor: 20_000_000,
      taxableMinor: 17_999_900,
      discountMinor: 2_000_100,
      discountBp: 1001,
      needsApproval: true,
    });
  });

  it("D3: S1 4,000,000 typed 3,600,000 and S10 5,000,000 x 2 with a 5 % line discount: R 14,000,000, T 13,100,000, D 900,000, 643 bp, allowed", () => {
    // R = 4,000,000 + 2 x 5,000,000 = 14,000,000. S10 gross 10,000,000, 5 % = 500,000, taxable 9,500,000.
    // T = 3,600,000 + 9,500,000 = 13,100,000. D = 900,000; 900,000 / 14,000,000 = 642.857 bp, rounded up 643.
    const g = guardOf([
      { cat: 4_000_000, typed: 3_600_000 },
      { cat: 5_000_000, qty: 2000, typed: 5_000_000, lineDiscount: { kind: "percent", bp: 500 } },
    ]);
    expect(g).toEqual({
      referenceMinor: 14_000_000,
      taxableMinor: 13_100_000,
      discountMinor: 900_000,
      discountBp: 643,
      needsApproval: false,
    });
  });

  it("D4: a premium on one line offsets a discount on another: R 24,000,000, T 23,000,000, D 1,000,000, 417 bp, allowed", () => {
    // R = 4,000,000 + 20,000,000. T = 7,000,000 + 16,000,000 = 23,000,000. 1,000,000 / 24,000,000 = 416.67 bp -> 417.
    const g = guardOf([
      { cat: 4_000_000, typed: 7_000_000 },
      { cat: 20_000_000, typed: 16_000_000 },
    ]);
    expect(g).toMatchObject({
      referenceMinor: 24_000_000,
      taxableMinor: 23_000_000,
      discountMinor: 1_000_000,
      discountBp: 417,
      needsApproval: false,
    });
  });

  it("D5: a custom line is ignored on both sides: R 20,000,000, T 17,000,000, D 3,000,000, 1500 bp, needs approval", () => {
    // Only S9 counts: R = 20,000,000, T = 17,000,000 (the custom 5,000,000 is left out of both).
    // 3,000,000 / 20,000,000 = 0.15 = 1500 bp exactly.
    const g = guardOf([
      { cat: 20_000_000, typed: 17_000_000 },
      { cat: null, typed: 5_000_000 },
    ]);
    expect(g).toEqual({
      referenceMinor: 20_000_000,
      taxableMinor: 17_000_000,
      discountMinor: 3_000_000,
      discountBp: 1500,
      needsApproval: true,
    });
  });

  it("D6: a document discount of 10 % on 30,000,000 is shared 2,000,000 / 1,000,000, so the catalogue line shows exactly 10 %", () => {
    // 10 % of 30,000,000 = 3,000,000, allocated in proportion to 20,000,000 and 10,000,000 = 2,000,000 and 1,000,000.
    // S9: T = 20,000,000 - 2,000,000 = 18,000,000; D = 2,000,000; 1000 bp; 10,000 x 2,000,000 is not greater than 1,000 x 20,000,000.
    const g = guardOf(
      [
        { cat: 20_000_000, typed: 20_000_000 },
        { cat: null, typed: 10_000_000 },
      ],
      { kind: "percent", bp: 1000 },
    );
    expect(g).toEqual({
      referenceMinor: 20_000_000,
      taxableMinor: 18_000_000,
      discountMinor: 2_000_000,
      discountBp: 1000,
      needsApproval: false,
    });
  });

  it("D7: quantity 1.5 typed 4,500,001: gross 6,750,002 (half up), R 7,500,000, D 749,998, 1000 bp, allowed", () => {
    // 1,500 milli x 4,500,001 / 1,000 = 6,750,001.5, half up 6,750,002. R = 1,500 x 5,000,000 / 1,000 = 7,500,000.
    // D = 7,500,000 - 6,750,002 = 749,998; 749,998 / 7,500,000 = 999.997 bp -> 1000.
    // 10,000 x 749,998 = 7,499,980,000 is not greater than 1,000 x 7,500,000 = 7,500,000,000.
    const g = guardOf([{ cat: 5_000_000, qty: 1500, typed: 4_500_001 }]);
    expect(g).toMatchObject({
      referenceMinor: 7_500_000,
      taxableMinor: 6_750_002,
      discountMinor: 749_998,
      discountBp: 1000,
      needsApproval: false,
    });
  });

  it("D7b: typed 4,499,999: gross 6,749,999, D 750,001, 1001 bp, needs approval", () => {
    // 1,500 x 4,499,999 / 1,000 = 6,749,998.5, half up 6,749,999. D = 7,500,000 - 6,749,999 = 750,001;
    // 750,001 / 7,500,000 = 1000.0013 bp -> 1001. 10,000 x 750,001 = 7,500,010,000 > 7,500,000,000.
    const g = guardOf([{ cat: 5_000_000, qty: 1500, typed: 4_499_999 }]);
    expect(g).toMatchObject({
      referenceMinor: 7_500_000,
      taxableMinor: 6_749_999,
      discountMinor: 750_001,
      discountBp: 1001,
      needsApproval: true,
    });
  });

  it("D8: USD S9 at 800,000 cents with a 10 % line discount is 1000 bp; a document discount of 100 more makes it 1002 and needs approval", () => {
    // R = 800,000. Line discount 10 % = 80,000, T = 720,000, D = 80,000, 1000 bp, allowed.
    const row: Row = { cat: 800_000, typed: 800_000, lineDiscount: { kind: "percent", bp: 1000 } };
    expect(guardOf([row], null, true)).toMatchObject({
      taxableMinor: 720_000,
      discountMinor: 80_000,
      discountBp: 1000,
      needsApproval: false,
    });
    // Then 100 cents off the document: T = 719,900, D = 80,100; 80,100 / 800,000 = 1001.25 bp -> 1002.
    // 10,000 x 80,100 = 801,000,000 > 1,000 x 800,000 = 800,000,000.
    expect(guardOf([row], { kind: "fixed", minor: 100 }, true)).toEqual({
      referenceMinor: 800_000,
      taxableMinor: 719_900,
      discountMinor: 80_100,
      discountBp: 1002,
      needsApproval: true,
    });
  });

  it("D9: a smaller quantity at the catalogue rate is not a discount (R 5,000,000, T 5,000,000, D 0)", () => {
    expect(guardOf([{ cat: 5_000_000, typed: 5_000_000 }])).toEqual({
      referenceMinor: 5_000_000,
      taxableMinor: 5_000_000,
      discountMinor: 0,
      discountBp: 0,
      needsApproval: false,
    });
  });

  it("D10: custom lines only: nothing to compare, nothing to approve", () => {
    expect(guardOf([{ cat: null, typed: 9_000_000 }], { kind: "percent", bp: 5000 })).toEqual({
      referenceMinor: 0,
      taxableMinor: 0,
      discountMinor: 0,
      discountBp: 0,
      needsApproval: false,
    });
  });

  it("a line with an item but no stored catalogue rate counts as custom, and a missing computed line is skipped", () => {
    const computed = computeDocument(
      {
        currency: "INR",
        documentDate: DATE,
        recipient: REG_WB,
        lines: [{ sac: "998314", qtyMilli: 1000, rateMinor: 100 }],
      },
      DEFAULTS,
    );
    if (!computed.ok) throw new Error("fixture");
    const lines: GuardLine[] = [
      { catalogueItemId: "x", catalogueRateMinor: null, qtyMilli: 1000 },
      { catalogueItemId: "y", catalogueRateMinor: 500, qtyMilli: 1000 },
    ];
    expect(catalogueGuard(lines, computed.value).referenceMinor).toBe(0);
  });

  it("the threshold is the owner's 10 % constant", () => {
    expect(SELF_SEND_DISCOUNT_BPS).toBe(1000);
  });
});

// ---- sections ------------------------------------------------------------------------------------------------------------------

const sec = (kind: string, over: Partial<SectionDraft> = {}): SectionDraft => ({
  kind,
  title: kind,
  bodyMd: "text",
  hidden: false,
  ...over,
});
const FULL = (): SectionDraft[] => [sec("cover"), sec("estimate"), sec("terms"), sec("acceptance")];

describe("sections [ADM-PROP-02]", () => {
  it("a document with the three required sections is fine, in any order", () => {
    expect(checkSections(FULL())).toEqual([]);
    expect(checkSections([sec("acceptance"), sec("terms"), sec("estimate")])).toEqual([]);
  });

  it("each required section must be present exactly once and never hidden", () => {
    for (const k of REQUIRED_SECTIONS) {
      expect(checkSections(FULL().filter((s) => s.kind !== k))).toContain("required_missing");
      expect(checkSections(FULL().map((s) => (s.kind === k ? { ...s, hidden: true } : s)))).toContain(
        "required_hidden",
      );
      expect(checkSections([...FULL(), sec(k)])).toContain("section_duplicate");
    }
  });

  it("other sections can be hidden, a kind appears once, and an unknown kind is refused", () => {
    expect(checkSections([...FULL(), sec("team", { hidden: true })])).toEqual([]);
    expect(checkSections([...FULL(), sec("team"), sec("team")])).toContain("section_duplicate");
    expect(checkSections([...FULL(), sec("pricing")])).toContain("section_kind_invalid");
  });

  it("up to 3 custom sections, 16 sections, 6,000 characters each and 30,000 in total", () => {
    expect(checkSections([...FULL(), sec("custom"), sec("custom"), sec("custom")])).toEqual([]);
    expect(checkSections([...FULL(), ...Array.from({ length: 4 }, () => sec("custom"))])).toContain(
      "custom_limit",
    );
    const many = [
      ...FULL(),
      ...[
        "summary",
        "problem_goals",
        "scope",
        "deliverables",
        "timeline",
        "team",
        "how_we_work",
        "assumptions_exclusions",
      ].map((k) => sec(k)),
      ...Array.from({ length: 5 }, () => sec("custom")),
    ];
    expect(many.length).toBeGreaterThan(MAX_SECTIONS);
    expect(checkSections(many)).toContain("too_many_sections");
    expect(checkSections([...FULL(), sec("scope", { bodyMd: "x".repeat(SECTION_BODY_MAX) })])).toEqual([]);
    expect(checkSections([...FULL(), sec("scope", { bodyMd: "x".repeat(SECTION_BODY_MAX + 1) })])).toContain(
      "section_too_long",
    );
    expect(checkSections([...FULL(), sec("scope", { title: "t".repeat(121) })])).toContain(
      "section_title_too_long",
    );
    // Six sections of 4,990 characters and the four short ones (16 characters) are 29,956: under 30,000; 50 more is over.
    const six = ["summary", "problem_goals", "scope", "deliverables", "timeline", "team"].map((k) =>
      sec(k, { bodyMd: "x".repeat(4990) }),
    );
    expect(checkSections([...FULL(), ...six])).toEqual([]);
    expect(checkSections([...FULL(), ...six, sec("how_we_work", { bodyMd: "y".repeat(50) })])).toEqual([
      "sections_too_long",
    ]);
    expect(
      checkSections([...FULL(), sec("how_we_work", { bodyMd: "y".repeat(SECTIONS_TOTAL_MAX) })]),
    ).toEqual(expect.arrayContaining(["sections_too_long", "section_too_long"]));
  });

  it("a missing body or title counts as empty", () => {
    expect(
      checkSections([sec("estimate", { title: null, bodyMd: null }), sec("terms"), sec("acceptance")]),
    ).toEqual([]);
  });
});

describe("sectionsFromTemplate", () => {
  const r = (key: string, heading = key, text = "t") => ({ key, heading, text });

  it("keeps known kinds, turns anything else into a custom section, and adds the three required ones that are missing", () => {
    const out = sectionsFromTemplate([
      r("cover"),
      r("schedule", "Payment schedule"),
      r("estimate", "Estimate", "  "),
    ]);
    expect(out.map((s) => s.kind)).toEqual(["cover", "custom", "estimate", "terms", "acceptance"]);
    expect(out[1]).toMatchObject({ title: "Payment schedule", bodyMd: "t" });
    // An empty text is no body; the added sections have the ADM-PROP-02 names and an empty body.
    expect(out[2]).toMatchObject({ bodyMd: null });
    expect(out[3]).toEqual({ kind: "terms", title: "Terms", bodyMd: null, hidden: false });
    expect(checkSections(out)).toEqual([]);
  });

  it("a repeated kind becomes custom; surplus custom sections join the last allowed one instead of being dropped", () => {
    const out = sectionsFromTemplate([
      r("scope"),
      r("scope", "Scope again"),
      r("a", "A"),
      r("b", "B"),
      r("c", "C", ""),
      r("d", "D", "dd"),
    ]);
    const customs = out.filter((s) => s.kind === "custom");
    expect(customs).toHaveLength(3);
    expect(customs.at(-1)?.bodyMd).toContain("**C**");
    expect(customs.at(-1)?.bodyMd).toContain("**D**\ndd");
    expect(checkSections(out)).toEqual([]);
  });

  it("a surplus section after an empty last custom section starts its body", () => {
    const out = sectionsFromTemplate([r("a", "A", ""), r("b", "B", ""), r("c", "C", ""), r("d", "D", "dd")]);
    expect(out.filter((s) => s.kind === "custom").at(-1)?.bodyMd).toBe("**D**\ndd");
  });

  it("a surplus section with no text adds only its heading", () => {
    const out = sectionsFromTemplate([r("a"), r("b"), r("c"), r("d", "D", "")]);
    expect(out.filter((s) => s.kind === "custom").at(-1)?.bodyMd).toBe("t\n\n**D**");
  });
});

// ---- status flow ---------------------------------------------------------------------------------------------------------------

describe("the status flow [ADM-PROP-06]", () => {
  it("draft goes to sent; sent to viewed; sent or viewed to accepted, rejected, expired or revised", () => {
    expect(canMoveStatus("draft", "sent")).toBe(true);
    expect(canMoveStatus("sent", "viewed")).toBe(true);
    for (const from of ["sent", "viewed"])
      for (const to of ["accepted", "rejected", "expired", "revised"])
        expect(canMoveStatus(from, to), `${from} ${to}`).toBe(true);
  });

  it("everything else is refused, pending_approval included, and nothing moves out of a final status", () => {
    expect(canMoveStatus("draft", "pending_approval")).toBe(false);
    expect(canMoveStatus("draft", "accepted")).toBe(false);
    expect(canMoveStatus("viewed", "sent")).toBe(false);
    for (const from of [
      "accepted",
      "rejected",
      "expired",
      "revised",
      "pending_approval",
      "issued",
      "nonsense",
    ])
      for (const to of ["draft", "sent", "viewed", "accepted", "revised"])
        expect(canMoveStatus(from, to), `${from} ${to}`).toBe(false);
    expect(Object.keys(DOC_STATUS_FLOW)).toEqual(["draft", "sent", "viewed"]);
    expect([...ACCEPTABLE_STATUSES]).toEqual(["sent", "viewed"]);
  });

  it("knows the two types", () => {
    expect(isQuoteType("proposal") && isQuoteType("estimate")).toBe(true);
    expect(isQuoteType("tax_invoice")).toBe(false);
  });
});

// ---- validity --------------------------------------------------------------------------------------------------------------------

describe("validUntil [VERIFY WITH CA/LEGAL item 5]", () => {
  it("is the IST sent date plus the validity, inclusive", () => {
    // Sent 1 October 2026 with 15 days: acceptable through 16 October.
    expect(validUntil({ year: 2026, month: 10, day: 1 }, 15)).toBe("2026-10-16");
    // Month and year ends: 25 December + 10 = 4 January.
    expect(validUntil({ year: 2026, month: 12, day: 25 }, 10)).toBe("2027-01-04");
    // A leap day: 20 February 2028 + 10 = 1 March 2028 (29 days in February 2028).
    expect(validUntil({ year: 2028, month: 2, day: 20 }, 10)).toBe("2028-03-01");
  });

  it("refuses 0, a fraction, and more than 90 days", () => {
    for (const bad of [0, -1, 1.5, 91, Number.NaN])
      expect(() => validUntil({ year: 2026, month: 10, day: 1 }, bad)).toThrow(RangeError);
  });
});

// ---- placeholders ---------------------------------------------------------------------------------------------------------------

describe("unresolved placeholders [ADM-CAT-03]", () => {
  it("finds the distinct names in several texts and ignores empty ones", () => {
    expect(
      unresolvedIn(["Hello {{client.name}}", null, undefined, "{{ client.name }} and {{service.short}}"]),
    ).toEqual(["client.name", "service.short"]);
    expect(unresolvedIn(["plain", ""])).toEqual([]);
  });

  it("uses the same pattern as M4.1's placeholdersOf", () => {
    const text = "a {{client.name}} b {{ service.short }} c {{Bad}} d {{x.y.z}}";
    expect(unresolvedIn([text])).toEqual(placeholdersOf(text));
    expect(UNRESOLVED_RE.flags).toBe("g");
  });
});

// ---- the content hash and the snapshot -----------------------------------------------------------------------------------------

const draft = (): DraftContent => ({
  type: "proposal",
  clientId: "client-1",
  contactId: "contact-1",
  title: "Website build",
  currency: "INR",
  validityDays: 15,
  termsVersionId: "terms-1",
  discountKind: null,
  discountValue: null,
  exportMode: null,
  lines: [
    {
      catalogueItemId: "item-9",
      description: "Build",
      detail: null,
      sac: "998314",
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 2_000_000,
      discountKind: null,
      discountValue: null,
      gstRateBp: 1800,
      catalogueRateMinor: 2_000_000,
    },
  ],
  sections: [sec("estimate"), sec("terms"), sec("acceptance")],
  schedule: [{ label: "On acceptance", trigger: "on_accept", pctBp: 10_000, detail: null, targetDate: null }],
});
const computedOf = (rate = 2_000_000) => {
  const r = computeDocument(
    {
      currency: "INR",
      documentDate: DATE,
      recipient: REG_WB,
      lines: [{ sac: "998314", qtyMilli: 1000, rateMinor: rate }],
    },
    DEFAULTS,
  );
  if (!r.ok) throw new Error("fixture");
  return r.value;
};

describe("contentHash [lead decision 4]", () => {
  it("is deterministic, 64 hex characters, and has no ids in it", async () => {
    const a = await contentHash(draft(), computedOf());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHash(draft(), computedOf())).toBe(a);
    const input = canonicalJson(contentHashInput(draft(), computedOf()));
    expect(input).not.toContain('"id"');
  });

  it("changes when any field, line, section, schedule step, the supply or a total changes", async () => {
    const base = await contentHash(draft(), computedOf());
    const d = draft();
    const variants: DraftContent[] = [
      { ...d, title: "Other" },
      { ...d, contactId: "contact-2" },
      { ...d, validityDays: 30 },
      { ...d, termsVersionId: "terms-2" },
      { ...d, discountKind: "percent", discountValue: 100 },
      { ...d, exportMode: "igst_paid" },
      { ...d, lines: [{ ...(d.lines[0] as DraftContent["lines"][number]), description: "Build!" }] },
      { ...d, lines: [{ ...(d.lines[0] as DraftContent["lines"][number]), catalogueRateMinor: 1 }] },
      { ...d, sections: [sec("estimate", { bodyMd: "other" }), sec("terms"), sec("acceptance")] },
      { ...d, sections: [sec("terms"), sec("estimate"), sec("acceptance")] },
      {
        ...d,
        schedule: [
          { label: "On acceptance", trigger: "on_accept", pctBp: 10_000, detail: "x", targetDate: null },
        ],
      },
    ];
    for (const v of variants)
      expect(await contentHash(v, computedOf()), JSON.stringify(v).slice(0, 60)).not.toBe(base);
    expect(await contentHash(d, computedOf(2_000_001))).not.toBe(base);
  });

  it("a draft that does not compute hashes without totals", async () => {
    const a = await contentHash(draft(), null);
    expect(a).not.toBe(await contentHash(draft(), computedOf()));
    expect(contentHashInput(draft(), null).totals).toBeNull();
  });
});

describe("the frozen snapshot [M4.4 and M4.5 rebuild and verify it]", () => {
  const input = () => ({
    document: {
      type: "proposal" as const,
      clientId: "client-1",
      versionGroupId: "g1",
      version: 1,
      currency: "INR",
      title: "Website build",
      issueDate: "2026-10-25",
      validUntil: "2026-11-09",
      validityDays: 15,
      contentSha256: "a".repeat(64),
      discountKind: null,
      discountValue: null,
      exportMode: null,
      supplyType: "intra",
      placeOfSupplyCode: "19",
    },
    recipient: { legalName: "Example", country: "IN", contactId: "contact-1" },
    issuer: { company: { tradeName: "TecHaust Technologies" } },
    computed: computedOf(),
    lines: draft().lines,
    sections: draft().sections,
    schedule: [
      {
        label: "On acceptance",
        trigger: "on_accept" as const,
        pctBp: 10_000,
        detail: null,
        targetDate: null,
        amountMinor: 2_360_000,
      },
    ],
    terms: { id: "terms-1", version: 1, sha256: "b".repeat(64) },
  });

  it("holds the content, the recipient, the issuer and the terms reference, but no number or send instant", async () => {
    const snap = documentSnapshot(input());
    expect(Object.keys(snap).sort()).toEqual([
      "computed",
      "document",
      "issuer",
      "lines",
      "recipient",
      "schedule",
      "sections",
      "terms",
      "v",
    ]);
    const text = canonicalJson(snap);
    for (const key of ["numberDisplay", "frozenAt", "sentAt", "series"]) expect(text).not.toContain(key);
    expect(await snapshotSha256(input())).toBe(await sha256Hex(canonicalJson(snap)));
  });

  it("the same input gives the same hash and any change gives another", async () => {
    const base = await snapshotSha256(input());
    expect(await snapshotSha256(input())).toBe(base);
    expect(
      await snapshotSha256({ ...input(), terms: { id: "terms-1", version: 2, sha256: "b".repeat(64) } }),
    ).not.toBe(base);
    expect(await snapshotSha256({ ...input(), recipient: { legalName: "Other", country: "IN" } })).not.toBe(
      base,
    );
  });
});

// ---- approvals ----------------------------------------------------------------------------------------------------------------

describe("approvalState [ADM-APR-02]", () => {
  const row = (status: string, contentSha256 = "h1") => ({ status, contentSha256 });
  it("none without a request; a pending or approved one counts only for the same content", () => {
    expect(approvalState(null, "h1")).toBe("none");
    expect(approvalState(row("pending"), "h1")).toBe("pending");
    expect(approvalState(row("approved"), "h1")).toBe("approved");
    expect(approvalState(row("pending", "h1"), "h2")).toBe("expired");
    expect(approvalState(row("approved", "h1"), "h2")).toBe("expired");
    expect(approvalState(row("approved", "h1"), null)).toBe("expired");
  });

  it("rejected and expired stay so, whatever the content now is (an expired approval never revives)", () => {
    expect(approvalState(row("rejected"), "h1")).toBe("rejected");
    expect(approvalState(row("rejected"), "h2")).toBe("rejected");
    expect(approvalState(row("expired"), "h1")).toBe("expired");
    expect(approvalState(row("bogus"), "h1")).toBe("none");
  });
});
