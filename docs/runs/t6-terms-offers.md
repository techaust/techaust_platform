# Run: T6, the offer wording, proposal terms v4 and website Terms 0.2

Status: builder running (Q1, Q2 answered 2026-10-31)
Tier: B
Usage: lead claude-opus-5-5/high (cloud session t6-terms)

**Source:** [settle-08c](settle-08c.md) task T6; wording [07-ZE](../07-content-appendix/ZE-terms-offers-deed.md) (approved by the owner, 2026-10-31: 20 lines, Q1–Q4). Cloud session `t6-terms`, branch `feat/t6-terms-offers`, controlled by the main session on the owner's PC. Merge order today: T12, **T6**, proforma withdraw, T7, M6.1.

## Step 1: the MCIA check (07-ZE Q2, 08-C RB-38(c))
Done by the lead, 2026-10-31, from MCIA's own pages (recorded in 08-C RB-38):
- **(b) Kolkata seat: passes.** MCIA Rules 2025, r.30.1: "The parties may agree on the seat of the arbitration. Failing such agreement, the seat of arbitration shall be Mumbai, India, unless the Tribunal determines … that another seat is more appropriate." A Kolkata seat written in the terms is a seat the parties agreed. Source: https://mcia.org.in/mcia-rules-2025.php and https://mcia.org.in/pdfs/MCIA-Rules-2025.pdf.
- **(a) Fees: recorded; high for a small claim.** MCIA Schedule of Fees 2025 (in force for arbitrations begun on or after 1 May 2025; https://mcia.org.in/mcia-schedule-of-fees): case filing fee ₹50,000, non-refundable; sum in dispute up to ₹10 lakh: administration fee up to ₹1,10,000, one arbitrator's fee up to ₹1,85,000; shared equally, paid in tranches; the expedited documents-only track halves the administration and arbitrator fees; r.43.4 lets the Registrar go higher in exceptional cases. So a small overseas dispute can cost up to about ₹3.45 lakh in MCIA fees (about ₹1.7 lakh each side), before lawyers.
- **Caveat:** this cloud session's network blocks mcia.org.in (proxy 403), so the pages were read through the search index of mcia.org.in, not opened directly. Re-read the rules PDF and the fee page on the owner's PC before launch (follow-up below).
- Because of the cost, line 12 goes to the owner as **Q1** below. Line 12 is built as approved meanwhile; only a change of answer would change it.

## Brief (lead, 2026-10-31)

**PRD IDs:** ADM-SET-08 (proposal terms), ADM-PROP-07, ADM-EST-01 (send), POR-04 (portal offer view), WEB-LEGAL (Terms page). **Tier B** (copy and seed; no money, no schema).
**Wording:** only [07-ZE](../07-content-appendix/ZE-terms-offers-deed.md), word for word (curly apostrophes where the surrounding file uses them, e.g. legal-pages.ts). Any line 07-ZE lacks is a question to the lead, never invented; it shows "[Placeholder]" in code.
**Out of scope:** Delivery 0.2 (line 16) and the deed (lines 17–20): T11. Refunds page unchanged (Q1). No migration, no schema, no route change (unless noted). Proformas and due dates get no "(IST)", nor do staff list screens. Sent documents keep the terms version they pinned; already rendered PDFs are never re-rendered; no snapshot, seal or hash format changes.

### Comment tags (07-ZE "Tags for code comments")
Lines 1–2: `OPEN (08-C RB-35(a))` answered by naming IST. Line 3: `Researched 2026-10-29, Contract Act s.6 (08-C RB-35)`; `OPEN (08-C RB-35(b)): s.5 not read`. Lines 4, 5, 7, 13: `Researched 2026-10-31, Contract Act s.7(2) (08-C RB-35)`. Lines 6, 14, 15: `OPEN (08-C RB-23): CPA 2019 ss.2(7) and 34 read in secondary sources only`. Lines 8, 9, 11, 12: `OPEN (08-C RB-38(c)): commercial choices, no statute read`; line 9's personal data also `OPEN (08-C RB-38(c)): DPDP s.8`. Line 12's MCIA facts: `Researched 2026-10-31, MCIA Rules 2025 r.30.1 (08-C RB-38(c))`. Never a bare "VERIFY" (`packages/core/test/verify-tags.test.ts`).

### Builder (data, text, plumbing; worktree branch `fix/t6-terms-build` from `origin/feat/t6-terms-offers`)
1. **Proposal terms v4** in `packages/db/src/seed/terms.ts` (`PROPOSAL_TERMS_V4` + `_SHA256`): v3 items 1–5 word for word, then 07-ZE item 6 (line 7), 7 (line 8), 8 (line 9 + line 10 appended to the same paragraph), 9 (line 11), 10 (line 12), then line 6 as its own paragraph. Same Markdown shape as v3 (`N. **Title.** text`). `proposalTermsV4Select()` in `packages/db/src/seed/index.ts` through `nextProposalTermsSelect` with `afterId: "terms:proposal:za14-proposal-or-estimate"`, `afterSha256: PROPOSAL_TERMS_V3_SHA256`, a new stable id (e.g. `terms:proposal:ze-t6-v4`), inserted after v3 in `seedStatements`. Tests (`packages/db/test/seed-terms-v4.test.ts`, mirroring `seed-terms-v3.test.ts`): the hash recomputes; v4 follows only the seeded v3 by id and hash; an owner's own newer version (or an owner row repeating a seeded text) is never followed; re-running the seed adds nothing; due-days guard; a document that pinned v3 still reads v3. Check any test or code that counts terms items or reads item 6 "Validity".
2. **Shared offer lines** in `@techaust/core/offers` (pure, used by email, PDF, portal and the admin preview; no duplicated strings): the "(IST)" suffix helper for validity dates (line 1), the expired notice (line 2), the "replaces" line for version ≥ 2 (line 3: `n−1` is the previous version number; return null for v1), the email closing (line 4), and the staff reply (line 5) as a fill function (`first name`, `number`, `n`, `portal link`). Unit tests for each, including v1 → null, v2 → "replaces version 1".
3. **Email** `packages/email/src/offers.ts` `offerSent`: "(IST)" on the lead sentence's date and the "Valid until" fact; the line-3 paragraph right after the first paragraph when version ≥ 2; line 4 replaces "Questions? Just reply to this email." (text only; existing `para` blocks; both HTML and plain text). Update `apps/admin/src/lib/offers.ts` (the admin's email preview) to match exactly. Tests in `packages/email/test`.
4. **PDF data** `packages/pdf/src/view.ts`: the validity value and `validityNote` with "(IST)" for proposals and estimates only (never the proforma's `Valid until`, `layout/copy.ts:156`); a new `replacesNote` field (line 3, null for v1). Render `replacesNote` in `packages/pdf/src/layout/document.ts` directly under the validity note with the existing note style (the designer checks it visually). Fixed words go in `layout/copy.ts` only if they aren't from core. Update the pdf tests and any text snapshots; visual baselines are the designer's.
5. **Website Terms 0.2** `apps/web/src/content/legal-pages.ts`: §7 add line 13 after "…a fingerprint of the document)."; §10 end with line 14 ("…such as liability for fraud, or your rights under the Consumer Protection Act, 2019 (see Law and courts)."; the ₹10,000 cap stays); §12 line 15 replaces ", subject to any dispute-resolution clause in a signed contract." and line 6 follows as its own paragraph; update the OPEN comments (RB-23) per the tags. `apps/web/src/content/legal.ts`: terms `version: "0.2"`, `effective: "2026-10-31"` (literal), changes: 0.1 "First published draft." then 0.2 with 07-ZE's note "How to accept a proposal or estimate, and that a newer version replaces earlier ones; your rights as a consumer are not limited; arbitration for clients outside India.". The content lint must pass ("and", never "&"; banned phrases; meta description).
6. **Admin: the portal link for line 5** (Q2 option A, owner 2026-10-31; the heading "Client accepted by email?" and the button "Copy reply" are approved, built as real text): the admin SPA needs the portal origin. Add it as a build-time constant (follow the portal's `__WEBSITE_ORIGIN__` pattern: `scripts/website-origin.mjs`, a `vars` entry per env, the config guard `scripts/check-worker-config.mjs` if it checks vars). No Worker bytes, no API change unless the document GET lacks the contact's first name (check `GET /documents/:id`'s sends and contacts first; if a field is needed, add it to the existing response and say so). Expose `staffReplyText(doc)` from `apps/admin/src/lib/offers.ts` for the designer, with tests.
7. **Docs:** 07-O: a short "§2e terms version 4" pointer to 07-ZE (don't copy the text twice); 07-A: the status row "Changes in v0.4: 2026-10-31: …" from 07-ZE "Versions", noting Delivery 0.2 waits for T11.

Run (each through `bash tools/heavy.sh --log <name> …` where heavy): `pnpm --filter @techaust/core test`, `@techaust/db test`, `@techaust/email test`, `@techaust/pdf test`, `@techaust/web test` (rebuild web first), `@techaust/portal test`, `@techaust/admin test`, `pnpm --filter @techaust/jobs build` (record the jobs bytes: ceiling 1,000,000, main 984,266; stop and report if over 995,000), the admin build (record admin API bytes, main 618,422) and the portal build. Commit at least every 20 minutes and per layer; push your sub-branch; append your "Builder report" to this run file.

### Designer (after the analyst's early check; same branch, port offset 0)
- **Portal** (`apps/portal/src/copy-documents.ts` and the offer card, page and list): "(IST)" after validity dates (card, page, notices; not due dates, not proformas); the expired notice → line 2; the line-3 version line under the title for version ≥ 2. Check how the existing "There's a newer version" notice and the line-3 line sit together.
- **PDF:** the `replacesNote` placement and the "(IST)" width in the header facts; refresh the visual baselines.
- **Email:** screenshots of the sent email v1 and v2, light and dark.
- **Admin:** the staff-reply box on a sent (not accepted, not expired-and-declined) proposal or estimate in `offer-panels.tsx`: heading "Client accepted by email?" and button "Copy reply" (approved, Q2), the filled line-5 text, copy to clipboard with a toast; the email preview matches the email.
- **Website:** the Terms page (§7, §10, §12, version line and Changes) at 360, 768, 1280, both themes.
- Load `frontend-design:frontend-design` if available (cloud: plugins don't load; say so); axe on the changed screens.

### Done
Analyst GO; designer screenshots; reviewer APPROVE with a live visual review; every finding fixed or kept with a reason; `pnpm check` and `pnpm test` green at the branch tip; Worker bytes recorded here.

## Questions for the owner
**Q1 (07-ZE line 12, arbitration for clients outside India).** Plain English: the check passed: MCIA's rules let us choose Kolkata as the seat. But MCIA's fees are high next to our project sizes: a ₹50,000 filing fee plus, for a dispute up to ₹10 lakh, up to ₹1.1 lakh administration and up to ₹1.85 lakh for the arbitrator (about ₹3.45 lakh in all, normally split half each; half that on the fast, papers-only track). It only ever applies to an overseas client, after 30 days of trying to settle. Its value: an arbitration award can be enforced in most countries (New York Convention); an Indian court judgment usually can't.
- **A. Keep MCIA, seated in Kolkata, as approved (Recommended).** Wording unchanged. The cost deters weak claims on both sides and the award can be enforced abroad.
- B. Arbitration without an institution ("ad hoc") under the 1996 Act, seated in Kolkata: no MCIA fees, but if the client won't agree on an arbitrator, the Supreme Court has to appoint one (s.11), which is slow and costly. Needs new wording, back to you.
- C. Courts at Balurghat for every client: cheapest to start, but a judgment is hard to enforce outside India. Needs new wording, back to you.

**Q2 (07-ZE line 5, the staff reply to an acceptance by email: where it lives).** Plain English: line 5 is the reply you send when a client says "I accept" by email instead of using the button. We can put it ready-filled (name, number, version, portal link) on the admin page of a sent proposal or estimate, with a copy button, so you paste it into your email; nothing is sent automatically.
- **A. A box on the sent proposal or estimate in admin, with a copy button (Recommended).** Two new labels, word for word:
  1. Heading: "Client accepted by email?"
  2. Button: "Copy reply"
  Until you approve them, they show "[Placeholder]".
- B. No screen: the reply goes into a written how-to (runbook) only, and you fill it in by hand.

**Owner's answers (2026-10-31, through the main session):**
- **Q1: A.** Keep MCIA arbitration seated in Kolkata for clients outside India, as approved in 07-ZE line 12. Wording unchanged.
- **Q2: A.** The box on a sent proposal or estimate in admin, with a copy button. Labels approved word for word: heading "Client accepted by email?", button "Copy reply". Built as real text, not "[Placeholder]".

## Lead decisions (for 13)
- 2026-10-31 | After the MCIA check (fees recorded in 08-C RB-38(c)), arbitration for clients outside India stays under the MCIA Rules seated in Kolkata, wording of 07-ZE line 12 unchanged (Q1: A) | Owner | 07-ZE line 12, proposal terms v4 item 10, 08-C RB-38
- 2026-10-31 | The staff reply to an acceptance by email (07-ZE line 5) is a box on a sent proposal or estimate in admin with a copy button; heading "Client accepted by email?", button "Copy reply" (Q2: A) | Owner | `apps/admin` offer panels, run file t6-terms-offers

## Follow-ups (for 12)
- **Cloud setup script (lead, 2026-10-31): fixed by #126** (Node in /opt/techaust-node). the environment's setup script failed (`node -v says v24.22.1, not v24.22.2`): the image now ships `/opt/node24` as a real directory, so `ln -sfn /opt/node-v24.22.2-linux-x64 /opt/node24` makes a link inside it and Node stays 24.22.1; the browser step never ran. Fixed by hand in this session (moved the image's directory aside, linked 24.22.2, installed both Chromiums). Fix for `scripts/cloud-setup.sh` and the pasted environment script: before the `ln -sfn` line, add `[ -d /opt/node24 ] && [ ! -L /opt/node24 ] && mv /opt/node24 "/opt/node24.image.$(date +%s)"`. The owner pastes the corrected script into the environment's settings.

## Builder report
Builder (Opus 5.5, high; cloud session), 2026-10-31, branch `fix/t6-terms-build` from `origin/feat/t6-terms-offers` (4166570). No migration, no schema, no route, no snapshot/seal/hash format change. Wording only from 07-ZE, word for word.

**Skills:** `cloudflare:workers-best-practices` and `cloudflare:wrangler` were tried first (step 6 touches wrangler vars) and are **not available** in this cloud session ("Unknown skill": plugins don't load here). No other skill in docs/14 §9 fits builder work on copy, seed and build plumbing (`frontend-design` is the designer's; `code-review`/`security-review` are the reviewer's).

**Files by layer**
1. Seed (step 1): `packages/db/src/seed/terms.ts` (`PROPOSAL_TERMS_V4` + `_SHA256` e180ddb4…46fe; items 1–5 of v3, then 07-ZE lines 7, 8, 9 + 10, 11, 12, then line 6; tags per the brief), `packages/db/src/seed/index.ts` (`proposalTermsV4Select()` through `nextProposalTermsSelect`, id `terms:proposal:ze-t6-v4`, after `terms:proposal:za14-proposal-or-estimate` + `PROPOSAL_TERMS_V3_SHA256`; inserted after v3; `SEED_VERSION` 5). Tests: new `packages/db/test/seed-terms-v4.test.ts` (the text is checked against 07-ZE itself via `?raw`: items 1–5 equal v3, items 6–10 and the consumer line equal 07-ZE lines 7–12 and 6; the hash recomputes; due days still only [7]; at 14 days nothing is added; at 7 it is added once; a document pinned to v3 keeps v3; an owner's newer row, and an owner row repeating v3's text, are never followed), `seed.test.ts` (v4 in the seeded list; the owner row is now version 5), `seed-terms-v3.test.ts` (seeds up to v3 only where it checks v3 becoming newest), `test/env.d.ts` (`*?raw`). No code counts terms items or reads item 6 by title (searched).
2. Core (step 2): `packages/core/src/offers.ts`: `validityDateIst(date)` (line 1; an empty date stays empty), `offerExpiredNotice(kind, date)` (line 2), `offerReplacesLine(version)` (line 3; null for v1 and non-versions), `OFFER_EMAIL_CLOSING` (line 4), `staffAcceptReply({firstName, number, version, portalLink})` (line 5). Tests in `packages/core/test/offers.test.ts`.
3. Email (step 3): `packages/email/src/offers.ts` `offerSent`: "(IST)" on the lead sentence and the "Valid until" fact; the line-3 paragraph right after the first paragraph for version ≥ 2; line 4 replaces the old closing (HTML and text). Tests in `packages/email/test/m45.test.ts`.
4. PDF data (step 4): `packages/pdf/src/view.ts` + `types.ts`: `validUntil` and `validityNote` with "(IST)", a new `validUntilDate` (the bare date, for line 2) and `replacesNote` (line 3, null for v1). This view is proposals and estimates only; the proforma's `Valid until` (`invoice-view.ts`, `layout/copy.ts:156`) is untouched. `layout/document.ts`: `replacesNote` as `<p class="note replaces-note">` directly under the Document facts (the PDF prints no separate validity-note line; the facts block holds "Valid until"). Tests: `test/view.test.ts`, `test/layout.test.ts`. Visual baselines not touched (designer).
5. Website (step 5): `apps/web/src/content/legal-pages.ts` §7 (+ line 13), §10 (line 14; ₹10,000 cap kept), §12 (line 15) + line 6 as its own paragraph; RB-23, RB-35 and RB-38(c) tags. `apps/web/src/content/legal.ts`: terms 0.2, effective "2026-10-31", changes 0.1 and 0.2 (07-ZE's note word for word). Tests: `apps/web/test/content-m23.test.ts`.
6. Admin plumbing (step 6): `apps/admin/wrangler.jsonc` `vars.PORTAL_ORIGIN` (local `http://localhost:5174`, staging the portal staging Worker, production `https://portal.techaust.com`; front only, not the API Worker); `scripts/website-origin.mjs` (generic `originVarOf`, plus `portalOriginOf`, `portalOriginForApp`); `apps/admin/vite.config.ts` and `vitest.config.ts` define `__PORTAL_ORIGIN__` (port offset applied in dev); `apps/admin/src/portal-origin.d.ts`, `apps/admin/src/lib/portal-origin.ts`. `apps/admin/src/lib/offers.ts`: `STAFF_REPLY_COPY` {heading "Client accepted by email?", copy "Copy reply"} (owner-approved, real text), `staffReplyText(doc, portalOrigin = PORTAL_ORIGIN)`, `EMAIL_PREVIEW.lead` with "(IST)", new `EMAIL_PREVIEW.validUntilValue(date)` and `EMAIL_PREVIEW.replaces(version)`, `EMAIL_PREVIEW.questions` = line 4. No API change: `GET /documents/:id` already returns `contact.name` (the frozen recipient on a sent version). Tests: `apps/admin/src/lib/offers.test.ts`, `apps/web/test/admin-portal-origin.test.ts`. `scripts/check-worker-config.mjs` needed no change (it compares only the API's vars to the front's).
7. Docs (step 7): 07-O new "§2e" pointer to 07-ZE; 07-A "Changes in v0.4" row (Delivery 0.2 waits for T11) and a v0.2 pointer under §2.
- Also `apps/portal/worker/offer-view.test.ts` (the view's `validUntil` now ends in "(IST)").

**Commands and results** (heavy ones through `tools/heavy.sh`, logs in `.logs/t6-*.log`)
- `pnpm --filter @techaust/core test`: 91 files, 1,866 tests passed; coverage 99.07 % statements, 98.15 % branches.
- `pnpm --filter @techaust/db test`: 36 files, 518 passed.
- `pnpm --filter @techaust/email exec vitest run`: 11 files, 132 passed.
- `pnpm --filter @techaust/pdf test`: 21 files, 378 passed (after updating 4 assertions for "(IST)").
- `pnpm --filter @techaust/web build`, then `test`: 37 files, 739 passed; the built `dist/terms.html` shows "Version 0.2 · Effective 31 October 2026"; `node scripts/web-content-lint.mjs` ok.
- `pnpm --filter @techaust/portal test`: first run 1 failure (offer-view: `validUntil` now has "(IST)"), test updated, that file re-run 6/6 passed; the other 24 files passed in the first run (650 tests).
- `pnpm --filter @techaust/admin test`: 120 files, 3,497 passed.
- `pnpm --filter @techaust/jobs test`: 33 files, 549 passed.
- `node scripts/check-worker-config.mjs`: ok.
- `pnpm typecheck`: exit 0.
- `pnpm lint` (once, final): exit 0; 10 warnings and 8 infos, all in files this task didn't touch.

**Worker bytes:** jobs **985,956** (main 984,266; +1,690; ceiling 1,000,000, stop line 995,000), admin API **618,422** (unchanged), admin front 99,271, portal **101,065**.

**Not verified**
- No screen, PDF render, email screenshot or browser check (the designer's step). The send dialog JSX (`apps/admin/src/routes/documents/send-dialog.tsx`) is not changed: the lead sentence and the closing line update by themselves through `EMAIL_PREVIEW`, but the "Valid until" fact (line 249, `props.validUntil`) and the version-2 paragraph need the designer to use `EMAIL_PREVIEW.validUntilValue(...)` and `EMAIL_PREVIEW.replaces(props.version)`.
- The portal still passes `view.validUntil` (now with "(IST)") to its old expired notice (`apps/portal/src/routes/offer.tsx:125` → `N.expired`), so until the designer swaps in core `offerExpiredNotice(kind, view.validUntilDate)` it reads "expired on 10 Nov 2026 (IST)". The portal card and list dates and the line-3 line under the title are the designer's (`offerReplacesLine`).
- The PDF `.note` style may be scoped to the totals block; the `replaces-note` placement and look are for the designer's visual check.
- No staging build (`CLOUDFLARE_ENV=staging`) of admin was run; the staging origin is covered by `admin-portal-origin.test.ts` reading the real config.
- `pnpm check` as a whole was not run (lint ran once as required; typecheck, the worker-config guard and the content lint ran separately; no migration changed).

**Decisions taken (builder, routine)**
- The staff reply's `{portal link}` is the full portal origin (`https://portal.techaust.com`), clickable when pasted into an email; the PDF's acceptance box keeps its host-only form.
- `staffReplyText` returns null (box hidden) unless the version is a proposal or estimate with status sent, viewed or expired, has a number, neither client nor contact is anonymised, and the contact has a name; the first name is the first word of the frozen contact's name (as the email does).

**Open questions (for the lead)**
1. The designer's "copy to clipboard with a toast" needs a toast line 07-ZE lacks. `CopyButton` in `apps/admin/src/components/ui.tsx` already says "Copied" / "Copied to the clipboard" (existing words); if a different line is wanted, it is a copy question.
2. Should the box also show on a `revised` (replaced) version? Built as no (sent, viewed, expired only); the reply's last sentence covers a newer version when staff answer from the newest one.
