Status: PR READY https://github.com/techaust/techaust_platform/pull/129
Tier: C (comments and one register section; no logic, no copy)
Usage: builder claude-opus-5-5/high, 2026-10-31 07:37Z, skills: none (flagged by model-audit; none of docs/14 §9 fits a comment-only retag, and the cloudflare skills don't load in a cloud session; lead accepts); reviewer claude-opus-5-5/high, 2026-10-31, skills: code-review (its read-only helper on Opus 5.5); 5-h reading 8 % at 12:58 IST

# T12: retag the settled OPEN comments and rewrite 08-C §5

Cloud task session `t12-retag`, branch `chore/t12-retag-open` from `origin/main` 8d5b958. Merges **first** of the five parallel tasks (T12 → T6 → proforma withdraw → T7 → M6.1), so it stays small: comment lines and 08-C §5 only.

## Brief (lead, 2026-10-31)

**Source of truth.** The owner's 2026-10-30 rule (docs/13 "No CA or lawyer"; CLAUDE.md rule 8) lets the lead settle an OPEN item on the safest reading of the official sources. The lead did so for every item in [settle-08c](settle-08c.md)'s table (2026-10-30) except **RB-06** (a bank fact), **RB-21's rate** and **RB-22(b)** (the G.S.R. 789(E) text). The 08-C rows still carry most of those items as "OPEN"; T12 may not edit the rows (T6 changes RB-38, T7 may change RB-37), so the settled reading comes from the settle-08c table, and the tag is:

`Settled by the lead on the safest reading, 2026-10-30 (08-C <ID>)`, followed by `: <the reading, short>`.

Where a row itself already records the item as settled by research (RA-19 Q39: "Researched 2026-10-30, Rule 96A(1), Notification 37/2017-CT"), the comment may cite that too; the lead-settled tag is still correct because the reading is the lead's.

**Questions raised after settle-08c** (by rt1 and rt2 on 2026-10-31) are still OPEN in their rows and keep their `OPEN (08-C <ID>): <question>` tag unchanged.

### Mapping: what each tag becomes

| ID (part) | Settled? | Reading to write after the tag (shorten to fit the comment; never add a claim not here) |
|---|---|---|
| RA-04 (Q38: the balance after an IMS rejection) | settled | the note stays and the client's balance stays reduced; GST is reduced only once a registered client accepts it in IMS; a debit note if the credit was not due |
| RA-04 (in which 3B period a later acceptance counts; `core/gst/summary.ts:10`) | **stays OPEN** | unchanged |
| RA-10 (void shown as cancelled in Table 13) | settled | the owner's 2026-10-30 rule: same IST month (not for a proforma), not emailed, not opened in the portal, no payment or note, number kept; such a void is reported as cancelled in Table 13; anything else is corrected by a credit note |
| RA-18 (IGST-route endorsement wording; `core/export-invoice.ts:17`) | **stays OPEN** | unchanged (not in the settle-08c table) |
| RA-19 (Q37: payment received after the LUT lapsed) | settled | the LUT route is refused when the receipt day's FY has no saved LUT; the Owner saves the new LUT first or issues with IGST (owner, 2026-10-28) |
| RA-19 (Q39: later-FY debit note on an LUT export) | settled | the note needs the LUT of its own FY; no IGST alternative (built in rt1) |
| RA-19 (the LUT ARN's format; `schemas/settings.ts:146`, `export-invoice.ts:175`) | **stays OPEN** | unchanged |
| RA-21 (Q24: an older rate when that day has one; `core/fx.ts`) | settled | that day's rate, or an earlier one only with the dated "no rate that day" statement |
| RA-21 (which day's rate a note on a USD export uses; `apps/admin/src/lib/notes.ts:105`) | **stays OPEN** | unchanged |
| RA-22 (Rules 50 and 53 and the Rule 46(q) proviso) | **stays OPEN** | unchanged (row OPEN; the safest reading is built) |
| RA-23 (Q17: the Offline Tool import) | settled | a test import of each CSV before the first GSTR-1 (owner duty); until then the files are untested and every column unverified (keep any "may not come through" explanation the comment gives) |
| RA-31 (what IFF carries and when a period's return can be filed; `core/notes.ts:392`) | **stays OPEN** | unchanged |
| RA-32 (a tax-only debit note in Table 9B and 3B) | settled | entered by hand in the GST portal's Table 9B, and 3B Table 3 checked before filing; whether the portal takes a nil-value row is unverified |
| RA-33 (round-off on a tax-only debit note) | settled | never rounded: round-off 0, the total is its tax |
| RA-34 (the GSTIN check-character algorithm) | settled | the secondary-sourced mod-36 algorithm, tested locally against the owner's own GSTIN and two vendors' before Phase 7 (a scratch test, never committed) |
| RB-02 (export invoices raised before 1 Oct 2026) | settled | 9 months from the invoice date; ask the bank for an extension if that has passed |
| RB-03 (bank channel; software or not) | settled | "software" (FEMA 23(R)/2026-RB Reg. 2(1)(e)); one monthly EDF with the AD bank; never Reg. 3(2)(b) |
| RB-05 (proof of realisation) | settled | keep the bank advice or e-FIRA; for a PA-CB, the settlement report mapped to the invoice |
| RB-06 (RBI purpose code) | **stays OPEN** | unchanged (a bank fact) |
| RB-12 (ground for recording IP and browser) | settled | DPDP s.7(a) with the Rule 6 log duty, kept 13 months; GDPR Art. 6(1)(f) for EU and UK persons |
| RB-16 (watch) | **stays OPEN (watch)** | unchanged |
| RB-18 (staff consent under SPDI) | settled | emailed consent before enrolling anyone but the owner (practice, no code; until 13 May 2027) |
| RB-23 (courts; the ₹10,000 cap against consumers) | settled | Balurghat kept, with a consumer carve-out on the website and proposal terms; the ₹10,000 cap stays (07-ZE lines 6, 14, 15; built in T6) |
| RB-27 (GDPR Art. 27 representative) | settled | a representative is appointed before the first EU or UK client (owner's choice) |
| RB-33 (watch) | **stays OPEN (watch)** | unchanged |
| RB-36 (a, b: files in a data export) | settled | the export lists the files; their contents on request; for EU and UK persons a full copy (GDPR Art. 15(3)) with others' data redacted, by hand |
| RB-37 (a: a never-accepted sent offer after an erasure request) | settled | on request the person's data is erased in the frozen copy, keeping number, status, dates and hash (T7, before 13 May 2027); until T7 the offer is kept and erase is refused |
| RB-37 (b: keeping proposals and approvals) | settled | accepted offers are kept as long as the tax records (s.36 CGST Act) |
| RB-38 (a: assignment wording and signature; c: extra clauses) | settled | (a) a one-page deed of assignment on full payment, signed by the owner with Aadhaar eSign (07-ZE, T11; a one-off lawyer review of the deed is wise); (c) the owner chose the four clauses (07-ZE, terms v4) |
| RB-39 (the Udyam number's official format) | **stays OPEN** | unchanged |

### Builder's job (code comments)
1. Find every tag that names a settled item above as OPEN: the canonical `OPEN (08-C <ID>)` (80 hits on main; some break across lines, e.g. `packages/db/src/triggers.ts:886`) **and** the loose forms (`OPEN 08-C RA-33`, `(OPEN, 08-C RB-23)`, `is OPEN, RB-12`, `is OPEN (RB-05)`, `is OPEN, RA-04`, `both OPEN`, `OPEN, 08-C RB-18`, `with its OPEN parts`). Search `apps packages scripts tools .github`, skipping `node_modules`, `dist` and `packages/db/migrations`.
2. Replace the tag and the question after it with the settled tag and the reading. Keep everything else on the line, and the comment's style. A tag naming several IDs where one stays OPEN keeps the OPEN part.
3. **Leave alone:** every tag of an item marked "stays OPEN"; the generic lines "Researched … or OPEN per 08-C" (still true); `apps/web/src/content/legal-pages.ts:3-4` (describes 07-A's notes) and `:701` (a quote of 07-A, RB-33 watch); every `Researched …` tag.
4. Test files: comments may change; a test title (`describe`/`it` string) that carries a stale tag may have **only that tag text** changed; no assertion, no other code.
5. `packages/core/test/verify-tags.test.ts` lines 1-2: add the third tag to the header comment (`Settled by the lead on the safest reading, <date> (08-C <ID>)`). Nothing else in that file.
6. No code, no copy strings, no docs, no 08-C. Run `pnpm lint` on the changed files (`pnpm exec biome check <files>`), `pnpm --filter @techaust/core test`, and `git diff --stat` / a check that every changed line is a comment or a test title (e.g. `git diff -U0 | grep '^[+-][^+-]'` read by eye).
7. Write the table below (file:line on your branch, ID, old tag, new tag) under "Builder report", commit (`docs(comments): retag settled 08-C items [T12]`), push your sub-branch.

**Done** = no comment names a settled item as OPEN; the stays-OPEN tags untouched; lint clean on the changed files; core tests green; the table complete.

**Out of scope:** the 08-C rows (T6, T7 edit them), any copy file, docs/12, docs/13, CHANGELOG, CLAUDE.md.

## Builder report

Builder (Opus 5.5, high), branch `fix/t12-retag-r1` from `origin/chore/t12-retag-open` (ade4025, then rebased onto 0eb3d81, the lead's 08-C §5 commit, which touches no file of mine).

**Skills:** none loaded. The docs/14 §9 skills cover Worker code, screens, Cloudflare platform features, SES, CPU budgets and reviews; a comment-only retag fits none of them (and the `cloudflare:*` skills are not available in this cloud session anyway).

**What changed:** 78 tag lines in 49 files, plus the `verify-tags.test.ts` header (step 5). The only non-comment lines changed are 5 test titles, and only their tag text (`reports.test.ts:695`, `documents-convert.test.ts:367`, `invoices-void.test.ts:291`, `note-research.test.ts:157`, `settings.test.ts:338`). In titles I wrote only the tag, with no reading (the old titles carried a bare tag or a question; a reading would make the label longer). Each reading comes from the mapping table only; multi-line tags kept their line breaks (`triggers.ts:886-887`, `:913-914`, `totals.ts:55-56`, `credit.ts:380-381`, `sections.ts:440-441`, `types.ts:158-159`, `seed/terms.ts:47-48`).

| file:line | ID | old tag (short) | new tag (short) |
|---|---|---|---|
| apps/admin/src/lib/clients.ts:4 | RB-36, RB-37 | "with their OPEN parts" | Settled (RB-36, RB-37): files listed, contents on request; accepted offers kept as long as tax records; never-accepted erased in frozen copy (T7) |
| apps/admin/src/lib/invoices.ts:146 | RA-10 | OPEN: never-delivered invoice reported as cancelled? | Settled: owner's 2026-10-30 rule; such a void cancelled in Table 13, else credit note |
| apps/admin/src/lib/invoices.ts:516 | RA-10 | OPEN (08-C RA-10). | Settled: void only in the same IST month; else credit note |
| apps/admin/src/lib/notes.ts:70 | RA-04 (Q38) | "is OPEN, RA-04" | Settled: note stays, balance stays reduced; GST reduced once accepted in IMS; debit note if credit not due |
| apps/admin/src/lib/reports.test.ts:695 (title) | RA-32 | OPEN 08-C RA-32 | Settled (08-C RA-32), tag only |
| apps/admin/src/lib/reports.ts:60 | RA-32 | OPEN: how reported in 9B | Settled: by hand in Table 9B, 3B Table 3 checked; nil-value row unverified |
| apps/admin/src/lib/reports.ts:90 | RA-23 (Q17) | OPEN: layout the CA's to confirm | Settled (RA-23, Q17): test import of each CSV before first GSTR-1; untested until then |
| apps/admin/src/lib/reports.ts:228 | RB-02 | OPEN: which period before 1 Oct 2026 | Settled: 9 months from invoice date; ask bank for extension |
| apps/admin/src/lib/reports.ts:237 | RA-32 | OPEN: 9B / 3B question | Settled: by hand in Table 9B, 3B Table 3 checked; nil-value row unverified |
| apps/admin/src/lib/reports.ts:238 | RA-23 | OPEN: import untested | Settled: test import before first GSTR-1; "may not come through" explanation kept |
| apps/admin/src/lib/reports.ts:472 | RB-02 | OPEN (08-C RB-02). | Settled: 9 months from invoice date; ask bank for extension |
| apps/admin/src/lib/reports.ts:477 | RB-05 | "is OPEN (RB-05)" | Settled: bank advice or e-FIRA; PA-CB settlement report mapped to the invoice |
| apps/admin/src/routes/invoices/read.tsx:4 | RA-10 | "is OPEN, 08-C RA-10" | Settled: owner's 2026-10-30 rule; cancelled in Table 13 |
| apps/admin/src/routes/settings/payment-terms.tsx:1 | RB-23 | "liability cap OPEN" | Settled: ₹10,000 cap stays, consumer carve-out (07-ZE; T6) |
| apps/admin/src/routes/settings/terms.tsx:1 | RB-38 (c) | OPEN: proposal terms text | Settled: owner chose the four clauses (07-ZE, terms v4); RA-18, RB-24 references untouched |
| apps/admin/src/routes/reports/manual-entries.tsx:1 | RA-32, RA-23 | "both OPEN" | Settled (RA-32, RA-23): by hand in Table 9B; test import before first GSTR-1 |
| apps/admin/src/routes/invite.tsx:30 | RB-18 | "OPEN, 08-C RB-18": consent needed first? | Settled: emailed consent before enrolling anyone but the owner (practice; until 13 May 2027) |
| apps/admin/worker/clients.ts:995 | RB-36 | OPEN: file bytes on request or never? | Settled: files listed, contents on request; GDPR Art. 15(3) full copy, redacted, by hand |
| apps/admin/worker/clients.ts:1297 | RB-37 (a) | OPEN: unaccepted sent offer kept? | Settled: erased in frozen copy on request, number/status/dates/hash kept (T7); until T7 kept, erase refused |
| apps/admin/worker/documents-convert.test.ts:367 (title) | RB-37 | OPEN (08-C RB-37) | Settled (08-C RB-37), tag only |
| apps/admin/worker/invoice-model.ts:91 | RA-10 | OPEN: Table 13 question | Settled: owner's rule; cancelled in Table 13, else credit note |
| apps/admin/worker/invoice-model.ts:624 | RA-19 (Q37) | OPEN: LUT lapsed, IGST? | Settled (RA-19, Q37): LUT route refused without receipt-FY LUT; save new LUT or IGST (owner, 2026-10-28) |
| apps/admin/worker/invoices.ts:5 | RA-10 | "the void is OPEN" | Settled: owner's rule; cancelled in Table 13 |
| apps/admin/worker/invoices.ts:1153 | RA-10 | OPEN: Table 13 question | Settled: cancelled in Table 13, else credit note |
| apps/admin/worker/invoices-void.test.ts:1 | RA-10 | OPEN: Table 13 question | Settled: cancelled in Table 13, else credit note |
| apps/admin/worker/invoices-void.test.ts:291 (title) | RA-10 | OPEN + question | Settled (08-C RA-10), tag only (": the GST return period" kept) |
| apps/admin/worker/note-research.test.ts:157 (title) | RA-33 | OPEN 08-C RA-33 | Settled (08-C RA-33), tag only |
| apps/jobs/src/lut-check.ts:1 | RA-19 (Q37, Q39) | OPEN: cases after a lapse the CA's call | Settled (RA-19, Q37, Q39): receipt-FY LUT or IGST; debit note needs its own FY's LUT, no IGST alternative |
| apps/web/src/content/legal-pages.ts:48 | RB-23 | "(OPEN, 08-C RB-23)" | Settled: ₹10,000 cap stays, consumer carve-out (07-ZE; T6) |
| apps/web/src/content/legal-pages.ts:124 | RB-12 | OPEN: EU/UK basis | Settled: GDPR Art. 6(1)(f); India DPDP s.7(a), Rule 6, 13 months |
| apps/web/src/content/legal-pages.ts:154 | RB-12 | OPEN: EU/UK basis | same as :124 |
| apps/web/src/content/legal-pages.ts:291 | RB-27 | OPEN: GDPR section as a whole | Settled: section kept; representative before first EU or UK client |
| apps/web/src/content/legal-pages.ts:302 | RB-27 | OPEN: representative needed? | Settled: representative before first EU or UK client (owner's choice) |
| apps/web/src/content/legal-pages.ts:476 | RB-23 | OPEN: cap against a consumer? | Settled: ₹10,000 cap stays, carve-out (07-ZE lines 6, 14, 15; T6) |
| apps/web/src/content/legal-pages.ts:493 | RB-23 | OPEN: Balurghat or Kolkata | Settled: Balurghat kept, consumer carve-out (07-ZE; T6); MSA arbitration note kept |
| apps/portal/src/components/decision/decision-panel.tsx:6 | RB-12 | "is OPEN, RB-12" | Settled: DPDP s.7(a), Rule 6, 13 months; GDPR Art. 6(1)(f) |
| apps/portal/src/copy-documents.ts:7 | RB-12 | "is OPEN, RB-12" | same |
| apps/portal/src/copy-documents.ts:183 | RB-12 | "is OPEN (08-C RB-12)" | "is settled (Settled ... (08-C RB-12): ...)" |
| packages/core/src/documents.ts:3 | RB-37 (a, b) | OPEN (08-C RB-37) | Settled: accepted kept as long as tax records; never-accepted erased in frozen copy (T7; until then kept) |
| packages/core/src/fx.ts:34 | RA-21 (Q24) | OPEN: 4 days older when rate exists? | Settled (RA-21, Q24): that day's rate, or earlier only with the dated statement |
| packages/core/src/gst/docs.ts:3 | RA-10 | OPEN: Table 13 question | Settled: owner's rule void cancelled in Table 13, else credit note |
| packages/core/src/gst/edf.ts:3 | RB-03 | OPEN: bank's form and channel | Settled: "software" (Reg. 2(1)(e)); monthly EDF with AD bank; never Reg. 3(2)(b) |
| packages/core/src/gst/format.ts:2 | RA-23 | OPEN: formats unverified | Settled: test import before first GSTR-1; "until then ... unverified" kept |
| packages/core/src/gst/layouts.ts:3 | RA-23 | OPEN: CSVs import cleanly? | Settled: test import of each CSV; untested, every column unverified until then |
| packages/core/src/gst/registers.ts:4 | RA-10 | "Every rule is OPEN" | "Every rule: Settled ...": cancelled in Table 13, else credit note |
| packages/core/src/gst/sections.ts:438 | RA-23 | OPEN: what tax on import? | Settled: test import of each CSV; "Untested ... would under-report it" kept |
| packages/core/src/gst/sections.ts:440 | RA-32 | OPEN: 9B / 3B question | Settled: by hand in Table 9B, 3B Table 3 checked; nil-value row unverified |
| packages/core/src/gst/summary.ts:3 | RA-23 | "(OPEN, 08-C RA-23" | Settled: test import of each CSV ("The mapping is unverified" kept) |
| packages/core/src/gst/types.ts:158 | RA-32 | OPEN: 9B / 3B question | Settled: by hand in Table 9B, 3B Table 3 checked; nil-value row unverified |
| packages/core/src/gst/types.ts:160 | RA-23 | OPEN: untested | Settled: test import before first GSTR-1; untested until then ("may not come through" kept) |
| packages/core/src/invoices.ts:517 | RA-10 | OPEN: Table 13 question | Settled: same IST month, not for a proforma |
| packages/core/src/invoices.ts:522 | RA-10 | OPEN: Table 13 question | Settled: cancelled in Table 13 |
| packages/core/src/invoices.ts:526 | RA-10 | OPEN: Table 13 question | Settled: owner's rule; cancelled in Table 13, else credit note |
| packages/core/src/invoices.ts:567 | RA-10 | OPEN: Table 13 question | Settled: owner's rule void cancelled in Table 13 |
| packages/core/src/permissions.ts:92 | RA-10 | OPEN: Table 13 question | Settled: cancelled in Table 13, else credit note |
| packages/core/src/schemas/settings.ts:54 | RA-34 | OPEN: no official text found | Settled: secondary-sourced mod-36, local scratch test before Phase 7, never committed |
| packages/core/src/schemas/settings.ts:383 | RB-23 | OPEN: cap against a consumer? | Settled: ₹10,000 cap stays, carve-out (07-ZE; T6) |
| packages/core/src/schemas/settings.ts:601 | RB-23 | OPEN: cap against a consumer? | Settled: ₹10,000 cap stays, carve-out (07-ZE; T6) |
| packages/core/src/tax/credit.ts:325 | RA-33 | "OPEN 08-C RA-33" | Settled (08-C RA-33) |
| packages/core/src/tax/credit.ts:380 | RA-33 | OPEN: rounded, which direction? | Settled: never rounded, round-off 0, total is its tax |
| packages/core/src/tax/totals.ts:55 | RA-33 | OPEN: rounded, which direction? | Settled: never rounded, round-off 0, total is its tax |
| packages/core/test/gst/docs-issued.test.ts:1 | RA-10 | OPEN: Table 13 question | Settled: owner's rule void cancelled in Table 13 |
| packages/core/test/gst/docs.test.ts:1 | RA-10 | OPEN: Table 13 question | Settled: owner's rule void cancelled in Table 13 |
| packages/core/test/gst/layouts.test.ts:3 | RA-23 | "OPEN, 08-C RA-23": CA's import | Settled: test import of each CSV before first GSTR-1 (owner duty) |
| packages/core/test/gst/report-csv.test.ts:1 | RA-23 | OPEN (08-C RA-23) | Settled: test import before first GSTR-1 |
| packages/core/test/gst/tax-only-debit.test.ts:63 | RA-32 | OPEN 08-C RA-32 | Settled: by hand in Table 9B |
| packages/core/test/gst/tax-only-debit.test.ts:98 | RA-32 | OPEN 08-C RA-32 | Settled (08-C RA-32) |
| packages/core/test/settings.test.ts:338 (title) | RB-23 | OPEN + question | Settled (08-C RB-23), tag only |
| packages/core/test/tax/tax-only-debit.test.ts:74 | RA-33 | OPEN 08-C RA-33 | Settled (08-C RA-33) |
| packages/core/test/verify-tags.test.ts:2-3 | (header) | two tag forms | third form `Settled by the lead on the safest reading, <date> (08-C <ID>)` added (step 5) |
| packages/db/src/contact-access.ts:4 | RB-37 (a, b) | "with its OPEN parts" | Settled: accepted kept as long as tax records; never-accepted erased in frozen copy (T7) |
| packages/db/src/issue.ts:460 | RA-33 | OPEN 08-C RA-33 | Settled (08-C RA-33) |
| packages/db/src/seed/terms.ts:5 | RB-38 (a, c) | OPEN: text, Ownership, GST line | Settled: four clauses (07-ZE, terms v4); deed on full payment, Aadhaar eSign (07-ZE, T11) |
| packages/db/src/seed/terms.ts:23 | RB-38 (a) | OPEN: lawyer's final assignment wording | Settled: one-page deed, Aadhaar eSign (07-ZE, T11; lawyer review of the deed wise) |
| packages/db/src/seed/terms.ts:47-48 | RB-38 (a) | OPEN: lawyer's wording (lead settles it) | same as :23 |
| packages/db/src/sql-rules.ts:24 | RA-33 | OPEN: rounded, which direction? | Settled: never rounded, round-off 0, total is its tax |
| packages/db/src/triggers.ts:886-887 | RA-19 (Q37) | OPEN: FY X LUT covers FY X+1 receipt? | Settled (RA-19, Q37): refused without receipt-FY LUT; save new LUT or IGST |
| packages/db/src/triggers.ts:913-914 | RA-33 | OPEN: rounded, which direction? | Settled: never rounded, round-off 0, total is its tax |
| packages/db/test/tax-only-note.test.ts:1 | RA-33 | OPEN 08-C RA-33 | Settled (08-C RA-33) |

**Count by ID** (78 tag lines; `clients.ts:4` and `manual-entries.tsx:1` name two IDs each): RA-04 1, RA-10 17, RA-19 3, RA-21 1, RA-23 10, RA-32 8, RA-33 9, RA-34 1, RB-02 2, RB-03 1, RB-05 1, RB-12 5, RB-18 1, RB-23 7, RB-27 2, RB-36 2, RB-37 5, RB-38 4.

**OPEN hits left** (re-grep `grep -rnE "OPEN" apps packages scripts tools .github | grep -E "08-C|R[AB]-[0-9]"`, skipping node_modules, dist, packages/db/migrations):
- stays OPEN per the mapping: RA-21 notes (`apps/admin/src/lib/notes.ts:105`); RB-06 (`apps/admin/worker/settings.ts:889`, `packages/db/src/schema/settings.ts:49`, `packages/db/src/schema/documents.ts:115`, `packages/core/src/export-invoice.ts:371`, `packages/pdf/src/invoice-types.ts:17`); RB-39 format (`apps/jobs/test/pdf-signature-udyam.test.ts:195`, `packages/core/src/schemas/settings.ts:101`, `packages/core/src/udyam.ts:8`, `:51`, `packages/core/test/settings.test.ts:259`, `packages/pdf/src/invoice-envelope.ts:171`, `packages/pdf/src/layout/copy.ts:233`, `packages/pdf/test/signature-udyam.test.ts:93`); RA-22 (`packages/db/src/issue.ts:350`, `packages/db/src/triggers.ts:968`, `packages/core/src/notes.ts:309`, `packages/core/src/invoices.ts:331`); RA-31 (`packages/core/src/notes.ts:392`); RA-19 ARN (`packages/core/src/schemas/settings.ts:146`, `packages/core/src/export-invoice.ts:175`); RA-18 (`packages/core/src/export-invoice.ts:17`); RA-04 3B period (`packages/core/src/gst/summary.ts:10`); RB-16 watch (`apps/web/src/content/legal-pages.ts:215`).
- excluded by step 3: `legal-pages.ts:3-4` (describes 07-A's notes), `:701` (07-A quote, RB-33 watch); the generic "Researched … or OPEN per 08-C" lines (`apps/admin/src/lib/notes.ts:6`, `tax-settings.ts:1`, `invoice-types.ts:4`, `reports.ts:7`, `routes/settings/tax.tsx:1`, `apps/web/src/content/legal.ts:3`, the six `apps/web/src/pages/*.astro` headers); `verify-tags.test.ts:3` (the header naming the `OPEN` form).
- the other OPEN hits are code names (`OPEN`, `OPEN_IT`, `OPEN_STAGES`, `OPEN_STATUSES`, …) and font licence text, not tags.

**Commands and results**
- `pnpm install --frozen-lockfile --offline`: done (no version change).
- `pnpm exec biome check <the 49 changed files>`: "Checked 49 files … No fixes applied" (clean); again on the two files I re-edited: clean.
- `bash tools/heavy.sh --log t12-core-test pnpm --filter @techaust/core test`: exit 0, 91 files, 1861 tests passed; coverage 99.04 % statements, 98.12 % branches.
- `git diff -U0 HEAD`, every +/- line read: every changed line is a comment line except the 5 test titles listed above, where only the tag text changed. None of the retitled tests uses snapshots.

**Not verified:** the admin, db, jobs, portal, web and pdf test suites were not run (comments and 5 test-title labels only; core holds `verify-tags.test.ts`, which passed). The whole-repo `pnpm lint` was not run (the lead's brief asked for changed-file lint only).

**For the lead (not changed: copy, outside this brief):** two copy strings still read as if the item were open, now that the comment above them is settled: `apps/admin/src/lib/reports.ts:229` and `:473` ("a different realisation period may apply. Ask your bank or CA.", RB-02 settled as 9 months from the invoice date), and `apps/admin/src/lib/reports.ts:91` ("test-import one file with your CA", RA-23: the owner's duty now that there is no CA). Same for `apps/web/src/content/legal-pages.ts:303` ("we haven't appointed a representative", consistent with RB-27 until the first EU or UK client, so no change needed). Copy decisions are the owner's or the lead's.

**Open questions:** none.

## Lead: 08-C §5
Rewritten by the lead (commit 0eb3d81): §5 is now "Where the OPEN items stand", in three parts. **Settled by the lead on the safest reading, 2026-10-30** is a table with the reading, where it stands on main (built, which task, or owner duty) and the residual risk. **Still OPEN** holds RB-06, RB-21 (rate) and RB-22(b); the questions rt1 and rt2 raised on 2026-10-31 (RA-04 3B period, RA-22 proviso, RA-31 IFF); RB-38 (MCIA, checked first in T6); RB-39 (format); and three found in code with no row yet (RA-21 note rate day, RA-18 IGST endorsement, RA-19 ARN format). **Watch** lists RA-01, RB-08, RB-16, RB-33 and RB-39(b). No row in §1 or §2 was changed. §5 says that where a row still reads OPEN for a settled item, §5 is current.
Lead check of the builder's diff: merged `fix/t12-retag-r1` 5ca2907 by fast-forward. Every non-doc +/- line is a comment except the 5 test titles listed in the builder report. The readings match the brief's table.

## Review
**Reviewer (Opus 5.5 high, 2026-10-31): APPROVE.** No critical or high findings; 4 medium, 7 low. What it confirmed:
- only comments changed, plus 5 test titles where only the tag text changed;
- the readings match settle-08c;
- no settled item is still tagged OPEN, and every stays-OPEN tag is unchanged byte for byte;
- the §5 claims are true on main (migrations 0046–0048 and 0052–0054, `creditNoteDeadline`, `tax_only_note_manual`, the T-numbers);
- only §5 of 08-C changed;
- biome is clean on 49 files, and `verify-tags.test.ts` passed 3/3.

Findings (the reviewer's wording, condensed):

| # | Sev | Where | Finding | Lead's triage |
|---|---|---|---|---|
| M1 | medium | web `legal-pages.ts:154` | The RB-12 comment read as the EU/UK basis for the whole Client contact row, which prints "contract; legal obligation" | **Fixed:** limited to the acceptance IP address and browser. Whether the row's EU/UK cell should name legitimate interests is a follow-up for T6 (legal pages v0.4) |
| M2 | medium | db `seed/terms.ts:5`, admin `settings/terms.tsx:1` | The comment over terms v1 read as if v1–v3 were the settled RB-38 terms | **Fixed:** says the versions in that file are superseded, v4 comes in T6, the deed in T11, MCIA stays OPEN; terms.tsx says "built in T6" |
| M3 | medium | portal `decision-panel.tsx:6`, `copy-documents.ts:7`, `:183` | "kept 13 months" is the security-log retention; acceptance evidence is kept with the offer | **Fixed:** "13 months" removed; the comment now says the acceptance record is kept with the offer (RB-37 (b)) |
| M4 | medium | admin `worker/settings.ts:131-133`, `:634`; `src/api.ts:81`; `components/form.tsx:262`; web `legal-pages.ts:3` | `meta.verify` and the Settings hint still point to "08-C §5: CA / lawyer" lists, which §5 no longer has; tests pin the strings | **Kept, with a reason:** this is API meta, copy and tests, outside T12's comment-only scope (and other sessions are editing nearby). Listed as a follow-up: point to "08-C §5" and get new owner-approved copy |
| L1 | low | §5 RB-02; admin `reports.ts:228`, `:472` | The engine gives a pre-October INR invoice 12 months; that case can't occur | **Fixed in §5:** the engine's 12 months can't apply, because no invoice in the app predates 1 Oct 2026 |
| L2 | low | admin `reports.ts:239` (copy at `:224`, `:243`, `:256`) | The comment gives the settled route, then says it sends the question to the CA | **Fixed:** the comment says the copy still sends it to the CA (follow-up). The three copy lines are added to the copy follow-up |
| L3 | low | 08-C §6 vs §5 RB-01 | §6 says "12 if invoiced or settled in INR"; §5 says a PA-CB INR credit keeps 9 | **Kept, with a reason:** §6 is outside the §5-only scope. Listed as a follow-up |
| L4 | low | core `gst/summary.ts:3`, `test/gst/report-csv.test.ts:1` | The RA-23 test import doesn't cover the 3B mapping or these CSVs | **Fixed:** both comments now say so |
| L5 | low | §5 RA-19 (Q39) | settle-08c said "LUT or IGST"; rt1 narrowed it | **Fixed:** the row says rt1 narrowed it (a note follows its parent's route) |
| L6 | low | §5 RA-31 and the "(no row yet)" lines | No part label; "(no row yet)" was inaccurate | **Fixed:** "RA-31 (issue deadline)"; "(not in its row yet)" |
| L7 | low | web `legal-pages.ts:291` | The section title read as if it were the RB-27 reading | **Fixed:** the title comes first, then the tag and reading |

**Re-check (reviewer, 2026-10-31, `0c2548e`): PASS.** All 9 fixes are correct, and M4 and L3 are accepted as follow-ups. Two new findings, both fixed by the lead:
- **Medium:** web `legal-pages.ts:124`. The M1 wording had also been applied to the Website visitor row, where no acceptance happens. That line now names the visitor basis: GDPR Art. 6(1)(f), and DPDP s.7(a) with the Rule 6 log duty (security logs 13 months).
- **Low:** db `seed/terms.ts:5` now says "superseded once T6 adds terms v4", since v3 is still the newest seeded version today.

Note: M1's text suggested a bare "VERIFY WITH CA/LEGAL" mark; it was not written anywhere (the tag test forbids it).

## Integration notes
- `fix/t12-retag-r1` was fast-forwarded into the branch. The review fixes and re-check fixes were made by the lead (comments and §5 only).
- At 656db58: `bash tools/heavy.sh --log check pnpm check` exited 0. `bash tools/heavy.sh --log test pnpm test` exited 0: 389 test files, 8,894 tests passed and 19 skipped (admin 3,493, core 1,861, web 714, portal 651, jobs 549, db 514, ui 471, pdf 376, auth 135, email 130).
- Migrations: none. Worker bytes: not re-measured; the change is comments only (main: admin API 618,422, jobs 984,266).

## Lead decisions (for 13)
- 2026-10-31, Lead (T12): the settled tag uses the settle-08c date 2026-10-30, and the reading comes from the settle-08c table because the 08-C rows may not be edited in T12 (T6 and T7 edit them). Questions added to rows on 2026-10-31 by rt1 and rt2 (RA-04 3B period, RA-22 proviso, RA-31 IFF, RB-39 Udyam format) stay OPEN.
- 2026-10-31, Lead (T12): a test title carrying a stale tag gets its tag text retagged (a label; no assertion changes).

## Follow-ups (for 12)
- **Copy (owner approval):** `apps/admin/src/lib/reports.ts` (the RB-02 line at ~229 and ~473) still says "a different realisation period may apply. Ask your bank or CA.", though RB-02 is settled at 9 months from the invoice date. The RA-23 line at ~91 says "test-import one file with your CA", though the owner has no CA and the test import is the owner's duty. Both are copy, so T12 leaves them.
- **08-C header (main session or the next task that touches 08-C rows):** line 9's tag list names two tags. It should also name `Settled by the lead on the safest reading, <date> (08-C <ID>)`. Line 7 ("The OPEN rows are the list for the CA and the lawyer") is stale since 2026-10-30. Both lines sit outside §5, which is all T12 may edit.
- **T6, when it changes row RB-38:** update §5's "Still OPEN" RB-38 (MCIA) line and the RB-38 (c) residual column. **T7, if it changes RB-37:** update §5's RB-37 (a) line.
- **Copy and API meta (M4):** admin `worker/settings.ts:131-133`, `:634` (`meta.verify` "08-C §5: CA" / "CA and lawyer"), `src/api.ts:81`, `components/form.tsx:262` (the "on the list for your CA and lawyer" hint) and web `legal-pages.ts:3` point to lists §5 no longer has. Point them to "08-C §5" and get new owner-approved copy; `settings.test.ts:121`, `:123` and `:901` pin the strings.
- **Copy (L2):** admin `reports.ts:224`, `:243`, `:256` say "Ask your CA how to report it (in Table 9B)". RA-32 is settled (entered by hand in Table 9B), and the owner has no CA.
- **T6 (M1):** in legal pages v0.4, decide whether the privacy notice's Client contact row should name legitimate interests (GDPR Art. 6(1)(f)) in its EU/UK cell for the acceptance IP address and browser (08-C RB-12).
- **08-C §6 (L3):** the realisation line should add "(a USD invoice credited in INR through a PA-CB: 9 months; RB-01)", to match §5.
- RA-21 (note rate day): settle-08c leans towards the note's own date, but the code uses the invoice's rate. Still OPEN; to be decided in a later task with a source.

## Questions for the owner
None.

## Handover
Lead, 2026-10-31: PR [#129](https://github.com/techaust/techaust_platform/pull/129) is open from `chore/t12-retag-open`. It has review APPROVE and re-check PASS, and `pnpm check` and `pnpm test` passed at 656db58. Next: the main session turns on auto-merge and Auto-fix, and copies "Lead decisions (for 13)" and "Follow-ups (for 12)". No agents or dev servers are running.
