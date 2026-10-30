// T4 and T10 (rt2; ADM-INV-01, ADM-INV-06, ADM-INV-07, ADM-SET-01): a credit note, a debit note and an invoice for a payment received always carry the signature
// (Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17)), whatever the checklist's signatory switch says;
// the Udyam registration is saved in Settings › Company and frozen only on a tax invoice (owner, 2026-10-31; 07-ZC; Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a))).
// Failure paths first.
import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import { invoiceSealOf, loadDocument, verifyInvoiceSealed } from "@techaust/db/documents";
import { beforeEach, describe, expect, it } from "vitest";
import { type InvoiceSettings, issuerOf } from "./invoice-model.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import {
  currentFy,
  lutOf,
  mkExportDraft,
  mkProforma,
  putSwiftBank,
  putTax,
  setFx,
  todayIso,
} from "./test-invoice-types.ts";
import {
  auditCount,
  FROZEN_SIGNATURE,
  getInvoice,
  invoiceCounter,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  putBank,
  putCompany,
  requestIssue,
} from "./test-invoices.ts";
import { draftCredit, draftDebit, mkIssuedInvoice, parentRow } from "./test-notes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
type Owner = Awaited<ReturnType<typeof owner>>;
const UDYAM = { number: "UDYAM-WB-01-0012345", category: "micro" } as const;
/** A credit note and a debit note draft of 10,000 paise taxable on the invoice's first line (made by the Owner). */
const DRAFTS = [
  (o: Owner, id: string) => draftCredit(o, id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] }),
  (o: Owner, id: string) => draftDebit(o, id, { lines: [{ line: 0, taxableMinor: 10_000 }] }),
] as const;

/** The `tax` row with the checklist's signatory switch off (or on). */
const putSignatory = (off: boolean) =>
  putTax({
    luts: [lutOf(currentFy())],
    invoiceChecklist: { ...SETTINGS_DEFAULTS.tax.invoiceChecklist, ...(off ? { signatory: false } : {}) },
  });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putSignatory(false);
});

const issuerOfRow = async (id: string) =>
  JSON.parse(
    (await one<{ issuer: string }>("SELECT issuer FROM documents WHERE id = ?", id))?.issuer ?? "{}",
  );
const sealOk = async (id: string) => {
  const check = await verifyInvoiceSealed((await loadDocument(env.DB, id)) as DocumentBundle<TermsRef>);
  return check?.content === true && check.snapshot;
};
const blockerCodes = async (res: Response) => (((await json(res)).blockers ?? []) as J[]).map((b) => b.code);

let refSeq = 0;
async function advance(s: Owner, proformaId: string, over: Record<string, unknown> = {}) {
  const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", proformaId);
  return call(`/invoices/${proformaId}/advance-invoice`, {
    cookie: s.cookie,
    body: {
      expectedProformaUpdatedAt: row?.updated_at,
      amountMinor: 59_000,
      receivedOn: todayIso(),
      reference: `UTR SIG ${Date.now()} ${++refSeq}`,
      ...over,
    },
  });
}
async function issuedProforma(s: Owner) {
  const made = await mkProforma(s, { price: 100_000 });
  const res = await issueInvoice(s, made.id);
  if (res.status !== 200) throw new Error(`proforma not issued: ${res.status} ${await res.text()}`);
  return made;
}

// ---- T4: the signature ---------------------------------------------------------------------------------------------------------------------------

describe("T4: a note always carries the signature [ADM-INV-06, ADM-INV-07; 08-C RA-22]", () => {
  it("no signature saved: 409 signature_missing on the issue, the issue request and the view, for both kinds; nothing is written", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    for (const make of DRAFTS) {
      const inv = await mkIssuedInvoice(o, { prices: [100_000] });
      const d = await json(await make(o, inv.id));
      await putCompany({ signature: null });
      const before = { parent: await parentRow(inv.id), audits: await auditCount("invoice.issue") };
      const res = await issueInvoice(o, d.id);
      expect(res.status).toBe(409);
      expect(await blockerCodes(res)).toEqual(["signature_missing"]);
      expect((await getInvoice(o, d.id)).blockers.map((b: J) => b.code)).toEqual(["signature_missing"]);
      const asked = await requestIssue(staff, d.id, "please");
      expect(asked.status).toBe(409);
      expect(await blockerCodes(asked)).toEqual(["signature_missing"]);
      expect(await one("SELECT status FROM documents WHERE id = ?", d.id)).toEqual({ status: "draft" });
      expect(await parentRow(inv.id)).toEqual(before.parent);
      expect(await auditCount("invoice.issue")).toBe(before.audits);
      await putCompany();
    }
  });

  it("the switch off: the note still freezes the signature, with no `signatory` key, and its seal verifies", async () => {
    const o = await owner();
    await putSignatory(true);
    for (const make of DRAFTS) {
      const inv = await mkIssuedInvoice(o, { prices: [100_000] });
      // the parent tax invoice followed the switch (Rule 46(q) proviso, RA-06)
      expect(await issuerOfRow(inv.id)).toMatchObject({ signatory: false, signature: null });
      const d = await json(await make(o, inv.id));
      const res = await issueInvoice(o, d.id);
      expect(res.status, await res.clone().text()).toBe(200);
      const issuer = await issuerOfRow(d.id);
      expect(issuer.signature).toEqual(FROZEN_SIGNATURE);
      expect(issuer).not.toHaveProperty("signatory");
      // and never the Udyam number
      expect(issuer.company).not.toHaveProperty("udyam");
      expect(await sealOk(d.id)).toBe(true);
    }
  });
});

describe("T4: an invoice for a payment received always carries the signature [08-C RA-17]", () => {
  it("no signature saved: 409 signature_missing, nothing written (no invoice, no number, no receipt, the proforma unchanged, no audit row)", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    await putCompany({ signature: null });
    const before = {
      counter: await invoiceCounter(),
      proforma: await one(
        "SELECT status, paid_minor, balance_minor, updated_at FROM documents WHERE id = ?",
        pf.id,
      ),
      children: await rows("SELECT id FROM documents WHERE parent_id = ?", pf.id),
      receipts: await rows("SELECT id FROM advance_receipts WHERE proforma_id = ?", pf.id),
      audits: await auditCount("invoice.advance_issue"),
    };
    const res = await advance(o, pf.id);
    expect(res.status).toBe(409);
    expect(await blockerCodes(res)).toEqual(["signature_missing"]);
    expect({
      counter: await invoiceCounter(),
      proforma: await one(
        "SELECT status, paid_minor, balance_minor, updated_at FROM documents WHERE id = ?",
        pf.id,
      ),
      children: await rows("SELECT id FROM documents WHERE parent_id = ?", pf.id),
      receipts: await rows("SELECT id FROM advance_receipts WHERE proforma_id = ?", pf.id),
      audits: await auditCount("invoice.advance_issue"),
    }).toEqual(before);
  });

  it("the switch off: issued and signed, with no `signatory` key; a domestic one carries the Udyam number, the seal verifies", async () => {
    const o = await owner();
    await putCompany({ udyam: UDYAM });
    await putSignatory(true);
    const pf = await issuedProforma(o);
    // the proforma itself followed the switch and never carries the Udyam number
    const pfIssuer = await issuerOfRow(pf.id);
    expect(pfIssuer).toMatchObject({ signatory: false, signature: null });
    expect(pfIssuer.company).not.toHaveProperty("udyam");
    const res = await advance(o, pf.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const id = (await json(res)).id as string;
    const issuer = await issuerOfRow(id);
    expect(issuer.signature).toEqual(FROZEN_SIGNATURE);
    expect(issuer).not.toHaveProperty("signatory");
    expect(issuer.company.udyam).toEqual(UDYAM);
    expect(await sealOk(id)).toBe(true);
  });

  it("a plain tax invoice with the switch on and no signature saved still issues (no blocker: Rule 46(q) proviso, RA-06)", async () => {
    const o = await owner();
    await putCompany({ signature: null });
    const made = await mkInvoice(o);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const issuer = await issuerOfRow(made.id);
    expect(issuer.signature).toBeNull();
    expect(issuer).not.toHaveProperty("signatory");
  });
});

// ---- T10: the Udyam number ------------------------------------------------------------------------------------------------------------------------

describe("T10: the Udyam number in Settings › Company [ADM-SET-01; 07-ZC lines 4-5]", () => {
  const company = async (s: Owner) => json(await call("/settings/groups/company", { cookie: s.cookie }));
  const putUdyam = async (s: Owner, udyam: unknown) => {
    const got = await company(s);
    return call("/settings/groups/company", {
      cookie: s.cookie,
      method: "PUT",
      body: { version: got.version, value: { ...got.value, udyam } },
    });
  };

  it("a malformed number or category is 400 with 07-ZC line 4 on the field, and nothing is saved", async () => {
    const s = await owner();
    for (const bad of [
      { number: "udyam-wb-01-0012345", category: "micro" },
      { number: "UDYAM-WB-01-001234", category: "micro" },
      { number: "UDYAM-W1-01-0012345", category: "micro" },
      { number: "WB-01-0012345", category: "micro" },
      { number: "UDYAM-WB-01-0012345", category: "large" },
      { number: "UDYAM-WB-01-0012345" },
      "UDYAM-WB-01-0012345",
    ]) {
      const before = await company(s);
      const res = await putUdyam(s, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      const b = await json(res);
      expect(b.error.code).toBe("invalid");
      expect((b.fields as J[])[0]?.path).toMatch(/^udyam/);
      expect((await company(s)).version).toBe(before.version);
    }
    const res = await putUdyam(s, { number: "udyam-wb-01-0012345", category: "micro" });
    expect((await json(res)).fields).toEqual([
      { path: "udyam.number", message: "Enter the number as UDYAM-XX-00-0000000." },
    ]);
  });

  it("sets and clears: a canonical number is 200 and reads back; null clears it; the signature is kept either way", async () => {
    const s = await owner();
    const set = await putUdyam(s, { number: "UDYAM-WB-01-0012345", category: "small" });
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await company(s)).value.udyam).toEqual({ number: "UDYAM-WB-01-0012345", category: "small" });
    const cleared = await putUdyam(s, null);
    expect(cleared.status).toBe(200);
    expect((await company(s)).value.udyam).toBeNull();
    expect((await company(s)).value.signature).toMatchObject({ sha256: FROZEN_SIGNATURE.sha256 });
  });
});

describe("T10: the Udyam number is frozen only on a tax invoice [ADM-INV-01; 08-C RB-39]", () => {
  it("a tax invoice seals it; a later settings change leaves the issued row and its seal intact", async () => {
    const o = await owner();
    await putCompany({ udyam: UDYAM });
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const row = await one<{ issuer: string; snapshot_sha256: string }>(
      "SELECT issuer, snapshot_sha256 FROM documents WHERE id = ?",
      made.id,
    );
    expect(JSON.parse(row?.issuer ?? "{}").company.udyam).toEqual(UDYAM);
    expect(await sealOk(made.id)).toBe(true);
    // the seal covers it: the same row with another number would not verify
    const bundle = (await loadDocument(env.DB, made.id)) as DocumentBundle<TermsRef>;
    const tampered = {
      ...bundle,
      document: {
        ...bundle.document,
        issuer: {
          ...(bundle.document.issuer as J),
          company: { ...(bundle.document.issuer as J).company, udyam: { ...UDYAM, category: "small" } },
        },
      },
    };
    expect((await verifyInvoiceSealed(tampered as never))?.snapshot).toBe(false);
    await putCompany({ udyam: { number: "UDYAM-WB-02-7654321", category: "small" } });
    await putCompany({ udyam: null });
    expect(await one("SELECT issuer, snapshot_sha256 FROM documents WHERE id = ?", made.id)).toEqual(row);
    expect(await sealOk(made.id)).toBe(true);
  });

  it("an export invoice, a proforma and a credit or debit note never carry it", async () => {
    const o = await owner();
    await putCompany({ udyam: UDYAM });
    const exp = await mkExportDraft(o);
    await setFx(o, exp.id);
    const expRes = await issueInvoice(o, exp.id);
    expect(expRes.status, await expRes.clone().text()).toBe(200);
    expect((await issuerOfRow(exp.id)).company).not.toHaveProperty("udyam");
    const pf = await issuedProforma(o);
    expect((await issuerOfRow(pf.id)).company).not.toHaveProperty("udyam");
    for (const make of DRAFTS) {
      const inv = await mkIssuedInvoice(o, { prices: [100_000] });
      expect((await issuerOfRow(inv.id)).company.udyam).toEqual(UDYAM);
      const d = await json(await make(o, inv.id));
      expect((await issueInvoice(o, d.id)).status).toBe(200);
      expect((await issuerOfRow(d.id)).company).not.toHaveProperty("udyam");
    }
  });
});

// ---- L6: earlier seals are unchanged ---------------------------------------------------------------------------------------------------------------

describe("L6: with no Udyam number and the switch on, the issuer block is the M5.1 block, key for key", () => {
  const settings = (over: Partial<InvoiceSettings["company"]> = {}): InvoiceSettings =>
    ({
      ...SETTINGS_DEFAULTS,
      company: {
        ...SETTINGS_DEFAULTS.company,
        legalName: "L",
        address: "A",
        gstin: null,
        signature: null,
        ...over,
      },
    }) as unknown as InvoiceSettings;
  const who = { id: "s1", name: "N" };
  /** The M5.1 issuer block of this fixture, written out: no `udyam`, no `signatory` (and no `undefined` or `null` keys). */
  const M51 = {
    company: {
      tradeName: "TecHaust Technologies",
      legalName: "L",
      address: "A",
      gstin: null,
      stateCode: "19",
      logo: "logo-primary-color.svg",
      email: "contact@techaust.com",
    },
    bank: { inr: null },
    signature: null,
    reverseChargeText: SETTINGS_DEFAULTS.tax.reverseChargeText,
    sender: { staffId: "s1", name: "N", email: SETTINGS_DEFAULTS.email.senders.billing },
  };
  const parts = (issuer: unknown) => ({
    document: {
      type: "tax_invoice",
      clientId: "c1",
      currency: "INR",
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: "a".repeat(64),
      termsRef: null,
      exportMode: null,
    },
    computed: { supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" } } as never,
    recipient: { legalName: "Client", country: "IN" },
    issuer: issuer as never,
  });

  it("every type without a saved number gives exactly that block, and the same seal", async () => {
    const golden = (await invoiceSealOf(parts(M51))).snapshotSha256;
    for (const type of ["tax_invoice", "export_invoice", "proforma"]) {
      const block = issuerOf(settings(), [], who, "INR", { type, advance: false });
      expect(block, type).toStrictEqual(M51);
      expect((await invoiceSealOf(parts(block))).snapshotSha256).toBe(golden);
    }
    // the stored value `null` and an absent key are the same: no key on the block
    const { udyam: _u, ...noKey } = settings().company;
    expect(
      issuerOf({ ...settings(), company: noKey } as InvoiceSettings, [], who, "INR", {
        type: "tax_invoice",
        advance: false,
      }),
    ).toStrictEqual(M51);
    // with a number, only a tax invoice gains the key (and so its own seal)
    const withUdyam = issuerOf(settings({ udyam: UDYAM }), [], who, "INR", {
      type: "tax_invoice",
      advance: false,
    });
    expect(withUdyam.company.udyam).toEqual(UDYAM);
    expect((await invoiceSealOf(parts(withUdyam))).snapshotSha256).not.toBe(golden);
    for (const type of ["export_invoice", "proforma", "credit_note", "debit_note"])
      expect(
        issuerOf(settings({ udyam: UDYAM }), [], who, "INR", { type, advance: false }).company,
        type,
      ).not.toHaveProperty("udyam");
  });

  it("the signatory switch: off drops the signature on a plain invoice, never on a note or an advance invoice", () => {
    const sig = { ...FROZEN_SIGNATURE, size: 1, width: null, height: null, updatedAt: 1 };
    const off = {
      ...settings({ signature: sig as never }),
      tax: {
        ...SETTINGS_DEFAULTS.tax,
        invoiceChecklist: { ...SETTINGS_DEFAULTS.tax.invoiceChecklist, signatory: false },
      },
    } as unknown as InvoiceSettings;
    for (const type of ["tax_invoice", "export_invoice", "proforma"])
      expect(issuerOf(off, [], who, "INR", { type, advance: false }), type).toMatchObject({
        signatory: false,
        signature: null,
      });
    for (const [type, advance] of [
      ["credit_note", false],
      ["debit_note", false],
      ["tax_invoice", true],
      ["export_invoice", true],
    ] as const) {
      const block = issuerOf(off, [], who, "INR", { type, advance });
      expect(block.signature, type).toEqual(FROZEN_SIGNATURE);
      expect(block, type).not.toHaveProperty("signatory");
    }
  });
});
