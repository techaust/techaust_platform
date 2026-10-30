# Run: settling the research register's OPEN items (no CA or lawyer)

Owner, 2026-10-30 (docs/13 "No CA or lawyer"): the lead settles every OPEN item in 08-C §5 on the safest reading of the official sources, records what it costs, and gives click-by-click steps for duties only the owner can do. The lead is not a licensed professional and says so where a choice carries risk.

## Analyst's draft (Opus 5.5 high, read-only, 2026-10-30), condensed by the lead
Source marks: **[read]** official text read 2026-10-30 (RBI FEMA 23(R)/2026-RB and its 22 Sep 2026 amendment; the 2015 amendment of 5 Jun 2026; IP India fees); **[08-C]** the register's earlier reading; **[secondary]** only third-party pages reachable; **[unverified]** general knowledge. Unreachable today: CBIC repository (TLS), indiacode and MeitY (403), incometaxindia (403), the CERT-In FAQ and GST Council PDFs. Items resting on [secondary] or [unverified] keep that mark in 08-C until an official text is read.

| Item | Safest reading | App | Residual risk / opinion |
|---|---|---|---|
| RA-03 FY of the supply | earliest FY of invoice, advance, completion [08-C s.34(2)] | built (`core/notes.ts:322-339`) | may refuse a note the law allows |
| RA-04 IMS rejection | the note stays and the balance stays reduced; no GST reduction until the registered buyer accepts; a debit note if the credit wasn't due [08-C; IMS mechanics secondary] | **T3** | until T3, copy 3B from the portal, never the helper |
| RA-07 electronic original | keep the recipient original and the stored supplier duplicate [08-C] | built (0048) | none |
| RA-10 void shown as cancelled | keep the owner's 2026-10-30 rule (same month, not emailed, not opened, no payment or note) [Table 13 secondary; Rule 56(8)] | built | an officer may ask for a credit note instead |
| RA-16 care-plan SAC | 998313 by default; 998316 only for plans that are mainly hosting or infrastructure [08-A; secondary] | built | HSN summary only |
| RA-17 advance tax invoice as receipt voucher | yes, with every Rule 50 particular including the signature (s.31(3)(d) "or any other document") [08-C; proviso unverified] | **T4** | low after T4 |
| RA-19 Q37 | the owner's 2026-10-28 rule | built | settled |
| RA-19 Q39 debit note on an LUT export in the next FY | needs that FY's LUT or IGST (Rule 96A) [08-C] | **T2** | stricter, harmless |
| RA-20 IGST export never realised | LUT route; never claim a refund before realisation; repay with interest if one was paid [secondary, unverified] | none | none while no refund is claimed |
| RA-21 FX rate | that day's rate, or the dated "no rate that day" statement | built | settled |
| RA-23 Offline Tool import | a test import before the first GSTR-1 (owner duty 4) | none | none |
| RA-25 legal hold | nothing deletes an issued document under a hold; goes into the M7 retention brief [08-C s.36] | none now | none until M7 |
| RA-26 RCM on imported services | RCM IGST on every foreign business service billed without an Indian GSTIN; self-invoice within 30 days; GSTR-3B 3.1(d) in cash, ITC in 4(A)(2) [unverified, secondary] | none (owner: spreadsheet) | interest and penalty if missed |
| RA-29 GST on gateway MDR | taxable; give the gateway our GSTIN; ITC only when it shows in GSTR-2B [unverified] | at M6 onboarding | none |
| RA-30 TDS | the client picks section and rate; record the certificate's amount; invoice and GST at full value; reconcile with 26AS/AIS [secondary] | **T8** inside M6.1 | chasing certificates |
| RA-31 previous-FY credit notes | declared in a return filed by 30 Nov, so **issued by 31 Oct** (monthly; QRMP: 31 Oct through IFF for registered buyers, **30 Sep** for unregistered) [08-C s.34(2)] | **T1** | stricter than GSTN practice |
| RA-32 tax-only debit note | enter it by hand in the portal's Table 9B; check 3B Table 3 before filing | blocking warning built | whether the portal accepts a nil-value row is unverified |
| RA-33 round-off on a tax-only debit note | never round | built (0052) | settled; the trigger is permanent |
| RB-01 settlement in INR | 9 months unless the invoice is in INR [read] | built | none |
| RB-02 pre-launch export invoices | 9 months from the invoice date; ask the bank for an extension if passed [read] | retag only | none |
| RB-03 bank channel | "software" (Reg. 2(1)(e)); a monthly EDF with the AD bank; never Reg. 3(2)(b) [read] | built | none |
| RB-05 proof of realisation | keep the bank advice or e-FIRA; for PA-CB the settlement report mapped to the invoice; ask the bank [read] | M6.1 | none |
| RB-06 purpose code | **stays OPEN (a bank fact)** | Settings | statistics only |
| RB-37(b) keeping offers | accepted offers kept as long as the tax records [08-C s.36] | built | none |
| RB-39(a) Udyam number on invoices | not required; the owner chose to print it | **T10** | none |
| RB-12 ground for IP and browser data | DPDP s.7(a) with the Rule 6 log duty; 13 months; GDPR Art. 6(1)(f) [08-B; unverified today] | retag | MeitY guidance may change |
| RB-14 CERT-In | a proprietorship is covered (IT Act s.43A); keep a log copy in India [08-B] | **T5** (owner yes) and the PoC | requests to static pages leave no log |
| RB-18 SPDI consent | emailed consent before enrolling anyone but the owner [08-B] | none (practice) | ends 13 May 2027 |
| RB-21 West Bengal stamp duty | no stamping at acceptance; pay the deficit and penalty before going to court; **the rate stays OPEN** | none | a lawyer only before suing on a large contract |
| RB-22 e-commerce rules | comply as an inventory e-commerce entity (already done); **(b) the G.S.R. 789(E) text stays OPEN**, read before 1 Jan 2027 | owner inputs pending | none |
| RB-23 courts and the cap against consumers | Balurghat with a consumer carve-out; "Nothing in these terms limits … your rights under the Consumer Protection Act, 2019" [unverified today] | **T6** (legal pages v0.4) | the carve-out makes it harmless |
| RB-27 GDPR representative | before the first EU or UK client (owner's choice) | retag | none |
| RB-28 follow-up emails | replies and at most two follow-ups in 30 days on that enquiry; stop at any "no" | practice | none |
| RB-34 trademark | search classes 9, 35 and 42; file at least class 42 (₹4,500 per class) [read: fees] | owner | none |
| RB-35(a) whose midnight | IST, printed "(IST)" | **T6** | none |
| RB-35(b) version 2 revokes version 1 | say so in version 2; prescribe acceptance by the button; answer any email acceptance at once [unverified] | **T6** (the portal already refuses version 1) | none |
| RB-36(a, b) files in the data export | list the files; contents on request; GDPR Art. 15(3) full copy with others' data redacted (manual) | none | none |
| RB-37(a) never-accepted offers and erasure | erase the person's data in the frozen copy; keep number, status, dates and hash | **T7** before 13 May 2027 | none after T7 |
| RB-38(a) signing the assignment | a one-page deed on full payment, signed with Aadhaar eSign (owner's choice) [Copyright Act s.19(1); IT Act s.5 unverified] | **T11** | **a one-off lawyer review of the deed is wise** |
| RB-38(c) extra proposal clauses | the owner chose all four (law and courts with arbitration for overseas clients, cap at the fees paid excluding fraud, 15 days' termination, mutual confidentiality) | a new terms version (copy for approval) | none |
| RA-34 GSTIN check | a local scratch test with the owner's own GSTIN and two vendors'; never committed | a test before Phase 7 | none |

Also found in code, outside §5: which day's FX rate a USD debit note uses (`apps/admin/src/lib/notes.ts:97`; leaning: the note's own date, no source read), the IGST-route endorsement wording (`packages/core/src/export-invoice.ts:17`), the LUT ARN format (`export-invoice.ts:175`, `schemas/settings.ts:131`).

## Owner's answers (2026-10-30)
- FY 2025-26 credit notes needed: **none**.
- GSTR-1 frequency: **not sure**; the lead sent the steps to check. T1's dates wait for the answer. **Answered 2026-10-31: quarterly (QRMP).**
- Udyam number on tax invoices: **print it**, as "Udyam Registration No. … (Micro enterprise)". The number goes in Settings, never in code.
- Reverse charge on foreign services: **a monthly spreadsheet with the lead's steps**; no app feature now.
- EU and UK representatives: **before the first EU or UK client** (the lead reminds).
- Copyright assignment: **a deed on full payment, signed with Aadhaar eSign**.
- Extra proposal terms: **all four clauses**; wording to the owner for approval.
- CERT-In logs: **a daily copy to AWS S3 in Mumbai**. The owner creates the bucket and access key with the lead's script, then the job is built.
- Staff consent before 13 May 2027: emailed consent before enrolling anyone but the owner (the lead's default; no code).

## Tasks this creates (after the final sweep merges)
- **T1** the credit-note block and warning one month earlier (Tier A; dates by filing frequency).
- **T2** the LUT of the FY of an LUT export's debit note (Tier A; a new trigger only).
- **T3** the 3B helper nets a registered buyer's credit note only once IMS-accepted (Tier A).
- **T4** the signature always on credit and debit notes and on the tax invoice for a payment received; an issue blocker without a saved signature (Tier A).
- **T5** the CERT-In log copy to S3 Mumbai (Tier B; the owner's AWS setup first).
- **T6** offer and terms copy ("(IST)", "replaces version N", acceptance only by the button, consumer carve-outs), the four new proposal clauses, legal pages v0.4 (Tier B/C; copy for owner approval).
- **T7** erase never-accepted offers' frozen personal data on request (Tier A; before 13 May 2027).
- **T8** TDS by the certificate's amount (inside M6.1).
- **T10** the Udyam number on tax invoices (Tier A; sealed issuer block and PDF layout).
- **T11** a deed of assignment PDF on full payment, for eSign (Tier B; wording for a one-off lawyer review).
- **T12** retag every settled `OPEN (08-C X)` comment and rewrite 08-C §5 (Tier C; a builder for the code comments, the lead for the register).
- **Owner duties:** the LUT for FY 2026-27; the bank questions and the monthly EDF; the Offline Tool test import; the RCM monthly steps; the CERT-In point of contact (address and format to be confirmed from the Directions first); the trademark search; the April turnover check.

## Handover (lead, 2026-10-31)
Recorded in #119. Waiting on the owner: the GSTR-1 frequency (for T1's dates); the AWS bucket and key for T5 (script to come). Next: the tasks T1–T12 after the final sweep, Tier A ones with an analyst brief and early check; T12 rewrites 08-C §5 with the new tag.
Usage: analyst claude-opus-5-5/high (agent-a605f8e9…, workers-best-practices).
