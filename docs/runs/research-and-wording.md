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
