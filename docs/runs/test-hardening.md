Status: builder r1 and analyst (candidate check) running
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
(pending)

## Builder report r1
(pending)

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
