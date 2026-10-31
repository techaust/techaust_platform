Status: WAITING ON OWNER (Q1: approve 07-ZK lines 1–13)
Tier: C (copy lines and the tests that pin them; no logic, no migrations)
Usage: lead claude-opus-5-5/high (no agent started yet; 5-h reading 17 % at 2026-11-01T02:40+05:30)

# ca-wording: replace the lines that send the owner to "your CA" or "your CA and lawyer"

Cloud task session `ca-wording`, branch `fix/ca-wording` from `origin/main` 474ec9c (2026-11-01). Follow-up from T12 ([t12-retag-open](t12-retag-open.md): M4, L2 and the copy notes). The owner has no CA or lawyer (owner, 2026-10-30; docs/13; CLAUDE.md rule 8), so screen lines that tell the owner to ask one mislead. Copy file: [07-ZK](../07-content-appendix/ZK-ca-wording.md).

Skills (docs/14 §9): no row of the table fits the lead's copy drafting (no screen built, no Worker code); the builder and the reviewer load theirs (reviewer: `code-review`).

## Inventory (lead, 2026-11-01)

Searched `apps/` and `packages/` (all `.ts`, `.tsx`, `.astro`), `docs/07-content.md` and `docs/07-content-appendix/` for "CA", "chartered", "accountant", "lawyer", "legal adviser", "legal partner", "solicitor", "advocate". Every line that tells **the owner** to ask a CA or lawyer is staff-facing in the admin app; **no portal, email, PDF or jobs line does.**

| # (07-ZK) | file:line | Current text (short) | Who sees it |
|---|---|---|---|
| 1 | `apps/admin/src/lib/reports.ts:49` | GST exports intro "… Check them with your CA before you file." | Owner, Accountant |
| 2 | `apps/admin/src/lib/reports.ts:93` | layout note "… test-import one file with your CA." | Owner, Accountant |
| 3 | `apps/admin/src/lib/reports.ts:226` | `b2cs_negative_net` "… Check with your CA how to report it." | Owner, Accountant |
| 4 | `apps/admin/src/lib/reports.ts:231` | `before_fema_2026` "… a different realisation period may apply. Ask your bank or CA." (GST exports, EDF, Export realisation) | Owner, Accountant |
| 5, 6 | `apps/admin/src/lib/reports.ts:258` | tax-only note card "Ask your CA how to report it in Table 9B." / "Ask your CA how to report it." | Owner, Accountant |
| 7 | `apps/admin/src/lib/reports.ts:245` | fallback card "… Ask your CA how to report it." | Owner, Accountant |
| 8 | `apps/admin/src/lib/invoice-types.ts:85` | `previousPeriod` "… that month's return: check with your CA." (dialog and toast) | Owner |
| 9 | `apps/admin/src/lib/invoice-types.ts:99`, `apps/admin/src/lib/invoices.ts:566`, `apps/admin/worker/invoice-model.ts:877` | `advance_supply_changed` "… Check the client's details with your CA before recording the payment." | Owner |
| 10 | `apps/admin/src/routes/settings/tax.tsx:489` | E-invoicing hint "… Ask your CA." | Owner (Accountant reads) |
| 11 | `apps/admin/src/routes/settings/terms.tsx:52` | "The wording of these blocks is yours and your lawyer's. Confirm it with your CA and a lawyer …" | Owner (Accountant reads) |
| 12 | `apps/admin/src/components/form.tsx:262` (via `routes/settings/kit.tsx:179`; the list name comes from `apps/admin/worker/settings.ts:131-133`, `:634`, typed in `apps/admin/src/api.ts:81`) | "… on the list for your CA" / "… CA and lawyer." | Owner (Accountant reads) |
| 13 | `apps/admin/src/components/shell/nav.tsx:125` | Reports "isn't built yet" page "… and exports for your CA." | Staff, Sales |

Tests that pin them: `apps/admin/src/lib/reports.test.ts:96`, `:733`, `:771`, `:792`, `:809`; `apps/admin/src/lib/invoice-types.test.ts:369`; `apps/admin/worker/settings.test.ts:119-123`, `:901`; plus any e2e or test that matches the strings (the builder greps).

**Kept (07-ZK §F):** website lines addressed to visitors, who may have a CA or lawyer of their own ("your CA confirms it", "your CA stays in charge of tax decisions", "CA firms" as a customer type), the S3 catalogue line ("Legal interpretation comes from your lawyer"), Settings › Flags "Stays off until a legal partner is in place." (Q-B12), blog drafts and rules.

**Comments, not screen text** (changed with their lines where they describe them; the register's "a one-off opinion would still be wise" comments stay): `reports.ts:241`, `form.tsx:264-266`, `kit.tsx:178`, `settings.ts:128-129`, `api.ts:81`, `apps/web/src/content/legal-pages.ts:2-3`.

**08-C header** (lead, done in this branch, no copy): line 3 "stay the owner's or the CA's" → "stay the owner's"; line 7 "The OPEN rows are the list for the CA and the lawyer" → points to §5; line 9 names the third tag `Settled by the lead on the safest reading, <date> (08-C <ID>)`.

## Brief (lead, 2026-11-01; for the builder once Q1 is answered)

- **PRD IDs:** ADM-REP-04 (GST exports), ADM-INV-17 / the M5.2 advance path, ADM-SET-03 (settings). Commit: `fix(admin): replace the "ask your CA" lines with owner-approved 07-ZK copy [ADM-REP-04, ADM-SET-03]`.
- **Builder** (one, own worktree, sub-branch `fix/ca-wording-b1` from `origin/fix/ca-wording`): change every line in the inventory to the approved 07-ZK text **word for word**, and every test that pins one. `meta.verify` becomes `"08-C §5"` for tax, payment_terms, retention and the terms list (the screen no longer names a list); `researchedSettingsText` takes no argument; `kit.tsx` calls it without the regex. Update the comments listed above so none still says the copy sends the question to a CA. `apps/admin/worker/settings.ts`: change only the four string values and the comment above them (the PC's M6.2 builder edits the gateway status there). No logic, no migrations, no workflow files.
- **Checks:** `pnpm --filter @techaust/admin exec vitest run src/lib/reports.test.ts src/lib/invoice-types.test.ts worker/settings.test.ts`, then `bash tools/heavy.sh --log ca-check pnpm check`, and a grep proving no `your CA`, `CA and lawyer`, `your lawyer's` remains in `apps/admin`.
- **Reviewer:** code (`code-review` skill) plus a visual check (TECHAUST_PORT_OFFSET=0) of Reports › GST exports (the intro and the layout note; a tax-only note card if a fixture shows one), Settings › Tax (the note and the E-invoicing hint), Settings › Terms, and a proforma with the payment-received dialog if the sample data allows. No layout changes, so no designer.
- **Done:** the approved lines in place word for word, their tests updated, review APPROVE, `pnpm check` and `pnpm test` green.
- **Out of scope:** website copy (§F), the register's rows, 08-C §5, new 08-C rows (follow-ups).

## Questions for the owner

**Q1 (2026-11-01). The new wording for 13 admin lines that say "ask your CA" or "your CA and lawyer".** You have no CA or lawyer, so these lines point you at someone who isn't there. Each new line says what you can do yourself, using the rules the lead has already settled in the research register, or says to check the figure before you file where the register leaves a question open. None of them claims a professional checked anything. All are lines only you and your staff see in the admin app; nothing changes for clients or on the website. The lines, old and new side by side: [07-ZK](../07-content-appendix/ZK-ca-wording.md).
- **(a) Approve all 13 as recommended (Recommended).**
- (b) Approve with line 9's shorter alternative ("Check the client's GST details before recording the payment.").
- (c) Approve with line 12's longer alternative (adds "This isn't tax or legal advice.").
- (d) Changes to particular lines (say which and how).

## Lead decisions (for 13)
- 2026-11-01: website lines that name the visitor's own CA or lawyer, the S3 catalogue line and the Flags "legal partner" hint stay (07-ZK §F): they don't tell the owner to ask anyone.
- 2026-11-01: `meta.verify` for the settings groups and the terms list becomes one value, `"08-C §5"`, and the "Researched default" note has one text (once 07-ZK line 12 is approved).
- 2026-11-01: 08-C header lines 3, 7 and 9 corrected (no CA or lawyer list; the third tag named).

## Follow-ups (for 12)
- **08-C, a new row:** how a B2CS row that nets below zero after credit notes is reported on the GST portal (07-ZK line 3 only says to check it; 08-C has no row).
- **08-C RA-32 for B2CS:** RA-32 settles Table 9B for registered and B2CL notes; a tax-only note in the B2CS file has no settled route (07-ZK line 6 names no table).
- **Website, About › team** (`apps/web/src/content/company.ts:152`, 07 §466): "We bring in trusted specialists, such as security testers and legal partners, when a project needs them." Not a "your CA" line, so outside this task; the owner may want to confirm it is still true now that there is no lawyer.
- `apps/admin/worker/care.ts:10` comment "To check with the CA (no 08-C row yet)": a research item without an 08-C row (comment only).

## Handover
- 2026-11-01: inventory done, 07-ZK drafted, Q1 written. Next: the owner's answer to Q1 (through the main session), then the builder per the brief.
