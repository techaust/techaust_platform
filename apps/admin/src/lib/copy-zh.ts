// 07-ZH lines 23 onwards (docs/07-content-appendix/ZH-m6.1-payments.md): the designer's recommended words for what the approved lines 1–22 lacked, marked with
// "[Placeholder]" until they are approved; then `APPROVED_07ZH_NEW` turns true and the marks go (the 07-X, 07-Y and 07-Z pattern). Its own small module, so the
// audit log's labels (line 49) don't load the payment screens' words.

/** Lines 23 onwards of 07-ZH: false until the lead (staff-only lines, owner's delegation) approves them. */
export const APPROVED_07ZH_NEW = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-ZH line from 23 as the screen shows it: marked until approved. */
export const ZH = (line: string): string => (APPROVED_07ZH_NEW ? line : `${PLACEHOLDER_MARK} ${line}`);

/** Line 49: the audit log's words for the eight new actions (lib/audit.ts reads them; the record type "Payments" is line 1). */
export const PAY_AUDIT = {
  "invoice.realisation_extend": ZH("recorded the bank's extension of a realisation date"),
  "payment.record": ZH("recorded a payment"),
  "payment.verify": ZH("checked a payment"),
  "payment.withdraw": ZH("withdrew a payment"),
  "payment.proof": ZH("attached a payment's proof"),
  "payment.tds_certificate": ZH("recorded a TDS certificate"),
  "payment.credit_apply": ZH("used a client's credit on an invoice"),
  "payment.credit_release": ZH("moved an invoice's excess to the client's credit"),
} as const;
