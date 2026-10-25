// The Clients screens' rules [ADM-CLI-01, -02, -05]: only changed fields are sent (the M3.2 drafts rule), the tax
// identity goes as one piece, a draft survives a reload and drops only a clashing field, the API's refusals land on
// their field, the 07-J copy is word for word, and the export file holds every part of the manifest.
import { describe, expect, it } from "vitest";
import type { ClientView, ExportSummary } from "../api.ts";
import {
  anonymiseConfirmation,
  DATA_TOOLS_VERIFY,
  EXPORT_EXPLAINER,
  eraseConfirmation,
} from "../routes/clients/data-tools.tsx";
import { ATTACH_PDF_HINT } from "../routes/clients/overview.tsx";
import {
  addressErrors,
  addressForm,
  addressLines,
  billingOf,
  billingPatch,
  clientDrafts,
  contactCountText,
  detailsOf,
  detailsPatch,
  ERASE_REASON_LABELS,
  exportFile,
  exportFileName,
  fieldOfError,
  NO_CLIENT_DRAFTS,
  parseOffsets,
  parseTags,
  readClientActivity,
  stateWarning,
  taxFieldErrors,
  termsDays,
  toAddress,
  withCountry,
  withGstin,
} from "./clients.ts";

// Sample data only (clearly fake): a GSTIN with a valid check character for West Bengal (19).
const SAMPLE_GSTIN = "19AAAAA0000A1ZZ";

const client = (over: Partial<ClientView> = {}): ClientView => ({
  id: "c1",
  code: "C0001",
  legalName: "Sample Client Pvt Ltd (sample)",
  displayName: "Sample Client (sample)",
  type: "business",
  country: "IN",
  gstStatus: "unregistered",
  gstin: null,
  stateCode: "19",
  billingAddress: null,
  currency: "INR",
  serviceAddress: null,
  tags: ["retainer"],
  notes: null,
  legalHold: false,
  createdAt: 1,
  updatedAt: 2,
  paymentTermsDays: null,
  reminderPolicy: null,
  careAutoIssue: false,
  attachPdf: false,
  ...over,
});

describe("07-J copy, word for word", () => {
  it("the owner's 2026-10-25 lines", () => {
    expect(ATTACH_PDF_HINT).toBe(
      "Emails to this client carry a link to each document. Turn this on to attach the PDF as well.",
    );
    expect(DATA_TOOLS_VERIFY).toBe("Check your obligations before you export or erase someone's data.");
  });
  it("the data tools and the warning", () => {
    expect(EXPORT_EXPLAINER).toBe(
      "Download everything we hold about this person as a file, to answer their data request: contact details, enquiries, sign-ins, emails sent and activity.",
    );
    expect(eraseConfirmation("Sample Person")).toBe(
      "Erase Sample Person? This deletes their contact details, their client portal access and the personal details on their enquiries. Records the law requires us to keep, such as issued invoices, stay. This can't be undone.",
    );
    expect(anonymiseConfirmation("Sample Person")).toBe(
      "Anonymise Sample Person? Their name, email and phone are replaced with 'Removed contact' wherever we can, and their client portal access ends. Issued invoices and acceptances keep the details the law requires. This can't be undone.",
    );
    expect(Object.values(ERASE_REASON_LABELS)).toEqual([
      "They asked to be erased",
      "They withdrew consent",
      "No longer needed",
      "Other",
    ]);
    expect(stateWarning("West Bengal")).toBe(
      "The state you chose differs from the GSTIN's state (West Bengal). Check it before saving.",
    );
  });
});

describe("forms as text", () => {
  it("an address is null until something is typed, and needs a first line and a city", () => {
    const empty = addressForm(null, "IN");
    expect(toAddress(empty)).toBeNull();
    expect(addressErrors(empty, "x")).toEqual({});
    const half = { ...empty, postalCode: "733101" };
    expect(Object.keys(addressErrors(half, "x"))).toEqual(["x-line1", "x-city"]);
    const full = { ...empty, line1: "1 Sample Road", city: "Sampletown" };
    expect(toAddress(full)).toEqual({ line1: "1 Sample Road", city: "Sampletown", country: "IN" });
    expect(addressLines(toAddress(full))).toEqual(["1 Sample Road", "Sampletown", "India"]);
  });

  it("tags: trimmed, no repeats in any case, at most 20", () => {
    expect(parseTags(" design, Design ,, retainer ")).toEqual(["design", "retainer"]);
    expect(parseTags(Array.from({ length: 25 }, (_, i) => `t${i}`).join(","))).toHaveLength(20);
  });

  it("reminder days: whole numbers −60 to 365, sorted, the minus sign accepted", () => {
    expect(parseOffsets("7, -3, 0, 7")).toEqual([-3, 0, 7]);
    expect(parseOffsets("−3")).toEqual([-3]);
    expect(parseOffsets("1.5")).toBeNull();
    expect(parseOffsets("-61")).toBeNull();
    expect(parseOffsets("")).toEqual([]);
  });

  it("payment terms: empty is the default, else 0 to 365 days", () => {
    expect(termsDays("")).toBeNull();
    expect(termsDays("30")).toBe(30);
    expect(termsDays("366")).toBeUndefined();
    expect(termsDays("thirty")).toBeUndefined();
  });
});

describe("patches send only what changed (M3.2 re-check R1)", () => {
  it("details: one field", () => {
    const base = detailsOf(client());
    expect(detailsPatch({ base, value: { ...base, notes: "A sample note" } })).toEqual({
      notes: "A sample note",
    });
    expect(detailsPatch({ base, value: base })).toEqual({});
  });

  it("details: an emptied display name falls back to the legal name; tags emptied are null", () => {
    const base = detailsOf(client());
    expect(detailsPatch({ base, value: { ...base, displayName: " ", tags: "" } })).toEqual({
      displayName: "Sample Client Pvt Ltd (sample)",
      tags: null,
    });
  });

  it("billing: the tax identity goes as one piece", () => {
    const base = billingOf(client());
    const p = billingPatch({ base, value: { ...base, gstStatus: "registered", gstin: SAMPLE_GSTIN } });
    expect(p).toEqual({ gstStatus: "registered", gstin: SAMPLE_GSTIN, stateCode: "19" });
  });

  it("billing: overseas clears the GSTIN and the state", () => {
    const base = billingOf(client());
    const p = billingPatch({ base, value: { ...base, country: "US", gstStatus: "overseas", stateCode: "" } });
    expect(p).toEqual({ country: "US", gstStatus: "overseas", gstin: null, stateCode: null });
  });

  it("billing: money settings alone never touch the tax identity", () => {
    const base = billingOf(client());
    const p = billingPatch({
      base,
      value: { ...base, terms: "15", reminders: "on", offsets: "-3, 7", careAutoIssue: "on" },
    });
    expect(p).toEqual({
      paymentTermsDays: 15,
      reminderPolicy: { enabled: true, offsetsDays: [-3, 7] },
      careAutoIssue: true,
    });
  });

  it("billing: reminders back to the default send null", () => {
    const base = billingOf(client({ reminderPolicy: { enabled: false } }));
    expect(billingPatch({ base, value: { ...base, reminders: "default" } })).toEqual({
      reminderPolicy: null,
    });
  });
});

describe("drafts survive a reload (M3.2 pattern)", () => {
  it("an untouched field takes the stored value; a clash drops only that field and raises the notice", () => {
    const stored = detailsOf(client());
    let s = clientDrafts(NO_CLIENT_DRAFTS, { type: "details", value: stored, base: stored });
    s = clientDrafts(s, {
      type: "details",
      value: { ...stored, notes: "mine", legalName: "Mine Ltd (sample)" },
      base: stored,
    });
    const theirs = { ...stored, legalName: "Theirs Ltd (sample)", tags: "new" };
    s = clientDrafts(s, { type: "loaded", details: theirs, billing: billingOf(client()) });
    expect(s.details?.value.notes).toBe("mine");
    expect(s.details?.value.legalName).toBe("Theirs Ltd (sample)");
    expect(s.details?.value.tags).toBe("new");
    expect(s.conflict.details).toBe(true);
    expect(s.conflict.billing).toBe(false);
    s = clientDrafts(s, { type: "details", value: null, base: theirs });
    expect(s.conflict.details).toBe(false);
    expect(clientDrafts(s, { type: "reloaded-latest" })).toEqual(NO_CLIENT_DRAFTS);
  });
});

describe("tax identity in a form", () => {
  const t = { country: "IN", gstStatus: "registered", gstin: "", stateCode: "" };

  it("a valid GSTIN brings its state unless another was picked on purpose", () => {
    expect(withGstin(t, SAMPLE_GSTIN.toLowerCase())).toEqual({ gstin: SAMPLE_GSTIN, stateCode: "19" });
    expect(withGstin({ ...t, stateCode: "07" }, SAMPLE_GSTIN)).toEqual({ gstin: SAMPLE_GSTIN });
  });

  it("a country outside India makes the client overseas and clears the GSTIN and state", () => {
    expect(withCountry({ ...t, gstin: SAMPLE_GSTIN, stateCode: "19" }, "US")).toEqual({
      country: "US",
      gstStatus: "overseas",
      gstin: "",
      stateCode: "",
    });
    expect(withCountry({ ...t, gstStatus: "overseas", country: "US" }, "IN").gstStatus).toBe("unregistered");
  });

  it("registered and unregistered Indian clients need a state (owner answer Q1)", () => {
    expect(Object.keys(taxFieldErrors({ ...t, gstStatus: "unregistered" }, "p"))).toEqual(["p-stateCode"]);
    expect(taxFieldErrors({ ...t, gstin: SAMPLE_GSTIN, stateCode: "19" }, "p")).toEqual({});
    expect(taxFieldErrors({ country: "US", gstStatus: "overseas", gstin: "", stateCode: "" }, "p")).toEqual(
      {},
    );
  });

  it("each API refusal lands on its field", () => {
    expect(fieldOfError("currency_locked")).toBe("currency");
    expect(fieldOfError("type_locked")).toBe("type");
    expect(fieldOfError("state_required")).toBe("stateCode");
    expect(fieldOfError("gstin_in_use")).toBe("gstin");
    expect(fieldOfError("email_in_use")).toBe("email");
    expect(fieldOfError("stale_version")).toBeNull();
  });
});

describe("activity and export", () => {
  it("names a contact from the page, never from the audit row", () => {
    const names = new Map([["k1", { name: "Removed contact", anonymisedAt: 5 }]]);
    const v = readClientActivity(
      { action: "contact.anonymise", summary: { contactId: "k1", mode: "anonymise", reason: "requested" } },
      names,
    );
    expect(v).toEqual({
      what: "anonymised a contact",
      fields: "",
      contact: "Removed contact",
      reason: "requested",
    });
    const u = readClientActivity(
      { action: "client.billing_update", summary: { changed: ["currency", "paymentTermsDays"] } },
      names,
    );
    expect(u.fields).toBe("currency, payment terms");
    expect(
      readClientActivity({ action: "contact.erase", summary: { contactId: "gone" } }, names).contact,
    ).toBeNull();
  });

  it("the file holds every part of the manifest, empty ones included", () => {
    const summary: ExportSummary = {
      contact: { id: "k1" },
      client: null,
      suppression: null,
      manifest: ["leads", "sessions"],
    };
    const f = exportFile(summary, { leads: [{ id: "l1" }] }, Date.UTC(2026, 9, 25));
    expect(f.parts).toEqual({ leads: [{ id: "l1" }], sessions: [] });
    expect(f.exportedAt).toBe("2026-10-25T00:00:00.000Z");
    expect(exportFileName("k1", "2026-10-25")).toBe("techaust-data-export-k1-2026-10-25.json");
  });
});

describe("the client page's contacts (review 7)", () => {
  it("counts live contacts only, from the API's count", () => {
    expect(contactCountText({ liveContactCount: 140 })).toBe("140 contacts");
    expect(contactCountText({ liveContactCount: 1 })).toBe("1 contact");
    expect(contactCountText({ liveContactCount: 0 })).toBe("0 contacts");
  });
});
