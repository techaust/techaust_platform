Status: open (research done; code waits until FX-3 and FX-4 have merged)
Tier: A (tax and legal wording, terms text)
Usage: analyst claude-opus-5-5/high, 2026-10-29 ~13:45–14:00 IST (skills: cloudflare:workers-best-practices)

# FX-5: research the bare "VERIFY WITH CA/LEGAL" tags

This is part of the owner's full audit of M1–M5 ([full-audit-m1-m5.md](full-audit-m1-m5.md)). FX-3 retagged every tag that 08-C already covered. The rest are listed in the guard `packages/core/test/verify-tags.test.ts` (`NO_ROW_YET`): **25 tags in 17 files**, not 22 as first counted. This task researches them under owner rule 8, adds the 08-C rows, retags each one, and fixes the defaults the research shows to be wrong.

- **Model:** Opus 5.5 at high effort (owner's audit instruction).
- **Base:** `origin/main`. The code changes are made after FX-3 and FX-4 merge (both touch these files), then this branch merges `main`.
- **Numbering:** the analyst read FX-3's branch, where the highest rows were RA-31 and RB-34. FX-4 has since added RA-32 (tax-only debit note in GSTR-1) and RA-33 (its round-off). So the analyst's RA-32 is **RA-34** here and its RA-33 is **RA-35**. RB-35 to RB-39 stay as drafted.

## Analyst's draft (Opus high, read-only, 2026-10-29), renumbered by the lead

### A. The 25 tags
Every tag is mapped below, with file and line on `origin/fix/fx3-admin-portal`:

| # | file:line | About | Row | Replacement tag |
|---|---|---|---|---|
| 1 | apps/admin/worker/clients.ts:951 | export: offer links sent to the person | RB-36 | `M4.5 (Researched 2026-10-29, DPDP s.11(1) (08-C RB-36)): …` |
| 2 | apps/admin/worker/clients.ts:956 | export: invoice links | RB-36 | `M5.4 (Researched 2026-10-29, DPDP s.11(1) (08-C RB-36)): …` |
| 3 | apps/admin/worker/clients.ts:965 | export: declined proposals | RB-36 | `M4.5 (Researched 2026-10-29, DPDP s.11(1) (08-C RB-36)): …` |
| 4 | apps/admin/worker/clients.ts:995 | file contents in an export | RB-36 | `OPEN (08-C RB-36): the Act asks for a summary; file bytes on request or never?` |
| 5 | apps/admin/worker/clients.ts:1295-1296 | O-Q4 drafts; a sent version keeps its frozen copy | RB-37 | `(owner O-Q4, 2026-10-25; Researched 2026-10-29, DPDP s.8(7), s.12(3) (08-C RB-37)) … (OPEN (08-C RB-37): may an unaccepted sent offer be kept against an erasure request, and for how long?)` |
| 6 | apps/admin/worker/documents-convert.test.ts:367 | a sent offer and the people it names | RB-37 | `[ADM-CLI-05, O-Q4; OPEN (08-C RB-37)]` |
| 7 | apps/admin/src/lib/clients.ts:4 | data-subject items | RB-36, RB-37 | `Researched 2026-10-29, DPDP s.11, s.12(3) (08-C RB-36, RB-37), with their OPEN parts` |
| 8 | apps/admin/src/lib/clients.ts:368-369 | erase removes project notes and files | RB-37 | `(owner, 2026-10-25; Researched 2026-10-29, DPDP s.12(3) (08-C RB-37))` |
| 9 | apps/admin/src/lib/projects.ts:111 | the 07-K erase/anonymise addition | RB-37 | `(Researched 2026-10-29, DPDP s.12(3) (08-C RB-37))` |
| 10 | apps/admin/src/routes/settings/payment-terms.tsx:1 | payment-terms settings | RB-39 (cap: RB-23) | `Payment terms (ADM-SET-05; Researched 2026-10-29, commercial settings, MSMED ss.15-16 (08-C RB-39); the liability cap OPEN (08-C RB-23))` |
| 11 | apps/admin/src/routes/settings/terms.tsx:1 | the five terms blocks | RB-38 (+RA-18, RB-24) | `Document terms (ADM-SET-08; OPEN (08-C RB-38): the proposal terms text; export declaration RA-18; refund link RB-24)` |
| 12 | apps/jobs/src/expire.ts:1-2 | what an expired offer means | RB-35 | `Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35): the offer lapses after the date it prescribes; a new version is a new offer.` |
| 13 | apps/jobs/test/expire.test.ts:4 | same | RB-35 | `Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35).` |
| 14 | packages/core/src/documents.ts:2-3 | discount threshold, offer evidence, validity (M4.3 items 1–12) | RB-35, RB-37, §7 | `The discount threshold is the owner's commercial rule (Q-P3-2), not a legal item. Validity: Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35); a sent proposal kept as evidence: OPEN (08-C RB-37); M4.3 items 1-12: 08-C §7.` |
| 15 | packages/core/src/documents.ts:448 | validity | RB-35 | `---- validity (Researched 2026-10-29, Contract Act s.6(2) (08-C RB-35))` |
| 16 | packages/core/test/documents.test.ts:533 | validUntil | RB-35 | `validUntil [08-C RB-35]` |
| 17 | packages/core/src/gstin.ts:1 | the state list | RA-34 | `Researched 2026-10-29, e-invoice portal master codes (08-C RA-34): the state list…` |
| 18 | packages/core/test/gstin.test.ts:87 | legacy state codes flagged | RA-34 | `(08-C RA-34)` |
| 19 | packages/core/src/schemas/settings.ts:53 | GSTIN shape and check character | RA-34 | `(state codes Researched 2026-10-29 (08-C RA-34); the check-character algorithm OPEN (08-C RA-34): no official text found)` |
| 20 | packages/core/src/schemas/settings.ts:101 | same | RA-34 | `(08-C RA-34)` |
| 21 | packages/core/src/schemas/settings.ts:568 | part-payment floor ₹10,000 | RB-39 | `Researched 2026-10-29, Razorpay first_min_partial_amount (08-C RB-39): a commercial default, no regulatory floor.` |
| 22 | packages/core/src/pdf-jobs.ts:134 | export place-of-supply wording | RA-35 | `Researched 2026-10-29, Rule 46(n), e-invoice master code 96 (08-C RA-35).` The wording changes too (C1). |
| 23 | packages/db/src/contact-access.ts:3 | portal access ends in the same batch; erase blockers | RB-37 | `Researched 2026-10-29, DPDP s.8(5), s.12(3), s.17(1)(a) (08-C RB-37), with its OPEN parts.` |
| 24 | packages/db/src/schema/crm.ts:29 | the lead's consent receipt | RB-28 (amended) | `(FRM-05; Researched 2026-10-28, DPDP s.6, s.6(10) (08-C RB-28))` |
| 25 | packages/db/src/seed/terms.ts:5 | the terms text: Payment (GST 18 %) and Ownership | RB-38 (+RA-16) | `OPEN (08-C RB-38): the text, Ownership (Copyright Act s.19) and the GST line; GST at 18 %: Researched 2026-10-28 (08-C RA-16).` |

### B. New 08-C rows (to add in the register's format)
- **RA-34: GSTIN shape, check character and state codes.**
  - **Settled (codes):** the list matches the e-invoice portal master (State Codes), with 96, 97 and 99. Code 28 is not listed. Former Daman and Diu GSTINs (25) were replaced under 26 from 1 Aug 2020 (Circular 168/24/2021-GST; Notification 10/2020-CT). So keeping 25 and 28 as legacy codes (accepted with a flag, refused as a place of supply) is right.
  - **OPEN (technical, lead):** no official text of the mod-36 check-character algorithm was found; only secondary sources agree on it. Before production, test the check against at least 3 real GSTINs from the GST portal's Search Taxpayer, TecHaust's own included.
  - **Not verified:** non-PAN registrations have other shapes (RA-05).
  - **Sources:** einvoice1.gst.gov.in Master Codes (read 2026-10-29); Circular 168/24/2021-GST; Notification 10/2020-CT.
- **RA-35: place of supply as printed.**
  - **Settled:** Rule 46(n) wants the State name for an inter-State supply. For an export, the place of supply is the recipient's location outside India (s.13(2) IGST). In the master, 96 = OTHER COUNTRIES and 97 = Other Territory. A proposal or estimate is not a tax document (RA-28); its place of supply is a preview (RA-12).
  - "Outside India (96 – Other Territory)" is **wrong**. It should read "Outside India (96)", as invoices already print (07-S §1).
- **RB-35: what an expired offer means; validity; revisions.**
  - **Settled:** Contract Act s.6(2): an offer lapses at the time it prescribes for acceptance. The printed "Valid until" date is that time; acceptance after it is refused in SQL, and the job only records the lapse. IT Act s.10A: electronic offer and acceptance are valid. Evidence: RB-19, RB-20.
  - **OPEN (lawyer):**
    - (a) whose midnight ends the validity date for an overseas client;
    - (b) whether sending v2 revokes v1 when the email doesn't say so (s.5, s.6(1)), and whether v1 can be accepted by email reply.
  - **Recommended copy:** "Valid until … (IST)", and on v ≥ 2: "This replaces version N, which can no longer be accepted."
- **RB-36: what a contact's data export holds.**
  - **Settled in part:** from 13 May 2027, s.11(1) gives a summary of the data and the processing, plus the identities of other fiduciaries and processors and what was shared. Replies within 90 days (Rule 14). There is no full-copy right, so our export goes beyond the law. Not exporting token hashes is a security choice (s.8(5)).
  - **Gap:** the export doesn't name the processors (s.11(1)(b)).
  - **OPEN (lawyer):**
    - (a) whether file contents belong in the export: always, on request, or never;
    - (b) GDPR Art. 15(3) for EU/UK persons (RB-27).
- **RB-37: erase and anonymise.**
  - **Settled in part:**
    - erase on request or once the purpose is served, unless retention is needed (s.8(7), s.12(3));
    - processing logs kept at least 1 year (Rule 8(3)); GST records 72 months (RA-25);
    - s.17(1)(a) (enforcing a legal right or claim) is the basis for keeping acceptances and declines;
    - never-sent drafts are not offers and not tax records, so deleting them is lawful;
    - notes and project files are not s.35 records, so deleting them is lawful;
    - ending sessions and links is a security safeguard (s.8(5), Rule 6).
  - **OPEN (lawyer):** (a) whether s.17(1)(a) covers keeping an unaccepted or expired sent offer naming an individual after their erasure request, whether it covers defending a claim, and for how long. Our default keeps it and refuses erase; anonymise is allowed.
  - **OPEN (CA):** (b) whether any law requires keeping proposals, estimates and approval records, and for how long. Income-tax Act 2025 retention not researched (RA-30).
- **RB-38: the proposal terms text.**
  - **Partly settled; two parts are wrong:**
    1. **Ownership:** Copyright Act s.17: the author is the first owner, the employer only under a contract of service. s.19: an assignment must be in writing, signed by the assignor, and must name the rights, the duration and the territory. Unused rights lapse after 1 year unless stated (s.19(4)). No period stated means 5 years (s.19(5)); no territory stated means India (s.19(6)). "On full payment, the code, designs and documentation are yours" names none of these: **wrong**.
    2. **GST line:** "for Indian clients" is incomplete. IGST can fall on an overseas client: on the IGST export route, with no LUT for the receipt day's FY, or when the s.2(6) conditions fail.
    3. "Valid until the date shown" fits s.6(2).
    4. "Invoices are due within 7 days" is fixed text, while the due-days setting is editable.
  - **OPEN (lawyer):**
    - (a) the assignment wording: all rights, worldwide, full term, the s.19(4) lapse excluded, pre-existing tools and third-party or open-source parts licensed. Is a PDF accepted by click "in writing signed by the assignor", or must TecHaust sign (IT Act s.5)?
    - (b) chain of title: are the team employees, or contractors who must assign to TecHaust? (a business fact)
    - (c) whether the terms should carry governing law and courts, a liability cap, termination and confidentiality.
- **RB-39: the payment-terms settings** (Net 7, validity 15 days, small-job threshold, part-payment floor ₹10,000, reminders).
  - **Settled:** these are commercial settings; no law sets them for B2B IT services. The floor is Razorpay's merchant-set `first_min_partial_amount`, not an RBI figure. If TecHaust is a micro or small enterprise with a Udyam registration, MSMED s.15 makes the buyer pay within the agreed time and never later than 45 days, and s.16 adds compound interest at 3 × the bank rate.
  - **OPEN (CA):** (a) Udyam registration, and whether invoices should state the MSMED rights.
  - **Watch:** (b) the MSMED (Amendment) Act 2026: commencement reports conflict.
- **Amend RB-28:** the lead's consent receipt (notice version, purposes, time, IP hash, marketing flag, withdrawal) is the proof s.6(10) asks for.
- **§7 addition, M4.3 items 1–12:**
  - 1: RA-09, RA-28
  - 2: RA-12, RA-28, RA-35
  - 3: RA-17
  - 4: RB-19, RB-20, RB-21
  - 5: RB-35
  - 6: RB-35, RB-37
  - 7: RB-37
  - 8: RB-38
  - 9: RA-16, RA-27
  - 10: RA-21
  - 11: RA-24
  - 12: RB-37
- **Register line 9:** the tag format should read `OPEN (08-C <ID>)`, as CLAUDE.md and the guard use.

### C. Wrong defaults found
1. **Export place of supply (RA-35):**
   - The wrong label is in `packages/core/src/pdf-jobs.ts:136-139` and prints on proposal and estimate PDFs (`layout/document.ts:72`), the invoice skeleton (`layout/invoice-skeleton.ts:94`) and the portal view (`document-paper.tsx:109`). The test (`pdf-jobs.test.ts:137-139`) and 07-P line 17 carry the same wording.
   - **Lead decision:** print "Outside India (96)", as invoices already do. This is a code number corrected, not new wording. Stored PDFs are write-once and stay as they are.
2. **The Ownership clause (RB-38):** wrong under s.19. It needs a lawyer's redraft, and interim wording for the owner to approve (owner question).
3. **The GST line (RB-38):** needs owner-approved copy, e.g. "GST at 18 % is added unless the work is an export of services under our Letter of Undertaking."
4. **Due days in the terms text vs the setting:** make it a token from settings, or a check that refuses a mismatch.
5. **Processors missing from the export (RB-36, from 13 May 2027):** list them, or link to the privacy page's list.

### D. For the CA and the lawyer (§5)
- **CA:** RB-37(b), RB-39(a).
- **Lawyer:** RB-35(a, b), RB-36(a, b), RB-37(a), RB-38(a, b, c).
- **Lead (technical):** the RA-34 GSTIN check tested with real GSTINs before Phase 7.
- **Watch:** RB-39(b).
- **Related:** `packages/core/src/gst/layouts.ts:25` marks the place-of-supply labels "UNVERIFIED"; that falls under RA-23's test import.

### E. Sources read on 2026-10-29
- **Official:** einvoice1.gst.gov.in Master Codes (read in full); Circular 168/24/2021-GST and Notification 10/2020-CT (search summaries; the PDF text could not be extracted).
- **Bare-act copies:** Copyright Act ss.17 and 19 (advocatekhoj); Contract Act s.6 (advocatekhoj, casemine); DPDP s.17 (dpdpa.com mirror).
- **MSMED:** West Bengal government and ICAI summaries; secondary sources on the Amendment Act 2026.
- **Razorpay:** Payment Links API.
- **GSTIN algorithm:** python-stdnum (secondary).
- **Blocked (HTTP 403):** MeitY, indiacode and the e-way bill docs. The DPDP citations rest on 08-B's reading of 2026-10-06.
- **Not verified:** Contract Act s.5, IT Act s.5, GDPR Art. 15(3), the official MSMED text.

## Plan (lead)
After FX-3 and FX-4 merge:
1. A builder (Opus high) adds the 08-C rows and the amendment, fixes line 9 and the §5 list, retags all 25 tags, and empties `NO_ROW_YET`.
2. It fixes C1 (place of supply) and C4 (due days).
3. C2 and C3 wait for the owner's interim wording. C5 is an M7 follow-up, due before 13 May 2027.
4. Then a review and a PR.

## Owner's answers (2026-10-29 ~14:05 IST)
- **Udyam:** yes, a micro enterprise. MSMED ss.15–16 apply to TecHaust's Indian buyers. Printing the Udyam number and the MSMED rights on invoices stays on the CA list (RB-39(a), now a narrower question).
- **Ownership:** the interim wording above (docs/13) goes into a new terms version.
- **GST line:** "GST at 18 % is added unless the work is an export of services under our Letter of Undertaking."
- **Who builds:** only the owner so far, so RB-38(b) is closed for now. Future contractors must assign in writing.

The code step adds both terms changes as a new seeded terms version, plus a migration if the seed's terms rows need it (insert-only; never edit an applied one). 07 records the two lines as owner-approved.

## Added to this task: owner-approved packages (2026-10-29 ~15:20 IST)
- **`sharp` 0.35.5** as a devDependency of `apps/web`. It's already in the lockfile, so only the importer changes, and nothing is downloaded. Then prove that a sample founder photo builds through `<Picture>` (AVIF and WebP), and remove the sample.
- **Noto Sans Bengali and Noto Sans Devanagari** (OFL) for the PDFs (full audit A4 3):
  - add the `@fontsource` packages, exact pins, respecting `minimumReleaseAge`;
  - subset them as fallbacks in `packages/pdf` (`src/generated/assets.ts`, the way the Latin fonts are built);
  - add a layout-gate test that renders a certificate with a Bengali and a Devanagari name;
  - check the jobs bundle budget (1,000,000 bytes) and the PDF size;
  - **the owner approved this install.**

## Added to this task: the approved wording (owner, 2026-10-29: "Approve all")
07-X (lines 1–32) and 07-Y (items 1–31) are approved. After FX-3 and FX-4 merge:
- **Turn every approval switch on**, so no `[Placeholder]` mark is left anywhere:
  - `APPROVED_07X` in `apps/admin/src/lib/copy-x.ts` and `apps/portal/src/copy-documents.ts`;
  - `APPROVED_07Y` in the admin and portal `copy-y.ts`;
  - `APPROVED_07Y_PUBLISH` in `apps/admin/src/lib/publish-text.ts`;
  - plus any other switch a grep finds.

  `check-prod-readiness` must then find no `[Placeholder` outside the issue guard.
- **Apply the lines that change existing text:**
  - 07-Y 1 and 2: the terms, as a new seeded terms version;
  - 3: hide the /work lede while there is no case study;
  - 4: the dashboard foot line;
  - 13: "estimate" wording, three places;
  - 14: the proposal-sent email;
  - 24: the numbering clash message;
  - 26: the bell says "on 3 days".
- **Copy the approved lines into docs/07** where the convention asks for it, and update the tests that pin the old words.

## Added to this task (lead, 2026-10-29)
- **Widen the VERIFY scan** (`packages/core/test/verify-tags.test.ts`) to the remaining tracked text types: `.html`, `.py` and `.example` files (`index.html`, `packages/ui/scripts/measure-cmyk.py`, `.dev.vars.example`). Snapshots (`.snap`, email and CSV fixtures) stay out: they are generated. None holds a tag today. This was the FX-3 fix round 2 builder's question.

## Added to this task: void after a portal view (owner, 2026-10-30)
Full audit A0 3 (08-C RA-10), owner's answer "View blocks void": an invoice-family document whose client has opened it in the portal (`viewed_at` set) can't be voided; corrections go through a credit note.
- Add the condition everywhere the void rule lives: core (`packages/core/src/invoices.ts` void rule, about line 491: a new reason such as `viewed_by_client`), the admin void route (`apps/admin/worker/invoices.ts` about 1168–1176) and the SQL guard of the void statement, so a view landing between the check and the write still refuses (one batch, condition in SQL). Look for a trigger that already pairs voids (`invoice_triggers`, 0038); if a trigger is the right place, add a new one in a new migration (never edit an applied one).
- The admin screen shows the refusal in plain words; new copy goes in 07-W style as `[Placeholder]` unless an approved line fits, and the report lists it.
- Update 08-C RA-10 from OPEN to settled: "Owner decision 2026-10-30 (docs/13)".
- Tests: core (property and unit), route (viewed → 409 with the reason; not viewed → still voidable), and the race (view between check and write).
- Tier A for this item: stop after it and the core/route layers, commit, and say so in the report; the lead asks for the analyst's early check.

## Builder report (FX-5)
Builder claude-opus-5-5/high, 2026-10-30 ~01:55–03:45 IST, branch `fix/fx5-r1` from `origin/fix/fx5-research-tags` (06663bf0), pushed.

**Skills loaded:** `cloudflare:workers-best-practices` (route and SQL guard patterns: the void condition in the statement, no module state; nothing to change beyond that), `cloudflare:wrangler` (no config change; used for the jobs dry-run build and its budget), `cloudflare:cloudflare` (Browser Run: the PDF fonts must be inlined data URIs, so the fallbacks join the inlined set). Not loaded: `frontend-design` (no screen designed; two one-line copy hooks only, see below), `workers-profiling` (no CPU work changed; the jobs startup reading is from the budget script).

### Per item (change, commit)
1. **Void after a portal view (Tier A; early-check commit `4e428165`).** Core `voidBlockers` takes a required `viewed` fact and returns `viewed_by_client` (every voidable type, proforma included: a view is a delivery like an email); the void statement adds `viewed_at IS NULL`, so a view landing between the read and the write refuses it (the refused path re-reads `viewed_at` and answers `viewed_by_client`); the 409's code is `viewed_by_client` (after `already_void` and `return_period_closed`); the invoice view's `void.blockers` carries it; a new trigger `documents_viewed_no_void` (migration 0053, a new trigger only, set `void_view_triggers`) refuses any write that voids a viewed proforma, tax or export invoice. Admin lines (07-Z §1, `[Placeholder]` until approved): `voidBlockedText` and `INV_ERRORS.viewed_by_client`. 08-C RA-10: our rule is settled by the owner's decision; see open question 1. Tests: core unit + fast-check property (a view always adds exactly its own code), admin route (viewed → 409 with the reason and nothing written; not viewed → voidable; the race through `beforeBatchHolding`; the trigger), db (`void-view.test.ts`: installed SQL equals the generated one, viewed refused, unviewed voided). Decision row added to docs/13 (Lead (builder)).
2. **08-C rows and tags (`b4ea8946`).** RA-34, RA-35, RB-35 to RB-39 added in the register's format, RB-28 amended, the tag line fixed to `Researched <date>, <source> (08-C <ID>)` · `OPEN (08-C <ID>): <question>`, §3 rows 13–16, the §5 lists (CA, lawyer, lead, watch), §7 M4.3 items 1–12 and the sources read. All 25 tags retagged as the analyst's table (with RA-34/RA-35 numbering); the gstin.ts header was reworded so it claims only what the code holds (97 in the list, 96 as the export code, 25 and 28 legacy). `NO_ROW_YET` is empty and the test now also requires it empty; the scan covers `.html`, `.py` and `.example` files and skips `__snapshots__`.
3. **C1, export place of supply (`b4ea8946`).** `placeOfSupplyLabel` prints "Outside India (96)"; tests in core and pdf updated; 07-P line 17 and docs/06 §7.x updated.
4. **C4, due days (`b4ea8946`).** Core `termsDueDays` / `termsDueDaysMismatch`. Settings › Terms (proposal terms only) refuses a text whose "due within N days" differs from Settings › Payment terms: 400 `terms_due_days_mismatch` with `details {stated, dueDays}` and `fields[0].path = "body"`. The payment-terms save is never refused (no deadlock: change the setting first, then the terms); its GET meta carries `termsDueDays {stated, matches}` for the screen. Lines 07-Z §2 (`TERMS_DUE_DAYS_COPY`, pending). See open question 3 (per-client due days).
5. **Terms version 2 (07-Y 1 and 2, `b4ea8946`).** `PROPOSAL_TERMS_V2` (+ SHA-256) in the seed: inserted as the NEXT proposal version, once (no row with its hash yet), and only while the payment-terms due days equal the 7 the text states. No migration needed. Recorded in 07-O §2b. Seed version 3.
6. **Approval switches (`53302515`).** `APPROVED_07X` (admin, portal), `APPROVED_07Y` (admin, portal), `APPROVED_07Y_PUBLISH` on; comments updated; tests that pinned the marks updated. A grep found no other 07-X/07-Y switch. The only `[Placeholder` left in code: the issue guard (as before) and the new 07-Z lines.
7. **07-Y lines that change text (`53302515`, `b6ef3a98`).** 3: /work hides the lede while no case study is published (07 §5.4 note). 4: `DASH_COPY.footLine`, one sentence, used by the finance foot line (07-V note). 13: the portal's binding sentence takes the kind ("Accepting an estimate … that estimate"), and the client's accepted email says "estimate" (jobs now passes `kind`; an older queued message with no kind reads "proposal"). 14: the proposal-sent email and the admin preview use the new line; the estimate's line is unchanged. 24: already in core from FX-3 (checked word for word). 26: the bell says "on 3 days". docs/07 §8 rows updated. 07-Y item 21's unused live-client supplier-copy line: already gone from code (FX-4 review L2); marked dropped in 07-Y.
8. **Packages (`f2ed844a`).** `sharp` 0.35.5 as an apps/web devDependency (lockfile importer only). `@fontsource/noto-sans-bengali` 5.3.0 and `@fontsource/noto-sans-devanagari` 5.3.0 (published 2026-07-19, well past the 1-day `minimumReleaseAge`) as packages/ui devDependencies, where the other @fontsource packages and the subsetter live. Nothing else installed.
9. **sharp proof (no commit, by design).** A synthetic grey 960 × 1200 JPEG (no person, no client data) as `founderPhoto`, then a web build: About printed `<picture>` with AVIF and WebP sources at 352, 704 and 960 w plus the JPEG fallback. The sample and the config change were removed and the site rebuilt clean (no `fx5-sample` file in `dist`).
10. **PDF fonts (`b47337cc`).** packages/ui subsets each script's block plus U+200C–200D and U+25CC (38.6 and 39.4 KB woff2) into `fonts/*-pdf.woff2`, never into `fonts.css`; licences added to `fonts/LICENSES.md`. packages/pdf inlines them under the "Archivo" family with their `unicode-range` and Archivo's descriptors, so no font stack changes (one weight: a 600 heading in those scripts prints at 400). Layout gate `packages/pdf/visual/certificate-scripts.spec.ts`: a certificate with a Bengali and a Devanagari name loads only data: URLs, draws the name with embedded faces only (CDP `getPlatformFontsForNode`), and the PDF embeds the Noto subset. The documents' font check now expects 4 faces, the 2 Archivo ones loaded. **Jobs bundle 977,290 of 1,000,000 bytes** (startup 75.2 ms); certificate PDF with a Bengali name 118,157 bytes, Devanagari 117,899 bytes (Chromium embeds only the glyphs used).
11. **Docs (`dce8029c`).** 07-O §2b (terms v2), 07-Z (new page, pending: §1 void lines, §2 due-days lines).

### Commands and results
- `pnpm install --frozen-lockfile --offline`: ok. Installs above: ok.
- Package runs during the work (all through `tools/heavy.sh`): core invoices 207 pass; db 482 then seed 19 pass; admin void/send/lib 66, settings and copy 112, SPA lib 470 pass; portal doc-token 27 pass; email 130 pass; pdf assets 17 pass; ui fonts 14 pass; pdf visual: certificate gate 4 pass, documents font checks 54 pass.
- Typecheck admin, core, db: ok (one fix: an `exactOptionalPropertyTypes` arbitrary in the property test).
- `pnpm check`: first run failed on the formatting of the drizzle-written `0053_snapshot.json` and `_journal.json` (formatted, `5f3482e8`); second run ok (migration guard: 54 migrations, none rebuilds a referenced table).
- Web build: ok (with the sample, then clean).
- Jobs build (`wrangler deploy --dry-run` + budget): ok, numbers above.
- `pnpm test`: auth 135, ui 471 (+2 skipped), core 1824, email 130, db 484, pdf 349, web 535 pass; portal had 1 failure, `routes.test.ts` "every /api response is no-store" **timed out at 5000 ms** under the full run's load, then portal alone: 635 pass. The run stopped there, so admin and jobs were run alone: admin 3429 pass, jobs 531 pass.
- `pnpm lint` (whole repository, last check): ok (10 warnings and 8 infos, all in files this task didn't touch).

### Not verified
- Browser Run itself with the Noto fonts (the gate uses local Chromium; Browser Run is another build). The staging sample PDF should be looked at by eye.
- The PDF visual screenshots: only the font checks and the new certificate gate were run, not the whole suite (Linux baselines come from CI).
- The admin and portal screens were not opened: the two lines that need a screen hook (Settings › Terms showing `TERMS_DUE_DAYS_COPY.refused` from the 400's details, Settings › Payment terms showing `.warning` from `meta.termsDueDays`) are **not wired**; the terms screen currently shows the API's own field message. That is designer work.
- No hosted service touched; the seed's terms v2 reaches staging on the next deploy's seed run.

### New copy still `[Placeholder]` (07-Z, pending the owner)
1. "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead."
2. "The client has opened this proforma in the portal, so it can't be voided."
3. "These terms say invoices are due within {days}, but Settings › Payment terms says {days}. Change the number here, or change Payment terms first."
4. "Your proposal terms say invoices are due within {days}. Save a new version in Settings › Terms so they match."

### Open questions
1. **RA-10:** the brief says "from OPEN to settled". The owner's decision settles our rule (view blocks void), but the row's underlying question (may a never-delivered invoice be shown as cancelled in Table 13 with no credit note) is a source question for the CA that the decision doesn't answer. I marked the rule settled and kept that question visible ("Still for the CA") and RA-10 on the §5 CA list; the code's existing `OPEN (08-C RA-10)` tags stay. Lead to confirm.
2. **07-Y item 13, "a repeat of the accept notice":** I changed the portal's confirm-dialog binding sentence and the accepted email. The same binding sentence is on the website terms page (07-A §7, `legal-pages.ts`), where it is generic ("Accepting a proposal in the portal …"); changing a legal page needs a version bump, so I left it. If the lead reads the third place differently, say which.
3. **C4 and per-client due days:** a client with its own `payment_terms_days` still gets the shared terms' "7 days". Only a token rendered into each frozen document fixes that (it touches the seal); not done.
4. **Website copy outside this task:** /how-we-work still prints the old Ownership line and the pricing FAQ says "GST at 18 % is added for Indian clients" (07 §5.5, §5.3). 07-Y covered only the proposal terms; owner's copy if they should follow.
5. **Jobs bundle headroom:** 22,710 bytes left of 1,000,000. The next jobs feature likely needs the planned split or a smaller font set.
6. **Found, not fixed:** the certificate's `.mono` fingerprints ask for IBM Plex Mono, which the PDF fonts don't embed, so they print in the machine's monospace font (Cascadia Mono locally). Recorded in the new gate's comment; a follow-up for the lead.
7. Terms v2 is added as the next version whatever the owner saved before (only if the due days are 7); if the owner saved their own text on staging, v2 now follows it.

## Early check, void after a portal view (analyst, Opus 5.5 high, 2026-10-30, on 4e428165): CHANGE (copied by the lead)
Core, the void statement (`viewed_at IS NULL` in the guarded `mutate` statement; refusal writes nothing; 409 `viewed_by_client`) and trigger 0053 (new trigger only, registered in `TRIGGER_SETS`, snapshot and journal correct, no other branch has a 0053) are **GO**. Other writers of `viewed_at`: only the portal invoice GET, `doc-token` and the offers SQL (proposal/estimate only); no bot prefetch can set it; staff only by signing in to the portal as a contact. Credit notes ignore `viewed_at`; registers and statements never read it.

1. **high** `apps/portal/worker/invoices.ts:69-75`, `index.ts:73-99`: the signed-in view is written after the response, in `waitUntil`, in one batch with the session touch and access row, failures only logged. (A) A void landing between the 200 and the background write passes, then `viewed_at` lands on a void document. (B) If that batch fails, the view is never recorded. Fix: the guarded `UPDATE documents SET viewed_at = ?3 WHERE client_id = ?1 AND id = ?2 AND viewed_at IS NULL AND frozen_at IS NOT NULL AND voided_at IS NULL AND status IN (…) AND type IN (…)` as the first statement of the read batch (before `ONE_SQL`, `LINES_SQL`); drop the `c.set("after", …)` for it. Access row and session touch stay in the background.
2. **medium** `invoices.ts:78-92` (`GET /:id/pdf`): records no view. Fix: the same guarded UPDATE batched before its `ONE_SQL` read. The emailed-link PDF (`doc-token.ts` `/document/pdf`) optional, for parity.
3. **low** `doc-token.ts:98-113`: the emailed-link view UPDATE has no `voided_at IS NULL` (unreachable today: an emailed document can't be voided). Fix: add it.
4. **low, tests:** portal (a) `viewed_at` set when the 200 resolves, and a direct void UPDATE then fails with `documents_viewed_no_void`; (b) voided first → GET 404, `viewed_at` stays NULL; (c) the view lands even when the access-row write fails; (d) `GET /:id/pdf` sets `viewed_at`. db `void-view.test.ts`: a viewed proforma refused. Admin: viewed proforma 409 with the proforma line; viewed plus a closed month: `return_period_closed` with both codes in `reasons`.
5. **low, wording:** RA-10 and the decision row say a credit note corrects it; a proforma has none. Keep the rule (matches "emailed proforma can't be voided"); reword RA-10: "a credit note corrects an invoice; a delivered proforma stays until converted". Start the RA-10 cell with both states: "Our rule: settled by owner decision 2026-10-30 · Source question: OPEN (CA)". The builder's reading of RA-10 (the Table 13 question stays OPEN for the CA) is right.

**Not verified:** no tests run by the analyst (read-only); D1 batch atomicity from the docs and the project's existing race design; whether the portal test runtime waits for `waitUntil`.

## Lead's triage after the early check (2026-10-30)
All five are fixed in this task (fix round 1, builder): 1, 2 (signed-in PDF and the emailed-link PDF for parity), 3, 4, 5. Docs/13: a lead row clarifying that a viewed proforma stays until converted (the owner's row stays as it is). "Withdraw a delivered proforma" goes to the owner as a question in the morning.

## Fix round 1 brief (lead, 2026-10-30)
Builder, Opus 5.5 high, Tier A. Branch `fix/fx5-r2` from `origin/fix/fx5-research-tags` (this commit or later); push only that branch.
- Do the early check's 1–5 as written above, each with the tests in 4. For 1, prove the order in a test: when `exports.default.fetch` resolves, `viewed_at` is already set (don't rely on `waitUntil`).
- The portal's CPU and rows stay as before apart from one primary-key UPDATE per GET (0 rows after the first view).
- Docs: RA-10 in 08-C as in 5; one docs/13 row at the end, who: Lead: "A proforma the client has viewed can't be voided either (as for an emailed one); it stays until converted, since a proforma has no credit note. Applies the owner's 2026-10-30 void decision | Lead | 08-C RA-10, `@techaust/core/invoices`".
- Then the designer step follows (not yours): leave the two Settings screen lines from your report alone.
- Checks: touched packages' tests (portal, admin void tests, db, core) through the queue, `bash tools/heavy.sh --log fx5r2-check pnpm check`, whole-repository `pnpm lint` last. Append "## Builder report, fix round 1".
