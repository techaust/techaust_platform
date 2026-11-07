// M7.4 B.3: consent receipts [FRM-05, ADM-SET-09] (run file docs/runs/m7.4-data-protection.md A.3, L30).
import { describe, expect, it } from "vitest";
import {
  CONSENT_EVENTS,
  CONSENT_SOURCES,
  type ConsentSubject,
  isConsentEvent,
  isConsentSource,
  PURPOSES,
  receiptOf,
  withdrawalOf,
} from "../src/consent.ts";

const leadConsent = {
  noticeVersion: "1.0",
  purposes: ["respond_to_enquiry", "marketing_updates"],
  at: 1_000,
  ipHash: "abc",
  marketing: true,
  withdrawnAt: null,
};
const lead = (consent: unknown, source: "web" | "manual" = "web"): ConsentSubject =>
  ({ kind: "lead", id: "L1", source, consent }) as ConsentSubject;
const contact = (consent: unknown, noticeVersion: string | null = "0.3"): ConsentSubject =>
  ({ kind: "contact", id: "C1", consent, noticeVersion }) as ConsentSubject;

describe("enumerations (pinned to the M7.4 triggers in A)", () => {
  it("purposes, events (with L30's ended) and sources", () => {
    expect(PURPOSES).toEqual(["respond_to_enquiry", "marketing_updates"]);
    expect(CONSENT_EVENTS).toEqual(["grant", "withdraw", "ended"]);
    expect(CONSENT_SOURCES).toEqual(["web_form", "staff", "unsubscribe", "erasure", "retention"]);
    expect(isConsentEvent("ended")).toBe(true);
    expect(isConsentEvent("revoke")).toBe(false);
    expect(isConsentSource("portal")).toBe(false);
    expect(isConsentSource("retention")).toBe(true);
  });
});

describe("receiptOf", () => {
  it("a web lead's grant, purposes in a fixed order, unknown ones dropped", () => {
    expect(
      receiptOf(lead({ ...leadConsent, purposes: ["marketing_updates", "spam", "respond_to_enquiry"] })),
    ).toEqual({
      event: "grant",
      source: "web_form",
      noticeVersion: "1.0",
      purposes: ["respond_to_enquiry", "marketing_updates"],
      marketing: true,
      ipHash: "abc",
      at: 1_000,
      leadId: "L1",
      contactId: null,
    });
  });
  it("a manual lead's is staff's; an empty IP hash is none", () => {
    const r = receiptOf(lead({ ...leadConsent, ipHash: "", marketing: false }, "manual"));
    expect(r?.source).toBe("staff");
    expect(r?.ipHash).toBeNull();
    expect(r?.marketing).toBe(false);
  });
  it("no consent, or a malformed one, gives none", () => {
    expect(receiptOf(lead(null))).toBeNull();
    expect(receiptOf(lead("yes"))).toBeNull();
    expect(receiptOf(lead({ ...leadConsent, purposes: "all" }))).toBeNull();
    expect(receiptOf(lead({ ...leadConsent, purposes: ["spam"] }))).toBeNull();
    expect(receiptOf(lead({ ...leadConsent, at: -1 }))).toBeNull();
    expect(receiptOf(lead({ ...leadConsent, noticeVersion: 1 }))).toBeNull();
  });
  it("a contact's granted marketing consent", () => {
    expect(receiptOf(contact({ granted: true, at: 2_000, source: "admin" }))).toEqual({
      event: "grant",
      source: "staff",
      noticeVersion: "0.3",
      purposes: ["marketing_updates"],
      marketing: true,
      ipHash: null,
      at: 2_000,
      leadId: null,
      contactId: "C1",
    });
    expect(receiptOf(contact({ granted: true, at: 2_000, source: "admin" }, null))?.noticeVersion).toBeNull();
  });
  it("a contact's consent that isn't granted, or has no time, gives none", () => {
    expect(receiptOf(contact({ granted: false, at: 2_000, source: "admin" }))).toBeNull();
    expect(receiptOf(contact({ granted: true, at: 1.5, source: "admin" }))).toBeNull();
    expect(receiptOf(contact(null))).toBeNull();
  });
});

describe("withdrawalOf", () => {
  it("a lead withdraws every purpose it granted, and its consent gains withdrawnAt", () => {
    const w = withdrawalOf(lead(leadConsent), 5_000, "staff");
    expect(w?.receipt).toEqual({
      event: "withdraw",
      source: "staff",
      noticeVersion: "1.0",
      purposes: ["respond_to_enquiry", "marketing_updates"],
      marketing: false,
      ipHash: null,
      at: 5_000,
      leadId: "L1",
      contactId: null,
    });
    expect(w?.consent).toEqual({ ...leadConsent, withdrawnAt: 5_000 });
  });
  it("a contact withdraws marketing (granted false, as clients.ts already stores it)", () => {
    const w = withdrawalOf(contact({ granted: true, at: 2_000, source: "admin" }), 6_000, "unsubscribe");
    expect(w?.receipt.source).toBe("unsubscribe");
    expect(w?.receipt.purposes).toEqual(["marketing_updates"]);
    expect(w?.consent).toEqual({ granted: false, at: 2_000, source: "admin", withdrawnAt: 6_000 });
  });
  it("nothing to withdraw: none, already withdrawn, or not granted", () => {
    expect(withdrawalOf(lead(null), 5_000, "staff")).toBeNull();
    expect(withdrawalOf(lead({ ...leadConsent, withdrawnAt: 4_000 }), 5_000, "staff")).toBeNull();
    expect(
      withdrawalOf(
        contact({ granted: false, at: 2_000, source: "admin", withdrawnAt: 3_000 }),
        5_000,
        "staff",
      ),
    ).toBeNull();
  });
  it("refuses a time that is not UTC milliseconds", () => {
    expect(() => withdrawalOf(lead(leadConsent), -5, "staff")).toThrow(RangeError);
  });
});
