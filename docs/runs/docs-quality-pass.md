# Run: documentation quality pass (2026-10-07)

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
5. 03:493-505: heading → "Open questions for Phase 4 (answered in [04 §0](04-prd.md))". Add the same pointer under the roles legend (line 210). Payment schedule 30/40/30 → 40/30/30 at lines 255, 267, 502. The ❓ marks are resolved (tiered approvals, Q-P3-2).
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

## Findings: groups 1, 2
_Pending._

## Owner questions (collected)
_Asked after all groups report._

## Builder reports
## Integration notes
