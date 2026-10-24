import { describe, expect, it } from "vitest";
import {
  ANONYMISED_CLIENT,
  ANONYMISED_CONTACT,
  anonymisedEmail,
  CLIENT_BILLING_FIELDS,
  CLIENT_FINANCE_READ_FIELDS,
  CLIENT_TYPE_LOCKED_MESSAGE,
  clientTaxCheck,
  ERASE_REASONS,
  INVOICE_FAMILY,
  INVOICE_FAMILY_SQL,
  QUOTE_DOCUMENT_TYPES,
} from "../src/clients.ts";
import { gstinCheckChar } from "../src/gstin.ts";

const first14 = "19AAACT2727Q1Z";
const WB_GSTIN = first14 + gstinCheckChar(first14);

describe("clientTaxCheck [ADM-CLI-01, owner Q1 2026-10-25]", () => {
  it("registered: a valid GSTIN in India; the state defaults to the GSTIN's", () => {
    expect(clientTaxCheck({ gstStatus: "registered", country: "IN", gstin: WB_GSTIN })).toEqual({
      ok: true,
      gstin: WB_GSTIN,
      stateCode: "19",
      warnings: [],
    });
    expect(
      clientTaxCheck({ gstStatus: "registered", country: "IN", gstin: ` ${WB_GSTIN.toLowerCase()} ` }),
    ).toMatchObject({
      ok: true,
      gstin: WB_GSTIN,
    });
  });

  it("registered: a different state is a warning, never a block", () => {
    const r = clientTaxCheck({ gstStatus: "registered", country: "IN", gstin: WB_GSTIN, stateCode: "27" });
    expect(r).toEqual({
      ok: true,
      gstin: WB_GSTIN,
      stateCode: "27",
      warnings: [{ code: "gstin_state_mismatch", gstinState: "West Bengal" }],
    });
    // The same state as the GSTIN: no warning.
    expect(
      clientTaxCheck({ gstStatus: "registered", country: "IN", gstin: WB_GSTIN, stateCode: "19" }),
    ).toMatchObject({ ok: true, warnings: [] });
  });

  it("registered: a missing or wrong GSTIN is refused with the reason", () => {
    expect(clientTaxCheck({ gstStatus: "registered", country: "IN" })).toMatchObject({
      ok: false,
      code: "gstin_invalid",
    });
    expect(
      clientTaxCheck({ gstStatus: "registered", country: "IN", gstin: "19AAACT2727Q1Z0" }),
    ).toMatchObject({
      ok: false,
      code: "gstin_invalid",
    });
  });

  it("unregistered: India and a state code are both required", () => {
    expect(clientTaxCheck({ gstStatus: "unregistered", country: "IN", stateCode: "29" })).toEqual({
      ok: true,
      gstin: null,
      stateCode: "29",
      warnings: [],
    });
    expect(clientTaxCheck({ gstStatus: "unregistered", country: "IN" })).toMatchObject({
      ok: false,
      code: "state_required",
    });
    expect(clientTaxCheck({ gstStatus: "unregistered", country: "IN", stateCode: "" })).toMatchObject({
      ok: false,
      code: "state_required",
    });
    expect(clientTaxCheck({ gstStatus: "unregistered", country: "IN", stateCode: "ZZ" })).toMatchObject({
      ok: false,
      code: "state_invalid",
    });
    expect(
      clientTaxCheck({ gstStatus: "unregistered", country: "IN", stateCode: "19", gstin: WB_GSTIN }),
    ).toMatchObject({ ok: false, code: "gstin_not_allowed" });
  });

  it("overseas: not India, no GSTIN, no state", () => {
    expect(clientTaxCheck({ gstStatus: "overseas", country: "US" })).toEqual({
      ok: true,
      gstin: null,
      stateCode: null,
      warnings: [],
    });
    expect(clientTaxCheck({ gstStatus: "overseas", country: "US", stateCode: "19" })).toMatchObject({
      ok: false,
      code: "state_not_allowed",
    });
    expect(clientTaxCheck({ gstStatus: "overseas", country: "US", gstin: WB_GSTIN })).toMatchObject({
      ok: false,
      code: "gstin_not_allowed",
    });
  });

  it("the country has to fit the status, and be a real country", () => {
    for (const [gstStatus, country] of [
      ["overseas", "IN"],
      ["registered", "US"],
      ["unregistered", "GB"],
      ["unregistered", "UN"],
      ["overseas", "ZZ"],
      ["overseas", ""],
    ] as const)
      expect(clientTaxCheck({ gstStatus, country, stateCode: "19", gstin: WB_GSTIN })).toMatchObject({
        ok: false,
        code: "country_mismatch",
      });
  });
});

describe("client constants", () => {
  it("the billing and finance-read lists are unique; only currencyLocked of the read list is not a billing field", () => {
    expect(new Set(CLIENT_BILLING_FIELDS).size).toBe(CLIENT_BILLING_FIELDS.length);
    expect(new Set(CLIENT_FINANCE_READ_FIELDS).size).toBe(CLIENT_FINANCE_READ_FIELDS.length);
    expect(
      CLIENT_FINANCE_READ_FIELDS.filter((k) => !(CLIENT_BILLING_FIELDS as readonly string[]).includes(k)),
    ).toEqual(["currencyLocked"]);
    // The tax identity is not on the hidden list: the PRD hides the finance tabs, not who the client is for tax.
    for (const k of ["gstStatus", "gstin", "stateCode", "billingAddress", "currency", "country"])
      expect(CLIENT_FINANCE_READ_FIELDS as readonly string[]).not.toContain(k);
  });

  it("the type-lock text is the owner-pending sentence", () => {
    expect(CLIENT_TYPE_LOCKED_MESSAGE).toBe(
      "The client type can't change once this client has an issued document.",
    );
  });

  it("the invoice family never holds the quotes, and the SQL list quotes each type", () => {
    for (const q of QUOTE_DOCUMENT_TYPES) expect(INVOICE_FAMILY).not.toContain(q);
    expect(INVOICE_FAMILY_SQL).toBe(INVOICE_FAMILY.map((t) => `'${t}'`).join(", "));
    expect(INVOICE_FAMILY_SQL).toContain("'tax_invoice'");
  });

  it("anonymised names are the approved 07-J words and the address is unique, lower case and undeliverable", () => {
    expect(ANONYMISED_CONTACT).toBe("Removed contact");
    expect(ANONYMISED_CLIENT).toBe("Removed client");
    expect(anonymisedEmail("0192A-BC")).toBe("anonymised+0192a-bc@invalid");
    expect(anonymisedEmail("a")).not.toBe(anonymisedEmail("b"));
  });

  it("the erase reasons are the four of 07-J", () => {
    expect([...ERASE_REASONS]).toEqual(["requested", "consent_withdrawn", "not_needed", "other"]);
  });
});
