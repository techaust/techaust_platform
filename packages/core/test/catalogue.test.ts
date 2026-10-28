// The catalogue, pure (M4.1, ADM-CAT-02..05): entry schemas, price history rows, the public snapshot and its mini twin (parity with
// the classic schema), canonical JSON and the SHA, and template rendering.
import { describe, expect, it } from "vitest";
import {
  type CatalogueRow,
  canonicalJson,
  catalogueSnapshotMini,
  createEntry,
  createTemplate,
  parseSnapshot,
  patchEntry,
  placeholdersOf,
  priceChanges,
  renderTemplate,
  renderTemplateBody,
  sha256Hex,
  snapshotFromRows,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
  warmCatalogue,
} from "../src/catalogue.ts";
import { catalogueSnapshot } from "../src/schemas/catalogue-snapshot.ts";

const BUILD = [
  { label: "On acceptance", pctBp: 4_000, trigger: "on_accept" },
  { label: "Midpoint milestone", pctBp: 3_000, trigger: "milestone" },
  { label: "On delivery", pctBp: 3_000, trigger: "delivery" },
];
const terms = {
  dueDays: 7,
  proposalValidityDays: 15,
  buildSchedule: [
    { label: "On acceptance", pctBp: 4_000 },
    { label: "Midpoint milestone", pctBp: 3_000 },
    { label: "On delivery", pctBp: 3_000 },
  ],
  smallJobThreshold: { INR: 10_000_000, USD: 200_000 },
};
const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  code: "S5",
  name: "Custom Web Apps",
  slug: "custom-web-apps",
  category: "build",
  unit: "milestone",
  price_inr_minor: 30_000_000,
  price_usd_minor: 1_200_000,
  schedule: JSON.stringify(BUILD),
  default_lines: JSON.stringify([]),
  show_on_site: 1,
  active: 1,
  ...over,
});
const entry = {
  code: "S20",
  name: "A service",
  category: "build",
  short: "Short",
  unit: "fixed",
  priceInrMinor: 10_000,
  priceUsdMinor: null,
  sac: "998314",
  gstRateBp: null,
  defaultLines: null,
  schedule: BUILD,
  slug: "a-service",
  showOnSite: true,
};

describe("entry schemas (ADM-CAT-02)", () => {
  it("accepts a full entry", () => {
    expect(createEntry.safeParse(entry).success).toBe(true);
  });
  it.each([
    ["a SAC that is not six digits", { sac: "99831" }],
    ["a SAC with a letter", { sac: "99831a" }],
    ["a negative price", { priceInrMinor: -1 }],
    ["a fractional price", { priceInrMinor: 10.5 }],
    ["a GST rate over 100 %", { gstRateBp: 10_001 }],
    ["a bad slug", { slug: "Not A Slug" }],
    ["a bad code", { code: "X1" }],
    ["a schedule that is not 100 %", { schedule: [{ label: "x", pctBp: 9_000, trigger: "on_accept" }] }],
    ["an empty schedule", { schedule: [] }],
    ["an unknown field", { internal: 1 }],
    [
      "two default lines with one description",
      {
        defaultLines: [
          { description: "A", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 1, rateUsdMinor: null },
          { description: "A", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 2, rateUsdMinor: null },
        ],
      },
    ],
  ])("refuses %s", (_name, over) => {
    expect(createEntry.safeParse({ ...entry, ...over }).success).toBe(false);
  });
  it("an edit cannot carry a code and needs the version", () => {
    expect(patchEntry.safeParse({ expectedUpdatedAt: 1, code: "S2" }).success).toBe(false);
    expect(patchEntry.safeParse({ name: "x" }).success).toBe(false);
    expect(patchEntry.safeParse({ expectedUpdatedAt: 1, name: "x", gstRateBp: null }).success).toBe(true);
  });
});

describe("priceChanges (ADM-CAT-04)", () => {
  const line = (d: string, inr: number | null, usd: number | null) => ({
    description: d,
    rateInrMinor: inr,
    rateUsdMinor: usd,
  });
  const base = { priceInrMinor: 100, priceUsdMinor: 10, defaultLines: [line("Setup", 500, 50)] };
  it("lists nothing when nothing changed", () => {
    expect(priceChanges(base, { ...base })).toEqual([]);
  });
  it("lists INR, USD and line rates, one row per changed price", () => {
    const next = { priceInrMinor: 200, priceUsdMinor: 10, defaultLines: [line("Setup", 500, 60)] };
    expect(priceChanges(base, next)).toEqual([
      { field: "price_inr_minor", oldMinor: 100, newMinor: 200 },
      { field: "line:Setup:rate_usd_minor", oldMinor: 50, newMinor: 60 },
    ]);
  });
  it("lists an added and a removed line, and a price that becomes null", () => {
    const next = { priceInrMinor: 100, priceUsdMinor: null, defaultLines: [line("Monthly", 900, null)] };
    expect(priceChanges(base, next)).toEqual([
      { field: "price_usd_minor", oldMinor: 10, newMinor: null },
      { field: "line:Setup:rate_inr_minor", oldMinor: 500, newMinor: null },
      { field: "line:Setup:rate_usd_minor", oldMinor: 50, newMinor: null },
      { field: "line:Monthly:rate_inr_minor", oldMinor: null, newMinor: 900 },
    ]);
  });
});

describe("snapshotFromRows (ADM-CAT-05)", () => {
  it("builds a snapshot both schemas accept", () => {
    const s = snapshotFromRows([row()], terms);
    expect(parseSnapshot(s).ok).toBe(true);
    expect(catalogueSnapshot.safeParse(s).success).toBe(true);
  });
  it("leaves out inactive and off-site items, and sorts by code number", () => {
    const s = snapshotFromRows(
      [
        row({ code: "S10" }),
        row({ code: "S2" }),
        row({ code: "S3", active: 0 }),
        row({ code: "S4", show_on_site: 0 }),
      ],
      terms,
    );
    expect(s.items.map((i) => i.code)).toEqual(["S2", "S10"]);
  });
  it("never carries an internal field, whatever the row holds", () => {
    const dirty = {
      ...row({
        default_lines: JSON.stringify([
          {
            description: "Setup",
            unit: "fixed",
            qtyMilli: 1_000,
            rateInrMinor: 1,
            rateUsdMinor: null,
            sac: "998314",
          },
        ]),
        schedule: JSON.stringify(BUILD.map((s) => ({ ...s, note: "internal" }))),
      }),
      sac: "998314",
      gst_rate_bp: 1800,
      deliverables_md: "secret",
      assumptions_md: "secret",
      exclusions_md: "secret",
      id: "abc",
      created_at: 1,
      updated_at: 2,
    };
    const text = canonicalJson(snapshotFromRows([dirty], { ...terms, reminderOffsetsDays: [1] } as never));
    for (const word of [
      "sac",
      "gst",
      "deliverables",
      "assumptions",
      "exclusions",
      "secret",
      "998314",
      "created",
      "updated",
      "reminder",
      '"id"',
      "internal",
    ])
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    expect(parseSnapshot(JSON.parse(text)).ok).toBe(true);
  });
  it("carries the default-line rates", () => {
    const s = snapshotFromRows(
      [
        row({
          code: "S11",
          unit: "month",
          default_lines: JSON.stringify([
            { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 12_345, rateUsdMinor: 678 },
          ]),
        }),
      ],
      terms,
    );
    expect(s.items[0]?.defaultLines).toEqual([
      { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 12_345, rateUsdMinor: 678 },
    ]);
  });
  it("gives the same text and SHA for the same data, and another SHA for a changed price", async () => {
    const a = canonicalJson(snapshotFromRows([row()], terms));
    const b = canonicalJson(snapshotFromRows([row()], { ...terms }));
    expect(a).toBe(b);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    const c = canonicalJson(snapshotFromRows([row({ price_inr_minor: 1 })], terms));
    expect(await sha256Hex(c)).not.toBe(await sha256Hex(a));
  });
  it("canonical JSON sorts keys and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
});

describe("the mini twin agrees with the classic snapshot schema", () => {
  const good = snapshotFromRows([row(), row({ code: "S11", unit: "month" })], terms);
  const item = good.items[0] as Record<string, unknown>;
  const withItem = (over: Record<string, unknown>) => ({ ...good, items: [{ ...item, ...over }] });
  const withTerms = (over: Record<string, unknown>) => ({
    ...good,
    paymentTerms: { ...good.paymentTerms, ...over },
  });
  const cases: [string, unknown][] = [
    ["a good snapshot", good],
    ["a null price", withItem({ priceUsdMinor: null })],
    ["a null slug", withItem({ slug: null })],
    ...[
      "sac",
      "gstRateBp",
      "internalNotes",
      "deliverablesMd",
      "assumptionsMd",
      "exclusionsMd",
      "id",
      "active",
    ].map((f): [string, unknown] => [`the internal field ${f}`, withItem({ [f]: "x" })]),
    [
      "an internal field on a line",
      withItem({
        defaultLines: [
          { description: "x", unit: "fixed", qtyMilli: 1, rateInrMinor: 1, rateUsdMinor: null, sac: "1" },
        ],
      }),
    ],
    [
      "an internal field on a step",
      withItem({ schedule: [{ label: "x", pctBp: 10_000, trigger: "on_accept", note: "x" }] }),
    ],
    ["an extra payment-terms field", withTerms({ reminderOffsetsDays: [0] })],
    ["an extra top-level field", { ...good, bank: "x" }],
    ["a float price", withItem({ priceInrMinor: 10.5 })],
    ["a negative price", withItem({ priceInrMinor: -1 })],
    [
      "a schedule short of 100 %",
      withItem({ schedule: [{ label: "x", pctBp: 9_000, trigger: "on_accept" }] }),
    ],
    ["an hour unit", withItem({ unit: "hour" })],
    ["a bad code", withItem({ code: "X1" })],
    ["a bad slug", withItem({ slug: "Bad Slug" })],
    ["a bad category", withItem({ category: "other" })],
    ["duplicate codes", { ...good, items: [item, item] }],
    ["no items", { ...good, items: [] }],
    ["version 2", { ...good, version: 2 }],
    ["a build schedule short of 100 %", withTerms({ buildSchedule: [{ label: "x", pctBp: 5_000 }] })],
    ["due days over 90", withTerms({ dueDays: 91 })],
    ["validity days 0", withTerms({ proposalValidityDays: 0 })],
    ["a missing payment-terms field", withTerms({ dueDays: undefined })],
    ["not an object", "x"],
    ["null", null],
  ];
  it.each(cases)("both agree on %s", (_name, value) => {
    expect(parseSnapshot(value).ok).toBe(catalogueSnapshot.safeParse(value).success);
  });
  it("accepts the good snapshot and rejects an internal field (so the checks above are not vacuous)", () => {
    expect(catalogueSnapshotMini.safeParse(good).success).toBe(true);
    expect(parseSnapshot(withItem({ sac: "x" })).ok).toBe(false);
  });
  it("a failure names paths, never values", () => {
    const r = parseSnapshot(withItem({ name: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.paths.join(" ")).not.toContain("Custom");
  });
});

describe("templates (ADM-CAT-03)", () => {
  const data = Object.fromEntries(TEMPLATE_PLACEHOLDERS.map((p) => [p, `<${p}>`]));
  it("fills placeholders and lists none unresolved when all are given", () => {
    const r = renderTemplate("Hello {{client.name}} about {{ service.name }}", data);
    expect(r.text).toBe("Hello <client.name> about <service.name>");
    expect(r.unresolved).toEqual([]);
  });
  it("keeps a missing placeholder as written and lists it once", () => {
    const r = renderTemplate("{{a.b}} {{a.b}} {{client.name}}", { "client.name": "X" });
    expect(r.text).toBe("{{a.b}} {{a.b}} X");
    expect(r.unresolved).toEqual(["a.b"]);
  });
  it("treats an empty value as unresolved", () => {
    expect(renderTemplate("{{client.name}}", { "client.name": "" }).unresolved).toEqual(["client.name"]);
  });
  it("an empty placeholder is not unresolved: its line goes, in a mixed line only the token goes", () => {
    const empty = new Set(["service.assumptions", "service.exclusions"]);
    const both = renderTemplate("{{service.assumptions}}\n{{service.exclusions}}", {}, { empty });
    expect(both).toEqual({ text: "", unresolved: [] });
    const one = renderTemplate(
      "{{service.assumptions}}\n{{service.exclusions}}",
      { "service.assumptions": "A" },
      { empty },
    );
    expect(one).toEqual({ text: "A", unresolved: [] });
    const mixed = renderTemplate(
      "Intro\n\n{{service.exclusions}}\n\nNot included: {{service.exclusions}} ok\nEnd",
      {},
      { empty },
    );
    expect(mixed.text).toBe("Intro\n\nNot included:  ok\nEnd");
    expect(mixed.text).not.toContain("{{");
  });
  it("an unknown placeholder next to an empty one stays and is listed", () => {
    const r = renderTemplate(
      "{{service.exclusions}}\n{{client.contact}}",
      {},
      { empty: new Set(["service.exclusions"]) },
    );
    expect(r).toEqual({ text: "{{client.contact}}", unresolved: ["client.contact"] });
  });
  it("renderTemplateBody passes the empty set to every section", () => {
    const body = { sections: [{ key: "a", heading: "H", body: "{{service.deliverables}}" }] };
    const r = renderTemplateBody(body, {}, { empty: new Set(["service.deliverables"]) });
    expect(r).toEqual({ sections: [{ key: "a", heading: "H", text: "" }], unresolved: [] });
  });
  it("finds the placeholders and the unknown ones in a body", () => {
    expect(placeholdersOf("{{client.name}} {{x.y}} {{client.name}}")).toEqual(["client.name", "x.y"]);
    const body = { sections: [{ key: "a", heading: "H {{nope.nope}}", body: "{{client.name}}" }] };
    expect(unknownPlaceholders(body)).toEqual(["nope.nope"]);
    expect(renderTemplateBody(body, data).unresolved).toEqual(["nope.nope"]);
  });
  it("validates a new version's shape", () => {
    const ok = {
      kind: "proposal",
      category: "build",
      body: { sections: [{ key: "scope", heading: "Scope", body: "" }] },
    };
    expect(createTemplate.safeParse(ok).success).toBe(true);
    expect(createTemplate.safeParse({ ...ok, kind: "other" }).success).toBe(false);
    expect(createTemplate.safeParse({ ...ok, body: { sections: [] } }).success).toBe(false);
  });
});

describe("start-up warm-up (M4.1)", () => {
  it("parses all four samples, silently", () => {
    expect(warmCatalogue()).toBe(4);
  });
});
