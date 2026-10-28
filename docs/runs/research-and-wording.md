# Run: project-wide research and final wording (2026-10-28)

Owner, 2026-10-28 ([13-decisions](../13-decisions.md)): replace every `[Placeholder]` with final wording; research every "VERIFY WITH CA/LEGAL" item from official sources and settle it where the sources are clear; settle Q1–Q71 of the [M5 batch](m5-batch.md); afterwards rewrite anything else the research shows needs it. CLAUDE.md rule 8 now reads: clear sources → **"Researched <date>, <source>"**; unclear or conflicting → **"OPEN: <the precise question>"**, never a guess. Owner facts (postal address, headshot, bio, LinkedIn, WhatsApp, case studies, LUT ARN, bank details) stay marked (rule 10).

Branch: `feat/research-and-wording` (from `main` at c005fcd). Tier A (money, tax, legal).

## Steps
1. Inventory → `docs/08-research-appendix/C-research-register.md` (raw lists: `.logs/research/verify-raw.txt`, 658 lines; `.logs/research/placeholder-raw.txt`, 43 lines).
2. Research: two analysts (Opus 5.5, high, web tools), topics R-A and R-B below, drafts in `.logs/research/R-A.md` and `R-B.md`.
3. The lead checks each answer against its source and writes the register.
4. Wording: the lead writes every placeholder line and the pending 07 appendices (C, K, L, M, N, O, P, R, S, T, U, V).
5. Build: builder (Sonnet 5.5, high) for settings defaults and rules; designer (Opus 5.5, high) for the wording on screens, emails and PDFs; tags replaced.
6. Review (Opus 5.5, high, code + visual) → fixes → re-check → record → PR → staging → the owner's one-page summary.

## Brief for the research analysts (R-A and R-B)

You research Indian tax and law for TecHaust Technologies, a **sole proprietorship, GST-registered (regular scheme), in Balurghat, West Bengal (state code 19)**, selling IT services (websites, software, care/maintenance plans) to Indian businesses (B2B and B2C) and to foreign clients (export of services, paid in foreign currency). Annual turnover is well under ₹5 crore (assume under ₹2 crore unless a rule needs otherwise; say when the threshold matters). Today is 2026-10-28.

**Read first:** `CLAUDE.md` (rule 8 as rewritten), `docs/08-security-compliance.md`, `docs/08-research-appendix/A-gst-invoicing.md`, `docs/08-research-appendix/B-dpdp-legal.md`, `docs/runs/m5-batch.md` (Q1–Q71), and `docs/13-decisions.md` (never reopen a decided product question; a decided *legal* default may be corrected by research, say so).

**Inputs:** `.logs/research/verify-raw.txt` (every VERIFY line outside run files, `file:line:text`). Take only your topics. Many lines repeat one question: merge them into one item and list every place.

**Sources:** official and primary only, newest first: the Acts and Rules as amended (CGST/IGST Acts and Rules, FEMA and RBI Master Directions, DPDP Act 2023 and DPDP Rules 2025, IT Act 2000, Bharatiya Sakshya Adhiniyam 2023, Consumer Protection Act 2019 and its E-Commerce Rules), CBIC notifications and circulars (cbic-gst.gov.in, taxinformation.cbic.gov.in), GST Council meeting press releases, GSTN advisories (tutorial.gst.gov.in, gst.gov.in news), RBI (rbi.org.in), MeitY (meity.gov.in), egazette.gov.in, indiacode.nic.in. Secondary sources (big-four or CA blogs) only to find the primary one; never cite them alone. **Check for amendments after your training data**: search for 2025–2026 changes (e.g. GST rate rationalisation and the 56th/57th Council meetings, IMS, GSTR-1A/3B hard-locking, e-invoice thresholds and the 30-day reporting limit, DPDP Rules 2025 commencement dates, RBI export-realisation period changes, UPI MDR). If a page can't be fetched, say so; don't fill the gap from memory.

**Output:** write your draft with Bash to `.logs/research/<R-A|R-B>.md` (a git-ignored scratch file; this is the only file you may write). One section per item:

```
### <ID> <one-line question>
- Where: <files:lines, merged> (and Q-numbers of the batch page)
- Current default in the code/docs: <what we do now>
- Answer: <the rule, plainly, with numbers>
- Source: <title, section/rule/notification no., date, URL> (one or more)
- Status: SETTLED | OPEN: <the precise question a CA must answer, and why the sources don't settle it>
- Change: none | settings default <key: old → new> | code rule <what> | wording <what>
- Confidence: high | medium (medium only with a reason)
```

Then a short list: items where our current default is **wrong** (most important first), and any time-limited duty (date, what, who). Return only a summary (counts, the wrong-default list, the OPEN list) as your final message; the lead reads the file.

**Topics R-A (GST and invoicing):** tax invoice contents and timing (Rule 46, s.31, Rule 47), invoice numbering and series per FY, B2C and B2CL, place of supply (s.12/s.13 IGST), CGST+SGST vs IGST, rounding, discounts, reverse charge, credit and debit notes (s.34, the 30 November deadline, Rule 53), IMS, GSTR-1/1A/3B and Table 13, HSN/SAC and HSN summary rules for our turnover, e-invoicing applicability, export of services (s.2(6) IGST, LUT under Rule 96A, Rule 46 endorsement, zero-rating, FX conversion under Rule 34 and the date to use), proformas, receipt vouchers and advances (Rule 50, s.13 time of supply for services, tax on advances), continuous supply and recurring care invoices, refund vouchers, voiding/cancelling an invoice, document retention (s.36, Rule 56–58), the signature requirement (Rule 46 and digital signature), statement and reminder wording that names tax, UPI MDR (U-3), the 57th Council (U-9), and every tax Q of Q1–Q71.

**Topics R-B (everything else legal):** FEMA export realisation (period, EDF/SOFTEX for software and services, extensions, U-2, Q60), foreign-currency receipts and FIRC/e-BRC; DPDP Act 2023 and Rules 2025 (notice, consent, legitimate uses, retention and erasure periods, breach notice, data principal rights, children, cross-border transfer, commencement dates); IP, user agent and location in audit logs; anonymising a client and what must be kept for tax (s.36 vs erasure); e-signature and click-to-accept evidence (IT Act s.10A, s.3A, BSA 2023 s.61–63), the acceptance certificate contents; website legal pages (privacy, terms, refunds, cookies, grievance officer, Consumer Protection E-Commerce Rules applicability to a service seller); payments regulation (RBI payment aggregator rules, never storing card data, PAYMENTS_LIVE_ALLOWED); marketing email consent; security.txt and "encrypted off-site backups" claims; and every non-tax legal Q of Q1–Q71.

Usage: 2026-10-28, two analyst starts (Opus 5.5, high) stopped at once: no web tools in this conversation (agent files load when a conversation starts). No research done.

## Handover (2026-10-28, lead)
- **Done here:** owner decisions recorded (13-decisions, three rows of 2026-10-28 for this task); CLAUDE.md rule 8 rewritten; `.claude/agents/analyst.md` now lists WebSearch and WebFetch; this brief written. Branch `feat/research-and-wording` (pushed).
- **Raw lists** (git-ignored, regenerate if missing): `.logs/research/verify-raw.txt` (658 lines: `grep -rIn "VERIFY WITH\|VERIFY with CA\|verify with CA" apps packages docs scripts CLAUDE.md`, excluding node_modules, dist, .wrangler, docs/runs, 12-status, 13-decisions) and `.logs/research/placeholder-raw.txt` (43 lines: `grep -rIn "\[Placeholder" apps packages`, excluding tests).
- **Placeholder map (for step 4):** the marks are mechanisms as much as text: `INV_PLACEHOLDER`/`PLACEHOLDER_TAG` constants (admin `lib/invoice-types.ts`, `lib/catalogue.ts`, `lib/projects.ts`), `V07` in `lib/audit.ts`, `U`/`V` marks (`lib/invoice-send.ts`, `lib/reports.ts`, `packages/email/src/{billing,reports}.ts`, portal `copy-invoices.ts` with `APPROVED_07U`), `[Placeholder, 07-U]` in `packages/core/src/care-billing.ts` (care line text; `hasPlaceholder` blocks automatic issue) and jobs `alerts.ts`, `care-billing.ts`, `reports.ts` (`PLACEHOLDER_07V`), `lut-check.ts`; note errors in `apps/admin/worker/note-model.ts` (`DEBIT_PARENT_FULLY_CREDITED`, the no-closest-amount line, batch Q66) and `invoice-notes.ts:569`. The issue guards (`packages/core/src/invoices.ts:392`, `packages/db/src/issue.ts:347`) that refuse a line containing `[Placeholder` **stay** (they are a safety net, not copy).
- **Next:** in a new conversation ("continue"): check the analyst has WebSearch/WebFetch (start R-A first; if it still lacks them, stop and tell the owner), then run R-A and R-B in parallel as briefed, then steps 3–6.

Usage: 2026-10-28 R-A analyst (claude-opus-5-5 / high, skills: none, flagged: no §9 row fits pure legal research; kept with that reason), 82 tool uses, 19 min; R-B analyst (claude-opus-5-5 / high, skills: cloudflare:cloudflare), 104 tool uses, 21 min. 5-hour window 26 % at start.

## Research results (2026-10-28, step 2 done)
- **Drafts:** `.logs/research/R-A.md` (RA-01 to RA-31: 15 settled, 11 settled with an open sub-question, 5 open) and `.logs/research/R-B.md` (RB-01 to RB-34: 21 settled, 13 open). Both git-ignored; their summaries are in the lead's handover below.
- **Fetch limits the agents hit:** taxinformation.cbic.gov.in and egazette.gov.in (TLS), meity.gov.in, indiacode.nic.in, pib.gov.in (403), consumeraffairs.nic.in (refused). Many items lean on 08-A/08-B's reading of 2026-10-06 or on secondary reports and are rated medium.
- **R-A wrong defaults (most important first):** Q37 lapsed LUT on a payment-received invoice (refuse the LUT route when the receipt day's FY has no ARN); "Discount after sale" credit notes allowed from 2026-11-01 (Notification 03/2026-CT, sections 153–155 Finance Act 2026); Q11 no DUPLICATE FOR SUPPLIER copy (Rule 48(2)); credit notes near 30 November (warn from 1 October); Q24 FX "that day's rate or the last published before it"; Q35 offer a tax-only debit note (owner's choice); stale text: U-9 can close, 08-A §6, GSTR-9 optional up to ₹2 crore (Notification 15/2025-CT).
- **R-B wrong defaults (most important first):** `emailLogMonths` minimum 1 → 12 (DPDP Rule 8(3), from 2027-05-13); "encrypted off-site backups" not true until Phase 7 L7 (add a pre-production gate); grievance line "aim to resolve" → "resolve within one month" (SPDI Rule 5(9)); E-Commerce (Amendment) Rules 2026 (notified 2026-09-09, from 2027-01-01) missing from the docs; U-2 "15 months" wrong (back to nine months, FEMA 23(R)/(8)/2026-RB); extensions are granted by the AD bank, not "RBI"; 07-V "invoiced in rupees" → "invoiced or settled in Indian Rupees"; one EDF may cover a month (Reg. 3(2)(a)); Razorpay no longer lists a Delivery page; security.txt 366 → 365 days (optional).
- **Owner question raised (RB-19):** keep Accept from the emailed link for any value (recommended), or require a full portal sign-in above a set value.

## Lead's source check, started (2026-10-28)
- **The in-app browser reads CBIC pages the agents couldn't** (direct URLs such as `.../gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html` and `.../gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html`). The site search doesn't work by typing, some rule URLs give 500 (Rule 96A under chapter10), and the cookie banner is left untouched. A PDF link may start a download: use WebFetch for PDFs (it saves them, but there is no PDF text extractor installed; R-B wrote a stdlib extractor in its scratchpad).
- **Checked:** Rule 48(1)–(6) matches RA-07 word for word (DUPLICATE FOR SUPPLIER required; 48(6) exempts only IRN e-invoices). s.34 CGST matches RA-03/RA-04 (30 November, proviso substituted w.e.f. 01.10.2025 by s.126 Finance (No. 7) Act 2025). PIB PRID 2320934 is the 57th Council's recommendations (RA-01).
- **Discrepancy, resolved as medium:** the CBIC s.34 page still marks the s.154 insertion "w.e.f. yet to be notified", while TaxO (28.10.2026), CAclubindia, TaxGuru and A2Z all report Notification 03/2026-CT (26 Oct 2026, S.O. 5791(E)) appointing 1 Nov 2026 for sections 153–155. CBIC's repository lags; the gazette PDF itself was not read. Register RA-02 as "Researched 2026-10-28" with that note, confidence medium, and re-read the CBIC page after 1 November.

## Handover (2026-10-28, lead, after step 2)
- **Next (step 3, new conversation, "continue"):** read both drafts; check every item marked settled against its primary source (in-app browser for CBIC; R-A's medium items and R-B's DPDP items first); write `docs/08-research-appendix/C-research-register.md` (one row per item: Researched <date>, <source> or OPEN: <question>); update docs/08 (U-2, U-4, U-9, G-items), 08-A §6, 08-B. Then ask the owner in one batch (AskUserQuestion): RB-19, Q35 tax-only debit note, Q11 duplicate copy, Q37 lapsed-LUT rule; the CA-only OPEN items go on the owner's one-page list, not as questions.
- **Then step 4 (wording) and step 5 (build brief)** as listed above; the code changes found so far: Q37 LUT rule, discount reason from 2026-11-01, DUPLICATE FOR SUPPLIER PDF, 1 October credit-note warning, FX date rule, `emailLogMonths` ≥ 12, backup gate in `check-prod-readiness.mjs`, wording fixes listed above.

## Step 3 done (2026-10-28, lead)
- **Register written:** [08-C](../08-research-appendix/C-research-register.md), 65 items (RA-01–31, RB-01–34): settled rows tagged "Researched 2026-10-28, <source>", OPEN rows with the precise question; §5 lists the CA and lawyer questions, §6 the time-limited duties, §7 maps Q1–Q71.
- **Lead's source check on CBIC (in-app browser):** Rule 34(2) (FX date = time of supply), s.15 with the Finance Act 2026 substitution of s.15(3)(b) (enacted text; CBIC still shows "w.e.f. yet to be notified", the gazette notification 03/2026-CT sets 1 Nov 2026), s.7(1)(a) ("for a consideration", RA-11 settled), plus the earlier s.34 and Rule 48 checks. Rule 96A still gives a 500 on CBIC; it rests on the 2026-10-06 reading.
- **Docs updated:** docs/08 U-2, U-3, U-4, U-9 (U-9 closed); 08-A §6 (discount after sale in force from 1 Nov 2026).
- **Owner answers (13-decisions):** Q37 block the lapsed LUT; Q11 store a DUPLICATE FOR SUPPLIER copy; Q35 add the tax-only debit note; RB-19 link acceptance for any value. Lead triage row added.

## Handover (2026-10-28, lead, after step 3)
- **Next: step 4 (wording)** in a new conversation ("continue"): the lead writes every placeholder line (placeholder map above) and the pending 07 appendices (C, K, L, M, N, O, P, R, S, T, U, V), folding in the register's wording changes (08-C §1–§3 "Change" column: grievance "resolve within one month", certificate s.63 line, IP/browser line at portal sign-in and Accept, staff enrolment line, refunds line, "invoiced or settled in Indian Rupees", "your bank", care-terms overage line, IMS line in 07-T, GSTR-9 optional, Q8 confirmation, signature hint, house-rule marks on the checklist, complaint-copy line), and replaces each "VERIFY WITH CA/LEGAL" tag with "Researched 2026-10-28, <source>" or "OPEN (C-<ID>): …".
- **Step 5 build list (for the builder brief):** Q37 LUT refusal; "Discount after sale" from 2026-11-01; DUPLICATE FOR SUPPLIER PDF (jobs, stored in DOCS, never sent); "Tax charged too low" debit-note reason; 1 October credit-note warning; FX "same day or last published" rule; `emailLogMonths` ≥ 12 (with a read-time floor); backup gate in `check-prod-readiness.mjs`; security.txt 365 days; prior-price content-lint guard. Tier A.
- **Owner's one-page list** at the end: the CA and lawyer questions of 08-C §5 and the duties of §6.

## Step 4 done (2026-10-28, lead)
- **07-R, 07-S, 07-T, 07-U, 07-V approved by the lead** under the owner's delegation: every "VERIFY WITH CA/LEGAL" replaced by "(Researched, 08-C <ID>)" or "(OPEN, 08-C <ID>)"; the code's marked gaps written (footer notes none by default; checklist house rules = bank details, payment link, authorised signatory; Q66 rounding line; debit on a fully credited invoice; note draft whose invoice changed; care overage note; milestone and start-plan line words); research changes made (DUPLICATE FOR SUPPLIER, Q37 refusal and route choice, FX "that day or last published", Q8 confirmation, discount after sale from 1 Nov 2026, tax-only debit note, credit-note deadline and 1 October warning, GSTR-9 optional, EDF one per month, FEMA 9/12 months "invoiced or settled in Indian Rupees", "your bank" not RBI, "GST date" not "GST refund date"). New lines sit in a dated last section of each file (R §7, S §9, T §9, U §9, V §11).
- **07-K to 07-P:** headers now point to their 07-Q approval of 2026-10-26 (the "PENDING" text was stale).
- **07-A v0.3:** grievance "resolve within one month" plus the complaint copy; refunds to another account in the payer's own name; GST credit-note time limit; every legal tag replaced; new §9 notices (portal sign-in, Accept, staff enrolment, certificate line). Privacy notice and refund policy version lines move (refunds 0.1 → 0.2; the privacy notice's version is set by the designer with `legal.ts`).

## Brief for step 5 (build): research and wording, Tier A
**Branch:** each agent branches from `origin/feat/research-and-wording` (e.g. `feat/rw-builder`, `feat/rw-designer`) in its own worktree and pushes only that branch. Read first: CLAUDE.md, this run file, [08-C](../08-research-appendix/C-research-register.md), 07-R/S/T/U/V (the dated last sections first), 07-A §1–§3 and §9, 07-N §5. **Copy is word for word from 07; never invent a line; a missing line is a stop-and-report.** Load every fitting skill (docs/14 §9).

### Builder (Sonnet 5.5, high): logic, worker and job strings, PDFs, emails, tags. Files: `packages/*`, `apps/*/worker`, `apps/jobs`, `scripts/`. Not `apps/admin/src`, `apps/portal/src`, `apps/web/src` (the designer's).
1. **Q37 (S §9):** the tax invoice for a payment received is refused on the LUT route when no LUT is saved for the FY of the receipt day (`advance_lut_missing`); the request may choose the IGST route instead (IGST 18 %, with the S §9 PDF line). Guard in core, in the admin route and in the freeze `WHERE` of `advanceIssueStatements`. Tests both ways and at the FY boundary (31 March / 1 April IST).
2. **Discount after sale (T §9):** allowed only for credit notes dated ≥ 2026-11-01 IST (`discount_reason_not_in_force`); core rule + note issue path; update the notes.ts:46 comment.
3. **Tax-only debit note (T §9, Q35):** reason "Tax charged too low": taxable value 0, tax only, at the parent's heads and rates; `debit_tax_only_invalid`; reported in GSTR-1 CDNR/CDNUR like any debit note (check the register and `@techaust/core/gst` rows); trigger and cap checks still pass.
4. **DUPLICATE FOR SUPPLIER (R §6, Q11):** jobs renders a second PDF of the same frozen envelope with the mark "DUPLICATE FOR SUPPLIER" for every tax invoice, export invoice, credit and debit note (not proformas), write-once in `DOCS` under its own key, never attached or linked to a client; the admin API serves it to Owner/Accountant (`document-pdf.ts`, a `copy=supplier` path segment or route, not a query parameter carrying data). One unit of work per queue message. Watch the jobs byte budget (844,916 of 1,000,000) and admin API (576,894; third Worker at 650,000).
5. **FX rule (S §8):** `fx_date_invalid` now: the rate date equals the time-of-supply date, or is earlier by at most `fxMaxAgeDays` only when the Owner states no rate was published that day (a `noRateThatDay` flag stored with the rate); otherwise refuse. Message lines from S §8 / §9.
6. **Credit-note deadline (T §4):** the banner data from 1 October of the deadline year (`deadlineWarnFrom`), advice date 31 October; hard block unchanged.
7. **`emailLogMonths` ≥ 12** (schema minimum and a read-time floor for stored rows) (08-C RB-09).
8. **Pre-production gate (08-C RB-30):** `scripts/check-prod-readiness.mjs` fails until a verified backup is recorded (a repo file or variable the L7 runbook sets; choose the simplest, name it in the run file).
9. **security.txt ceiling 366 → 365 days** in `scripts/web-dist-checks.mjs`.
10. **Prior-price guard (08-C RB-22):** `scripts/web-content-lint.mjs` fails on "was/now" or "% off" price wording in built pages unless allow-listed with a reason.
11. **Strings in builder files:** every line of 07-R §7, S §8–§9, T §8–§9, U §6 and §9, V (changed lines and §11) that lives in a worker, jobs, core, email or pdf file; remove every `[Placeholder` mark and the `PLACEHOLDER*`, `U`, `V`, `V07`, `APPROVED_07U` mechanisms in those files (care line text from U §6: automatic care issue then works where an owner switched it on). **Keep** the issue guards that refuse a line containing "[Placeholder" (`packages/core/src/invoices.ts`, `packages/db/src/issue.ts`). Care terms seed line (U §9) in `packages/db/src/seed/terms.ts` as a new append-only terms version if the seed is versioned.
12. **Tags:** replace every "VERIFY WITH CA/LEGAL" comment in builder files with `Researched 2026-10-28, <source> (08-C <ID>)` or `OPEN (08-C <ID>): <question>`, using 08-C's rows; a line no row covers is listed in the run file, not guessed. Regenerate `.logs/research/verify-raw.txt` at the end; report the count left.
13. Tests for 1–10; `pnpm check` and the affected packages' tests through `tools/heavy.sh`; the whole-repo lint once at the end. Commit at each item.

### Designer (Opus 5.5, high): screens, legal pages, copy files. Files: `apps/admin/src`, `apps/portal/src`, `apps/web/src`. Starts after the builder's items 1–5 land (it needs the API codes).
1. Every line of 07-R/S/T/U/V that lives in the SPA copy files; remove the `[Placeholder]` marks and the `INV_PLACEHOLDER`, `PLACEHOLDER_TAG`, `U`, `V`, `V07`, `APPROVED_07U` mechanisms in SPA files.
2. New UI: the advance dialog's route choice (S §9); checklist "House rule" badges and switchability (S §3); "Download supplier copy" (R §7, Owner/Accountant); "Tax charged too low" with its amount field (T §9); the credit-note banner states (T §4); the FX "no rate was published that day" checkbox (builder item 5).
3. Legal pages from 07-A v0.3 in `apps/web/src/content/legal-pages.ts` and `legal.ts` (version lines and "Changes" sections); the §9 notices on the portal sign-in page, the Accept step and the staff enrolment screen; the certificate line goes to the builder (pdf) — coordinate through the run file.
4. Screenshots of every changed screen (both themes, 375 px and desktop); axe; stop every dev server before reporting.

### Then
Review (Opus 5.5, high, code + visual) → fixes → re-check → record (12-status, CHANGELOG, 13-decisions) → PR (auto-merge on green; Auto-fix on) → staging → the owner's one-page summary: what changed, the CA and lawyer list (08-C §5), the duties (08-C §6).

## Handover (2026-10-28, lead, after step 4)
- **Next:** step 5 in a new conversation ("continue"): budget gate, then start the builder with the brief above (`isolation: "worktree"`); the designer after the builder's items 1–5.

## Step 5: API contract (lead, 2026-10-28; builder and designer run in parallel against it)
The owner said "complete everything here now", so the builder and the designer start together (disjoint files); the designer builds against this contract and the lead integrates.
- **Advance (Q37):** `advanceBody` gains `route?: "lut" | "igst"` (omitted = the proforma's route). LUT route with no LUT saved for the FY of `receivedOn` → 409 `advance_lut_missing` with `details: { fy: "2027-28" }`. `route: "igst"` on an LUT proforma issues with IGST 18 % and the S §9 PDF line.
- **FX (RA-21):** `fxIn` gains `noRateThatDay?: boolean`. Rate date = the time-of-supply date → fine. Earlier date → needs `noRateThatDay: true` and within `fxMaxAgeDays`, else 400 `fx_same_day_exists` (flag false/missing) or `fx_date_invalid` (too old or later). Stored with the frozen FX.
- **Debit reason (Q35):** `DEBIT_REASONS` = `price_correction`, `tax_charged_too_low`, `other`. For `tax_charged_too_low` the debit body carries `taxAmountMinor` (total tax to add, > 0); the taxable value is 0; tax split over the parent's heads; bad shape → 400 `debit_tax_only_invalid`.
- **Discount after sale:** a credit note with `discount_after_sale` dated before 2026-11-01 IST → 400 `discount_reason_not_in_force`.
- **Supplier copy (Q11):** `GET /api/v1/invoices/:id/pdf/supplier` (Owner, Accountant; tax, export, credit and debit notes; proformas 404) answers like the existing `/:id/pdf` (ready / pending / failed). Jobs renders it after the original.
- **Credit-note deadline:** wherever the invoice view returns the credit-note deadline, it also returns `deadlineWarnFrom` (1 October of that year, ISO) and `adviseIssueBy` (31 October, ISO).
- **Checklist house rules:** core exports `HOUSE_RULE_ITEMS` (bank details, payment link, authorised signatory); the settings API marks each checklist item `houseRule: boolean`; only house-rule items may be switched off (others refused 400 `checklist_item_statutory`).
- **Notes draft changed:** `content_changed` with T §9's line. **Rounding (Q66):** T §9's line.
Any change to this contract is written here by whoever makes it, with the reason.
- **Designer, 2026-10-28 (contract notes):** (a) the issued invoice view needs the FY that had no LUT to print S §9's line on screen; the SPA reads `advance.igstNoLutFy` (a name I chose; builder or lead, add it or say the real one). (b) A tax-only debit note is sent with `lines: []` (and `mode: "lines"` in `fields.note`) plus `taxAmountMinor`: the contract didn't say. (c) `checklist_item_statutory` has no 07 line; the screen never offers that switch. (d) The certificate line of 07-A §9 is the builder's (pdf).

## Designer report (Opus 5.5 high, 2026-10-28)
Branch `feat/rw-designer` (from `origin/feat/research-and-wording` 2a34ba0; pushed). Commits: 9d8c92e (admin and portal wording, new UI), a410b0a (legal pages and the §9 notices), c52a27e (visual-pass fixes), then this report. Only `apps/admin/src`, `apps/portal/src`, `apps/web/src` and two `apps/web/test` files (their assertions follow the new legal version data) changed; no worker, package, jobs or script file. No hosted service touched. Local data fake ("(sample)", `@example.test`). Every dev server I started (admin, portal, website) is stopped; the browser is closed.

### Skills
- **`frontend-design:frontend-design`: loaded first.** What it changed: this is wording inside an approved system, so the direction was restraint: no new colours, cards or motion; each new piece reuses an existing device (the LUT banner's warning rule for the Q37 choice; the checklist's lock for statutory lines and one quiet outlined "House rule" tag for the rest; a text button under the PDF for the supplier copy, so the client's copy stays the panel's action). One change after looking: the badge now sits on its own line under every house rule (it had wrapped on one and not another).
- `dataviz`: not loaded (no chart, tile or dashboard changed). The other §9 rows (Workers, Cloudflare, SES) don't apply to SPA screens.

### Screens and copy placed
1. **Mechanisms removed** (SPA): `U`, `APPROVED_07U` (admin `lib/invoice-send.ts`, portal `copy-invoices.ts`), `V`, `P`, `APPROVED_07V`, `unmark` (`lib/reports.ts`), `V07` (`lib/audit.ts`), `INV_PLACEHOLDER` (`lib/invoice-types.ts` and its re-exports, route fallbacks), `PLACEHOLDER_TAG` (`lib/catalogue.ts`, `lib/projects.ts`). Every 07-R/S/T/U/V line shows unmarked. A line no approved appendix has goes through one helper, `apps/admin/src/lib/copy-gap.ts` (`gap()`, `COPY_GAP` = "[Placeholder]"), so the gaps are greppable in one place (list below). Data fallbacks that were `INV_PLACEHOLDER` (issuer name, void-by name, project name, due preview, a blocker's FY/date/days) are now "…" (`UNKNOWN`), as the send preview already did.
2. **07-S:** checklist intro, locked hint, "House rule" badge, INR export confirmation (Q8), `advance_lut_missing` and the §9 route lines, the IGST note, the advance line with IGST (on the issued invoice when the view sends `advance.igstNoLutFy`), `fx_date_invalid` (§8 new line; the day is the blocker's `date`), `fx_same_day_exists`.
3. **07-T:** debit reasons in §9 order, "Tax charged too low" hint, "Tax to add" and hint, "Discount after sale" hint, `debit_tax_only_invalid`, `discount_reason_not_in_force`, `debit_parent_fully_credited`, Q66 no-closest line, note-draft `content_changed`, GSTR-9 hint, the deadline banner (before / from 1 October / passed).
4. **07-U:** all lines unmarked; the care overage note (§9) in `lib/care.ts`.
5. **07-V:** all lines unmarked; §11 changes ("GST date in 30 days", layout note, EDF lede, realisation lede, "a different realisation period may apply" in the row line and the warning, extension note, B2CL and INR-period hints). Singulars of 07-V plurals follow their plural line; words that exist in 07-V §3 headers ("Taxable value", "Table", "Place of supply"), 07-U §3 ("Credit note"), 07-V §10 ("Open export realisation") and 07-Q POR3 ("Show more") are used as written.
6. **07-R §7:** signature hint (Settings › Company, replaces 07-P's), "Download supplier copy".
7. **New UI:** Settings › Tax checklist (statutory locked; Bank details, Payment link or QR, Authorised signatory with the badge, which is also the switch's description; `signatory` saved once stored or turned off); "Download supplier copy" for Owner and Accountant on tax, export, credit and debit notes (asks `/pdf/supplier` first; 409 `pdf_pending` toasts "PDF being prepared…", other failures "The PDF couldn't be made. Try again."; `fetchSupplierCopy`, `SupplierCopy`, an `extra` slot on `PdfPanel`); debit dialog with the reason first and "Tax to add" for "Tax charged too low"; reason hints; the deadline banner from `deadlineWarnFrom` (fallback: within 30 days) with the 31 October advice until `adviseIssueBy`; the advance dialog's Q37 choice ("Save the LUT first" links to Settings › Tax #luts; "Issue with IGST" is a pressed toggle that sends `route: "igst"` and shows the IGST note; focus moves to its heading); the "no rate was published that day" checkbox on an earlier rate date, sent as `noRateThatDay: true` only when ticked.
8. **07-A v0.3** (`apps/web/src/content/legal-pages.ts`, `legal.ts`): privacy §8, refunds items 5 and 6; privacy and refunds at **0.2**, `effective` "2026-10-28" (literal). Changes rows: privacy "Complaints are resolved within one month, and you get a copy of your complaint as we recorded it." (07-A's v0.3 row without its "(not "aim to")" aside); refunds "Refunds to another account in your own name on request; the GST time limit for credit notes." (07-A §3). Every VERIFY tag on the legal pages and their `.astro` files replaced with its 08-C ID.
9. **§9 notices:** portal sign-in under the button ("Privacy notice" links to `https://techaust.com/privacy`), portal Accept confirmation above the buttons (`NOTICES` in `copy-documents.ts`), staff enrolment step 1 under Continue (`routes/invite.tsx`). The certificate line is the builder's.

### Coded against contract fields the worker doesn't send yet
`route` and 409 `advance_lut_missing` with `details.fy` (also read at the top level; `api.ts` reads `fy`, `date`, `maxAgeDays` from either); `noRateThatDay` (body and view) and 400 `fx_same_day_exists` / `fx_date_invalid` (with `date`, `maxAgeDays` when sent, else the server's words); `taxAmountMinor` (body, `fields.note`, stored `request`) and `tax_charged_too_low` in core's `DEBIT_REASONS` (until core has it the SPA inserts it before "Other"; a test keeps every core code in the list); `discount_reason_not_in_force`; `GET /invoices/:id/pdf/supplier`; `deadlineWarnFrom` / `adviseIssueBy`; `houseRule` on checklist items and `invoiceChecklist.signatory`; `advance.igstNoLutFy` (my name, see the contract note above).

### Lines still missing from 07 (shown with "[Placeholder]"; proposals for one approval pass)
1. FX checkbox "No rate was published that day".
2. Debit reason label "Reason (required, printed on the debit note)".
3. Invoices list with filters hiding every row: "No invoices match these filters".
4. Blocker `line_text_placeholder`: "Line {n}: a line's wording isn't approved yet."
5. M5.4 review lines 07-U lacks: the send hint and two lines with "Can see finance", "Waiting for the PDF. The email goes as soon as it's made.", "Waiting for the PDF", "Payment reminders are paused too. You can resume them on this page.", "Reminders paused.", "Reminders resumed.", "Skipped: missed while reminders were paused", the care toggle hint (07-U §6's approved hint says "billing contacts with portal access" and "anyone can turn it off", wrong on this screen, so the L7 version stays marked), "Not in effect", the care plan's billing section (9 lines), portal "Sign in to your client portal to see all your invoices and payment requests in one place."
6. 07-V lacks: "Section", "Documents", "Cancelled. No files were made.", "Overall", "Files", the two HSN/SAC download rows, "None in this period.", "Show" (twice), "Output tax", "No export invoices in this list.", "Statement entries", "Export deadlines can't be worked out until the Tax settings are saved again.", "Open invoices", and the three realisation-period errors in Settings › Tax.

### Screenshots (`.logs/rw-designer/` in my worktree)
SIMULATED = view or answer changed in the browser (a `fetch` wrapper; the contract's fields and a local PDF don't exist yet); SAMPLE = the portal's dev-only sample API.
- `admin-enrolment-notice-1280-light`, `-375-dark`: enrolment notice under Continue.
- `settings-tax-checklist-1280-light`, `-375-dark`: locks, house-rule badges, switches.
- `settings-signature-hint-375-dark`: R §7 hint.
- `invoice-supplier-copy-deadline-info-1280-light-SIMULATED`: supplier copy under the PDF, the deadline's info line.
- `invoice-supplier-copy-pending-toast-1280-light-SIMULATED`: copy still being made.
- `invoice-deadline-warning-1280-light-SIMULATED`: the 1 October warning.
- `debit-dialog-tax-too-low-1280-light-SIMULATED`, `debit-dialog-tax-too-low-error-375-dark-SIMULATED`: reason first, tax field, its error.
- `credit-dialog-discount-hint-375-dark-SIMULATED`: discount-after-sale hint.
- `advance-lut-missing-choice-375-dark-SIMULATED`, `advance-igst-chosen-375-dark-SIMULATED`, `advance-igst-chosen-1280-light-SIMULATED`: Q37 choice, no-rate checkbox, IGST note.
- `keyboard-advance-route-focus-1280-dark-SIMULATED`: focus ring on "Issue with IGST".
- `reports-realisation-1280-dark`: new lede and notes, no marks.
- `portal-signin-notice-1280-light`, `-375-dark`; `portal-accept-notice-1280-light-SAMPLE`, `-375-dark-SAMPLE`; `portal-invoices-unmarked-1280-light-SAMPLE`.
- `web-privacy-grievance-1280-dark`, `web-privacy-changes-1280-dark` (0.2 first), `web-refunds-375-light`.

### Checks run
- `biome check --write` on the changed files: clean. `tsc -p tsconfig.json` admin (`rwd-tsc-admin3`) and portal (`rwd-tsc-portal2`): exit 0.
- Admin `vitest run src` (`rwd-test-admin-src2`): 19 files, **351 passed**. Portal `vitest run src` (`rwd-portal`): **41 passed**. Web `test` (`rwd-web-test2`): 21 files, **423 passed** (two assertions changed on purpose: privacy 0.2 and its lastmod). Web build (`rwd-web-build`): exit 0, dist checks pass.
- axe (wcag2a, 2aa, 21aa, 22aa): admin Settings › Tax, the issued invoice, the debit dialog with its error, the proforma; portal sign-in, the Accept confirmation, the invoice list; /privacy, /refund-policy: **0 violations** each.
- Keyboard: the route choice takes focus on its heading, Tab reaches both options with a visible ring; house-rule switches are named by the label and described by the badge. Console: only 401s before sign-in and my own setup requests.
- Whole-repo `pnpm lint` once (`rwd-lint`): exit 0; its 10 warnings are in files I didn't touch.

### Not verified
- Nothing against the builder's real API: every new contract path was seen only SIMULATED. The real supplier-copy download and the "passed" deadline state were not shown.
- Admin worker tests, `pnpm check` and the full `pnpm test` not run (no worker file changed; the lead's integration).
- 30 VERIFY tags remain in my files outside the legal pages and the invoice libraries (settings and clients screens, web price notes, `company.ts`); several have no clear 08-C row. Not changed.

### Open questions (lead)
1. The 07-U §6 care toggle hint: the approved line as written, or approve the marked L7 version?
2. The privacy "Changes" note wording above: keep?
3. After 31 October the banner drops "Issue it by 31 October…" and keeps "Only {days} days left for a credit note on this invoice." Intended reading of T §4?
4. The admin `VerifyNote` component still prints "VERIFY WITH CA/LEGAL" as a visible tag on five screens; its words need the lead's choice now that tags are "Researched/OPEN".
5. The portal's "Privacy notice" link is `https://techaust.com/privacy` (no website-origin setting in the portal; on staging it leaves for production). A `WEBSITE_ORIGIN` var would be the builder's.
6. The marked lines above, for one approval pass.
