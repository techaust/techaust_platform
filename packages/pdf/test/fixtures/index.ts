// Document fixtures for the PDF tests: envelopes built through core's REAL tax engine (computeDocument, computeSchedule), so every
// figure is what the engine produces. SAMPLE DATA ONLY (the repo is public): "Sample ..." names, @example.test addresses.

import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import {
  type ComputedDocument,
  computeDocument,
  computeSchedule,
  type LineInput,
  type TaxContext,
} from "@techaust/core/tax";
import { type ContentHasher, type HashDraft, serializeEnvelope } from "../../src/envelope.ts";
import { canonicalJson, sha256Hex } from "../../src/hash.ts";
import type {
  Envelope,
  EnvLine,
  EnvSection,
  EnvStep,
  RecipientSnap,
  SnapshotHeader,
} from "../../src/types.ts";

/**
 * Stands in for M4.3's `contentHash` (core documents.ts), which is not on this branch yet: a SHA-256 over the draft and the computed
 * result. The jobs consumer passes the real one; the envelope code only calls "a hasher".
 */
export const testContentHash: ContentHasher = (draft: HashDraft, computed: unknown) =>
  sha256Hex(JSON.stringify({ draft, computed }));

// SAMPLE: not TecHaust's GSTIN (a made-up number whose check character is valid).
export const SAMPLE_SUPPLIER_GSTIN = "19ABCDE1234F1ZX";
export const SAMPLE_CLIENT_GSTIN_27 = "27ABCDE1234F1Z0";

export const FIXTURE_NAMES = [
  "short-intra-inr",
  "long-inter-inr",
  "usd-export",
  "intra-estimate",
  "inter-estimate",
  "long-names",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

const ctx: TaxContext = {
  tax: SETTINGS_DEFAULTS.tax,
  supplierStateCode: "19",
  luts: [{ fy: "2627", arn: "SAMPLE-LUT-ARN" }],
};

type LineSpec = {
  description: string;
  detail?: string;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discount?: { kind: "percent"; bp: number } | { kind: "fixed"; minor: number };
};

type Spec = {
  name: FixtureName;
  type: "proposal" | "estimate";
  number: number;
  version: number;
  currency: "INR" | "USD";
  recipient: RecipientSnap;
  lines: LineSpec[];
  sections: EnvSection[];
  steps: { label: string; trigger: string; pctBp: number; detail?: string }[];
  documentDiscount?: { kind: "percent"; bp: number };
  /** An empty supplier block (staging before the owner fills the company settings). */
  bareSupplier?: boolean;
};

const para = (n: number, who: string) =>
  Array.from(
    { length: n },
    (_, i) =>
      `Sample paragraph ${i + 1} for ${who}. It has **bold words**, some *emphasis*, a [link](https://example.test/page) and enough text to wrap across several lines of the printed page.`,
  ).join("\n\n");

const SECTION_KINDS = [
  "cover",
  "summary",
  "problem_goals",
  "scope",
  "deliverables",
  "timeline",
  "team",
  "how_we_work",
  "assumptions_exclusions",
  "custom",
];

const fullSections = (): EnvSection[] => [
  ...SECTION_KINDS.map((kind) => ({
    kind,
    title: kind === "custom" ? "Sample custom section" : null,
    bodyMd: `${para(2, kind)}\n\n- First sample point\n- Second sample point with a **strong** word\n\n1. Step one\n2. Step two`,
    hidden: false,
  })),
  { kind: "estimate", title: null, bodyMd: "The estimate is below.", hidden: false },
  { kind: "terms", title: null, bodyMd: "The terms of this offer apply.", hidden: false },
  { kind: "acceptance", title: null, bodyMd: "Accept this offer in the client portal.", hidden: false },
  { kind: "team", title: "Hidden sample", bodyMd: "This hidden section must not be printed.", hidden: true },
];

const requiredSections = (): EnvSection[] => [
  { kind: "summary", title: null, bodyMd: "Sample summary of a small piece of work.", hidden: false },
  { kind: "estimate", title: null, bodyMd: "The estimate is below.", hidden: false },
  { kind: "terms", title: null, bodyMd: "The terms of this offer apply.", hidden: false },
  { kind: "acceptance", title: null, bodyMd: "Accept this offer in the client portal.", hidden: false },
];

const wbClient: RecipientSnap = {
  legalName: "Sample Client Private Limited",
  displayName: "Sample Client",
  gstin: "19ABCDE1234F1ZX",
  stateCode: "19",
  address: {
    line1: "1 Sample Road",
    city: "Kolkata",
    state: "West Bengal",
    postalCode: "700001",
    country: "IN",
  },
  email: "client@example.test",
  country: "IN",
  contactId: "con_sample_1",
  contactName: "Sample Contact",
  clientType: "business",
  gstStatus: "registered",
};

const SPECS: Record<FixtureName, Spec> = {
  "short-intra-inr": {
    name: "short-intra-inr",
    type: "proposal",
    number: 3,
    version: 2,
    currency: "INR",
    recipient: wbClient,
    lines: [
      { description: "Sample discovery workshop", qtyMilli: 1000, unit: "fixed", rateMinor: 2_500_000 },
      {
        description: "Sample build",
        detail: "Two sample milestones",
        qtyMilli: 1500,
        unit: "days",
        rateMinor: 1_200_000,
      },
      {
        description: "Sample review",
        qtyMilli: 2000,
        unit: "hours",
        rateMinor: 350_050,
        discount: { kind: "percent", bp: 1000 },
      },
    ],
    sections: requiredSections(),
    steps: [
      { label: "On acceptance", trigger: "on_accept", pctBp: 4000 },
      { label: "Midpoint", trigger: "milestone", pctBp: 3000 },
      { label: "On delivery", trigger: "delivery", pctBp: 3000 },
    ],
  },
  "long-inter-inr": {
    name: "long-inter-inr",
    type: "proposal",
    number: 12,
    version: 1,
    currency: "INR",
    recipient: {
      ...wbClient,
      legalName: "Sample Maharashtra Industries Limited",
      displayName: "Sample Maharashtra",
      gstin: "27ABCDE1234F1Z0",
      stateCode: "27",
      address: {
        line1: "7 Sample Street",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "IN",
      },
    },
    lines: Array.from({ length: 40 }, (_, i) => ({
      description: `Sample line ${i + 1}: a description long enough to wrap onto a second line of the items table`,
      ...(i % 3 === 0 ? { detail: `Sample detail ${i + 1} with more words` } : {}),
      qtyMilli: 1000 + (i % 4) * 500,
      unit: i % 2 === 0 ? "days" : "hours",
      rateMinor: 150_000 + i * 12_345,
      ...(i % 7 === 0 ? { discount: { kind: "percent" as const, bp: 500 } } : {}),
    })),
    sections: fullSections(),
    steps: [
      { label: "On acceptance", trigger: "on_accept", pctBp: 2500 },
      {
        label: "Design sign-off",
        trigger: "milestone",
        pctBp: 2500,
        detail: "After the sample design is approved",
      },
      { label: "Build complete", trigger: "milestone", pctBp: 2500 },
      { label: "On delivery", trigger: "delivery", pctBp: 2500 },
    ],
    documentDiscount: { kind: "percent", bp: 500 },
  },
  "usd-export": {
    name: "usd-export",
    type: "estimate",
    number: 5,
    version: 1,
    currency: "USD",
    recipient: {
      legalName: "Sample Overseas LLC",
      displayName: "Sample Overseas",
      address: {
        line1: "100 Sample Avenue",
        city: "Austin",
        state: "Texas",
        postalCode: "73301",
        country: "US",
      },
      email: "client@example.test",
      country: "US",
      contactId: "con_sample_2",
      contactName: "Sample Overseas Contact",
      clientType: "business",
      gstStatus: "overseas",
    },
    lines: [
      { description: "Sample platform build", qtyMilli: 1000, unit: "fixed", rateMinor: 1_250_000 },
      { description: "Sample support", qtyMilli: 3000, unit: "months", rateMinor: 90_000 },
    ],
    sections: requiredSections(),
    steps: [
      { label: "On acceptance", trigger: "on_accept", pctBp: 5000 },
      { label: "On delivery", trigger: "delivery", pctBp: 5000 },
    ],
  },
  "intra-estimate": {
    name: "intra-estimate",
    type: "estimate",
    number: 7,
    version: 1,
    currency: "INR",
    recipient: wbClient,
    lines: [
      { description: "Sample website refresh", qtyMilli: 1000, unit: "fixed", rateMinor: 4_000_000 },
      { description: "Sample content setup", qtyMilli: 4000, unit: "hours", rateMinor: 120_000 },
    ],
    sections: requiredSections(),
    steps: [{ label: "On acceptance", trigger: "on_accept", pctBp: 10000 }],
  },
  "inter-estimate": {
    name: "inter-estimate",
    type: "estimate",
    number: 8,
    version: 1,
    currency: "INR",
    recipient: {
      ...wbClient,
      legalName: "Sample Karnataka Traders",
      displayName: "Sample Karnataka",
      gstin: "29ABCDE1234F1ZW",
      stateCode: "29",
      address: {
        line1: "3 Sample Lane",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
    },
    lines: [{ description: "Sample integration", qtyMilli: 2500, unit: "days", rateMinor: 1_800_000 }],
    sections: requiredSections(),
    steps: [{ label: "On acceptance", trigger: "on_accept", pctBp: 10000 }],
  },
  "long-names": {
    name: "long-names",
    type: "proposal",
    number: 9,
    version: 1,
    currency: "INR",
    recipient: {
      legalName: "Sample Extraordinarily Long Named Technology and Consultancy Services Private Limited",
      displayName: "Sample Extraordinarily Long Named Technology and Consultancy Services",
      gstin: "19ABCDE1234F1ZX",
      stateCode: "19",
      address: {
        line1:
          "Flat 12B, Sample Tower Number Forty-Two, Extraordinarily Long Sample Road Name Near The Sample Junction",
        line2: "Opposite the Sample Landmark That Also Has A Very Long Name",
        city: "Balurghat",
        state: "West Bengal",
        postalCode: "733101",
        country: "IN",
      },
      email: "client@example.test",
      country: "IN",
      contactId: "con_sample_3",
      contactName: "Sample Contact With An Unusually Long Full Name And Designation",
      clientType: "business",
      gstStatus: "registered",
    },
    lines: [
      {
        description:
          "Sample line with an extraordinarily long description that keeps going well past the width of the description column so that it must wrap",
        detail:
          "Sample detail text that is also long enough to need several lines inside its cell of the table",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 9_999_900,
      },
    ],
    sections: requiredSections(),
    steps: [{ label: "On acceptance", trigger: "on_accept", pctBp: 10000 }],
  },
};

export type Fixture = { name: FixtureName; envelope: Envelope; computed: ComputedDocument };

/** Builds one fixture envelope. `bareSupplier` leaves the company fields empty, as on a staging that has no settings filled in. */
export async function buildFixture(
  name: FixtureName,
  options: { bareSupplier?: boolean } = {},
): Promise<Fixture> {
  const spec = SPECS[name];
  const bare = options.bareSupplier ?? spec.bareSupplier ?? false;
  const lineInputs: LineInput[] = spec.lines.map((l) => ({
    sac: "998314",
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
    ...(l.discount ? { discount: l.discount } : {}),
  }));
  const result = computeDocument(
    {
      currency: spec.currency,
      documentDate: { year: 2026, month: 10, day: 26 },
      recipient: {
        gstStatus: spec.recipient.gstStatus ?? "registered",
        country: spec.recipient.country,
        ...(spec.recipient.gstin ? { gstin: spec.recipient.gstin } : {}),
        ...(spec.recipient.stateCode ? { stateCode: spec.recipient.stateCode } : {}),
      },
      lines: lineInputs,
      ...(spec.documentDiscount ? { documentDiscount: spec.documentDiscount } : {}),
      ...(spec.currency === "USD" ? { fx: { rateMicros: 83_500_000 } } : {}),
    },
    ctx,
  );
  if (!result.ok) throw new Error(`fixture ${name}: ${JSON.stringify(result.errors)}`);
  const computed = result.value;
  const schedule = computeSchedule(
    computed.totalMinor,
    spec.currency,
    spec.steps.map((s) => ({ label: s.label, trigger: s.trigger as "on_accept", pctBp: s.pctBp })),
    ctx,
  );
  if (!schedule.ok) throw new Error(`fixture ${name} schedule: ${JSON.stringify(schedule.errors)}`);

  const lines: EnvLine[] = spec.lines.map((l) => ({
    catalogueItemId: null,
    description: l.description,
    detail: l.detail ?? null,
    sac: "998314",
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
    discountKind: l.discount ? l.discount.kind : null,
    discountValue: l.discount ? (l.discount.kind === "percent" ? l.discount.bp : l.discount.minor) : null,
    gstRateBp: 1800,
    catalogueRateMinor: null,
    catalogueLine: null,
  }));
  const steps: EnvStep[] = spec.steps.map((s) => ({
    label: s.label,
    trigger: s.trigger,
    pctBp: s.pctBp,
    detail: s.detail ?? null,
    targetDate: null,
  }));
  const termsBody = "Sample terms.\n\n1. Payment is due as scheduled.\n2. Work starts on acceptance.";
  const termsSha = await sha256Hex(termsBody);
  const computedJson = JSON.stringify(computed);
  const company = bare
    ? { tradeName: "TecHaust Technologies", legalName: null, address: null, gstin: null, stateCode: "19" }
    : {
        tradeName: "TecHaust Technologies",
        legalName: "Sample Proprietor",
        address: "1 Sample Supplier Road, Balurghat, West Bengal 733101",
        gstin: SAMPLE_SUPPLIER_GSTIN,
        stateCode: "19",
      };
  const header: SnapshotHeader = {
    document: {
      type: spec.type,
      clientId: "cli_sample_1",
      versionGroupId: `grp_${spec.name}`,
      version: spec.version,
      currency: spec.currency,
      title: `Sample ${spec.type} for ${spec.name}`,
      issueDate: "2026-10-26",
      validUntil: "2026-11-10",
      validityDays: 15,
      contentSha256: "",
      discountKind: spec.documentDiscount ? "percent" : null,
      discountValue: spec.documentDiscount ? spec.documentDiscount.bp : null,
      exportMode: spec.currency === "USD" ? "lut" : null,
    },
    supply: {
      type: computed.supply.type,
      placeOfSupplyCode: computed.supply.placeOfSupplyCode,
      supplierStateCode: computed.supply.supplierStateCode,
    },
    recipient: spec.recipient,
    issuer: {
      company: { ...company, logo: "logo-primary-color.svg" },
      sender: { staffId: "stf_sample_1", name: "Sample Proprietor", email: "sender@example.test" },
    },
    terms: { id: "trm_sample_1", version: 3, sha256: termsSha },
    instalmentAmounts: schedule.value.map((s) => s.amountMinor),
    computedSha256: await sha256Hex(computedJson),
  };
  const snapshotBase = {
    v: 2 as const,
    header,
    computedJson,
    lines,
    sections: spec.sections,
    schedule: steps,
    terms: { id: "trm_sample_1", version: 3, sha256: termsSha, bodyMd: termsBody },
  };
  const draft: HashDraft = {
    type: spec.type,
    clientId: header.document.clientId,
    contactId: spec.recipient.contactId ?? null,
    title: header.document.title,
    currency: spec.currency,
    validityDays: 15,
    termsVersionId: "trm_sample_1",
    discountKind: header.document.discountKind,
    discountValue: header.document.discountValue,
    exportMode: header.document.exportMode,
    lines,
    sections: spec.sections,
    schedule: steps,
  };
  header.document.contentSha256 = await testContentHash(draft, JSON.parse(computedJson));
  const snapshotSha256 = await sha256Hex(canonicalJson({ v: 2, header }));
  const prefix = spec.type === "proposal" ? "PRP" : "EST";
  const envelope: Envelope = {
    v: 1,
    documentId: `doc_sample_${spec.name.replaceAll("-", "_")}`,
    type: spec.type,
    version: spec.version,
    number: spec.number,
    numberDisplay: `TH/${prefix}/2627/${String(spec.number).padStart(4, "0")}`,
    series: spec.type,
    fy: "2026-27",
    sentAt: Date.UTC(2026, 9, 26, 6, 0, 0),
    snapshotSha256,
    snapshot: snapshotBase,
  };
  return { name, envelope, computed };
}

/** The stored text of a fixture's envelope. */
export async function fixtureText(name: FixtureName): Promise<string> {
  return serializeEnvelope((await buildFixture(name)).envelope);
}
