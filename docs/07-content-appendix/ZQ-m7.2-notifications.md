# 07-ZQ: M7.2 notifications and digest

Status: **APPROVED by the owner word for word (2026-11-05)**, C1–C4 as below (`APPROVED_07ZQ` true in `packages/core/src/copy-zq.ts`; `refundCopyGate` in `apps/jobs/src/refund-notify.ts` keeps the pattern). The client lines C1–C3 of the refund email (Q4 A: every completed refund except card chargebacks, including refunds recorded as made outside the system). The staff lines (digest labels, notification switches, suppression reasons, the unfinished-sign-in email, template names) are the lead's under the owner's delegation and are listed in the run file. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3).

## The refund email to a client (approved)
- C1. Subject: "Refund of {amount} for {document number}"
- C2. Body: "Hi {first name}, we've refunded {amount} for {document number} on {date}. Banks and card networks may take longer to show it."
- C3. Only when a credit note records the refund: "Credit note {credit note number} records this refund."
- C4. The button: "View invoice" (the existing, approved portal button; it opens the refunded invoice).

## For information (already approved, no change)
- The weekly digest's subject and opening come from 07 §8: "Your week at TecHaust: {date of the week's Monday}" and "Pipeline, invoiced and collected, overdue invoices, new leads and upcoming reminders." Note: some of its figures are month-to-date (from the dashboard), so on a month's first Monday they read close to zero.
