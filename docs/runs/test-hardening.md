Status: main merged (6d25c9e: #141, #142); reviewer running
Tier: B
Usage: analyst (item 5) claude-opus-5-5/high, skills: code-review (+ its read-only general-purpose helper claude-opus-5-5/high); 5-h 17 → 62 % (shared window, four sessions) · builder r1 claude-opus-5-5/high, skills tried: cloudflare:workers-best-practices, cloudflare:wrangler, cloudflare:turnstile-spin (not installed in the cloud); 5-h 17 → 62 % · analyst (early check r1) claude-opus-5-5/high, skills: code-review (+ read-only helper); 5-h 62 % · builder r2 claude-opus-5-5/high, skills tried: cloudflare:workers-best-practices (not installed in the cloud); 5-h 62 → 88 %

# Test and guard hardening (cloud session "test-hardening")

Branch `fix/test-hardening` (from `origin/main` 474ec9c). Copy file: none (no user-facing wording changes). Controlled by the PC main session (parallel run of 2026-11-01: polish-sweep, test-hardening, ca-wording, m63-m64-briefs; the PC builds T11 and M6.2). Lead: this cloud session.

## Brief
Final brief by the lead (2026-11-01). Tier B: builder → analyst early check → reviewer (no screens; no designer unless an item turns out to change a screen). Every item was checked on `origin/main` 474ec9c before the brief.

**PRD IDs:** tests and guards only; commits name the area and, where one applies, the PRD ID of the code touched (`[ADM-LEAD-…]`, `[ADM-INV-…]`, `[ADM-DOC-…]`, `[POR-…]`); otherwise `test(…)`/`refactor(…)` with the item number.

**Out of bounds (other sessions edit them now):** core `payments.ts`, `razorpay.ts`, `online-pay.ts`, `gateway-rpc.ts`, `permissions.ts`; db `gateway.ts`, `issue.ts`, `triggers.ts`, `deeds.ts`; admin worker `payments.ts`, `payment-ledger.ts`, `invoice-advance.ts`, `invoice-issue.ts`, `invoices.ts`, `projects.ts`. If an item needs one of these, do the rest of the item and list that part under "Not done (needs an out-of-bounds file)". **No migrations. No workflow files. No user-facing wording changes** (if a fix would change a visible line, stop that part and report it). No production behaviour change unless the item says so; a refactor to a shared constant must be byte-identical in behaviour (same values, same SQL text where SQL is generated, pinned by the existing tests or a new one).

### Builder r1 (branch `fix/test-hardening-r1` from `origin/fix/test-hardening`)
1. **Flaky tests.**
   - (a) web e2e `apps/web/e2e/forms.spec.ts:37` "the contact form is reachable and submittable by keyboard": a 40 s `waitForURL(/\/thanks\?ref=/)` timeout once on main (passed on re-run). Find the cause (e.g. the submit fires before the Turnstile test widget has a token, the first `wrangler dev` request compiling, the form limiter): read `apps/web/src/forms.ts`, the form's client script and the Turnstile loader. Fix the test's wait (wait for the condition the submit needs, not a longer timeout alone) and, only if the cause is a real page bug, report it rather than changing production code. Keep the file's rules (keyboard only, no third submission). Run the web e2e suite through the queue at least 3 times in a row (state the runs).
   - (b) admin `apps/admin/worker/leads-api.test.ts:759` "a stale page is a 409 stale_version…": two saves in the same millisecond give `[200, 200]`. Make `updated_at` strictly increasing **in the test** (a fake clock or a deliberate tick between saves), not in production. Then say plainly whether production has the same bug (two real saves within 1 ms both pass the `expectedUpdatedAt` check); if it does, describe it under "For the analyst" with the file and line; don't change production for it in r1.
2. **Slow tests under a full parallel run.** `apps/admin/worker/invoice-send.test.ts` "each send names the staff member…" (M5.4), `apps/admin/worker/dashboard-stress.test.ts` and `apps/portal/worker/scope.test.ts` (5 s timeouts on 2026-11-01). Prefer a faster setup (fewer rows, one `batch`, shared fixtures in `beforeAll` when the tests don't mutate them); where the work is inherently heavy (a stress test), give that test an explicit, commented timeout. Report each test's time before and after (single-file run) and run `pnpm test` once through the queue.
3. **Realisation bounds:** export the bounds (months 1–1,200, extra days 0–36,500) from `@techaust/core` once and use them in `packages/core/src/schemas/settings.ts:293-297`, `export-invoice.ts:283-286` and `gst/realisation.ts:61-64` (and any other copy you find, e.g. `packages/db/src/realisation.ts`, admin or SPA). Same values, same messages.
4. **rt2 leftovers** ([runs/rt2-signature-udyam](rt2-signature-udyam.md)):
   - (a) one shared must-be-signed list: core already has `signatureRequired` / `SIGNED_ALWAYS_TYPES` (check the names); make every reader outside the out-of-bounds files use it (admin `invoice-model.ts` or wherever it is copied, `packages/db/src/sql-rules.ts` SQL builders, jobs `pdf.ts`). `db/src/issue.ts` and `db/src/triggers.ts` are out of bounds: if they hold their own copy, list it (the trigger is pinned by a test already; say whether that test also covers `issue.ts`).
   - (b) inner spaces in a pasted Udyam number: the form trims and upper-cases (L5); make it also drop inner whitespace (spaces, tabs, non-breaking spaces) **before** the shape check, in the one core normaliser the form uses (add one if the form does it inline); unit tests with "UDYAM-WB-01-0012345" pasted as "UDYAM - WB - 01 - 0012345", with a tab, with U+00A0. This is input cleaning, no new wording.
   - (c) the duplicate PNG builder in `apps/admin/e2e/sample-data.ts:70-100`: reuse the existing PNG builder (find it: probably a test helper in admin worker tests or `packages/*/test`); if the only other copy lives in a test file that e2e can't import, move it to one shared test-support module both import. No change to the bytes produced (pin with a test or a hash comparison).
6. **M4.5 decline reasons:** one shared list of the 07-N §3 decline reasons (codes and their approved labels, word for word as they are now) in `@techaust/core` (likely `offers.ts`), used by admin (`apps/admin/src/lib/offers.ts`, `offer-words.ts`, `documents.ts`, `audit.ts` as applicable), portal (`apps/portal/src/components/decision/…`), jobs (`apps/jobs/src/offers.ts`) and the message schema (`packages/core/src/schemas/messages.ts`). Visible text must stay identical (a test that pins each label). Mind the portal byte ceiling (120,000; main 104,589): import from a subpath that doesn't drag more of core in, and report the portal bytes.

(Item 5 is the analyst's, below; its real findings may become a builder r2.)

**Done for r1 means:** each item committed separately (conventional commits, the footer from the session prompt), `bash tools/heavy.sh --log check pnpm check` green, the touched packages' tests green, `pnpm test` once green, the builds' Worker bytes (admin front, admin API, admin finance, portal, jobs), and a report appended to this file under "Builder report r1": per item what changed, the file list, commands and results, what wasn't verified, and the skills loaded (Cloudflare skills don't load in cloud sessions: say so).

### Analyst: verify the unchecked code-review candidates (item 5, read-only, in parallel with r1)
- **M5.4:** the code-review helper of the M5.5b review looked at `main`'s M5.4 by mistake and its 10 candidates **were never written down** (only the files: `care-billing.ts`, `reminders.ts`, `invoice-send.ts`, `document-links.ts`, `overview.tsx`, `billing.ts`; [runs/m5.5b-exports-statement](m5.5b-exports-statement.md) line 382). So: a focused correctness pass (load `code-review` as the recipe) over those files on `origin/main` (admin `worker/care-billing.ts`, `worker/invoice-send.ts`, `worker/document-links.ts`, the SPA `overview.tsx` that shows sends/reminders, db `src/billing.ts`, jobs `src/reminders.ts` and `src/invoice-send.ts`), with the M5.4 review's fixed findings (H1, M1, M2, L1–L8 in [runs/m5.4](m5.4-send-recurring-reminders.md)) as already known. Report only verified defects, each: file:line, the failure in one concrete scenario, severity, and whether the fix is small and outside the out-of-bounds list above.
- **T6:** `packages/pdf/src/view.ts:212` (old envelopes get the new "(IST)" and "replaces" text?), `apps/admin/src/lib/offers.ts:151`, `apps/admin/src/routes/invoices/send-parts.tsx:112` (a hand-written first-word split; core `firstNameOf` exists; [runs/t6](t6-terms-offers.md) line 208 lists five more such splits). For each: real or not, with evidence.
- Deliverable: the reply to the lead (the lead pastes it under "Item 5: candidate check").

## Item 5: candidate check
_Pasted by the lead from the analyst's reply (Opus 5.5 high, read-only, 2026-11-01). Base `fix/test-hardening` ca682a9 = main 474ec9c + the run file; no in-scope file differs from main. Verified by reading code, SQL, callers, triggers and tests; no test run. The lead re-read #1 (`apps/jobs/src/invoice-send.ts:50-54`, admin `invoice-send.ts:210-218`) and confirms it._

**The code-review helper's 10 candidates (re-run on main): 4 confirmed, 6 dropped.**

| # | file:line | Failing scenario | Sev. | Fix (all in bounds, no migration) |
|---|---|---|---|---|
| 1 | jobs `invoice-send.ts:50-54` `LINK_SQL`; admin `invoice-send.ts:210-218` | `invoice.send` mints token A, `EMAIL_QUEUE.send` throws, the message retries in 60 s; meanwhile staff "Revoke links": A is revoked but the send isn't cancelled (the cancel only takes sends without a token); the retry's `LINK_SQL` checks only `s.cancelled_at IS NULL`, mints a **live** token B and emails a working 180-day link after the revoke. A plain redelivery after a successful run mints an un-emailed live B that still counts in `LIVE_LINKS_SQL` ("1 live link" after a revoke). Same pattern for offers: jobs `offers.ts:181-185` with admin `document-links.ts:207`. The comment at admin :210-211 is wrong for this path. | medium | `LINK_SQL` gains `AND NOT EXISTS (SELECT 1 FROM doc_access_tokens r WHERE r.document_id = d.id AND r.send_id = s.id AND r.revoked_at IS NOT NULL)` (indexed by `document_id`); the same on `offer_links` in jobs `offers.ts`; the existing refusal path then `markNotSent`. Fix the three comments. Test: mint, revoke, redeliver → refused, send cancelled, no live token (invoice and offer). |
| 2 | jobs `reminders.ts:97-98` `GIVE_BACK_SQL`, :204-209; admin `invoice-send.ts:224-228` | Claim commits (links minted), revoke commits before `sendBatch` (links revoked; the pause skips claimed rows), `sendBatch` throws, give-back makes the row waiting (not paused), the retry emails fresh live links after the revoke and pause. | low | Give-back sets `skipped_reason = 'paused'` when a token of the document was revoked at or after the claim (`reminders_fixed` 0044 allows both moves in one UPDATE). Test beside `reminders.test.ts:397`. |
| 3 | admin `care-billing.ts:759` (comment :515) | `enqueuePdf` never throws (returns false; `document-events.ts:86-98`) and the result is ignored, so a failed `PDF_QUEUE.send` at the 06:00 IST care issue leaves the invoice frozen with its `auto` sends waiting for the 03:30 IST sweep: emailed about a day late while the bell already says "issued and emailed". The comment "awaited: the jobs Worker retries" is false. | low | On `false` throw so `care.issue` retries; in the `already_issued` branch (:526) enqueue again when `pdf_sha256` is null. Test both. |
| 4 | admin `care-billing.ts:404-423` (comment :501) | Statements 1 (move `last_billed_period`) and 2 (insert `care_invoices`) have no anonymised-client guard (only the draft does). A client erased between the read and write batches leaves the period marked billed and `care_invoices.document_id` naming a document never inserted (no FK), answered `already_billed`, no audit row; the comment says "Nothing was written". | low | Statement 1 gains `AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = care_plans.client_id AND z.anonymised_at IS NOT NULL)`; statement 2 already hangs on `changes()`. Test with the client anonymised between the batches (DB proxy, as M1's test). |

**Dropped (helper candidates a–f and the analyst's own):** (a) `queued_at` stamped when `LINK_SQL` wrote nothing: `markNotSent` cancels and `sendState` reads `cancelledAt` first, no visible effect; (b) `REMINDERS_OF_SQL LIMIT 20`: Settings allow ≤ 8 offsets, a client policy ≤ 10; (c) `VALID_INVOICE_RECIPIENTS_SQL` via `.replace`: maintainability, pinned by the H1 tests; (d) claim/facts subqueries written twice in `billing.ts`: pinned by the twin test `billing-sql.test.ts:329`; (e) the resend route rebuilds helpers: quality only; (f) `processReminderScan` two sequential reads: one extra round trip an hour. Also: the care "issued and emailed" bell is the approved 07-U line (M1's area); `document-links.ts:197` unreachable `NOT_A_QUOTE` branch (harmless); `document-links.ts:91` stale `?2 today` comment; admin revoke's cancel subquery `t.send_id = document_sends.id` has no index on `send_id` (adding `t.document_id = ?1 AND` makes it indexed; not checked with EXPLAIN); concurrent first sends can't duplicate reminders (`INSERT OR IGNORE`). `overview.tsx` (`apps/admin/src/routes/clients/overview.tsx`, reminder policy and the care switch): nothing.

**T6 candidates:**
- `packages/pdf/src/view.ts` (now ~:115-116, :207-214): **real, staging-only, no fix.** "(IST)" and "replaces version N" are computed at render, not frozen; the portal re-runs `toPdfView` on every view (`apps/portal/worker/viewer.ts:15`), so a pre-#130 offer shows both lines on screen but not in its write-once PDF (and a pre-#130 envelope first rendered after #130 prints them). Both lines are true to the frozen facts (version frozen; validity always IST). Nothing is live before L8. Matches the T6 follow-up already kept.
- `apps/admin/src/lib/offers.ts:151`: **not real.** The preview uses `firstNameOf` (`documents/send-dialog.tsx:92`) and the same `validityDateIst`/`offerReplacesLine` as the email; `offers.test.ts:153-156` keeps them equal.
- `send-parts.tsx:112` and the five other first-word splits (t6 line 208): **no wrong greeting possible**: every stored name is trimmed on write (staff `packages/auth/src/schemas.ts:13`; contacts and leads admin `http.ts:23` `text()`; form leads `fields.ts:19,44`, re-parsed in jobs `leads.ts:182`), and for a trimmed string `split(/\s+/)[0]` equals `firstNameOf`. `jobs/invoice-mail.ts:46` does trim (the T6 note miscounted it). Moving them onto `firstNameOf` is optional cleanup with no output change.

**Skills:** `code-review` (recipe; its read-only helper re-reviewed the six files and returned 10 unverified candidates, each verified by the analyst); `security-review` not loaded (no diff yet; the reviewer loads it for the r2 revoke fixes); Cloudflare skills don't load in cloud sessions.

**Lead triage:** #1–#4 are fixed in this task by builder r2 after r1 (r1 also edits jobs `offers.ts` for item 6, so they run in sequence). The six first-word splits move onto `firstNameOf` in r2 too (no output change; trimmed input proven above), and the admin revoke's cancel subquery gains `t.document_id = ?1 AND` (index), with the stale comments fixed.

### Builder r2 brief (branch `fix/test-hardening-r2` from `origin/fix/test-hardening` after r1 is merged; starts when r1 reports)
The four verified defects of "Item 5" (#1–#4, fixes as in its table, each with its test), plus:
- the admin revoke's cancel subquery `t.send_id = document_sends.id` (admin `invoice-send.ts` revoke, and the offer twin in `document-links.ts` if it has the same shape) gains `t.document_id = ?1 AND` so it uses `doc_access_tokens_document`; fix the stale comments named in Item 5 (`invoice-send.ts:210-211`, `care-billing.ts:501`, `:515`, `document-links.ts:91`);
- `apps/portal/src/components/decision/decline-dialog.tsx:13` (or wherever `NOTE_MAX = 500` sits) reads core `DECLINE_NOTE_MAX` (r1's note);
- the six hand-written first-word splits (`send-parts.tsx:112`, admin `leads.ts:836`, `email-fixtures.ts:45`, jobs `invoice-mail.ts:46`, `leads.ts:93`, `staff-alerts.ts:94`) use core `firstNameOf`; output unchanged (the existing email/preview tests must pass untouched); watch the portal/jobs bytes.
Same rules as r1 (out-of-bounds list, no migration, no wording change, heavy queue). Done: each fix committed with its test, `pnpm check` and `pnpm test` green, Worker bytes, report under "Builder report r2".

## Builder report r1
_Builder r1 (Opus 5.5 high, cloud session, 2026-11-01). Branch `fix/test-hardening-r1`. It was cut from ca682a9 and has 3d24fd4 merged in (the lead's Item 5 and r2 brief, docs only)._

**Skills.** I tried to load `cloudflare:workers-best-practices`, `cloudflare:wrangler` and `cloudflare:turnstile-spin`. None loaded ("Unknown skill"), because Cloudflare skills don't load in cloud sessions. `cloudflare:cloudflare` was not tried, since it is the same plugin. `code-review` and `security-review` belong to the reviewer. Context7 tools were not available in this agent (there is no ToolSearch). The Turnstile behaviour that item 1a relies on (the hidden `cf-turnstile-response` input) was therefore taken from the code and from a stubbed run.

### Per item
**1a. Web e2e `forms.spec.ts`, the contact form (83b97d3, d6d553f)**
- **Cause, reproduced here.** The page script (`apps/web/src/scripts/forms.ts` `getToken`) waits at most 20 s for a Turnstile token. After that it shows the generic error and does not post. The test pressed Enter as soon as the button had focus.
- **The reproduction.** I added a temporary spec (deleted, never committed) with a Turnstile stub whose token arrives after 25 s:
  - with the old test: "after 40052 ms: TIMEOUT page.waitForURL: Timeout 40000ms exceeded.; POSTs: []" and the generic status line. This is main's failure exactly.
  - with the new wait: "token after 25336 ms; POST answered 400". The 400 is only because the Worker's siteverify can't resolve challenges.cloudflare.com here.
- **Not a page bug.** The 20 s cap is designed; production is unchanged.
- **The fix, in the test only.** A new `readyToSubmit` waits for two things:
  - the script to take over the form. Its first act is `form.noValidate = true`, in the same run that adds the submit handler, and the HTML has no `novalidate`. `data-ready` is set on the quote form only.
  - the widget's hidden `cf-turnstile-response` input to hold a value, with a 30 s limit and a message that names challenges.cloudflare.com.
- **The submit.** A new `submitAndLand` waits for the POST, so a refusal shows its status, then waits for /thanks.
- The quote test has the same pattern and got the same two waits. Both submitting tests have `test.setTimeout(90_000)` (commented). Keyboard only; still two submissions.
- **The three runs** (`th-web-e2e-run1`, `-run2`, `-run3`, back to back): each gave **209 passed, 1 failed, 2 did not run** (5.1, 5.1 and 5.0 min).
  - The one failure is always the contact test, on the new wait: "Turnstile gave no token (is https://challenges.cloudflare.com reachable from the browser?)". The rest of that serial file did not run.
  - The reason is this session's network: curl to challenges.cloudflare.com gets "CONNECT tunnel failed, response 403", and workerd's siteverify gets "DNS lookup failed". **So the form tests can't pass in any cloud session, before or after this change.** They need a PC or CI run.

**1b. Admin `leads-api.test.ts` "a stale page is a 409…" (8f62105)**
- The two saves now run under a fake `Date`: the first at `lead.updated_at + 1`, the second at `+ 2`, restored in `finally` (the `TA_TEST_CLOCK` shift stays intact).
- **Proof of the cause:** with both saves pinned at `lead.updated_at`, the test fails with `expected [200, 200] to deeply equal [200, 409]`, the flake exactly. With the fix: 33/33 pass.
- **Production has the same weakness. Not changed, by the brief.** See "For the analyst" 1.

**2. Slow tests (8249f69).** Single-file times, before and after:

| Test | Before | After | What changed |
|---|---|---|---|
| portal `scope.test.ts` "the spy sees the schema's client_id tables" | 65 ms | 3 ms | `tablesWithClientId` (`worker/test-helpers.ts`) is one statement (`EXISTS … pragma_table_info(m.name)`) instead of about 80 round trips |
| the same file's 27 SQL-spy route tests (same helper) | 65 to 75 ms each | about 14 ms each | |
| admin `dashboard-stress` "reads at most 6,300 rows…" | 349 / 399 ms (fixture included) | 186 / 241 ms | the 6,700-row fixture moved into `beforeAll` |
| admin `dashboard-stress` "local CPU proxy" | 216 / 247 ms | 213 / 301 ms | none (inherently heavy) |
| admin `invoice-send` "each send names the staff member…" | 41 ms | 40 / 49 ms | the named owner issues and sends (one session, not two) |

- **Portal cross-check:** a temporary test (deleted) compared the old per-table list with the new one. They are equal.
- **dashboard-stress:** the hook and all three tests carry a commented 30 s limit (`HEAVY_MS`).
- **invoice-send:** its cost is the issue chain the test needs. There was nothing more to cut without changing what it proves, so it has no extra timeout.
- **Honest note:** the 5 s timeouts came from CPU starvation under `pnpm -r test`. One green `pnpm test` (below) does not prove the flake is gone.

**3. Realisation bounds (dd8141b)**
- New `packages/core/src/realisation-bounds.ts` holds `REALISATION_MIN_MONTHS` 1, `REALISATION_MAX_MONTHS` 1200, `REALISATION_MIN_DAYS` 0 and `REALISATION_MAX_DAYS` 36_500. It has no imports and is exported through `@techaust/core/invoices`.
- Readers now using it:
  - `schemas/settings.ts`
  - `export-invoice.ts` `realisationParamsFromStoredTax`
  - `gst/realisation.ts` `rulesAreValid`, including `approachingDays`
  - the admin SPA `src/lib/tax-settings.ts`, which held its own copy
- Messages are unchanged and still pinned by `reports.test.ts`.
- `inrMonths` keeps its own 1 to 120 in the schema and the form (the reader keeps 1 to 1,200 as before).
- `packages/db/src/realisation.ts` has no copy.
- The GST structure test's allow-list gains `../realisation-bounds.ts`.
- New tests pin the constants, the re-export and the edges of `rulesAreValid`.

**4a. One must-be-signed list (76e898a)**
- `SIGNED_ALWAYS_TYPES`, a new `SIGNED_ADVANCE_TYPES` (`tax_invoice`, `export_invoice`) and `signatureRequired` moved to `packages/core/src/signature-rule.ts`, still exported through `@techaust/core/invoices`.
- Readers:
  - core's note blockers now ask `signatureRequired(noteTypeOf(kind), false)` instead of assuming "a note always".
  - admin `invoice-model.ts` `issuerOf` and `@techaust/pdf` `requiresSignature`, which jobs `pdf.ts` uses through `signatureMissing`, already used core.
  - `db/src/sql-rules.ts` `signedIssuerSql` holds no type list.
- **Out of bounds, listed:**
  - `db/src/triggers.ts` holds the pinned `SIGNED_ALWAYS_TYPES_0055` and the literal advance pair of the 0055 trigger. `signature-triggers.test.ts` now also pins that advance clause to `SIGNED_ADVANCE_TYPES`.
  - `db/src/issue.ts` holds **no type list**. It applies `SIGNED_FREEZE_SQL` by code path (the note and advance freezes), and the "note freeze WHERE holds the signature" tests cover that SQL. No test can prove that `issue.ts` picks its paths from core's list, because the choice is structural.

**4b. Inner spaces in a pasted Udyam number (2a3a47e)**
- Core `normaliseUdyamNumber` (`udyam.ts`): `typed.replace(/\s+/gu, "").toUpperCase()`. It drops spaces, tabs, newlines, U+00A0 and the other Unicode spaces.
- The admin form's `normaliseUdyam` is now core's; `company.tsx` is untouched. The shape check and its error are unchanged.
- Tests (core `settings.test.ts`, admin `udyam.test.ts`):
  - "UDYAM - WB - 01 - 0012345", a tab, U+00A0, a thin space and an ideographic space all normalise and pass the shape check.
  - a blank paste becomes "".
  - other wrong shapes stay wrong.

**4c. The duplicate PNG builder (8a54dbf)**
- The encoder copied in `apps/admin/e2e/sample-data.ts` and `packages/pdf/test/fixtures/invoice-layout.ts` is now `packages/testing/src/png.ts`: pure, no Node imports, and the caller passes its own `deflate`.
- Both import it by relative path, like `csrf-corpus.ts`. No workspace dependency was added, so the lockfile is unchanged. `packages/testing/tsconfig.json` gains `allowImportingTsExtensions`.
- The drawings stay where they were.
- **Bytes unchanged** (SHA-256 before and after):
  - admin e2e: `289eba30…98b0ce`, 679 bytes.
  - PDF fixture: `5fe5e20a…052217`, 896 bytes, now pinned by `packages/pdf/test/sample-signature.test.ts`.
- New encoder tests in `packages/testing/test/png.test.ts`.

**6. Decline reasons (7727681)**
- `DECLINE_REASON_LABELS` in `@techaust/core/offers` holds the 07-N §3 words, word for word, in the order of `DECLINE_REASONS`, typed `satisfies Record<DeclineReason, string>`.
- Readers:
  - admin `src/lib/offer-words.ts` (`reasonText`)
  - portal `src/copy-documents.ts` (`N.reasons`; the dialog component is untouched)
  - jobs `src/offers.ts` (`DECLINE_WORDS`)
- `LOST_REASON_OF_DECLINE` is now typed `satisfies Record<DeclineReason, LostReason>`.
- **No message schema change.** `schemas/messages.ts` carries no reason (`offer.decided` sends only the id and the decision). Admin `documents.ts` and `audit.ts` hold no copy.
- **Labels pinned** in core, admin and portal tests. Jobs' decline test already pins one.
- **Portal Worker: 104,589 bytes, the same as main.**

### Files changed
- **core:**
  - `src/realisation-bounds.ts` (new), `src/signature-rule.ts` (new)
  - `src/schemas/settings.ts`, `src/export-invoice.ts`, `src/gst/realisation.ts`, `src/invoices.ts`, `src/notes.ts`, `src/udyam.ts`, `src/offers.ts`, `src/lead-lifecycle.ts`
  - tests: `realisation-bounds`, `gst/structure`, `invoice-types`, `settings`, `offers`
- **db:** `test/signature-triggers.test.ts`
- **pdf:** `test/fixtures/invoice-layout.ts`, `test/sample-signature.test.ts` (new)
- **testing:** `src/png.ts` (new), `test/png.test.ts` (new), `tsconfig.json`
- **admin:**
  - `src/lib/tax-settings.ts`, `src/lib/udyam.ts`, `src/lib/udyam.test.ts`, `src/lib/offer-words.ts`, `src/lib/offers.test.ts`
  - `worker/leads-api.test.ts`, `worker/dashboard-stress.test.ts`, `worker/invoice-send.test.ts`
  - `e2e/sample-data.ts`
- **portal:** `src/copy-documents.ts`, `src/lib/offers.test.ts`, `worker/test-helpers.ts`
- **jobs:** `src/offers.ts`
- **web:** `e2e/forms.spec.ts`
- No migration, workflow, wording change or out-of-bounds file.

### Commands and results
- **While working:** single test files for core, admin, portal, jobs, db (`signature-triggers`), pdf and testing; `pnpm exec biome check <changed files>` at each commit. All green.
- `bash tools/heavy.sh --log th-web-build pnpm --filter @techaust/web build`: exit 0.
- **Web e2e** (`th-web-e2e-1`, `th-web-forms`, `th-web-repro`, then `th-web-e2e-run1` to `-run3`): as under 1a, 209 passed on every full run.
- `bash tools/heavy.sh --log th-build pnpm build`: exit 0. **Worker bytes:**

| Worker | Bytes | Limit | Startup (fastest of 7) |
|---|---|---|---|
| admin front | 100,839 | 150,000 | 12.3 ms |
| admin API | 438,064 | 800,000 | 47.9 ms |
| admin finance | 507,948 | 800,000 | 47.9 ms |
| portal | 104,589 | 120,000 | 11.7 ms |
| jobs | 667,889 | 1,000,000 | 72.5 ms |

- `bash tools/heavy.sh --log th-test pnpm test`: exit 0. **9,518 passed, 2 skipped, 0 failed.**

| Package | Passed |
|---|---|
| testing | 4 |
| auth | 135 |
| ui | 471 (+2 skipped) |
| core | 1,956 (coverage gate passed) |
| email | 132 |
| db | 623 |
| pdf | 380 |
| web | 767 |
| portal | 680 |
| jobs | 560 |
| admin | 3,810 |

- `bash tools/heavy.sh --log th-check pnpm check`: exit 0, the final full check. Lint checked 1,443 files with no fixes; typecheck and every guard passed.
- Every dev server was stopped by Playwright. Only the session's own `playwright-mcp` remains.

### Not verified
- **The form submissions of 1a in a session that reaches Cloudflare.** Here the new wait is proven only against a stub. Run the web e2e on the PC or in CI (after `pnpm --filter @techaust/web build`).
- That item 2 removes the timeouts under a starved full run. One `pnpm test` passed with no timeout; the flake can't be forced.
- Worker bytes against main, except the portal (unchanged at 104,589).
- The merge commit 0dffdec has git's default message, without the footer. It was pushed before I noticed, and fixing it would need a force-push.

### For the analyst
1. **Production has the same-millisecond weakness of 1b.**
   - Where: `apps/admin/worker/leads.ts:721` (`const t = Date.now()`) and `:727` (`… updated_at = ?3 … WHERE id = ?1 AND updated_at = ?2`).
   - A save in the same millisecond as the row's previous write rewrites the same `updated_at`, so a second save from that stale page also passes. A clock behind the stored value can move `updated_at` backwards.
   - The existing safe pattern is `Math.max(Date.now(), row.updated_at + 1)` or SQL `max(?t, updated_at + 1)` (`document-write.ts:52`, `care.ts:539`, `document-send.ts:127`).
   - A heuristic scan finds the same plain `Date.now()` stale check in these places. I did not verify them one by one:
     - `catalogue.ts:518`
     - `clients.ts:668`, `:779`, `:1133`
     - `invoice-notes.ts:579`
     - `notes.ts:159`
     - `settings.ts:972`
2. **`apps/portal/src/components/decision/decline-dialog.tsx:13`** keeps its own `NOTE_MAX = 500` (core `DECLINE_NOTE_MAX`). It is a component (the designer's) and not the reasons list, so I left it.

### Open questions
None.

## Builder report r2
_Builder r2 (Opus 5.5 high, cloud session, 2026-11-01). Branch `fix/test-hardening-r2` from `origin/fix/test-hardening` 9b26707; f4ef3fa (the early check) merged in before this report. Scope: Item 5 #1–#4, the r2 brief's extras, and the lead's message (early check M1, L1–L3, stale-check E)._

**Skills.** Tried `cloudflare:workers-best-practices`: "Unknown skill" (Cloudflare skills don't load in cloud sessions), so `cloudflare:wrangler` was not tried (same plugin). `code-review` and `security-review` belong to the reviewer. No Context7 in this agent; nothing here needed library docs beyond the code itself.

### Per fix
Every fix's test was run against the code **without** the fix (the source file reverted, the test kept) and failed as stated; then the fix went back and it passed.

**#1 No live link after "Revoke links" for a send that already had one (75589bf).**
- jobs `invoice-send.ts` `LINK_SQL` gains `AND NOT EXISTS (SELECT 1 FROM doc_access_tokens r WHERE r.document_id = d.id AND r.send_id = s.id AND r.revoked_at IS NOT NULL)` (no new `?n`); jobs `offers.ts` the same on `offer_links` (`r.send_id = s.id`, index `offer_links_send`). The existing refusal path then marks the send not sent.
- admin `invoice-send.ts`: the revoke's cancel is now `cancelUnlinkedSendsSql(guard)` with `t.document_id = ?1 AND t.send_id = …` (same `?1`, same arity), so it SEARCHes `doc_access_tokens_document`. Comments fixed: admin `invoice-send.ts` revoke, `document-links.ts` revoke and `OPEN_LATEST` (the stale `?2 today`), and the jobs headers.
- Tests: jobs `invoice-send.test.ts` (queue fails after the mint → revoke → retry is `refused`, no email, no live token, `cancelled_at` set; a redelivery after a sent email and a revoke mints no live link; another send of the same document still goes), jobs `offers.test.ts` (the first two for offers), admin `invoice-send.test.ts` (EXPLAIN QUERY PLAN: `SEARCH t USING INDEX doc_access_tokens_document`, no SCAN).
- Without the fix: invoice and offer tests "expected 'queued' to be 'refused'" (2 + 2); the EXPLAIN test failed with the plan lacking the index search.

**#2 A reminder claim given back after a revoke goes back paused (ddb1480).**
- jobs `reminders.ts` `GIVE_BACK_SQL` also sets `skipped_reason = 'paused'` when a link of the document was revoked at or after the claim (`revoked_at >= ?2`) **or** one of this claim's own links was revoked (`token_hash IN json_each(?3)`, `?3` the claim's hashes). The second arm catches a revoke whose clock read came before the claim's but whose batch committed after it. `reminders_fixed` (0044) allows both moves in one UPDATE (proven by the test).
- Tests (`reminders.test.ts`, beside the queue-down give-back test): both orderings → the row is `{sent_at: null, skipped_reason: 'paused'}`, the redelivery is `already`, nothing queued; a link revoked **before** the claim leaves the give-back waiting.
- Without the fix: both ordering tests failed; with only the time arm, the "slow revoke" case failed.

**#3 A care invoice whose PDF request failed is retried (8b70ee4).**
- admin `care-billing.ts`: `requestPdf` throws `PDF_QUEUE_UNREACHABLE` when `enqueuePdf` returns false, so `care.issue` is retried; the `already_issued` branch asks again for a care invoice (system-made, frozen, not void) with no `pdf_sha256`. The false comment is corrected.
- Test (`care-billing.test.ts`): queue down → the call rejects, the invoice is frozen; the retry answers `already_issued` and enqueues one `pdf.snapshot`; still down → throws again; once the PDF exists, a redelivery enqueues nothing.
- Without the fix: "promise resolved { result: 'issued' } instead of rejecting"; with the throw but without the re-ask: "expected [] to deeply equal [Array(1)]".

**#4 A care period is not marked billed for a client anonymised mid-draft (0330b2a).**
- admin `care-billing.ts` statement 1 gains `AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = care_plans.client_id AND z.anonymised_at IS NOT NULL)`; statement 2 already hangs on `changes()`.
- Test (`care-billing.test.ts`, a DB proxy anonymising the client before the write batch): `skipped`/`changed`, `last_billed_period` unchanged, no `care_invoices` row, no document, no `care_invoice.draft` audit row.
- Without the fix: "expected { result: 'already_billed' } to match { result: 'skipped', why: 'changed' }".

**Decline note limit (d2bef81).** `decline-dialog.tsx` imports core `DECLINE_NOTE_MAX` for `maxLength` (same 500). A refactor: no test can fail without it; typecheck and the portal tests pass.

**First-name splits (ece69e8).** The six splits (`send-parts.tsx`, admin `leads.ts`, `email-fixtures.ts`, jobs `invoice-mail.ts` `firstName`, `leads.ts`, `staff-alerts.ts`) call `firstNameOf` from `@techaust/core/offers`, which both Worker bundles already contained. Output unchanged; the existing email and preview tests pass untouched.

**Lead's message:**
- **A / M1 (1c17126):** `issued(2)` has its own owner again (the `as` parameter is gone); the named owner only sends.
- **B / L1 (ea2f615):** the bounds comment says "through `@techaust/core/invoices`; the GST core imports the file directly". No gst export.
- **C / L2 (5666c45, 4936f04):** the admin e2e PNG is pinned (679 bytes, SHA-256 `289eba305785b8213befc0c32b9b534cf3b8a96063f97ba81153e1922798b0ce`) in `apps/admin/worker/e2e-sample-signature.test.ts`. The worker tsconfig has no Node types, so the drawing moved into `apps/admin/e2e/sample-signature.ts` (no Node imports; the caller passes the deflate): `sample-data.ts` passes Node's `deflateSync`, the test passes `CompressionStream("deflate")`. Both give the pinned bytes (Node checked by hand, workerd by the test); a one-byte colour change fails the pin. The PDF fixture comment names `packages/pdf/test/sample-signature.test.ts`.
- **D / L3 (4c68e9d):** both assertions carry the message "… if Node or its zlib changed (not the drawing or the encoder), check the PDF visual baselines, then re-pin".
- **E / stale check (1c8fa09), production change approved by the lead:**
  - house pattern `Math.max(Date.now(), expected + 1)` at admin `leads.ts` (lead save), `catalogue.ts` (item save), `clients.ts` (client save, billing save, contact save) and `settings.ts` (bank: `(existing?.updated_at ?? 0) + 1`).
  - billing: `now` is the real clock for `stepUpActive` and for the in-SQL authority, which now binds it as its own parameter `?${setVals.length + 5}` after the session id (`?${setVals.length + 4}`), instead of `?3`.
  - contact: only the main statement and the answer use the new `version`; the consent stamp, the other primary's reset and `revokeContactAccess` keep the real `t`.
  - Tests: each pins `Date` to the row's stored `updated_at` → the first save answers `updatedAt = stored + 1`, the second from the same page is 409 `stale_version` (leads beside r1's test; catalogue; clients ×4 including turning the automatic issue on with step-up; settings bank). Without the fixes all 7 failed; with them 249 tests in the 7 related files pass (care-billing and care included).

### Files changed
- **jobs:** `src/invoice-send.ts`, `src/offers.ts`, `src/reminders.ts`, `src/invoice-mail.ts`, `src/leads.ts`, `src/staff-alerts.ts`; tests `invoice-send`, `offers`, `reminders`.
- **admin worker:** `invoice-send.ts`, `document-links.ts`, `care-billing.ts`, `leads.ts`, `email-fixtures.ts`, `catalogue.ts`, `clients.ts`, `settings.ts`; tests `invoice-send`, `care-billing`, `leads-api`, `catalogue`, `clients`, `settings`, `e2e-sample-signature` (new).
- **admin SPA and e2e:** `src/routes/invoices/send-parts.tsx`; `e2e/sample-data.ts`, `e2e/sample-signature.ts` (new).
- **portal:** `src/components/decision/decline-dialog.tsx`.
- **core:** `src/realisation-bounds.ts` (comment). **pdf:** `test/fixtures/invoice-layout.ts` (comment), `test/sample-signature.test.ts`.
- No migration, workflow, wording change or out-of-bounds file.

### Commands and results
- While working: single test files in jobs, admin and pdf; `pnpm exec biome check <changed files>` before each commit; each fails-without run as above.
- `bash tools/heavy.sh --log r2-admin-tc pnpm --filter @techaust/admin typecheck`: exit 0 (after the first `pnpm check` failed on the pin test importing `sample-data.ts`, fixed by 4936f04).
- `bash tools/heavy.sh --log r2-check pnpm check`: **exit 0**. Lint checked 1,445 files, no fixes (10 warnings and 8 infos, all in files this run didn't touch); typecheck and every guard passed.
- `bash tools/heavy.sh --log r2-test pnpm test`: **exit 0. 9,520 passed, 19 skipped, 0 failed**: testing 4, auth 135, ui 471 (+2 skipped), core 1,956, email 132, db 623, pdf 380, web 750 (+17 skipped: no `apps/web/dist` yet in this worktree), portal 680, jobs 568, admin 3,821.
- `bash tools/heavy.sh --log r2-web-test pnpm --filter @techaust/web test` after the build: 767 passed.
- `bash tools/heavy.sh --log r2-build pnpm build`: exit 0. **Worker bytes** (r1 in brackets):

| Worker | Bytes | Limit | Startup (fastest of 7) |
|---|---|---|---|
| admin front | 100,839 (100,839) | 150,000 | 14.4 ms |
| admin API | 438,280 (438,064) | 800,000 | 53.2 ms |
| admin finance | 508,291 (507,948) | 800,000 | 47.4 ms |
| portal | 104,589 (104,589) | 120,000 | 13.3 ms |
| jobs | 668,343 (667,889) | 1,000,000 | 114.8 ms |

- `bash tools/heavy.sh --log r2-lint pnpm lint` (whole repository, once, the final check): exit 0, 1,445 files, no fixes (the same 10 warnings and 8 infos in untouched files).
- No dev server was started.

### Not verified
- The revoke races of #1 and #2 are simulated in tests (the revoke's statements run by hand at the right moment); the real two-Worker interleaving was not exercised.
- `CompressionStream("deflate")` matching Node's `deflateSync` holds for this drawing on today's workerd; the pin says what to check if it ever drifts.
- The first-name refactor relies on stored names being trimmed (Item 5's evidence); `email-fixtures.ts` and jobs `leads.ts` did not trim before and `firstNameOf` does, which changes nothing for trimmed input.

### For the lead
- **#1 edge, not changed:** a plain redelivery of an `invoice.send`/`offer.send` that had already emailed, arriving after "Revoke links", is now refused and marks the send not sent, so its row reads "Cancelled" instead of "Sent". This is the existing behaviour of every other refusal path (lost access, void) on a redelivery; it needs a lost acknowledgement and a revoke in between. Keeping it "Sent" would need `markNotSent` to skip a send with an `email_log` row (a small change, not made without a decision).
- **#2 edge:** a "Resume reminders" between the revoke and the failed `sendBatch` doesn't reach the claimed row, so it comes back paused and needs a second resume.

### Open questions
None.

## Early check (analyst)
_Pasted by the lead from the analyst's reply (Opus 5.5 high, read-only, 2026-11-01). Range `474ec9c..9b26707` without docs/runs._

**CHANGE** (one medium, three low; no production defect). Production refactors are behaviour-identical: realisation bounds (1–1,200 months, 0–36,500 days incl. `approachingDays`; `inrMonths` 1–120 in schema and form, as before; messages unchanged), the signature rule (`noteTypeOf` only returns note types, so the same documents are blocked; no list outside out-of-bounds `db/triggers.ts`, pinned for both clauses), decline labels byte-identical to the three old copies and 07-N line 43, the Udyam normaliser (stored value canonical, server still refines with `isUdyamNumber`; whitespace removal can't invent another number), the PNG encoder (same bytes; PDF SHA pinned). `packages/testing` is imported only by admin e2e and pdf test fixtures (precedent `packages/auth/test/csrf-corpus.ts`), never bundled. Test changes keep their claims (leads fake clock coexists with `TA_TEST_CLOCK`; dashboard fixture unchanged; portal `tablesWithClientId` equivalent; web e2e stronger: asserts the POST's 200 before /thanks).

| # | file:line | Finding | Sev. | Fix |
|---|---|---|---|---|
| M1 | admin `invoice-send.test.ts:332-335` (`issued(…, as?)` :22-27) | The named owner now issues **and** sends, so a regression taking `sent_by_name` from the issuer would pass; no time saved (41 → 40/49 ms) | medium | revert to `issued(2)` with its own owner, then send as `s` |
| L1 | core `realisation-bounds.ts:5` | comment claims a `@techaust/core/gst` export that doesn't exist | low | fix the comment; no gst export (SPA-only) |
| L2 | admin e2e `sample-data.ts:84`, pdf `fixtures/invoice-layout.ts:454` | comments say `png.test.ts` pins the bytes; it doesn't (PDF pinned in `sample-signature.test.ts`; admin PNG pinned nowhere) | low | correct; optionally pin the admin PNG |
| L3 | pdf `sample-signature.test.ts:10-13` | the pin includes `node:zlib` output; Node 24 → 26 may change it with a bare hash failure | low | an assertion message: check visual baselines, then re-pin |

**Stale-check verdict:** real in theory (clock skew or same-ms writes; `Date.now()` in Workers moves only with I/O, and a stale page needs a round trip after the write), practically unreachable; low; cheap to fix. No trigger reads `updated_at`. Fix sites (in bounds): admin `leads.ts:721`, `catalogue.ts:511`, `clients.ts:659`, `:753` (billing: `?3` doubles as step-up "now"), `:1070` (contact), `settings.ts:967` (bank). Already safe: `notes.ts:159`, `invoice-notes.ts:579`/`:686` (the builder's list was wrong on these two), `time-logs.ts:613`, `care.ts:539`/`:606`, `document-write.ts:52`, `document-send.ts:127`, `invoice-withdraw.ts:149`, `care-billing.ts:569`, and the out-of-bounds `projects.ts`, `invoices.ts`, `invoice-issue.ts`, `payment-ledger.ts`, `invoice-advance.ts`. Follow-up (low): writers that stamp a stale-checked row with a bare `Date.now()` and no check of their own (leads stage `leads.ts:797`, convert `:1039`, `documents.ts:384`, contacts `clients.ts:909`, `:1126`, `:1484`) could use SQL `max(?n, updated_at + 1)`; optionally a guard test.

**Helper candidates (9):** 4 kept (above), 5 dropped (`inrMonths` 120 deliberate; relative test import has precedent; the `_0055` advance pin is out of bounds and now pinned; empty Turnstile key not reachable in e2e builds; Udyam U+2011/U+200B/en-dash not cleaned: outside "whitespace only", a follow-up; `maxLength={30}` cuts a paste with > 11 whitespace characters before normalising, not verified as a problem).
**Not verified:** no tests run by the analyst; admin/portal SPA chunk sizes after the `@techaust/core/offers` import (core `sideEffects: false`, portal Worker unchanged). **Skills:** `code-review` (+ read-only helper on this range); `security-review` left for the reviewer (r2 touches revoke); Cloudflare skills unavailable in the cloud.

**Lead triage (2026-11-01):** M1, L1–L3 and the six stale-check sites go to builder r2 (sent by message; the billing site binds a separate real `now` for the step-up check). The bare-`Date.now()` writers and the Udyam dash/zero-width characters are follow-ups.

## Review
(pending)

## Integration notes
- 2026-11-01 03:47 IST, lead on b9e226b (r1 + r2 + lead fix 60bcb5c): `bash tools/heavy.sh --log th-lead-check pnpm check` exit 0; `bash tools/heavy.sh --log th-lead-test pnpm test` exit 0: testing 4, auth 135, ui 471 (+2 skipped), core 1,956, email 132, db 623, pdf 380, web 750 (+17 skipped, no dist), portal 680, jobs 570, admin 3,821. Before review; the final run follows the review and a merge of main.

## Lead decisions (for 13)
- 2026-11-01: the optimistic stale check on six admin writers (leads, catalogue, client, client billing, contact, bank account) stamps `max(now, expected + 1)`, the house pattern, closing a same-millisecond/clock-skew gap (analyst: theoretical, low); the billing step-up check keeps the real clock.
- 2026-11-01 (builder r2's question): a send whose email already has its `email_log` row is never marked cancelled by a refused redelivery (it stays Sent/Delivered/Failed); jobs `MARK_NOT_SENT_SQL` in `invoice-send.ts` and `offers.ts`, tests in both (fail without the fix, checked). Lead commit 60bcb5c.
- 2026-11-01: item-5 defects #1–#4 (a revoked link re-minted on a queue retry, a reminder given back unpaused after a revoke, a care PDF enqueue failure ignored, care billing statements unguarded against a just-anonymised client) fixed in this task.
- 2026-11-01: the M5.4 code-review candidates were never recorded, so item 5 is a fresh focused pass over the six named files on main (analyst), not a re-check of a list.
- 2026-11-01: `git remote set-head origin main` run in this session's clone so `security-review` can load (cloud follow-up from T6).

## Follow-ups (for 12)
- **Web e2e form submissions can't run in a cloud session:** challenges.cloudflare.com is unreachable (proxy 403), so the contact and quote tests fail there before and after this task; the 1a fix is verified only by a stubbed slow-token reproduction. CI (or the PC) is the proof.
- **Stale stamps without their own check (low):** leads stage `leads.ts:797`, convert `:1039`, `documents.ts:384`, contacts `clients.ts:909`, `:1126`, `:1484` stamp a stale-checked row with a bare `Date.now()`; SQL `updated_at = max(?n, updated_at + 1)` would close the same theoretical gap; optionally a guard test.
- **Udyam paste:** non-breaking hyphen U+2011, en dash and zero-width characters are not cleaned (whitespace only); the form's `maxLength={30}` can cut a paste with many spaces before it is cleaned.
- **issue.ts / triggers.ts** (out of bounds in this run): `issue.ts` has no type list (it applies `SIGNED_FREEZE_SQL` per path), so no test ties the path choice to core's `signatureRequired`; the 0055 trigger copies stay pinned by `signature-triggers.test.ts`.
- **An email still on `EMAIL_QUEUE` when its send is cancelled** (no log row yet): the email consumer doesn't check `cancelled_at`, so it can still go (with a revoked, dead link) while the send reads Cancelled; pre-existing, rare (queue failure plus a revoke within seconds).
- **Resume between a revoke and a failed reminder send** (item 5 #2): the claimed reminder comes back paused and needs a second Resume (builder r2, accepted).
- **Merge commit 0dffdec** (builder r1) carries git's default message without the co-author footer; left as is (fixing it needs a force-push).

## Questions for the owner
(none)
