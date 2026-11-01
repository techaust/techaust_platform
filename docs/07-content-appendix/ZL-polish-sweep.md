# 07-ZL: polish sweep (staff-facing lines)

Status: **APPROVED by the lead under the owner's delegation, 2026-11-01** (lines 1–3 as written; staff-only). Change a line here first, then in the code (`apps/admin/src/lib/copy-zl.ts`, `APPROVED_07ZL` is true).

All lines are admin-only. No client-facing wording is added by this task.

1. Admin, the dashboard's activity feed and the audit log, when a **credit note** is issued (today it says "issued an invoice"): "issued a credit note"
   - **Recommended: as written.** (It sits beside "issued an invoice" and "drafted a credit or debit note".)
2. Admin, the same places, when a **debit note** is issued: "issued a debit note"
   - **Recommended: as written.**
3. Admin, the notifications bell's name for screen readers when more than 9 are unread (the badge shows "9+"; today the name says the exact count, which doesn't match what is on screen, an accessibility error): "Notifications, 9+ unread"
   - **Recommended: as written.** (A screen reader says "9 plus unread". Up to 9 the name keeps the exact number: "Notifications, 3 unread".)
