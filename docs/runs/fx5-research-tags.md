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
