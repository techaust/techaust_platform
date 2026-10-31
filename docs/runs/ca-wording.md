Status: PR READY https://github.com/techaust/techaust_platform/pull/142
Tier: C (copy lines and the tests that pin them; no logic, no migrations)
Usage: lead claude-opus-5-5/high, skills: none (no §9 row fits copy work); builder b1 claude-opus-5-5/high 2026-10-31T20:59Z, skills: none (flagged by model-audit: the cloudflare skills don't load in a cloud session and the change is string values only; lead accepts); 5-h reading 20 % at 02:55 IST; reviewer claude-opus-5-5/high 2026-11-01, skills: code-review (its read-only helper on Opus 5.5); 5-h reading 62 % at 03:21 IST

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
- **Answer (2026-11-01, relayed by the main session):** (a). All 13 lines approved as recommended (line 9 the long form, line 12 without the extra sentence), §F agreed. Approved by the lead under the owner's delegation (owner, 2026-11-01: "You approve them" for 07-ZK); the main session checked lines 4, 5–7, 8 and 10 against 08-C (§5 RB-02 and RA-32, RA-15, 07-ZH line 10).

## Lead decisions (for 13)
- 2026-11-01: 07-ZK line 8 (the earlier-month payment line) is not shown on the LUT route of an export, whose IGST is nil (s.16(3)(a) IGST Act, 08-C RA-18): the line's "add it … with interest" would send the owner to pay tax that isn't due. The server's `advance_previous_period` warning and its audit row stay (ca-wording review 1).
- 2026-11-01: website lines that name the visitor's own CA or lawyer, the S3 catalogue line and the Flags "legal partner" hint stay (07-ZK §F): they don't tell the owner to ask anyone.
- 2026-11-01: `meta.verify` for the settings groups and the terms list becomes one value, `"08-C §5"`, and the "Researched default" note has one text (07-ZK line 12, approved 2026-11-01).
- 2026-11-01: 08-C header lines 3, 7 and 9 corrected (no CA or lawyer list; the third tag named).

## Follow-ups (for 12)
- **08-C, a new row:** how a B2CS row that nets below zero after credit notes is reported on the GST portal (07-ZK line 3 only says to check it; 08-C has no row).
- **08-C RA-32 for B2CS:** RA-32 settles Table 9B for registered and B2CL notes; a tax-only note in the B2CS file has no settled route (07-ZK line 6 names no table).
- **Website, About › team** (`apps/web/src/content/company.ts:152`, 07 §466): "We bring in trusted specialists, such as security testers and legal partners, when a project needs them." Not a "your CA" line, so outside this task; the owner may want to confirm it is still true now that there is no lawyer.
- **Reports › Export realisation** `REALISATION_COPY.beforeFema` (`apps/admin/src/lib/reports.ts:475`, 07-V §11): "Issued before 1 October 2026: a different realisation period may apply." Names no CA, so outside 07-ZK, but it now disagrees with 07-ZK line 4 (RB-02 settled: 9 months from the invoice date). New copy needs approval; in practice no app invoice predates 1 October 2026 (08-C §5 RB-02).
- **07-ZK line 9 (review 6):** add "void or withdraw this one" so the client doesn't see two open proformas (copy approval needed; model 07-ZF 17).
- **Settings › Terms (review 5):** the "Researched default" tag over the "wording is yours" note; a plain notice or another tag needs copy approval.
- **08-C rows RA-10 and RA-36 (review 9):** still "OPEN (CA)" in their rows, against the header and §5; re-tag in rule 8's form.
- `apps/admin/worker/care.ts:10` comment "To check with the CA (no 08-C row yet)": a research item without an 08-C row (comment only).

## Review (reviewer, 2026-11-01; copied by the lead)
**APPROVE** at bbb940c. No critical or high; 2 medium, 8 low. All 13 07-ZK lines word for word in every listed place (line 9's three copies identical); no other screen text changed; `meta.verify` "08-C §5" and nothing else in `settings.ts`; no banned phrases; the 08-C §5 anchor resolves. Commands: admin `reports.test.ts` + `invoice-types.test.ts` 78 passed; core `verify-tags.test.ts` 3 passed; admin `worker/settings.test.ts` 47 passed; admin typecheck exit 0. Visual (plugin Playwright, offset 0, a fresh local DB, a local sample owner): Settings › Tax (note, E-invoicing hint wraps to 3 lines cleanly), Settings › Terms, Settings › Payment terms, Data retention, Reports › GST exports (intro, and the layout note after "Make files"), 1280 and 390 px, light and dark; no overflow (scrollWidth 390). Screenshots copied to `.logs/ca-wording/` (git-ignored). Not verified on screen: line 13 (Staff and Sales only), lines 3–9 (no local documents; tests cover them); no 768 px, keyboard or axe pass (no controls changed). Skills: `code-review` (its first run reviewed main's last commit and was discarded; the second reviewed `origin/main...HEAD`).

| # | Sev. | Finding | Triage (lead) |
|---|---|---|---|
| 1 | medium | `advance_previous_period` fires on the LUT route too; line 8 ("add it to the next one with interest") would send the owner to pay IGST and interest that aren't due on a zero-rated export | **Fixed (lead):** `previousPeriodShown` in `apps/admin/src/lib/invoice-types.ts` hides the line in the dialog and the toast when the proforma is `export_lut` and IGST wasn't chosen (s.16(3)(a) IGST Act, 08-C RA-18); the server's warning and audit row unchanged (existing tests). No new copy |
| 2 | medium | The replaced lines in 07-V, 07-S, 07-W, 07-Y aren't marked | **Fixed:** each carries "Replaced on 2026-11-01 by 07-ZK line N; kept for history only" (07-T's precedent) |
| 3 | low | 07-ZK line 8 said "07-ZH line 10, word for word"; only its second sentence is | **Fixed** in 07-ZK |
| 4 | low | The E-invoicing hint states a researched rule with no tag | **Fixed:** `Researched 2026-10-28, … (08-C RA-15)` comment above the row |
| 5 | low | Settings › Terms keeps the "Researched default" tag over a note that makes no research claim | **Kept:** the seeded blocks are researched defaults (07-ZE, 08-C RB-38); a different tag is new copy. Listed as a follow-up |
| 6 | low | Line 9 doesn't say to void or withdraw the old proforma, so the client could see two open proformas | **Follow-up:** new copy (07-ZF 17's "void it … or withdraw it …, then issue a new one" is the model); needs approval |
| 7 | low | The new test checks only the reports lines | **Fixed:** a raw-source scan of every admin `src` and `worker` file (tests excluded) for "your CA", "CA and lawyer", "your lawyer" |
| 8 | low | `REALISATION_COPY.beforeFema` disagrees with line 4 | Already a follow-up |
| 9 | low | 08-C RA-10 and RA-36 rows still say "OPEN (CA)" | **Follow-up** (rows outside this task) |
| 10 | low | Comment-only edits in `copy-zd.ts`, `legal-pages.ts` | Accepted earlier; no screen text |

## Integration notes (lead)
- 2026-11-01: `fix/ca-wording-b1` (4b68b9d) merged into `fix/ca-wording` (merge commit, no conflicts); the lead read the whole diff against 07-ZK (every line word for word; the three copies of line 9 identical). The builder's extra comment edit in `apps/admin/src/lib/copy-zd.ts:3` (the 07-T history now says "sent the owner to a CA") accepted: history kept, grep clean. Worktree removed, branches deleted.
- 2026-11-01: review triage fixed by the lead directly (small, coupled; b0d3ef7): findings 1, 2, 3, 4, 7; 5 kept, 6 and 9 follow-ups, 8 already one. No critical or high finding, so no second review.
- **Checks on b0d3ef7** (`origin/main` 474ec9c unchanged, nothing to merge): `bash tools/heavy.sh --log check pnpm check` exit 0 (lint, typecheck, every guard); `bash tools/heavy.sh --log test pnpm test` exit 0: auth 135, ui 471 (+2 skipped), core 1,952, email 132, db 623, pdf 379, web 750 (+17 skipped), portal 679, jobs 560, admin 3,812 (126 files).
- **Worker bytes** (`pnpm --filter @techaust/admin build`): admin front 100,839 (main 100,839), admin API 438,003 (main 438,052), admin finance 507,904 (main 507,872); startup 11.8 / 45.9 / 49.1 ms. Portal and jobs: no files changed (main: 104,589 and 667,870).

## Handover
- 2026-11-01: inventory done, 07-ZK drafted, Q1 written. Next: the owner's answer to Q1 (through the main session), then the builder per the brief.

## Builder report (b1, 2026-11-01; branch `fix/ca-wording-b1`)

**Skills (docs/14 §9):** none loaded. The row for Worker code names `cloudflare:workers-best-practices` and `cloudflare:wrangler`, but no Cloudflare plugin loads in a cloud session (neither skill is in this session's list); the only Worker change is string values in `settings.ts` and `invoice-model.ts`, with no binding, route or runtime behaviour touched. `frontend-design` is the designer's (no layout changed); `code-review` is the reviewer's.

**Files changed** (07-ZK lines 1–13, word for word):
- `apps/admin/src/lib/reports.ts`: `GST_COPY.lede` (1), `GST_COPY.verify` (2), `gstWarningText` `b2cs_negative_net` (3) and `before_fema_2026` (4), `taxOnlyNoteText` (5, 6, 7; `Y(...)` kept; new sentence order "Enter it by hand {in Table 9B on the GST portal | on the GST portal}: {heads}. Then check GSTR-3B Table 3 before you file."); its doc comment no longer says the copy sends the question to the CA (08-C tags kept).
- `apps/admin/src/lib/invoice-types.ts` `previousPeriod` (8), `advanceSupplyChanged` (9); `apps/admin/src/lib/invoices.ts` `advance_supply_changed` (9); `apps/admin/worker/invoice-model.ts` `ADVANCE_SUPPLY_CHANGED` (9): the three copies of line 9 are identical.
- `apps/admin/src/routes/settings/tax.tsx` E-invoicing hint (10); `apps/admin/src/routes/settings/terms.tsx` VerifyNote (11).
- `apps/admin/src/components/form.tsx`: `researchedSettingsText()` takes no argument and returns line 12; `VerifyNote` JSDoc fixed. `apps/admin/src/routes/settings/kit.tsx`: called without the regex, comment fixed. `apps/admin/worker/settings.ts`: only the `VERIFY` values (tax, payment_terms, retention → `"08-C §5"`), the terms list's `meta.verify` → `"08-C §5"`, and the comment above the map. `apps/admin/src/api.ts`: the `verify` field's comment.
- `apps/admin/src/components/shell/nav.tsx` Reports `arrives.what` (13).
- `apps/web/src/content/legal-pages.ts` lines 2–4: comment only (OPEN points settled by the lead on the safest reading or still OPEN in 08-C §5; no CA or lawyer, owner 2026-10-30; a one-off lawyer review stays optional). No page text changed.
- `apps/admin/src/lib/copy-zd.ts` line 3, comment only: `"Talk to your CA"` → `sent the owner to a CA`, so the brief's grep returns nothing (the comment still says what the old lines did).
- Tests: `apps/admin/src/lib/reports.test.ts` (the pinned lines at the old ~96, ~733, ~771, ~792, ~809 updated word for word; one new `describe` "07-ZK (approved 2026-11-01): no line sends the owner to a CA or a lawyer" checks lede, verify, both warnings, all three card forms and `researchedSettingsText()` against `/\bCA\b|lawyer/` and pins lines 1, 3, 4, 7, 12), `apps/admin/src/lib/invoice-types.test.ts` (line 9), `apps/admin/worker/settings.test.ts` (title no longer says "the CA's"; `meta.verify` expected `"08-C §5"` for tax, retention and the terms list).

**Commands and results:**
- `pnpm install --frozen-lockfile --offline`: exit 0.
- `pnpm --filter @techaust/admin exec vitest run src/lib/reports.test.ts src/lib/invoice-types.test.ts`: 2 files, 78 tests passed.
- `bash tools/heavy.sh --log ca-b1-settings-test pnpm --filter @techaust/admin exec vitest run worker/settings.test.ts`: exit 0, 47 tests passed.
- `pnpm --filter @techaust/core exec vitest run test/verify-tags.test.ts`: 3 tests passed.
- `pnpm exec biome check <15 changed files>`: 3 format-only findings, fixed with `--write`; `copy-zd.ts` clean.
- `bash tools/heavy.sh --log ca-b1-check pnpm check`: exit 0 (biome "Checked 1438 files … No fixes applied", typecheck of every package, every guard ok). This was the one whole-repository lint.
- `grep -rn -E "your CA|CA and lawyer|your lawyer's|ask your bank or CA" apps/admin --include=*.ts --include=*.tsx`: no matches (exit 1).
- No dev server started.

**Not verified:** the full `pnpm test` and the e2e suites (not run; the lead runs `pnpm test`); the screens were not looked at (the reviewer's visual check). The `copy-zd.ts` comment edit came after `pnpm check` (comment only; biome-checked on its own).

**Open points for the lead:**
- `REALISATION_COPY.beforeFema` (`apps/admin/src/lib/reports.ts`, Reports › Export realisation, 07-V §11) still reads "Issued before 1 October 2026: a different realisation period may apply." It names no CA, so it is outside 07-ZK, but it now differs from line 4's settled wording ("the 9 months run from the invoice date") on the GST exports warning. A possible follow-up for copy.
- 2026-11-01: PR [#142](https://github.com/techaust/techaust_platform/pull/142) opened with `tools/cloud-pr.sh`. Next: the main session's PR check, auto-merge and Auto-fix; any CI or merge fixes on this branch.
