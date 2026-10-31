Status: builder r1 running; item 5 checked (4 real defects, fixed in builder r2 after r1)
Tier: B
Usage: (filled in as agents finish; models and efforts from `node tools/model-audit.mjs`)

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

## Early check (analyst)
(pending)

## Review
(pending)

## Integration notes
(pending)

## Lead decisions (for 13)
- 2026-11-01: the M5.4 code-review candidates were never recorded, so item 5 is a fresh focused pass over the six named files on main (analyst), not a re-check of a list.
- 2026-11-01: `git remote set-head origin main` run in this session's clone so `security-review` can load (cloud follow-up from T6).

## Follow-ups (for 12)
(none yet)

## Questions for the owner
(none)
