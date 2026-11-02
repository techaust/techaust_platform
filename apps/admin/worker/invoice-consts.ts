// Invoice constants other admin Workers also need (M6.1 stage A, ADM-PAY-01; the fourth admin Worker, 2026-11-03, ADM-G-02): the invoice-flow types as SQL,
// the "series full" error and the void error. They lived in invoice-model.ts, whose imports carry the whole invoice chain into any Worker that names it; this
// module has no side effect at its top level and imports only the core list, so the API Worker (clients, proposals and estimates, their PDFs) and the finance
// Worker (the ledger routes) can use them without the invoice code, which belongs to the invoices Worker. invoice-model.ts re-exports all three.
import { INVOICE_FLOW_TYPES } from "@techaust/core/invoices";
import type { ApiError } from "./context.ts";

/** A full numbering series for this FY (proposal, estimate and invoice issue paths). */
export const SERIES_FULL: ApiError = {
  code: "series_full",
  message: "This numbering series has no numbers left this year",
};

/** The types the invoice routes read: the invoice flow (a receipt or a voucher has no screen before M6). */
export const INVOICE_TYPES_SQL = INVOICE_FLOW_TYPES.map((t) => `'${t}'`).join(", ");

/** The service date, a send, or a payment or credit move on a void invoice. */
export const INVOICE_VOID: ApiError = { code: "invoice_void", message: "This invoice is void." };
