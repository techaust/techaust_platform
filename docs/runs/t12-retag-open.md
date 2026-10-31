Status: builder running (code comments); lead rewriting 08-C §5
Tier: C (comments and one register section; no logic, no copy)
Usage: (filled from `node tools/model-audit.mjs` after each agent run)

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

## Lead: 08-C §5

## Review

## Integration notes

## Lead decisions (for 13)
- 2026-10-31, Lead (T12): the settled tag uses the settle-08c date 2026-10-30, and the reading comes from the settle-08c table because the 08-C rows may not be edited in T12 (T6 and T7 edit them). Questions added to rows on 2026-10-31 by rt1 and rt2 (RA-04 3B period, RA-22 proviso, RA-31 IFF, RB-39 Udyam format) stay OPEN.
- 2026-10-31, Lead (T12): a test title carrying a stale tag gets its tag text retagged (a label; no assertion changes).

## Follow-ups (for 12)

## Questions for the owner
None.

## Handover
