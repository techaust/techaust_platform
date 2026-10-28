// The proposal and estimate screens' pure rules [ADM-PROP-01..06, ADM-APR-01, ADM-G-04]: 07-O word for word, the statuses, the errors by
// code, what an autosave sends (only the parts that changed, in the API's units, never floats) and how its answer lands on the screen
// (the server's ids by position, figures kept when unchanged, a part edited during the save stays dirty).
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";

/** The mark a line not yet approved would carry (none should). */
const PLACEHOLDER_TAG = "[Placeholder]";

import { DASH_COPY, pipelineLine } from "./dashboard.ts";
import {
  applySave,
  approvalLine,
  blockerText,
  buildPatch,
  CARE_HOURS_HINT,
  CONVERTED_TO_INVOICE,
  careAiOps,
  careDone,
  careOfLines,
  careSummary,
  convertedToCare,
  DOC_COPY,
  DOC_ERRORS,
  DOC_PENDING,
  DOC_TOASTS,
  decisionLine,
  decisionTitle,
  docErrorText,
  editor,
  emptySectionsOf,
  guardLine,
  initEditor,
  isDirty,
  type LineDraft,
  lineErrors,
  mappedError,
  moved,
  newerTerms,
  OPEN_IT,
  placeholdersIn,
  placeOfSupplyLabel,
  recipientLine,
  reviseBody,
  STATUS_LABELS,
  sectionEmptyLine,
  sectionTitleName,
  sendLine,
  sentAs,
  shownStatus,
  termsLine,
  unresolvedLine,
  versionLine,
} from "./documents.ts";
import type { DocumentView, SaveAnswer, ViewLine } from "./documents-api.ts";

const view = (over: Partial<DocumentView> = {}): DocumentView => ({
  id: "d1",
  type: "proposal",
  status: "draft",
  version: 1,
  versionGroupId: "d1",
  number: null,
  title: "Sample (fake)",
  currency: "INR",
  validityDays: 15,
  validUntil: null,
  issueDate: null,
  sentAt: null,
  createdAt: 1,
  updatedAt: 100,
  contentSha256: "h",
  frozen: false,
  client: {
    id: "c1",
    code: "SAMPLE-A",
    name: "Sample Client A (sample)",
    type: "business",
    gstStatus: "registered",
    stateCode: "19",
    country: "IN",
    currency: "INR",
    anonymised: false,
  },
  contact: null,
  discount: null,
  exportMode: null,
  lines: [
    {
      id: "l1",
      position: 1,
      catalogueItemId: "s9",
      catalogueRateMinor: 20_000_000,
      catalogueLine: null,
      description: "AI Document Automation",
      detail: null,
      sac: "998314",
      qtyMilli: 1_000,
      unit: "fixed",
      rateMinor: 20_000_000,
      discount: null,
      gstRateBp: 1_800,
      taxableMinor: 20_000_000,
      cgstMinor: 1_800_000,
      sgstMinor: 1_800_000,
      igstMinor: 0,
      lineTotalMinor: 23_600_000,
    },
  ],
  sections: [{ id: "s1", position: 1, kind: "estimate", hidden: false, title: "Estimate", bodyMd: null }],
  schedule: [
    {
      id: "p1",
      position: 1,
      label: "On acceptance",
      trigger: "on_accept",
      pctBp: 10_000,
      amountMinor: 23_600_000,
      detail: null,
      targetDate: null,
    },
  ],
  totals: null,
  supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
  summary: null,
  guard: null,
  approval: {
    state: "none",
    id: null,
    requestedBy: null,
    requestedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
  },
  versions: [],
  terms: { id: "t1", version: 1, sha256: "x" },
  termsOutdated: false,
  newestTermsVersion: 1,
  errors: [],
  warnings: [],
  blockers: [],
  unresolved: [],
  canSend: true,
  needsResave: false,
  attachPdfDefault: false,
  ...over,
});

const answer = (s: ReturnType<typeof initEditor>, lineIds: string[]): SaveAnswer => ({
  id: "d1",
  updatedAt: 200,
  contentSha256: "h2",
  totals: null,
  supply: s.figures.supply,
  summary: null,
  lines: lineIds.map((id, i) => ({
    id,
    position: i + 1,
    taxableMinor: 20_000_000,
    cgstMinor: 1_800_000,
    sgstMinor: 1_800_000,
    igstMinor: 0,
    lineTotalMinor: 23_600_000,
  })),
  sections: [{ id: "s1", position: 1 }],
  schedule: [{ id: "p1", position: 1, amountMinor: 23_600_000 }],
  guard: {
    referenceMinor: 0,
    taxableMinor: 0,
    discountMinor: 0,
    discountBp: 0,
    needsApproval: false,
    customLines: [],
  },
  approval: s.figures.approval,
  terms: s.figures.terms,
  termsOutdated: false,
  newestTermsVersion: 1,
  errors: [],
  warnings: [],
  blockers: [],
  unresolved: [],
  canSend: true,
  needsResave: false,
});

describe("07-O copy, word for word (draft pending the owner)", () => {
  it("editor, approvals, send, versions and conversions", () => {
    expect(DOC_COPY.listHeading).toBe("Proposals and estimates");
    expect([DOC_COPY.listEmptyTitle, DOC_COPY.listEmptyBody]).toEqual([
      "No proposals or estimates yet",
      "Start one from a lead or a client.",
    ]);
    expect(DOC_COPY.listNoMatch).toBe("Try fewer filters, or search for the start of a number.");
    expect(DOC_COPY.createHint).toBe(
      "The matching template fills in the sections, lines and payment schedule. You can change everything before sending.",
    );
    expect(DOC_COPY.alwaysIncluded).toBe(
      "Always included: the estimate, terms and acceptance sections can't be hidden.",
    );
    expect(DOC_COPY.previewNote).toBe("A preview: the tax is fixed on the invoice.");
    expect(DOC_COPY.scheduleRule).toBe("Instalments always add up to the total.");
    expect(DOC_COPY.noContact).toBe("No contact chosen yet: you choose recipients when sending.");
    expect(newerTerms(3)).toBe(
      "Newer terms (version 3) exist. Use them? This changes the content, so any approval has to be asked for again.",
    );
    expect(unresolvedLine("{{client.name}}")).toBe(
      "These placeholders have no value yet: {{client.name}}. Fill them in before sending.",
    );
    expect(DOC_COPY.needsResave).toBe(
      "Prices or tax rules changed since this draft was saved. Save it once to update the figures.",
    );
    expect(DOC_COPY.customLine).toBe("Custom line: not from the catalogue");
    expect(guardLine(1250)).toBe("12.5 % off catalogue prices");
    expect(DOC_COPY.overTen).toBe(
      "More than 10 % off catalogue prices needs the owner's approval before sending.",
    );
    expect(DOC_COPY.requestNote).toBe(
      "The approval applies to this version only. Any change afterwards needs a new approval.",
    );
    expect(decisionTitle("Tally pilot", 2)).toBe("Approve Tally pilot v2?");
    expect(decisionLine(1500, "₹1,00,000.00")).toBe("15 % off catalogue prices, ₹1,00,000.00 total");
    expect(sendLine("₹2,36,000.00", "Sample Client A (sample)")).toBe(
      "₹2,36,000.00 to Sample Client A (sample)",
    );
    expect(DOC_COPY.sendIntro).toBe(
      "Sending gives this version its number and freezes it. Changes afterwards make a new version.",
    );
    // M4.5 sends the email: M4.3's interim "until the portal" line is gone (07-N replaces it).
    expect("untilPortal" in DOC_COPY).toBe(false);
    expect(sentAs("TH/PRP/2627/0001", 2)).toBe("Sent as TH/PRP/2627/0001 v2.");
    expect(versionLine(1, "Revised", "26 Oct 2026")).toBe("v1, Revised, 26 Oct 2026");
    expect(reviseBody(1)).toBe(
      "v1 stays acceptable until the new version is sent; then it shows as Revised.",
    );
    expect(termsLine(4)).toBe("The terms below are version 4 of our terms.");
    expect(Object.values(DOC_TOASTS)).toEqual([
      "Draft created.",
      "Draft saved.",
      "New version made.",
      "Draft discarded.",
      "Approval requested.",
      "Approved.",
      "Rejected.",
    ]);
  });

  it("statuses: pending approval is the draft's approval record, never a stored status", () => {
    expect(Object.values(STATUS_LABELS)).toEqual([
      "Draft",
      "Pending approval",
      "Sent",
      "Viewed",
      "Accepted",
      "Declined",
      "Expired",
      "Revised",
    ]);
    expect(shownStatus("draft", "pending")).toBe("pending_approval");
    expect(shownStatus("draft", "approved")).toBe("draft");
    expect(shownStatus("sent", "pending")).toBe("sent");
  });

  it("07-O §9: the accepted drafts carry no placeholder tag any more", () => {
    for (const v of Object.values(DOC_PENDING)) {
      const text = typeof v === "function" ? (v as (x: never) => string)(2 as never) : v;
      expect(text.includes(PLACEHOLDER_TAG)).toBe(false);
    }
    expect(DOC_PENDING.noLines).toBe("No lines yet. Add a line from the catalogue or a custom line.");
    expect(DOC_PENDING.customLinesCount(1)).toBe("1 custom line");
    expect(DOC_PENDING.customLinesCount(3)).toBe("3 custom lines");
    expect(DOC_PENDING.readOnlyDraft).toBe("Your role can read this draft but not change it.");
  });

  it("07-O §4 and §5 after the screens: the owner's over-10 % line, the care plan result", () => {
    expect(DOC_COPY.overTenOwner).toBe(
      "More than 10 % off catalogue prices. As the owner, you can send it without approval.",
    );
    expect(careDone("Sample Client A (sample)", "Growth")).toBe(
      "Care plan for Sample Client A (sample) (Growth) created.",
    );
  });

  it("07-O §10: the review fixes' sentences", () => {
    expect(CARE_HOURS_HINT).toEqual({
      essential: "Leave empty to use the plan's 2 hours.",
      required: "Required: this plan's hours are agreed per client.",
    });
    expect(careSummary("Growth", "Sample Client A (sample)", "₹25,000.00")).toBe(
      "Growth care plan for Sample Client A (sample): ₹25,000.00 a month before GST",
    );
    expect(careAiOps("₹5,000.00")).toBe("plus ₹5,000.00 a month for AI Ops");
    expect(CONVERTED_TO_INVOICE).toBe("Converted to an invoice draft.");
    expect(convertedToCare("Sample Client A (sample)", "Scale")).toBe(
      "Converted to a care plan for Sample Client A (sample) (Scale).",
    );
    expect(convertedToCare("Sample Client A (sample)", null)).toBe(
      "Converted to a care plan for Sample Client A (sample).",
    );
    expect(OPEN_IT).toBe("Open it");
    expect(sectionTitleName("Summary")).toBe("Title of Summary");
    expect(sectionEmptyLine("Summary, Team")).toBe(
      "Write these sections or hide them before sending: Summary, Team.",
    );
    expect(DOC_ERRORS.approval_rejected).toBe(
      "The owner rejected this version. Change it before asking again.",
    );
  });
});

describe("errors by API code (07-O §6)", () => {
  const e = (code: string, message = "Server words") => new RequestError(409, code, message);
  it("07-O's sentence for a known code, the server's words as a sentence otherwise", () => {
    expect(docErrorText(e("stale_version"))).toBe(
      "Someone else saved this at the same moment. Reload and try again.",
    );
    expect(docErrorText(e("approval_required"))).toBe("This needs the owner's approval before sending.");
    expect(docErrorText(e("converted_to_invoice"))).toBe(
      "This estimate already has an invoice draft, so it can't also become a care plan.",
    );
    expect(docErrorText(e("service_not_priced"), { service: "Care Plans", currency: "USD" })).toBe(
      "Care Plans has no price in USD.",
    );
    expect(docErrorText(e("something_new", "Not like this"))).toBe("Not like this.");
    expect(docErrorText(e("constructor", "Odd"))).toBe("Odd.");
    expect(docErrorText(new Error("x"))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
    const m = mappedError(e("frozen")) as RequestError;
    expect([m.code, m.message]).toEqual(["frozen", DOC_ERRORS.frozen]);
  });
  it("blockers read as 07-O's short sentences", () => {
    expect(blockerText({ code: "title_required" })).toBe("Add a title.");
    expect(blockerText({ code: "unresolved_placeholders", names: ["client.name"] })).toBe(
      "Some placeholders have no value yet.",
    );
  });
  it("section_empty names the sections: by the server's keys, else the editor's own empty visible optional ones", () => {
    const sec = (id: string, kind: string, bodyMd = "", hidden = false, title = "") => ({
      uid: `u-${id}`,
      id,
      kind,
      title,
      bodyMd,
      hidden,
    });
    const list = [
      sec("a", "cover", "Hello"),
      sec("b", "summary"),
      sec("c", "team", "", true),
      sec("d", "custom", "", false, "Hosting"),
      sec("e", "terms"),
    ];
    // By kind and by id, in the editor's order.
    expect(
      emptySectionsOf({ code: "section_empty", sections: ["d", "summary"] }, list).map((s) => s.id),
    ).toEqual(["b", "d"]);
    // The server's `kinds` alone (the name the Worker sends) work the same.
    expect(
      emptySectionsOf({ code: "section_empty", kinds: ["summary", "custom"] }, list).map((s) => s.id),
    ).toEqual(["b", "d"]);
    // No keys: shown, optional and empty only (not the hidden team, not the required terms).
    expect(emptySectionsOf({ code: "section_empty" }, list).map((s) => s.id)).toEqual(["b", "d"]);
    expect(blockerText({ code: "section_empty", sections: ["summary"] }, list)).toBe(
      "Write these sections or hide them before sending: Summary.",
    );
    expect(blockerText({ code: "section_empty" }, list)).toBe(
      "Write these sections or hide them before sending: Summary, Hosting.",
    );
  });
});

describe("the care plan an estimate describes (ADM-G-04 summary; core's mapping, no sums here)", () => {
  const line = (over: Partial<ViewLine>): ViewLine => ({
    id: "l",
    position: 1,
    catalogueItemId: "cat-s16",
    catalogueRateMinor: 2_500_000,
    catalogueLine: "Growth",
    description: "Growth plan",
    detail: null,
    sac: "998313",
    qtyMilli: 1000,
    unit: "month",
    rateMinor: 2_500_000,
    discount: null,
    gstRateBp: 1800,
    taxableMinor: 2_500_000,
    cgstMinor: 225_000,
    sgstMinor: 225_000,
    igstMinor: 0,
    lineTotalMinor: 2_950_000,
    ...over,
  });
  const codes: Record<string, string> = { "cat-s16": "S16", "cat-s17": "S17", "cat-s1": "S1" };
  const codeOf = (id: string) => codes[id];
  it("tier, price and AI Ops from the lines as the server worked them out", () => {
    expect(
      careOfLines(
        [line({}), line({ catalogueItemId: "cat-s17", catalogueLine: null, taxableMinor: 500_000 })],
        codeOf,
      ),
    ).toEqual({ tier: "growth", priceMinor: 2_500_000, aiOpsMinor: 500_000 });
    expect(careOfLines([line({ catalogueLine: "Essential", taxableMinor: 1_000_000 })], codeOf)).toEqual({
      tier: "essential",
      priceMinor: 1_000_000,
      aiOpsMinor: null,
    });
  });
  it("null when the lines describe no care plan, or a code or figure is unknown", () => {
    expect(careOfLines([line({ catalogueItemId: "cat-s1" })], codeOf)).toBeNull();
    expect(careOfLines([line({ catalogueItemId: "cat-unknown" })], codeOf)).toBeNull();
    expect(careOfLines([line({ taxableMinor: null })], codeOf)).toBeNull();
  });
});

describe("the autosave: what a save sends", () => {
  it("nothing when nothing changed; only the edited parts, in minor units, basis points and milli-units", () => {
    let s = initEditor(view());
    expect(buildPatch(s)).toEqual({ ok: true, patch: null });
    s = editor(s, {
      type: "line",
      uid: s.lines[0]?.uid as string,
      patch: { qty: "2.5", rate: "1,50,000.50", disc: "12.5" },
    });
    s = editor(s, { type: "fields", patch: { disc: "2,000", discKind: "fixed" } });
    const b = buildPatch(s);
    if (!b.ok || !b.patch) throw new Error("no patch");
    expect(Object.keys(b.patch).sort()).toEqual(["expectedUpdatedAt", "fields", "lines"]);
    expect(b.patch.expectedUpdatedAt).toBe(100);
    expect(b.patch.lines?.[0]).toMatchObject({
      id: "l1",
      qtyMilli: 2_500,
      rateMinor: 15_000_050,
      discount: { kind: "percent", value: 1_250 },
    });
    // a catalogue line keeps its SAC and GST rate on the server: they are not sent
    expect(b.patch.lines?.[0]).not.toHaveProperty("sac");
    expect(b.patch.fields?.discount).toEqual({ kind: "fixed", value: 200_000 });
  });

  it("a field that can't be read stops the save with its message", () => {
    let s = initEditor(view());
    s = editor(s, { type: "line", uid: s.lines[0]?.uid as string, patch: { qty: "1.2345" } });
    expect(buildPatch(s)).toEqual({ ok: false, error: DOC_PENDING.enterQty });
    expect(lineErrors({ ...s.lines[0], qty: "1" } as never, "INR")).toEqual({});
  });

  it("a new custom line sends its own SAC and GST rate; a new catalogue line may leave its rate to the catalogue", () => {
    let s = initEditor(view());
    s = editor(s, {
      type: "lines",
      lines: [
        ...s.lines,
        {
          ...(s.lines[0] as LineDraft),
          uid: "n1",
          id: null,
          catalogueItemId: null,
          sac: "998314",
          gstRate: "18",
          rate: "500",
        },
        {
          ...(s.lines[0] as LineDraft),
          uid: "n2",
          id: null,
          catalogueItemId: "s16",
          defaultLine: "Growth",
          rate: "",
        },
      ],
    });
    const b = buildPatch(s);
    if (!b.ok || !b.patch) throw new Error("no patch");
    expect(b.patch.lines?.[1]).toMatchObject({ sac: "998314", gstRateBp: 1_800, rateMinor: 50_000 });
    expect(b.patch.lines?.[1]).not.toHaveProperty("id");
    expect(b.patch.lines?.[2]).toMatchObject({ catalogueItemId: "s16", defaultLine: "Growth" });
    expect(b.patch.lines?.[2]).not.toHaveProperty("rateMinor");
  });
});

describe("the autosave: how the answer lands", () => {
  it("new rows get the server's ids by position; untouched figures keep their object; a part edited meanwhile stays dirty", () => {
    let s = initEditor(view());
    const firstFigures = s.figures.lines[s.lines[0]?.uid as string];
    s = editor(s, {
      type: "lines",
      lines: [
        ...s.lines,
        { ...(s.lines[0] as LineDraft), uid: "n1", id: null, catalogueItemId: null, rate: "500" },
      ],
    });
    const b = buildPatch(s);
    if (!b.ok || !b.patch) throw new Error("no patch");
    s = editor(s, { type: "saving" });
    // typed while the save was in flight
    s = editor(s, { type: "fields", patch: { title: "Changed" } });
    s = editor(s, { type: "saved", answer: answer(s, ["l1", "srv-new"]), sent: b.sent });
    expect(s.lines.map((l) => l.id)).toEqual(["l1", "srv-new"]);
    expect(s.updatedAt).toBe(200);
    expect(s.figures.lines[s.lines[0]?.uid as string]).toBe(firstFigures);
    expect(isDirty(s)).toBe(true);
    expect(s.status).toBe("idle");
    expect(s.fields.title).toBe("Changed");
  });

  it("a fresh save of everything reads Saved", () => {
    let s = initEditor(view());
    s = editor(s, { type: "fields", patch: { title: "New" } });
    const b = buildPatch(s);
    if (!b.ok || !b.patch) throw new Error("no patch");
    s = applySave(s, answer(s, ["l1"]), b.sent);
    expect([isDirty(s), s.status]).toEqual([false, "saved"]);
  });

  it("a conflict stops the autosave until the latest is loaded", () => {
    let s = initEditor(view());
    s = editor(s, { type: "failed", status: "stale", error: DOC_ERRORS.stale_version });
    s = editor(s, { type: "fields", patch: { title: "More typing" } });
    expect(s.status).toBe("stale");
  });
});

describe("small rules", () => {
  it("the dashboard pipeline tile (07-O §7)", () => {
    expect(pipelineLine(2, "₹3,88,000.00")).toBe("2 open, ₹3,88,000.00 before GST");
    expect(DASH_COPY.pipelineEmpty).toBe("No open proposals.");
  });

  it("moves, placeholders, place of supply and the approval line", () => {
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(placeholdersIn("Hi {{client.name}}, {{ service.name }} and {{client.name}}")).toEqual([
      "{{client.name}}",
      "{{service.name}}",
    ]);
    expect(placeOfSupplyLabel("19")).toBe("West Bengal (19)");
    expect(placeOfSupplyLabel("96")).toBe("Outside India (96)");
    const base = view().approval;
    expect(approvalLine(base, "x")).toBeNull();
    expect(approvalLine({ ...base, state: "pending" }, "x")).toBe("Approval pending");
    expect(
      approvalLine(
        { ...base, state: "rejected", decidedByName: "Sample Owner (fake)", note: "Too low" },
        "x",
      ),
    ).toBe("Rejected by Sample Owner (fake): Too low");
    expect(
      approvalLine(
        {
          ...base,
          state: "approved",
          decidedByName: "Sample Owner (fake)",
          decidedAt: Date.UTC(2026, 9, 25, 20, 0),
        },
        "x",
      ),
    ).toBe("Approved by Sample Owner (fake) on 26 Oct 2026");
  });
});

describe("recipientLine: who a document is for (M4.3 re-check 2, owner's rule)", () => {
  const client = { name: "Acme Ltd", anonymised: false };
  const contact = { name: "Asha Rao", anonymised: false };
  it("a live client and contact: the name and the contact", () => {
    expect(recipientLine({ client, contact })).toEqual({ name: "Acme Ltd", contact: "Asha Rao" });
  });
  it("a client with no contact: the name alone", () => {
    expect(recipientLine({ client, contact: null })).toEqual({ name: "Acme Ltd", contact: null });
  });
  it("the client anonymised: the label once, no contact part", () => {
    const gone = { name: "Anonymised client", anonymised: true };
    expect(recipientLine({ client: gone, contact: { name: "Anonymised client", anonymised: true } })).toEqual(
      { name: "Anonymised client", contact: null },
    );
    // even if the contact were not flagged
    expect(recipientLine({ client: gone, contact })).toEqual({ name: "Anonymised client", contact: null });
  });
  it("only the contact anonymised: the client's name alone, no contact part", () => {
    expect(recipientLine({ client, contact: { name: "Anonymised client", anonymised: true } })).toEqual({
      name: "Acme Ltd",
      contact: null,
    });
  });
});
