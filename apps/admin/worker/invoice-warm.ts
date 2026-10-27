// Start-up warm-up of the invoice request schemas (M5.1, CPU tuning; same idea as document-warm.ts): the first parse of a zod/mini schema is the costly
// one on the Free plan, so each schema of the new routes parses one made-up sample while the isolate starts, not inside the first request. Pure of
// `env`, nothing stored or logged; the count of samples that parsed is returned so a test notices a sample that a schema change has made invalid.
import { advanceBody } from "./invoice-advance.ts";
import { issueBody, issueRequestBody } from "./invoice-issue.ts";
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
    ];
    return samples.filter(Boolean).length;
  } catch {
    return 0; // never stop a Worker from starting
  }
}
