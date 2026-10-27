// Start-up warm-up of the invoice request schemas (M5.1, CPU tuning; same idea as document-warm.ts): the first parse of a zod/mini schema is the costly
// one on the Free plan, so each schema of the new routes parses one made-up sample while the isolate starts, not inside the first request. Pure of
// `env`, nothing stored or logged; the count of samples that parsed is returned so a test notices a sample that a schema change has made invalid.

import { creditForGross } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { computeDocument, creditNote } from "@techaust/core/tax";
import { advanceBody } from "./invoice-advance.ts";
import { issueBody, issueRequestBody } from "./invoice-issue.ts";
import { creditNoteBody, debitNoteBody, imsBody } from "./invoice-notes.ts";
import { createBody, listQuery, patchBody, serviceCompletedBody, voidBody } from "./invoices.ts";

export function warmInvoices(): number {
  try {
    const line = {
      description: "Build",
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 100,
      sac: "998314",
    } as const;
    const samples: boolean[] = [
      createBody.safeParse({ clientId: "c", services: [{ catalogueItemId: "i" }] }).success,
      createBody.safeParse({ clientId: "c", fromMilestoneId: "m" }).success,
      patchBody.safeParse({
        expectedUpdatedAt: 1,
        fields: { contactId: "c", discount: { kind: "percent", value: 100 } },
        lines: [line],
      }).success,
      createBody.safeParse({ clientId: "c", kind: "proforma", services: [{ catalogueItemId: "i" }] }).success,
      patchBody.safeParse({
        expectedUpdatedAt: 1,
        fields: {
          exportMode: "lut",
          fx: { rate: "83.1234", date: "2026-10-28", source: "FBIL" },
          serviceCompletedOn: "2026-10-28",
          exportDeclaration: false,
        },
      }).success,
      serviceCompletedBody.safeParse({ expectedUpdatedAt: 1, date: "2026-10-28" }).success,
      advanceBody.safeParse({
        expectedProformaUpdatedAt: 1,
        amountMinor: 100,
        receivedOn: "2026-10-28",
        reference: "UTR1",
        fx: { rate: "83.1234", date: "2026-10-28", source: "OTHER", sourceNote: "Bank" },
        confirmInrExport: true,
      }).success,
      issueBody.safeParse({
        expectedUpdatedAt: 1,
        expectedContentSha256: "a".repeat(64),
        confirmInrExport: true,
      }).success,
      issueRequestBody.safeParse({ expectedUpdatedAt: 1, reason: "r" }).success,
      voidBody.safeParse({ expectedUpdatedAt: 1, reason: "Duplicate" }).success,
      listQuery.safeParse({ type: "tax_invoice", status: "overdue", limit: "25" }).success,
      // M5.3: the note routes' bodies, the note part of a save, the IMS answer and the IMS list filter.
      creditNoteBody.safeParse({
        expectedParentUpdatedAt: 1,
        mode: "lines",
        lines: [{ line: 0, taxableMinor: 100 }],
        reasonCode: "other",
        reasonText: "Scope reduced",
        contactId: "c",
      }).success,
      creditNoteBody.safeParse({
        expectedParentUpdatedAt: 1,
        mode: "amount",
        grossMinor: 118,
        reasonCode: "price_correction",
      }).success,
      debitNoteBody.safeParse({
        expectedParentUpdatedAt: 1,
        lines: [{ line: 0, taxableMinor: 100 }],
        reasonCode: "other",
        reasonText: "Extra",
      }).success,
      patchBody.safeParse({
        expectedUpdatedAt: 1,
        fields: { note: { mode: "full", reasonCode: "price_correction" } },
      }).success,
      imsBody.safeParse({ expectedUpdatedAt: 1, status: "accepted" }).success,
      listQuery.safeParse({ ims: "pending", limit: "25" }).success,
      warmNoteMaths(),
    ];
    return samples.filter(Boolean).length;
  } catch {
    return 0; // never stop a Worker from starting
  }
}

/**
 * One credit note worked out at start-up (M5.3): the first run of the tax engine's credit path and of `creditForGross` costs the CPU, so it is paid here, not in the first
 * request. Made-up figures; nothing stored or logged. True when it computed.
 */
function warmNoteMaths(): boolean {
  const ctx = { tax: SETTINGS_DEFAULTS.tax, supplierStateCode: "19" as const, luts: [] };
  const original = computeDocument(
    {
      currency: "INR",
      documentDate: { year: 2026, month: 10, day: 28 },
      recipient: { gstStatus: "unregistered", country: "IN", stateCode: "29" },
      lines: [{ sac: "998314", qtyMilli: 1000, rateMinor: 100_000 }],
    },
    ctx,
  );
  if (!original.ok) return false;
  const none = {
    lines: [{ taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 }],
    creditedTotalMinor: 0,
  };
  const r = creditNote(
    original.value,
    none,
    { kind: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] },
    ctx,
  );
  const g = creditForGross(original.value, none, 11_800, ctx);
  return r.ok && g.ok;
}
