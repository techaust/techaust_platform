# M5 batch (M5.1 to M5.5: invoices, GST, credit and debit notes, recurring, exports)

Status: open

## Owner's answers (2026-10-27)
- **Scope:** build M5.1 to M5.5 as one batch while the owner is away, like the M3.4 to M4.5 batch: each milestone still has its own brief, review, fixes, re-check and PR to staging; the owner reviews the whole batch at the end (a second exception to hard rule 2; docs/13). M5.0 (the admin Worker split, PR #95, on staging) is reviewed with the batch.
- **The owner's calls** (tax and invoicing rules, copy): use the researched default as a setting, mark it **VERIFY WITH CA/LEGAL**, show missing copy as `[Placeholder]`, and collect every question on one numbered page with a recommendation each for the batch review. Nothing waits on the owner mid-batch unless it is a hosted change or something only the owner can do.
- The usual gates: 5-hour window ≥ 80 % → no new agent; at most two agents at once, at most one browser agent.

## Known owner inputs (not blocking the build)
- The LUT ARN for FY 2026-27 (docs/08 U-1): the LUT guard (ADM-INV-18) blocks an LUT-mode export invoice until it is saved in Settings; that is the intended behaviour.
- The view on the tax defaults and an optional CA review (docs/09 §M5).

## Phase plan (analyst Opus 5.5 high, 2026-10-27; checked by the lead)
Lead's check: the plan keeps the Free plan (cron count unchanged: `30 * * * *` replaces the planned `*/15`; no new queue), needs no hosted change before M5.4, and asks nothing docs/13 already decides. Until the owner answers the batch page, each owner question below is built with its recommended default, marked VERIFY WITH CA/LEGAL where tagged. The M5.4 cron reaches staging with its merge (config only, the M3.2 precedent); the lead tells the owner in the batch summary.

### 1.1 What M4.3 to M4.5 built that M5 reuses, and what is missing
| Area | Exists (reuse) | Missing (M5 adds) |
|---|---|---|
| Numbering | `doc_counters` + forward-only triggers; `sqlPrintfPattern`, `validateFormat`, `maxNumber` (`packages/core/src/numbering.ts:35, 59-78, 123-133`); the series lock in Settings plus the numbering-version guard in the send batch (`packages/db/src/issue.ts:97`) | Invoice issue batch; the "first character not 0, / or -" rule; a counter ≤ `maxNumber` guard |
| Issue guard | `issue_guard` (drafts only, `triggers.ts:358, 371-378`); `issue_result_check` accepts `issued` for non-quotes (`:422`) | Tests for each invoice type as it becomes issuable |
| Freeze | `documents_frozen_update` over the live columns; child-row freeze; `MUTABLE_AFTER_FREEZE` covers status and the ledger columns; void columns are set-once (`triggers.ts:32-65`) | An invoice status flow (the flow trigger covers quotes only, `:430`); void pairing |
| Snapshot and seal | `sealOf` / `SealParts` (`packages/db/src/documents.ts:227-261`), core `snapshotSha256`, the R2 envelope written once | An invoice seal (`{v:3, kind:"invoice"}`) including bank, signature reference and due date |
| PDF | `pdf.snapshot` → `pdf.render` → R2 write-once, pacing, the daily quota bell, the sweep | Invoice envelope and view, an invoice layout, jobs accepting invoice types, the sweep index |
| Approvals | Table, the `pending` unique index, bells, `approval.notify` emails (discount only) | Kind `issue` in request, list and decide; approve = issue |
| Tax | `computeDocument`, `splitInclusive`, `creditNote`, the `lutsOf()` list reader | Nothing in M5.1 (credit notes in M5.3 reuse `credit.ts`) |
| Drafts | `quote-model.ts` (`resolveLines`, `itemLines`, `computeQuote`, `taxContext`, `taxInputOf`, `readSettings`); convert and first-instalment drafts | An invoice draft model, routes and editor; drafts from a milestone |
| Send | `document_sends`, `offer_links`, `doc_access_tokens` (no contact binding), email queue | Invoice send and the portal invoice page (M5.4) |
| Jobs | Daily cron at 22:00 UTC that only enqueues (`apps/jobs/src/index.ts:29-40`) | Hourly cron, care billing, reminders, alerts (M5.4/M5.5) |
| Payments | None (`approvals.payment_id` waits for M6) | M5 never writes paid amounts (LD17) |

### 1.2 Milestones
| # | Tier | PRD IDs | Reuses | Adds | Screens (designer) | Emails / PDFs |
|---|---|---|---|---|---|---|
| **M5.1 Issue pipeline and numbering** | A | ADM-INV-01 (types; only `tax_invoice` issuable), -02, -03, -04, -07; ADM-APR-01/02 (issue kind); ADM-PRJ-02 ("Create invoice"); ADM-SET-04 validator; ADM-INV-14 (columns already exist; QR block only when an IRN exists) | Everything in 1.1 | Invoice routes, issue/void/request batches, `invoice_triggers`, invoice seal, invoice PDF wiring, a Table 13 summary function | Invoice list, draft editor, issue / request / void dialogs, frozen view, approvals for issue, client "Invoices" tab, milestone "Create invoice", the "Converted to…" link (docs/13 2026-10-26) | **Tax invoice PDF**; the approval request/decided email variant for issue requests |
| **M5.2 Document types and templates** | A | ADM-INV-06, -08, -10, -18; export endorsement (G-8); proforma; ADM-SET-03 `tax.luts` | The M5.1 batch and seal | Export and proforma issue; configurable mandatory-field checklist; FX capture (manual, Q7); LUT list + hard block + 1 March reminder; "tax invoice for an advance received" (Q9); `service_completed_on` (ADD COLUMN, 08-A §5 :240); GSTIN types TDS/UIN/NRTP (VERIFY); purpose-code hint | FX dialog, Settings › Tax LUT list, checklist panel, advance dialog | **Export invoice PDF, proforma PDF**; LUT reminder email |
| **M5.3 Credit and debit notes** | A | ADM-INV-11; debit notes (s.34(3)); G-11 | `core/tax/credit.ts`, the M5.1 batch, parent trigger | CN/DN issue against an invoice (per line or amount), creditable cap, 30 Nov / annual-return block (fake clock), IMS status, `credited_minor` / `balance_minor` / status in the same batch, `annualReturnFiledAt` setting, CN LUT/B2C warnings | CN/DN editor from an invoice, deadline banner, IMS status control | **CN and DN PDFs** |
| **M5.4 Send, recurring and reminders** | A | ADM-INV-15, POR-06 (minimal: view + PDF, no pay), ADM-CARE-02, ADM-INV-12, -13, -19, ADM-INV-10's 25-day warning; JOB-CRON-02 | `document_sends` pattern, email queue, `care_plans.last_billed_period`, the `reminders` table | Hourly cron (`30 * * * *`), care billing (draft, or auto-issue as a system actor), reminders in the 09:00–19:00 IST window, pause, stop when paid or void, the unbilled alert, invoice links bound to a contact | Invoice send dialog, reminders panel, **portal invoice token page** (browser) | Emails: invoice issued, proforma, CN, DN, 5 reminders, care draft ready (bell), unbilled alert |
| **M5.5 GST and CA exports, realisation, EDF, statement** | A | ADM-REP-04, ADM-REP-07, ADM-INV-17 (thresholds only; FIRA upload M6.1), ADM-CLI-04; ADM-DASH-01 invoicing tiles | M5.5a core, Table 13 summary, the hourly/daily dispatcher | JSON report routes (`exports.gst` step-up), CSV built in the browser (LD16), alerts at 9 months / 12 months + 15 days, EDF list + reminder on the 5th, statement query (payments rows join in M6) | Reports › GST exports, realisation tracker, EDF screen, statement screen, dashboard tiles (`dataviz`) | **Statement PDF** (Q20); EDF reminder email |

### 1.3 Dependencies and parallel safety
- M5.1 comes before everything. M5.2 needs M5.1 (batch, seal, invoice model). M5.3 needs M5.2 (export credit notes use the original FX; the checklist applies to CN/DN). M5.4 needs M5.2 (care plans for USD clients make export invoices) and M5.3 (CN/DN emails). M5.5b needs M5.2 to M5.4 (exp, cdnr and the dispatcher).
- **Safe in parallel:** M5.5a, a pure core in new files (`packages/core/src/gst/*`, `packages/core/test/gst/*`, one subpath export) covering:
  - GSTR-1 section rows (b2b, b2cl, b2cs, exp, cdnr, cdnur, hsn b2b/b2c, docs) from typed register rows;
  - versioned column layouts;
  - the CSV writer;
  - realisation date maths;
  - the EDF rows.
  
  It has no D1, no routes and no migrations.
- **Each designer runs in parallel with the next milestone's builder**, provided the brief fixes file ownership. The designer owns `apps/admin/src/**`, `apps/portal/src/**` and `packages/pdf/src/layout/*`. The builder owns `worker/**`, `packages/db/**`, `packages/core/**`, `apps/jobs/**` and `packages/pdf/src/{types,envelope,parse-envelope,view,render}.ts`.
- **Not parallel:** two builders on `documents`, `issue.ts`, `triggers.ts` or migrations (the M5.1 to M5.4 builders); two browser agents.

### 1.4 Order (at most two agents, at most one browser agent)
| Step | Lane N (builders, analysts, code-only reviews) | Lane B (designers, visual reviews) |
|---|---|---|
| 0 | Lead: run files m5.1 to m5.5, 07-R draft, M5.1 brief (from this draft) | — |
| 1 | M5.1 builder stage A ‖ (optional, if the 5-hour window allows) M5.5a builder (pure core; needs its own short Tier A brief) | — |
| 2 | M5.1 analyst early check ‖ M5.5a review (code only) | — |
| 3 | M5.1 builder: early-check fixes, then stage B (PDF wiring, milestone drafts, client tab) | — |
| 4 | M5.2 builder (branch from M5.1's task branch after GO) | M5.1 designer (screens + tax invoice PDF) |
| 5 | M5.2 analyst early check | M5.1 review (code + visual) |
| 6 | M5.1 fixes (builder, logic) | M5.1 fixes (designer, screens) |
| 7 | M5.3 builder (from M5.2 after GO and its fixes) | M5.1 re-check, then the lead's PR (merge 1) |
| 8 | M5.3 analyst early check | M5.2 designer (export and proforma PDFs, FX/LUT/checklist) |
| 9 | M5.4 builder (from M5.3 after GO) | M5.2 review |
| 10 | M5.2 fixes (builder) | M5.2 fixes (designer), re-check, PR (merge 2) |
| 11 | M5.4 analyst early check | M5.3 designer |
| 12 | M5.5b builder (routes, alerts; from M5.4 after GO, with M5.5a merged in) | M5.3 review, fixes, re-check, PR (merge 3) |
| 13 | M5.5b analyst early check | M5.4 designer (send dialog, portal invoice page, emails) |
| 14 | M5.4 and M5.5 builder fixes | M5.4 review, fixes, re-check, PR (merge 4) |
| 15 | — | M5.5 designer, review, fixes, re-check, PR (merge 5) |
| 16 | Lead: batch question page, owner review of M5.0 to M5.5 | — |

**Merge order:** M5.1, M5.2, M5.3, M5.4, M5.5 (M5.5a rides in M5.5's task branch). A later task branch contains the earlier one's commits. After each squash merge it merges `main`, takes its own unapplied migrations, snapshots and journal entries out, and regenerates them (protocol of 2026-10-25). Fix commits made on an earlier branch after the later one branched are the main source of conflicts; the lead merges them in a side worktree.

**Migration numbers reserved** (next is 0037):

| Milestone | Numbers | Contents |
|---|---|---|
| M5.1 | 0037–0038 | 0037 indexes; 0038 custom `invoice_triggers` |
| M5.2 | 0039–0040 | `service_completed_on`, the export declaration block id (ADD COLUMN), the freeze trigger recreated, type rules |
| M5.3 | 0041–0042 | `ims_status` (ADD COLUMN, set-once/forward-only trigger), CN/DN triggers |
| M5.4 | 0043–0044 | Invoice-link contact binding, reminder indexes, the billed-period freeze |
| M5.5 | 0045 | Indexes only, if any |
| M5.5a | none | — |

### 1.5 Copy appendices (the lead drafts; missing lines stay `[Placeholder]`)
- **07-R (M5.1):**
  - invoice list, editor and frozen-view labels;
  - the issue, request-issue and void dialogs;
  - every new error code's message;
  - issue-request bells (a draft has no number: "Untitled" per the 2026-10-26 rule, or a client-code form; lead's choice);
  - the approval email variant for issue;
  - the tax invoice PDF's fixed words for `layout/copy.ts`: "Tax Invoice", "ORIGINAL FOR RECIPIENT", "Place of supply", "Amount in words", "Authorised signatory", "Balance due", the bank block labels;
  - the invoice footer notes default.
- **07-S (M5.2):**
  - the export endorsement, word for word from 08-A §8 :344-348 (legal text, VERIFY);
  - "Proforma Invoice – not a tax invoice" and "A tax invoice will be issued on receipt of payment";
  - the checklist lines;
  - LUT and FX messages;
  - the advance-received dialog;
  - the LUT reminder email.
- **07-T (M5.3):** CN/DN screens and PDFs, reasons, IMS labels, deadline lines, CN/DN emails (07 §8 :553-554 cores).
- **07-U (M5.4):**
  - full texts of the invoice, proforma and five reminder emails (07 §8 :545-551 cores; "View & pay" breaks the "and" rule, see Q13);
  - the portal invoice page;
  - the send dialog;
  - the care draft bell;
  - the unbilled alert.
- **07-V (M5.5):** exports screen, realisation tracker, EDF screen and reminder email, statement screen and PDF, dashboard tiles.

### 1.6 Hosted changes and owner actions
- **None required for M5.1, M5.2, M5.3 or M5.5.**
- **M5.4:** `"triggers": {"crons": ["0 22 * * *", "30 * * * *"]}` at the top level and in `env.staging` of `apps/jobs/wrangler.jsonc` (today `:40, :123`); none in production. This is config only (M3.2 precedent); tell the owner. If the lead counts a new schedule as a Cloudflare setting, ask instead.
- **Owner actions** (not hosted changes; before the batch review):
  - company profile and bank details in staging Settings (Q21);
  - the LUT ARN when filed (U-1; the M5.2 hard block on LUT exports is intended until then);
  - optionally the invoice footer notes.

### 1.7 Free plan and size
- **CPU:** the issue costs one read batch, the engine (<1 ms, unverified), two SHA-256s and one write batch of about 10 statements. The gate is ≤ 7 ms p99 on staging (front + API summed, M5.0 LD7). For comparison, M4.3's 100-line save took 25 ms of local wall time (not CPU), so measure issue at 1 and 100 lines.
- **Crons and queues:** crons only enqueue (one scan message); consumers handle one plan, one invoice or one reminder per message; keyset pages ≤ 50.
- **Admin API Worker size:** 381,059 of 800,000 bytes, with a third Worker planned at 650,000 (`docs/runs/m5.0-admin-split.md:164`). M3.4 to M4.5 added about 200 KB over seven milestones, so M5 is about 100–170 KB (estimate, unverified). Exports are built in the SPA, so they add no Worker bytes.
- **Browser Run:** about 1 render per invoice, CN, DN or statement. The paced pipeline already handles the quota.


## Owner questions (batch page; built with the recommended default until answered) for the batch page (recommended option first; none of these is decided in docs/13)
1. **Void window** (VERIFY WITH CA/LEGAL, 08-A §4 :204). (Recommended) Void only an issued invoice that has not been emailed to the client and has no payment and no credit or debit note; after that, a credit note only. Alternatives: void any time before payment; never void.
2. **Who may void.** (Recommended) The Owner only, with a fresh code; Staff cannot request a void. This is a new docs/04 §9 row.
3. **Invoice date** (VERIFY WITH CA/LEGAL, Rule 46(c), Rule 47). (Recommended) Always the IST day it is issued; no backdated or future dates.
4. **Zero-value invoices** (VERIFY WITH CA/LEGAL). (Recommended) Refuse to issue a ₹0 / $0 invoice.
5. **Date of supply for the 25-day unbilled alert** (VERIFY WITH CA/LEGAL, Rule 47). (Recommended) The day a milestone moves to "Ready to bill". Alternative: a delivery date typed on the milestone.
6. **Approving a Staff issue request.** (Recommended) Approving issues the invoice at once (with your code). Alternative: approve, then issue separately.
7. **FX rate source** (VERIFY WITH CA/LEGAL, Rule 34(2)). (Recommended) You type the FBIL/RBI reference rate of the invoice date (the last published rate when none was published that day), with date and source; automatic fetching later, if a reliable free source is confirmed (none verified).
8. **Export invoice in INR** (VERIFY WITH CA/LEGAL, s.2(6) IGST). (Recommended) Allowed only after an explicit confirmation in the issue dialog. Alternative: blocked.
9. **Advance received before online payments exist (M6)** (VERIFY WITH CA/LEGAL, G-6). (Recommended) An Owner-only "Issue tax invoice for an advance received" action on a proforma (amount, date, reference; idempotent per reference), which M6 later triggers automatically. Alternative: wait for M6.
10. **Mandatory-field checklist** (VERIFY WITH CA/LEGAL, Rule 46). (Recommended) The ADM-INV-06 list, with "payment link/QR" off until online payment exists, and bank details required.
11. **Supplier's copy** (VERIFY WITH CA/LEGAL, Rule 48(2)). (Recommended) One PDF marked "ORIGINAL FOR RECIPIENT"; our record is the frozen snapshot and the same PDF. Alternative: a second "DUPLICATE FOR SUPPLIER" PDF.
12. **PDF payment block.** (Recommended) Bank details and the portal address, no personal link (a PDF gets forwarded and is never re-rendered); the personal link lives only in the email.
13. **Email button until online payment exists.** (Recommended) "View invoice", then "View and pay" from M6/M7.1 (07 §8's "View & pay" also breaks the "and" rule).
14. **Credit-note IMS status** (VERIFY WITH CA/LEGAL, s.34 proviso from 1 Oct 2025). (Recommended) Set by hand from the GST portal (Pending / Accepted / Rejected) for registered clients; "Not applicable" otherwise.
15. **Realisation period for INR-settled exports** (VERIFY WITH CA/LEGAL, FEMA 2026, 08-A :354). (Recommended) 9 months for foreign-currency invoices and 12 months for INR, as settings; the GST escalation at 12 months + 15 days for both.
16. **EDF scope** (VERIFY WITH CA/LEGAL, 08 §7.2 Q5). (Recommended) Every export invoice of the month, including those paid through Stripe or PayPal.
17. **GSTR-1 export format** (VERIFY WITH CA/LEGAL, 08-A §12). (Recommended) Section-wise CSV files for the Offline Tool (b2b, b2cl, b2cs, exp, cdnr, cdnur, hsn b2b/b2c, docs); XLSX only if your CA asks (it needs a package you would approve, or an in-house writer).
18. **B2CL threshold** (VERIFY WITH CA/LEGAL). (Recommended) ₹1 lakh (Notification 12/2024) as a setting.
19. **Statement of account.** (Recommended) A PDF made on request through the existing PDF queue, plus a CSV. Alternative: screen and CSV only until M7.3.
20. **Alerts for unbilled work and 25-day proformas.** (Recommended) A bell to every owner and one email per item, sent once.
21. **Staging test data (your action).** (Recommended) You type the real company profile (legal name, GSTIN, address) and clearly labelled sample bank details ("SAMPLE BANK") in staging Settings before the batch review. Alternative: real bank details. (A made-up GSTIN with a valid check character could belong to a real business, so none is invented.)
22. **LUT reminder** (ADM-INV-18). (Recommended) From 1 March, a bell and one email a week until the next FY's ARN is saved.
23. **Void after the GST return is filed** (VERIFY WITH CA/LEGAL; from the M5.5a analyst). Q1's void rule allows a void before the client is emailed, but a void dated in a later period could disagree with a GSTR-1 already filed. (Recommended) Also refuse a void once the invoice's return period has ended (the 11th of the next month for monthly filers), so a correction after that is always a credit note. Alternative: keep Q1 as it is.

Not asked, because docs/13 or docs/04 §0 already decide them:
- the numbering format;
- proforma as the default advance mode;
- care-plan drafts with the per-client auto-issue toggle;
- `billing@`;
- Net 7 and the reminder offsets;
- the 30 Nov / annual-return block;
- a state is required;
- the LUT per FY and the per-document export mode;
- the signature is optional;
- no SEZ;
- pass-through costs are taxed.

## Lead decisions (docs/13, 2026-10-27)
- **LD1** Invoices get their own prefix `/api/v1/invoices`: the permissions differ from proposals, and a ROUTES row has one action. Update docs/05 §7.2 :427 to match.
- **LD2** M5.1 issues `tax_invoice` only; export and proforma answer 409 `type_not_issuable` until M5.2, and CN/DN until M5.3. No incomplete export invoice ever reaches staging.
- **LD3** One issue-batch module (`packages/db/src/issue.ts`) with shared helpers; the SQL of `sendStatements` stays byte-identical. This closes the "single issue-batch builder" follow-up.
- **LD4** The invoice seal is `{v:3, kind:"invoice", header}`; the number stays outside it and the write-once envelope pairs them (as M4.4).
- **LD5** SQL guards in the freeze: the settings versions, the bank rows, the client's `updated_at`, the counter ≤ the format maximum, and an owner session with a live step-up.
- **LD6** Approve = issue, in one batch with step-up checked in the handler. An Owner issuing directly closes a pending request as approved; a save expires it.
- **LD7** Void is `invoices.void` (Owner, step-up), with the rule of Q1. The number is kept; the stored PDF is never re-rendered.
- **LD8** No `idempotency_keys` table: a repeated issue answers 409 `already_issued` with the number.
- **LD9** `documents_pdf_pending` is recreated over the invoice family (index only).
- **LD10** Per-head rates are derived in the PDF view, not stored in `computed`, so no draft's content hash moves. This replaces the M5.2 follow-up "store the per-head GST rate".
- **LD11** The snapshot references the signature by key, SHA-256 and mime (content-addressed in DOCS). Jobs verifies and embeds the bytes, and the admin Worker does no base64. This replaces "embed the signature bytes"; referenced objects are never deleted (VERIFY; M7.4 follow-up).
- **LD12** `delivered_at` is set on the move to Ready to bill and kept at invoicing. This changes the M3.4 note "set when invoiced", which would make ADM-INV-19 impossible.
- **LD13** Milestone invoices use the inclusive split (milestones are tax-inclusive, M4.5), and the target total comes only from the stored milestone.
- **LD14** M5.4 uses a `30 * * * *` cron (whole IST hours: 06:00 billing and the 09:00–19:00 window) next to `0 22 * * *`, replacing docs/05 §11.3's `*/15`. New message kinds on existing queues; no new queue in M5.
- **LD15** Send (ADM-INV-15) and the minimal POR-06 page are built once in M5.4 for every invoice-family type, together with reminders.
- **LD16** GST exports are CSV built in the browser; no XLSX package.
- **LD17** M5 writes no payments: balance = total at issue, minus credits from M5.3. Statements and realisation read only documents until M6.
- **LD18** The numbering validator gains the first-character rule (closes that follow-up; VERIFY).
- **LD19** The invoice date and FY come from the IST issue instant; the due date is issue date + client terms, else the settings (Net 7).
- **LD20** M5.1 has the minimal statutory blocker list; M5.2 makes it the configurable checklist.
- **LD21** M5.1 also closes these follow-ups:
  - the `parent_id` foreign key, by trigger;
  - issued-status transitions;
  - the invoice-currency trigger;
  - `contactId` in the snapshot (and `CONTACT_ON_ISSUED_DOCUMENT_SQL` stays correct);
  - the series lock in the batch;
  - the post-condition test for tax invoices (proforma and export in M5.2, CN/DN in M5.3).

## Risks
1. **Law:** every rule is a researched default. The optional CA hour (08 §7.2) covers the largest ones.
2. **CPU on issue at 100 lines:** unmeasured. Gate: the staging cold reading ≤ 7 ms (front + API).
3. **API Worker bytes:** about 381 + 100–170 KB (estimate); the third-Worker trigger is at 650 KB.
4. **Branches that contain each other plus squash merges:** conflicts from late fix commits. Mitigation: the lead merges in a side worktree and regenerates migrations.
5. **Debit-note balance semantics:** docs/05 §9.2 :523 adds DNs to the parent invoice's balance. The M5.3 analyst checks this against GSTR-1 cdnr and the client's view.
6. **The manual advance action (Q9) followed by M6 automation:** a double tax invoice is possible unless it is unique per (proforma, payment reference).
7. **`doc_access_tokens` has no contact binding** (`schema/identity.ts:150-164`); M4.5's offer links bind a contact. M5.4 decides (ADD COLUMN, or a new purpose on `offer_links` by trigger swap).
8. **The realisation tracker before M6 tracks only due dates on unpaid exports;** FIRA uploads come in M6.1.
9. **The staging review depends on the owner's Settings entry** (Q21).

## Not verified (analyst)
- Cloudflare limits, taken from the repo docs and not checked against Cloudflare's own docs (no web or docs tool in this run):
  - cron triggers per account on the Free plan (I recall 5);
  - queue operations of 10k/day and 24-hour message retention (docs/05 §11.2, `apps/jobs/src/pdf.ts` comment);
  - Browser Run at 10 min/day and 1 request per 10 s (M4.4);
  - whether a service-bound Worker gets its own 10 ms (M5.0 LD7: unknown).
- D1 batch atomicity on staging (proven only locally in workerd).
- The real CPU of any new route.
- That the Offline Tool's CSV column sets match today's tool version.
- That FBIL offers a fetchable rate source.

## Handover
(written at the end of each conversation)
