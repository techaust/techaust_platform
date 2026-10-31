// 07-ZF (docs/07-content-appendix/ZF-proforma-withdraw.md): a payment request (a proforma) that TecHaust withdrew after the client received it [ADM-INV-10,
// POR-06], APPROVED by the owner on 2026-10-31. The portal's lines 18 to 20, word for word. Each one shows the "[Placeholder] " mark before the words
// until the owner approves the page; then `APPROVED_07ZF` turns true and the marks go (the copy-y.ts pattern). The admin's twin is
// apps/admin/src/lib/copy-zf.ts. The client never sees the staff's reason (owner, 2026-10-31, Q3).

export const APPROVED_07ZF = true;
const ZF = (line: string): string => (APPROVED_07ZF ? line : `[Placeholder] ${line}`);

export const WITHDRAWN_ZF = {
  /** Line 18: the list's status. */
  status: ZF("Withdrawn"),
  /** Line 19: the page's banner; `date` as the page writes dates. */
  banner: (date: string) => ZF(`This payment request was withdrawn on ${date}. You don't need to pay it.`),
  /** Line 20: the PDF download refused (409 `withdrawn`). */
  pdfRefused: ZF("The PDF isn't available because this payment request was withdrawn."),
} as const;
