# Run: documentation quality pass (2026-10-07)

Status: merged (the `docs/quality-pass` PR, 2026-10-07)

## Brief
**Owner's request:** score all 45 documentation files out of 10 on six aspects (accuracy, completeness, consistency, clarity, structure, upkeep) and bring every one to 10/10.

**Restructure:**
- `docs/STATUS.md` → `docs/12-status.md`
- `docs/DECISIONS.md` → `docs/13-decisions.md`
- update every reference to them

**Rules for fixing:**
- **No owner decision needed:** wording, links, staleness, signposting, and corrections that bring a document in line with a decision already recorded (04 §0, DECISIONS, ADRs) or with the code.
- **Owner decision needed:** anything that changes meaning (marked **MEANING**). These are asked as multiple-choice questions and applied only after the owner answers.
- **Research appendices are dated records.** Add "Superseded" notes and source fixes; don't rewrite their research.
- **Approved docs** (01–03) get an `APPROVED 2026-10-06` header and a ticked approval box.

The review was done by six read-only Opus (high effort) reviewers, one per group of documents.

## Findings: group 4 (01 audit + appendices A, B, C). Scores before: 7.0, 7.5, 7.0, 7.0
1. `01:111`: **MEANING (owner)** The summary claims the git history was scanned, but App A:111 says it wasn't. Fix: "none found in the source tree or build output; git history not scanned (App A F-S12, Q4)".
2. `01:5`, `:201`: show it as APPROVED 2026-10-06 and tick §8.
3. `01:150-152`: add a Superseded note to the Keep list:
   - logo and colours → ADR 0013, 06 §1
   - ROI calculator deferred → 04 §11
4. `01` §7 open questions: add a "Resolved in" box. Answered:
   - Q-H1: Worker (ADR 0011)
   - Q-B1: proprietorship + GSTIN (02 §1)
   - Q-B4: ADR 0013
   - Q-B7: 04 §0 Identity
   - Q-B8: 04 Q-B15
   - Q-B5, Q-B6, Q-B10: 02/04

   Still open: Q-H2–Q-H6.
5. App C:6, :125: "MRS (Chennai)" is wrong, because MRS = Marseille. Check the raw evidence. If it can't be checked, write "MRS (Marseille)" and caveat the TTFB claim (C:129, :146; 01:70).
6. `01:58`, B:269-284: add the DPDP timeline note: core duties start 13 May 2027; SPDI Rules apply until then (08 L-1/L-2). Tag VERIFY WITH CA/LEGAL.
7. C:218, A:320-321: tag the legal items VERIFY WITH CA/LEGAL, and add a "Not legal advice" line to C's header.
8. B:68-71, :407, :651: socials superseded by App C S1/§5 (X doesn't exist; LinkedIn, Facebook and Instagram unverified).
9. `01:23`, `:69`: CLS "0.21–0.32 (needs improvement to poor)".
10. `01:22`, `:39`, `:68`, A:48: Resend free tier → "if on the free tier (plan not confirmed, Q-H4)".
11. `01:67`: 38.5 → "the 38.5 URL was seen live; the server regex `^\d{1,6}$` rejects it".
12. C:9, A:5: raw artefacts → "kept in the session scratchpad, not committed".
13. A, B and C headers: "Phase 1 evidence (APPROVED 2026-10-06). Parent: [01-audit](../01-audit.md). Fixes apply to the old site; for how the rebuild maps them, see 04 §11."
14. A:43-70: **OWNER** The public repo holds working reproduction steps for weaknesses still live on `techaust-web`: the XFF bypass, a 3 MB body, CR/LF in the subject. At minimum, point to 08 U-6. Option: redact the exact payloads.
15. B:482: slate-500 at ≈4.2:1 "fails AA (below 4.5:1)", not "borderline".
16. B:27, :481: "≈3.6:1 on #0F111A; 3.8:1 on #07080C (App C A2)".
17. B:17 vs :95, :413: the ping time should be one range, 4–12 ms.
18. `01:76-106`: add an Evidence column to the M and L tables (M-1 → A F-S2, M-4 → C A2, L-3 → A F-Q5/F-Q6, …).
19. A:123-124: "(wall time; CPU not measured)".
20. A:121: "CLAUDE.md" → "the old site's CLAUDE.md".
21. C:74: the CAA advice → "Cloudflare adds its CA records automatically; check before adding any".
22. B:24, :247, :341, :605, :616: replace "pass to the security auditor" notes with cross-references (C S4/P1, A F-S2, A F-S8).
23. A:228 vs C:101, :116: the sitemap line reference should be "lines 17–20".
24. B:138, :392, C:110, :195: **OWNER** The founder's personal social handles (r4rupak1997) are in the public repo. Keep them, or change them to "founder's personal handles".
25. B:647: Q6 is answered: "DNS shows Zoho (App C H4)".

## Findings: group 5 (02 strategy + appendices A, B, C). Scores before: 6, 8, 7.5, 6.5
The seed matches 02 §4.1/§4.2 exactly, and all links resolve.
1. `02:388`: trust signals → "legal form on Contact and the legal pages; GSTIN on invoices only (04 §0 Identity)".
2. `02:432`: delete "with GSTIN as `taxID`" and add "(no taxID: WEB-G-10)".
3. `02:5`, `:10`, `:462`: APPROVED 2026-10-06; tick §11; line 10 → "Approved as the catalogue base (03 §0); editable in the admin".
4. `02:439-453`: add a "Resolved in" column:
   - Q-P1, Q-S1, Q-S2, Q-B11 → 03 §0
   - Q-S3, Q-B12 … Q-B17 → 04 §0
5. `02:195`, `:399`: payment schedule → "40/30/30 (Q-P3-6)".
6. `02:100`: the low benchmark → "₹15–45k basic n8n setups (App A §1.8 / App C §1b)".
7. `02:286`: **MEANING (owner)** The S16 promise "first month included at launch" appears nowhere else. Keep it (add to 07 §4.14 and the terms) or delete it.
8. `02:258`: **MEANING (owner)** S12 model usage: "at cost" (07) or "cost + 10–20 %" (02)?
9. `02:230`: S9 rollout "from ₹5L" → "(internal guide only; the site says 'quoted after the pilot', 07 §4.5)".
10. `02:292`, `:297`: S16 Scale → "4 business hours (critical), business hours only (Q-S3)"; delete the on-call 🟡.
11. `02:294`: **MEANING (owner, the discount figure)** Rollover → "Growth and Scale: one month" (07 §4.14). Annual discount: 10 % (07, pending) or 10–15 % (02)?
12. `02:320`, `:376`, `:122`: S3 → "(page hidden behind the `S3_DPDP_PAGE` flag until a legal partner exists, 04 Q-B12)".
13. `02:424`, `:361`: reviews → "ask the 1–3 AMC clients and past project clients"; §7: "today: 1–3 AMC clients (Q-B14)".
14. `02:89`, `:388`: "founder profile; team described by role".
15. `02:435`, `:451`: "LinkedIn company page and founder profile only (04 Q-B15)".
16. `02:185`, `:206`, `:228`, `:276`: the 🟡 confirms → ✅ with a citation:
    - S4 lead: the founder
    - S7: React Native/Expo + Flutter
    - S9/S14 Tally/GSP experience: yes (03 §0)
17. `02:10`: ₹88 = $1 → "USD prices are set separately; ₹88 = $1 is used only for the revenue sums in §7".
18. `02:50`, `:300`: add "(vendor estimate)".
19. `02:408`: add "998315: hosting (08 G-2)".
20. C:78, :122, :129, :96, :94: add a Superseded note under C's title:
    - old service names → D-4
    - taxID → WEB-G-10
    - handles → Q-B15
    - reviews → Q-B14
    - "2 founders" → one founder
21. A:179: DPDP Rules → "Gazette-dated 13 Nov 2025 (PIB announced 14 Nov); see 08-B".
22. B:160: change "13/14 May 2027" to "13 May 2027".
23. B:13: "$6.15T (+10.8%) [S1]".
24. B:77: re-attribute the Clutch row to S16 UX Continuum, and change 02:65 to "Clutch / UX Continuum".
25. A:77, B:156: WhatsApp service-message pricing → "re-verify against Meta's official rate card before quoting S11 (date now past)".
26. C:15-30: change 02:460 to "≈140 sources, most dated" (adding per-row sources is out of scope).
27. Seed `catalogue.ts`: **MEANING (owner)** The 100 % upfront threshold is "under ₹1 L / $2k", but S2 ($2,000), S8 ($3k) and S14 ($3k) are seeded as UPFRONT. Is the threshold INR-led?

## Findings: group 6 (03 plan + appendices A payments, B platform stack). Scores before: 7.8, 7.3, 6.8
All relative links resolve. External URLs not checked (no web access). None of these fixes changes an approved decision.
1. B:11-12, :209-212, :249-250: add an Outcome banner under line 5: "Research record. Decisions differ: Free plan with browser-side Argon2id (03 §3C.4, ADR 0001/0004), SPA + Hono (ADR 0003), SES (ADR 0007). 05 wins." This also covers B:102 (forms "write to D1": rejected, web → Queue only, ADR 0002).
2. 03:420, :474 and B:45, :256: backup retention "6+ years" → add "(superseded: ≥ 8 years from FY end, default 10; 08 §backups, 08-A #13; VERIFY WITH CA)".
3. 03:32: `TH/INV/26-27/0001` → add "(superseded: `TH/INV/2627/0001`, ≤ 16 chars; 04 §0)".
4. 03:9: the list of changes → "including (not limited to)", and add:
   - Patina brand and fonts (ADR 0013), against lines 44, 142, 154
   - the queue CPU rule and upgrade triggers (05 §1.2), against lines 437-445
   - Workers Logs retention (05), against line 424
   - staging behind Access (04 §0), against line 452
   - backup retention
5. 03:493-505: heading → "Open questions for Phase 4 (answered in [04 §0](../04-prd.md))". Add the same pointer under the roles legend (line 210). Payment schedule 30/40/30 → 40/30/30 at lines 255, 267, 502. The ❓ marks are resolved (tiered approvals, Q-P3-2).
6. 03:100-102: "drafted for lawyer review" → add "(drafted in-house, no lawyer: 04 §0 Q-B12; VERIFY WITH CA/LEGAL)".
7. B:13, :196, :205: tag the DPDP conclusions VERIFY WITH CA/LEGAL, and add "see 08-B §1 (SPDI Rules apply now)".
8. A:3: add an Outcome note: "the owner holds active Razorpay, Stripe and PayPal accounts; 03 §3B.5 and 05 §9 adopt them plus manual transfer; Xflow, Skydo, MoneySaver and Cashfree are later options through the provider interface (ADR 0008)".
9. A:348: Xflow → "confirm its PA-CB authorisation first (VERIFY WITH CA/LEGAL)".
10. B:246: Time Travel → "7-day (Free) / 30-day (Paid)".
11. B:24: add "queue consumers: 10 ms (assumed; 05-A #11)".
12. A:220: PayPal on $1,000 → "$44.30 + about $30 FX ≈ $74".
13. B:79, :264-271: mark the items resolved in 05-A #13 (Workers Logs pricing).
14. B:57: the Workflows billing date → "date not captured".
15. B:195: the consent-manager date → align to 08-B (13 Nov 2026).
16. B:35, :51, :74, :75: retag the blog and aggregator sources "[S, secondary]".
17. A:216 vs B:4: FX → note "rough per-appendix assumption (₹88 / ₹90; 05 uses 88.42)".
18. A:36, :74, :80, :150: vague citations → "source detail not captured" where no URL is known (don't invent URLs).
19. A:213 vs :282: Wise → "July 2025 (announced 3 Jul 2025)" in both places.
20. A (whole file): add "See 05-A for PayPal/Stripe webhook verification".
21. 03:421: the packages list → add "(final layout: 05 §3)".
22. 03:466: → "dependency audit (pnpm) in CI; Renovate".
23. 03:46 vs :489: use one cost figure (≈ ₹0–50/month).
24. 03:142, :158, :268, :464: make the backticked 06/08 names relative links.
25. 03:459: OWASP 2021 → note "2021 mapping retained (08)"; don't claim a 2025 edition unless verified.

## Findings: group 3 (08 security + appendices A GST, B DPDP; 07-A legal pages). Scores before: 6.8, 8.0, 7.7, 6.8
The code matches the docs for: the settings defaults G-1, G-5, G-8, G-10, G-11 date, G-12, G-14, G-18; the GSTIN state codes; the auth parameters (PR #7).
1. 08:181 vs B:272, 07-A:67: **MEANING (owner)** Monthly D1 exports are kept for 10 years and include leads, which conflicts with "enquiries deleted after 12 months". Option (a): the long-term copy holds financial tables only. Option (b): disclose backups in 07-A §5 and replay erasures after a restore.
2. 08:14-25: add a Status/Date column to §0 (U-items). The open U-1 (LUT), U-2 (FEMA EDF) and U-3 (UPI MDR from 15 Oct) go into 12-status "Waits on the owner".
3. 08:20: tag U-3 "(VERIFY WITH CA)".
4. 08:19: FEMA → "invoices raised from 1 Oct 2026: 9 months; older ones may have 15 months (Nov 2025 amendment); ask the CA (VERIFY WITH CA)".
5. 08:189: restore → "Time Travel restores in place only: note the current bookmark, restore to the timestamp, export the rows needed, then restore back to the saved bookmark. Production action, needs the owner's approval."
6. 08:101: break-glass reset-2fa → "runs with the owner's local `wrangler login` (OAuth)", not with the prod token.
7. 08:187, :170: → "M7.5 (runbooks), L7 (first drill)".
8. 08:103-125: §3 checklist → tick the frozen-document triggers and the append-only logs (M1.3, `packages/db/src/triggers.ts`) and the core coverage gate (M1.2). Split "permission per route": the matrix is done (core); route enforcement is pending.
9. 08:120: Biome → "a float-scan test (`packages/core/test/no-floats.test.ts`) and Biome's recommended rules (`noDangerouslySetInnerHtml`)".
10. 08:45-70: threat model → add a "Staging Workers" row: Access for admin@ only, a jobs webhook bypass in M6, the benchmark service token. §4 → add the secret names `CF_ACCESS_BENCH_CLIENT_ID` and `CF_ACCESS_BENCH_CLIENT_SECRET`.
11. 08:210: → "G-1, G-2, G-5, G-6, G-8 to G-12, G-14, G-15, G-18 are settings; the rest arrive with M4.2/M5.5".
12. 08:224: **MEANING (owner)** The G-11 block also needs "or the annual-return filing date, if earlier". This needs a code change later; record it as a follow-up.
13. 08:216: G-3 → add the `TH/EST` and `TH/PRP` series ("non-GST, same format rules").
14. 08:135: session-key rotation: reword when PR #7 merges (follow-up only, not now).
15. 08:22: U-5 → add `no-reply@` (sent through SES) and `grievance@`.
16. 07-A:5: change the "08 §7.2" label to "08 §7.3".
17. 07-A:189, :71: `_ga` cookie lifetime → "up to 2 years (GA4 default)". Leave the data-retention setting as is.
18. 07-A:34, :38: India legal basis → "provided voluntarily for that purpose (DPDP s.7(a))" plus legal obligation; "Contract" in the GDPR column only. VERIFY WITH CA/LEGAL.
19. 07-A:85-95: **MEANING (owner)** EU/UK section (08 L-8). The controller identity may need the proprietor's name.
20. 07-A:93, :155 vs :100: → "48 hours" everywhere.
21. 07-A:46-56: providers → add Meta (WhatsApp); "Stripe (if used)".
22. 07-A: add a §8 accessibility statement: WCAG 2.2 AA target, known gaps, contact (08 L-15).
23. 07-A:72 vs B:264: **MEANING (owner)** Newsletter proof of consent: 1 year or 3 years after unsubscribing?
24. B:87: add a dated correction: staff have password + TOTP, stored as HMAC and encrypted respectively. Ask the lawyer about SPDI Rule 5(1) (VERIFY WITH LEGAL).
25. B:263, :419, :602, :622: "Superseded by 08 §7.3 L-6 / L-16" notes.
26. A:440: round-off range → "−49 … +50 paise".
27. A:51, :648: the 57th GST Council (7/8 Oct 2026) re-check → a follow-up in 12-status.
28. A:19, :203: the "first character not 0" rule isn't enforced in `numbering.ts`. Record as a code follow-up; the doc keeps the rule.
29. 08:3-8: add "Last updated 2026-10-07" and a short change log.
30. A:13-39: renumber the TL;DR rows 1–N.
31. 08:41: → "2021 mapping; 2025 re-map in M7.5".

## Findings: group 2 (04 PRD, 06 design, 11 brand audit, 07 content). Scores before: 7.2, 8.0, 8.8, 7.3
Checked and fine:
- links and § references resolve
- 06 tokens, contrast ratios, CMYK and geometry match the code
- the prices in 02, the seed and 07 agree
- the 04 §9 matrix matches `permissions.ts` (except item 24)
- the enums match
1. 04:438: NFR-2 → "API p99 ≤ 7 ms (the Phase 6 gate, 05 §1.2)". Also point the upgrade trigger at [05 §1.2](../05-architecture.md), not 03 §3C.4.
2. 04:424: JOB-Q-01 → "batches of 1–5 (one unit of work per message; PDF consumer max_concurrency 1)".
3. 04:195: ADM-G-03 → "keyset pagination (25/50 rows)".
4. 04:146: S18 "limited slots" (banned) → "a small number of subscriptions at a time (no scarcity counter)".
5. 07:15: nine meta titles are over 60 characters (lines 176, 219, 228, 255, 281, 312, 364, 376, 382). Shorten each to ≤ 60 (count them), and fix the counts on lines 107–108 (title 56, description 145).
6. 07:12-13: "How to read" → define `{{price-plain:Sx}}` (the amount with no "from" and no "+ GST") and `{{price:Sx-<line>}}` (reads the catalogue default line, e.g. S16-growth, S11-monthly).
7. 04:296: **MEANING (owner)** ADM-CAT-05: add default-line names and prices to the public snapshot fields, so the S16 tiers and the S11 setup/monthly prices can reach the site.
8. 06:425: §7.4 item 6 → "Acceptance is recorded in a separate acceptance-certificate PDF (05 §8); the accepted proposal PDF is never changed."
9. 06:225-226: shadow-1/2 → copy the values from `packages/ui/tokens/tokens.json`, which use `rgb(20 35 31 / …)`, not the retired navy.
10. 11:75: true once item 9 is fixed. Add "(shadow values fixed 2026-10-07)".
11. 07:30: rule 2 applies to outcome promises only. Write "paid in full upfront" in place of "100 % upfront" (07:185 and 04 WEB-SVC-05:125). "we never…" about our own process (241, 422) is allowed; say so.
12. 07:187: → "For small, well-defined jobs, we usually skip it and quote after a call."
13. 07:395: **MEANING (owner, the 04 part)** The hard-coded "₹1,00,000 / $2,000" breaks WEB-G-07. Add a `small_job_threshold` setting (ADM-SET-05) and a `{{terms:…}}` placeholder. Leave 07:395 as it is until the owner answers.
14. 04:164: the WEB-LEGAL link → [07-A](../07-content-appendix/A-legal-pages.md).
15. 06:398: → "the only public place for the GSTIN and the proprietor's legal name as supplier".
16. 04:358, :164: tag ADM-PAY-13 (UPI MDR) and WEB-LEGAL (DPDP/SPDI) "VERIFY WITH CA/LEGAL".
17. 04:358, :385: move ADM-PAY-13 after PAY-12 and ADM-REP-07 after REP-06, keeping the IDs.
18. 04:249, :374: JOB-EMAIL → JOB-Q-01; JOB-HOOK-SES → JOB-HOOK-01.
19. 04:225: ADM-SET-04 → "for every series (GST requires it for invoice, export, CN/DN, vouchers)".
20. 04:199: ADM-G-07 → "(a scanning test, `packages/core/test/no-floats.test.ts`)".
21. 04:97: WEB-G-02 → the CI check fails on D1, R2, KV, Durable Objects or Hyperdrive bindings.
22. 04:208: ADM-AUTH-02 → "M1.4 (docs/runbooks/cpu-baseline.md, PR #7)".
23. 04:471: GST/CA exports → "✅ (step-up)" for Owner and Accountant.
24. 04:519-531: §12 → replace the table with a pointer to 07 §9, which is the single list.
25. 07:519-537: §8 → add copy rows for estimate sent, approval requested/decided, weekly digest, debit note. Keep them plain and in the existing style.
26. 07:13: example → "40 % on acceptance · 30 % at the midpoint milestone · 30 % on delivery".
27. 07:23: → "(style guidance, not linted)".
28. 06:113-124: §2.2 → add the `fill-subtle` and `btn-secondary-fg` tokens (take their values from tokens.json); `--container` → `--container-page`; note that `--shadow-n` is an alias of `--elevation-n`.
29. 06:450: §9 → "Approved 2026-10-06", plus a Status line like 04 §13.
30. 06:356: "Bulletproof" → "VML-safe (Outlook) button".
31. 06:378, :394: the PDF sender → "per document type (hello@ for proposals and estimates, billing@ for invoices, proformas and receipts)".
32. 06:303: `Money` → negatives as −₹1,000.00 (U+2212). 04 ADM-INV-05:328 → amount in words "Rupees … and … Paise Only" / "US Dollars … and … Cents Only".
33. 07:332: → "Essential: no rollover. Growth and Scale: unused hours roll over for one month."
34. 07:524: → "Links to the accepted proposal and the acceptance certificate are below."
35. 07:490: the case-study brief location → "(git-ignored; never committed)".
36. 11:7, :68: add [ADR 0013](../adr/0013-new-brand-identity.md) to the header and link "docs/07 §3".
37. Code comments in `packages/db/src/seed/catalogue.ts` (lines 2, 129): "docs/04 §4.2" → "docs/04 §3.2". Comment only.

## Findings: group 1 (CLAUDE.md, README, record, 00, 05 + appendix, 09, 10, runbooks, ADRs). Done by the lead
Scores before:
| File | Score |
|---|---|
| CLAUDE.md | 8.5 |
| README | 7.8 |
| CHANGELOG | 7.5 |
| STATUS | 8.2 |
| DECISIONS | 8.3 |
| runs/README | 8.5 |
| 00 | 4.5 |
| 09 | 7.0 |
| 10 | 6.7 |
| environments | 7.7 |
| access-staging (PR #7) | 7.7 |
| cpu-baseline (PR #7) | 8.8 |
| ADR 0001–0011 | 7.2 |
| ADR 0012 | 8.5 |
| ADR 0013 | 9.0 |
| 05 | 7.3 |
| 05-A | 8.5 |

1. 05:306, :33: **MEANING (owner)** The issue guard allows `draft` and `pending_approval` (`triggers.ts:83`), but the §5.4 SQL issues drafts only, so a number could be lost. Decide: may a document waiting for approval be issued? The fix is a new migration later (code follow-up).
2. 05:578: ci.yml "Today" → add the migrations-drift step; D1 migrations in tests, gitleaks and the binding guard already run, so move them out of "later".
3. 05:579: deploy-staging "Today" → skip if no secrets → migrate staging D1 → seed → deploy 4 Workers; remove migrations from "later".
4. 09:10-16, :21: the milestone flow → CLAUDE.md rule 2 (review → PR → CI green → auto-merge → staging → show → wait; held PRs).
5. 09:50: M1.3 → "✅ Done and approved 2026-10-06 (PR #6)".
6. STATUS:44: "this PR" → PR #8 (merged). List what PR #7's CLAUDE.md must keep: the `pnpm dev:secrets` / `pnpm invite` commands, the Staff-login bullet, the `__new_` migration convention, and the `wrangler types --env staging` note.
7. STATUS: add "Install the Renovate app (approve/decline)" under Not blocking. 05:90 → "will open … once the app is installed".
8. CHANGELOG: add #8 (2026-10-07). Keep the link format and update the end-session skill to match.
9. 00: banner "Historical record (2026-10-06). Superseded by CLAUDE.md, docs/12-status.md, docs/13-decisions.md; start sessions with 'start the day'."
10. 10: add §9 "Working-rules additions (2026-10-07, owner-approved)": builder/reviewer agents, worktrees, Monitor, `tools/heavy.sh`, `tools/watch.sh`, the start/end-session skills.
11. 10:7: → "CLAUDE.md hard rule 11".
12. 10:64: "memory/08" → [08 §0 U-6](../08-security-compliance.md).
13. 10:52-56: §5 → "(done 2026-10-06)".
14. 05:315: triggers → "a custom migration generated from `packages/db/src/triggers.ts` by `scripts/write-triggers.ts`"; also 09:50 "hand-written triggers".
15. 05:147, :159: `config/` → "tsconfig bases"; dependency rules → "(enforced by review today; a lint check is planned)".
16. 05:153, :185: `restore-drill.yml`, `.dev.vars.example`, `pnpm dev:pdf-remote` → mark "(planned: Phase 7 / M1.4 / M4.4)".
17. 05:94: Node → "24.x (`.nvmrc` 24; engines ≥ 24.19.0)".
18. ADR 0009:4, 05:15: add "Update 2026-10-07": the private-repo premise changed with ADR 0012; the decision stands until the owner revisits it.
19. ADR 0004:4: → "To be confirmed by the M1.4 CPU gate (pending)".
20. environments:77: → 05 §12.3.
21. environments:64, :80-82: "no data" → "no personal data"; add auto-merge on and conversation resolution required; add "Last updated".
22. DECISIONS: add rows for Phase 4 approved, Phase 5 approved, R2 deferred, Renovate pending (2026-10-06).
23. runs/README: every run file starts with `Status: open | merged (PR #N) | abandoned`.
24. access-staging (PR #7): webhook paths → `/razorpay`, `/stripe`, `/paypal`, `/ses` (05:382, `apps/jobs/src/index.ts:10`). **Do in PR #7.**
25. access-staging (PR #7): "next PR"/"coming" wording, the full `cd` path, `powershell` labels, the trailing-newline check. **Do in PR #7.**
26. ADR 0001–0011: "Details: see docs/05" → link the section.
27. README: add pointers to the record, and the Node 24 / pnpm 12.9.1 prerequisites.
28. CLAUDE.md:97 → "(web and jobs also dry-run their Worker bundles)".
29. 10:14 → "pnpm switches to the pinned version itself (`packageManager`)".

**Lead decision on group 4 item 1:** this is a factual correction (the appendix says the git history wasn't scanned), so it gets fixed, not asked.

## Owner decisions (2026-10-07)
**Prices and terms:**
| Question | Decision | Where it's applied |
|---|---|---|
| S16 "first month included at launch" (g5#7) | **Dropped** | 02 |
| S12 model usage (g5#8) | **At cost** | 02 matches 07 |
| Annual care-plan discount (g5#11) | **10 %** | 02 and 07; the 07 "pending" mark removed |
| Small-job threshold (g5#27, g2#13) | **INR-led** (under ₹1 L, in any currency), and an editable setting `small_job_threshold` | 04 ADM-SET-05; 07 uses a `{{terms:small_job_threshold}}` placeholder. The seed is already INR-led, so nothing changes there. The setting code is a follow-up (M3/M4). |

**Privacy and legal (all VERIFY WITH CA/LEGAL):**
| Question | Decision | Where it's applied |
|---|---|---|
| Backups (g3#1) | The 10-year monthly copy holds **finance/GST tables only**. Leads and contacts are kept only in rolling 35–90-day backups. | 08 §6.1, 07-A §5 |
| Newsletter proof of consent (g3#23) | **3 years** after unsubscribing | 07-A |
| EU/UK section (g3#19) | Controller: "TecHaust Technologies (Rupak Sarkar, proprietor)", plus the GDPR rights and an Art. 27 note | 07-A |
| G-11 (g3#12) | Also stop at the annual-return filing date, if earlier | 08 G-11 now; the setting/code follows with M4/M5 |

**Public repo and approvals:**
| Question | Decision | Where it's applied |
|---|---|---|
| Live-site exploit steps (g4#14) | **Redact** the exact payloads ("verified locally"); the findings and severity stay | 01-A |
| Personal handles (g4#24) | Replace with "founder's personal handles" | 01-B, 01-C |
| A pending-approval document being issued (g1#1) | **No.** It needs approval first. The docs say drafts only; the guard is narrowed in a later migration (code follow-up). | 05 §5.4 |
| Default lines in the public snapshot (g2#7) | **Yes:** names and prices only | 04 ADM-CAT-05 |

## Review (verification pass, 2026-10-07, two Opus high-effort reviewers): SEND BACK, small fixes
Scores after the first fix round:
| Files | Score |
|---|---|
| 01 | 9.3 |
| 01-A, 01-B | 10 |
| 01-C | 9.7 |
| 02 | 9.5 |
| 02-A | 9.8 |
| 02-B | 9.5 |
| 02-C | 9.8 |
| 03 | 9.2 |
| 03-A | 9.8 |
| 03-B | 9.7 |
| CLAUDE.md | 9.3 |
| README | 10 |
| CHANGELOG | 9.8 |
| 13-decisions | 9.5 |
| runs/README | 10 |
| 00 | 10 |
| 04 | 9.2 |
| 05 | 9.3 |
| 05-A | 9.5 |
| 06 | 9.7 |
| 07 | 9.2 |
| 07-A | 9.3 |
| 08 | 9.3 |
| 08-A | 9.7 |
| 08-B | 9.8 |
| 09 | 9.8 |
| 10 | 9.8 |
| 11 | 9.8 |
| environments | 10 |
| ADR 0001–0011 | 9.8 |
| ADR 0012 | 9.7 |
| ADR 0013 | 10 |
| skills/agents | 9.7 |

12-status (6.2) and this run file are rewritten by the lead at session end.

### Fix list R1 (files 01–03)
1. 03:51: append "(superseded in part: the proprietor's name appears on the privacy page as Grievance Officer and EU/UK controller; GSTIN stays invoice-only, [04 §0](../04-prd.md) Identity, [07-A](../07-content-appendix/A-legal-pages.md))". The links are written relative to docs/ in the target file, i.e. `04-prd.md`.
2. 03:9, :422, :476; 03-B:47, :258: after "default 10", add "; the monthly copy holds finance/GST tables only, leads and contacts are only in the 90 daily copies (owner decision 2026-10-07, 08 §6.1)".
3. 02:286: keep as is (the option the owner chose included "case by case"). No change.
4. 03-B:81: delete the trailing "[?] The new pricing isn't known yet."
5. 01:189: add rows:
   - Q-B2 → 02 §1 (Markets) and D-2
   - Q-B3 → 02 §1 (AI projects in progress) and D-4
   - Q-B9 → 04 §0 (Assets, Contact, Q-P3-1)

   Extend Q-B7 with "; no lawyer: the legal pages are drafted in-house (04 §0 Q-B12)". Delete the "not tracked" sentence.
6. 01:81: change "a 3 MB body was parsed" to "an oversized body was parsed".
7. 01:23: after "time to first byte", add "(curl through the Marseille colo; re-measure from India, see H-7)".
8. 03-B:15, :198, :207: "08-B §1" → "08-B §1a" where the SPDI Rules are meant. Keep §1 where DPDP dates are meant (:197).
9. 03-A:225: change the $5,000 PayPal cell to "$220.30 + about $150 FX ≈ $370".
10. 01-C:114: remove the backticks around "the founder's personal X handle".
11. 02-B:18, :77: tag the S16 figures "**[S16][VENDOR]**".
12. 02:294: change "**10 % off**" to "10% off" (the file's style).
13. Banners and revisions:
    - 02-A and 02-B: add the banner "> **Phase 2 research record (APPROVED 2026-10-06).** Parent: [02](../02-services-strategy.md). Where it differs from a decision, [13-decisions](../13-decisions.md) wins."
    - 01, 02, 03: add a header row "| **Revised** | 2026-10-07, documentation quality pass ([runs/docs-quality-pass.md](docs-quality-pass.md)) |".

### Fix list R2 (04–13, root, ADRs)
1. 04 JOB-BKP-01 (~:429) → "retention 90 daily (all tables) + the first-of-month copy of the finance/GST tables only for 10 years (≥ 8 from FY end; 08 §6.1; VERIFY WITH CA/LEGAL)". 05 backup.yml row (~:581) → add "first of month: a second export limited to the finance tables (`wrangler d1 export --table …`), kept 10 years".
2. CLAUDE.md:48 and .claude/skills/start-session/SKILL.md:23: "DECISIONS" / "STATUS and DECISIONS" → "`docs/13-decisions.md`" / "`docs/12-status.md` and `docs/13-decisions.md`". Also grep CLAUDE.md, the skills and the agents for any remaining bare STATUS/DECISIONS names.
3. 04:429: "02:00 IST" → "03:00 IST (21:30 UTC)" (`.github/workflows/backup.yml:6`).
4. Code follow-up only (no edit): `settings.ts` `smallJobThreshold` has an INR/USD pair; the decision is a single INR value. The lead records it in 12-status.
5. 07:85 footer legal row: add " · Accessibility". Add `/accessibility` wherever 04 lists the legal links or the sitemap.
6. 07:49 claims register and the §9 confirmations row: Tally/GSP experience → "Confirmed (03 §0)", and drop it from the §9 list.
7. 08:216: settings list → "G-1, G-2, G-3, G-5, G-6, G-8 to G-12 (G-11's annual-return date arrives with M4/M5), G-14, G-15, G-18".
8. 08:301 change log, 2026-10-07 row: add "Owner decisions: the long-term backup holds finance/GST tables only (§6.1); G-11 also stops at the annual-return filing date (VERIFY WITH CA/LEGAL)".
9. 07-A:5, :279: "Draft v0.1 (2026-10-06)" → "Draft v0.2 (2026-10-07)", with a one-line change note (§7a EU/UK, backups, consent kept 3 years, §8 accessibility).
10. 08 §7.3 lawyer questions: add "the legal basis for passive visitor and security data (IP, device) under DPDP; currently written as s.7(a), VERIFY WITH CA/LEGAL".
11. CLAUDE.md:138, :146: "D1/R2/KV" → "D1/R2/KV/Durable Object/Hyperdrive bindings".
12. 05:582: restore-drill.yml trigger → "Manual (quarterly), planned: Phase 7".
13. 08-A TL;DR row 17: "(±₹0.50)" → "(−₹0.49 … +₹0.50)".
14. 08:22 (U-6) and ADR 0012:7: add "(exact reproduction payloads redacted 2026-10-07, 01-A; the findings and severity stay)".
15. 06 footer row and supplier note: add "billing@ for credit/debit notes and statements" (04 ADM-SET-07).
16. ADR 0003 "Details": "§3" → "§4 (Workers) and §7 (API design)". No heading anchors: the repo doesn't use them.
17. 13-decisions: add the rows
    - 2026-10-07 | `/accessibility` added as its own legal page, per 08 L-15 | Lead | 04 WEB-LEGAL, 07-A §8
    - 2026-10-07 | 04 §12 owner-inputs table folded into 07 §9 (single list) | Lead | 04 §12, 07 §9

    The "M1.1, M1.2, M1.3 approved" row: also cite [09](../09-roadmap.md).
18. Date rows in 04, 05, 06, 07, 10, 11 → add "(last updated 2026-10-07)".
19. CHANGELOG intro → "One line per merged pull request, newest first; dates in IST."
20. 05-A §14 heading (~:379): add a dated note under it: "Repo public since ADR 0012; see the ADR 0009 update (2026-10-07)."
21. Run-file bookkeeping: done by the lead in Integration notes.

## Builder reports

### Builder report (01–03)
Branch `docs/qp-01-03`, from b8dfdc3. Commits: d591261 (01), ee122a8 (02), 907dffc (03), plus this report. Docs only; no commands other than git and a link-check script (every relative link in the 12 files resolves, except the new `13-decisions.md` link in `02-research-appendix/C-…`, which resolves once the rename lands).

**Files changed:** `docs/01-audit.md`, `docs/01-audit-appendix/{A-code-build-security,B-content-design,C-live-perf-seo-a11y}.md`, `docs/02-services-strategy.md`, `docs/02-research-appendix/{A-ai-services-market,B-software-services-market,C-competitors-positioning-channels}.md`, `docs/03-plan.md`, `docs/03-research-appendix/{A-payments,B-platform-stack}.md`, and this run file.

**Group 4 (01 + appendices)**
- 1: SKIPPED (owner decision). `01:111` and App A:111 untouched.
- 2: applied (header APPROVED 2026-10-06, §8 ticked).
- 3: applied (Superseded note in §6: ADR 0013, 06 §1, 04 §11).
- 4: applied ("Resolved in" box at the top of §7; Q-H2 to Q-H6 still open). Q-B5/B6/B10 cite 02 §1 (Team), D-3, and 04 §0 (Team, Contact, Q-B16), since the brief only said "02/04".
- 5: applied the variant. C header and §3 now say MRS (Marseille) with the caveat that curl TTFB may include the route to Europe; same caveat in C summary row P2, C P2 finding, the TTFB table row, and 01 H-7.
- 6: applied (timeline note in 01 C-3 and B §A.8 gaps, citing 08 L-1/L-2 and 08-B).
- 7: applied (VERIFY WITH CA/LEGAL tags on A Q8/Q9 and C Q10; "Not legal advice" line in C's header).
- 8: applied (B footer list, A.15 table row, D Q10 now point to App C S1/§5).
- 9, 10, 11: applied (CLS wording; Resend free-tier hedge in 01:22/39/68 and A F-S1; the 38.5 wording).
- 12: applied (A:5, C:9).
- 13: applied to A, B, C. I linked **04 §10 (traceability) and §11 (later)** rather than §11 alone, because §10 is the finding-to-requirement map.
- 14: SKIPPED (owner decision). A:43-70 untouched.
- 15, 16, 17: applied (B slate-500 "fails AA", the 3.6/3.8 contrast pair, ping 4–12 ms).
- 18: applied (new Evidence column on the M and L tables, every row filled from the appendices' own finding IDs).
- 19, 20, 21, 23: applied.
- 22: applied (B:24, :247, :341, :605, :616 now cross-reference App C S4/P1, A F-S2, A F-S8).
- 24: SKIPPED (owner decision). The founder's handles are untouched.
- 25: applied (B Q6 answered in part: DNS shows Zoho; I also added the Grievance Officer answer from 04 §0).

**Group 5 (02 + appendices)**
- 7, 8, 11, 27: SKIPPED (owner decisions). S16 "first month included", S12 "at cost plus 10–20 %", the rollover/annual-discount line and the seed threshold are untouched. Item 27 is in `catalogue.ts`, outside my files.
- 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 26: applied as written. Item 4 adds a "Resolved in" column to the §10 table (Q-P1, Q-S1, Q-S2, Q-B11 → 03 §0; the rest → 04 §0). Item 16: S4, S7, S14 and the S9 Tally skill are now ✅ with citations; the S9 finance-domain 🟡 (Q-B13: no CA yet) is left because it is not in the finding.
- 6: applied with a **deviation**: the finding's "₹15–45k" blends two sources, so I wrote what each says: "₹15–60k, App A §1.8; ₹20–45k low-complexity, App C §1b". The "₹75k-per-workflow" example is removed from that cell.
- 23: applied with a **deviation**: B:13 now reads "$6.15T (+10.8%) [S1]". I dropped "about $6.3T" and "14.2 %" because no listed source supports them. I also added S16 to the "US web agencies" figure in B's summary, to match the re-attribution.
- 24: B:77 re-attributed to S16 UX Continuum; 02:65 reads "Clutch / UX Continuum". (I did not check S16's own text, only the existing source list.)

**Group 6 (03 + appendices)**
- 1 to 17, 19 to 25: applied as written. Item 4's list also names the sections each change contradicts (§0 Logo, §3A.5, §3C.3, §3C.4, §3C.5). Item 5 keeps the old 30/40/30 text visible with "superseded"/"Answered" notes, except the 30% advance example in §3B.3, which is changed to 40%. Item 15 uses 13 Nov 2026 (08-B). Item 17: ₹88 / ₹90 / 88.42 noted in A and B.
- 18: partly applied. Where the source named only a page type ("the related pages", "refunds idempotent docs", a mirror, a truncated GitHub path) I added "source detail not captured" or "full URL not captured". No URLs were invented. A:36's Razorpay and blog URLs were already complete.
- 13: B:264-271 marks only the Workers Logs item as resolved (05-A #13). The other re-check items are not resolved in 05-A's table, so they stay open.

**Not verified:** external URLs (no web access); the facts cited from 04/05/08 were checked against those files in this repo. The `13-decisions.md` link will 404 until the rename lands.

**Open questions:** none for the owner. One for the lead: the brief's "04 §11" for the appendix headers; I used §10 plus §11 (see item 13).

### Builder report (04–11)
Branch `docs/qp-04-11` (from b338cd4). Scope: group 2 and group 3 findings for 04, 06, 07, 08, 11, the 08 appendices, 07-A, and the two comment lines in `packages/db/src/seed/catalogue.ts`.

**Group 2 (04, 06, 07, 11)**
- Applied: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37.
- Skipped (owner decisions, as instructed): 7, 13. The 07 §5.3 line "under about ₹1,00,000 / $2,000" and ADM-CAT-05 are untouched.
- Notes:
  - 5: nine titles shortened (counted with a script; every meta title is now ≤ 60). Home counts fixed to title 56, description 145. Discovery Sprint now reads "a fixed price before you build", which drops the word "plan" to fit.
  - 11: "100 % upfront" is now "paid in full upfront" in 07 §4.1 and 04 WEB-SVC-05. Other "100 %" mentions in 04 (WEB-PRICING, ADM-SET-05, ADM-EST-02, Q-P3-6) were not in the finding and are unchanged. They may still trip the `100%` lint if rendered on a page.
  - 24: because the 04 §12 table was replaced by a pointer to 07 §9, I added two rows to 07 §9 (bank details/GSTIN/legal name/LUT ARN; gateway test keys) so no input was lost. The old "Needed by" milestones are folded into those rows.
  - 25: added copy rows for estimate sent, debit note, approval requested, approval decided and weekly digest. Variable names (e.g. `{{request_reason}}`, `{{decision}}`) are new and need confirming when the templates are built.
  - 31: the sender is now stated in the 06 footer row and under the shared header (hello@ for proposals and estimates, billing@ for invoices, proformas and receipts). Credit notes, debit notes and statements are not named in the finding, so they are not assigned.
  - 28 and 9: values copied from `packages/ui/tokens/tokens.json` and `generated/theme.css`.
  - 37: the finding said lines 2 and 129; the second was at line 148. Both are comment-only. Biome was not run (comments only; no pnpm).

**Group 3 (08, 08 appendices, 07-A)**
- Applied: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 24, 25, 26, 29, 30, 31. Item 27's 08 part is the new U-9 row (see below).
- Skipped (owner decisions or later work, as instructed): 1, 12, 14, 19, 23, 28. The 07-A privacy §5 retention table, the EU/UK text and the 08 G-11 row are untouched.
- Notes:
  - 2: Raised/status column added to 08 §0. U-1, U-2, U-3 are marked "Open (owner)" and link to `12-status.md` (the new name, which resolves once the rename lands). Statuses for U-4 to U-8 are my reading of the existing text and CLAUDE.md (planned / open / not blocking); the lead should check them.
  - 27: added **U-9** to 08 §0 for the 57th GST Council re-check (open follow-up). The matching "Waits on the owner"/follow-up entry in 12-status is for the lead.
  - 30: the 08-A TL;DR now numbers rows 1–25. **Old row 13 (Retention) is now row 20.** Group 6 finding 2 cites "08-A #13" for backup retention; that citation must become "08-A #20" (or cite 08 §7.1 G-15 instead).
  - 18: the India basis for visitors (07-A §2 row 1) is now "provided voluntarily by using the site (DPDP s.7(a))", tagged VERIFY WITH CA/LEGAL. That wording is my application of the finding to line 34; check it.
  - 22: the accessibility statement is added as 07-A §8 with the route `/accessibility`. The route is **not** listed in 04 WEB-LEGAL, 04 §3.3 or the 07 §2.2 footer. The lead or owner should decide whether it is its own page. "Known gaps" says none recorded yet (no audit has run).
  - 10: the Access facts (admin@ only, jobs webhook bypass in M6, benchmark service token, the two secret names) come from `docs/runbooks/access-staging.md` on the `feat/m1.4-auth-spike` branch (PR #7). The 08 text names that file in plain text, not as a link, because it is not on this branch.
  - 5: the Time Travel steps follow the finding; the exact `wrangler d1 time-travel` flags were not verified against Cloudflare docs here.
  - 8: ticked only what the code backs: permission matrix (core), frozen-document and append-only triggers (`packages/db/src/triggers.ts`), the core coverage gate (`packages/core/vitest.config.ts`). Route enforcement and SHA-256 stay unticked.
  - 25: B notes link to `../08-security-compliance.md` §7.3 L-6 and L-16.

**Not done / not verified**
- No pnpm commands were run (docs only). The site's content lint and SEO tests were not run.
- Links: a script checked every relative link and anchor in the eight edited docs. The only unresolved ones are the three new `12-status.md` links, which wait for the rename.
- No new URLs, dates or figures were introduced beyond those in the findings and the cited repo files.

**Files changed**
`docs/04-prd.md`, `docs/06-design-system.md`, `docs/07-content.md`, `docs/11-brand-audit.md`, `docs/08-security-compliance.md`, `docs/08-research-appendix/A-gst-invoicing.md`, `docs/08-research-appendix/B-dpdp-legal.md`, `docs/07-content-appendix/A-legal-pages.md`, `packages/db/src/seed/catalogue.ts` (two comment lines), `docs/runs/docs-quality-pass.md` (this report).
## Integration notes

### Lead integration (2026-10-07)
**Merged into `docs/quality-pass`:**
- `docs/qp-01-03` (builder, 01–03)
- `docs/qp-04-11` (builder, 04–11; the run-file conflict was resolved by keeping both reports)
- `docs/qp-r1` and `docs/qp-r2` (verification fix lists)

**Applied by the lead after the builders**, so where a builder report above says "SKIPPED" for these, they were applied later:
- g4#1, #14 and #24, plus 02 g5#7, #8 and #11: commit 27f106e, with the redaction completed in 5b85050
- g2#7 and #13, g3#1, #12, #19 and #23, and the 07 discount: commit 5b85050
- g1#1 (05 §5.4 guard note): commit a1c9c31

**Lead decisions:**
- R1#3: kept "can still be offered case by case". The owner chose the option that said so.
- R2#15: recorded as a Lead decision in 13-decisions; Q-P3-5 doesn't name a sender for credit/debit notes and statements.

**Deferred by design** (listed in [12-status](../12-status.md)):
- g1#24 and #25 (access-staging, in PR #7)
- g3#14 (session-key rotation, after PR #7)
- g3#28 and the code follow-ups (issue_guard, smallJobThreshold, annualReturnFiledAt)

**Checks:**
- every relative link in every tracked Markdown file resolves (script)
- `pnpm lint` passes
- docs only, apart from two comment lines in `packages/db/src/seed/catalogue.ts`

**Not verified:** external URLs (no web access in the reviews).

**Scores:** 8.8 out of 10 on average before → 9.7 after the verification pass, with R1/R2 applied on top. Some scores stay below 10 because reaching 10 needs new research or owner input:
- 01-C TTFB: re-measure from India
- 02-B S16 source: check the source text
- 02-C: add a source for each row
- 12-status: rewritten at session end

