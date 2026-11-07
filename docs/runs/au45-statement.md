# Run: AU45, the client statement's "refund returned" line

Status: designer running (PDF note, statement-5, admin tab); lead fixing early-check lows
Tier: A (the statement's money lines and balances; client-facing figures)
Usage: analyst claude-opus-5-5/high (brief draft; `cloudflare:workers-best-practices` and `cloudflare:wrangler` tried, unavailable in a cloud session); 5-h 1 % at 20:05 IST (relayed) ; builder b1 claude-opus-5-5/high (`cloudflare:workers-best-practices`, `cloudflare:wrangler` tried, unavailable in the cloud): 5-h 1 % (20:05 IST) at start, 14 % (20:29 IST) the last relayed reading ; analyst early check claude-opus-5-5/high (`cloudflare:*` tried, unavailable): 14 % (20:29 IST) at start ; designer d1 started 21:25 IST (14 % at 20:29 IST)

Cloud task session `au45-statement`, branch `feat/au45-statement` (owner's blanket approval, 2026-11-07, 13: "AU45 … built before launch; its wording drafted by the lead under this approval"). Basis: [full-audit-m6-m7](full-audit-m6-m7.md) AU37, AU45, AU46, AU1.

## Questions for the owner
**Q1 (for the main session, under the owner's delegation of 2026-11-07): approve 07-ZU U1–U2?** ([ZU](../07-content-appendix/ZU-au45-statement.md))
- **U1**, the statement line's label: "Refund came back" **(Recommended)** · "Refund returned to us" · "Refund returned"
- **U2**, a note printed once under the lines when a statement has a U1 line: "A refund that came back is one the bank or card network returned to us. The amount is your credit again." **(Recommended: include it)** · leave the note out
Until approved, both show "[Placeholder] " (`APPROVED_07ZU = false`, `packages/core/src/copy-zu.ts`); the lead flips the flag once the answer arrives. Nothing else waits on it.
- **Answer (2026-11-07, main session, under the owner's blanket approval of 2026-11-07):** approved as recommended: U1 "Refund came back"; U2 included word for word. `APPROVED_07ZU = true` (builder b1 told at 20:40 IST).

## Brief
Drafted by the analyst (2026-11-07), checked and finalised by the lead (the cursor regex and the index confirmed by reading).

**PRD:** ADM-CLI-04 (totals reconcile with the ledger), JOB-PDF-01, ADM-PAY-08. **Basis:** 13 2026-11-07 (owner: AU45 before launch, wording by the lead); full-audit-m6-m7 AU37, AU45, AU46 (accepted, unchanged), AU1.

### 1. The rule
A statement is a list of dated lines; nothing is "as at" any more.
- **`refund`** (debit, ord 5, unchanged date `settled_on`): every refund that went out: `status='succeeded'`, or went out and came back (failed with `reversed_at` set).
- **`refund_returned`** (new, credit, ord 6, `sk` `date|6`): every reversed refund of a confirmed payment, same amount and number (the gateway refund id), dated the **IST day of `reversed_at`**. Never a lost dispute or a manual refund (the 0082 trigger already forbids reversing them; said again in SQL so the pair always matches).
- AU37 holds: a range ending on day D before the return lists the debit only, exactly when `reversed_at >= istDayEndMsSql(D)` (the `refundOutAtSql` boundary), so past statements never move. Opening(range) is the sum of dated lines before `?3`, so closing(N) = opening(N+1) always.
- The ledger holds: `STATEMENT_LEDGER_SQL` counts only succeeded refunds as gone; after a return the statement has a debit plus an equal credit, net zero. Also with a release allocation (refund of an invoice's excess): the reversal moves only `payment_refunds`, both sides equal T − C − A before and after (pinned by a test).
- Anonymised clients: no change. The statement PDF is already refused for them (admin `statement-pdf.ts` route and INSERT guard, jobs `statement-pdf.ts`); the staff JSON tab keeps every line so closing = ledger.
- Portal: **no statement view exists** in `apps/portal` (verified by the lead and the analyst). The invoice's "Refunded … on …" reads `status='succeeded'` only, so it already disappears after a return. Nothing to build there.

### 2. Builder (data, logic, route, jobs, tests). Stops after this layer for the early check.
- `packages/db/src/sql-rules.ts`: new `istDayOfMsSql(ms)` = `date(CAST(ms AS INTEGER) / 1000 + 19800, 'unixepoch')` (twin of core `toIsoDate(istDate(ms))`); `refundReturnedSql(f)` = failed AND `reversed_at` IS NOT NULL AND `origin <> 'chargeback'` AND `provider <> 'manual'` (check the real column names on `payment_refunds`); `refundWentOutSql(f)` = succeeded OR returned.
- `packages/db/src/reports.ts` `statementSource`: the refund branch uses `refundWentOutSql("f")` instead of `refundOutAtSql(f, istDayEndMsSql("?4"))`; a new UNION ALL branch (alias `g`/`gp`, `INDEXED BY payment_refunds_client`, `gp.status='confirmed'`, `cond(istDayOfMsSql("g.reversed_at"))`, NULL parent). `LINE_DEBIT_KINDS` unchanged. Doc comments updated (AU37 → AU45, ord 6, the ledger comment).
- Binds: `statementSource` no longer writes `?4`, so `STATEMENT_BALANCE_BEFORE_SQL(false)` has `?3` as its highest parameter. Revert `statementBalanceBeforeBinds` to its pre-AU37 shape (`cursor ? [c, cur, null, null, sk, id] : [c, cur, from]`, no `to`), and fix every caller (`apps/admin/worker/statements.ts`, `apps/jobs/src/statement-pdf.ts`, `packages/db/test/reports.test.ts`, `packages/db/test/refund-statements.test.ts`).
- `packages/core/src/statement.ts`: `refund_returned` in `StatementKind` (a credit by not being in `STATEMENT_DEBIT_TYPES`); header comment.
- `packages/core/src/copy-zu.ts` (pattern of `copy-zt.ts`): `APPROVED_07ZU = false`, `STATEMENT_REFUND_RETURNED_WORD` (U1), `STATEMENT_REFUND_RETURNED_NOTE` (U2), each "[Placeholder] " + line while false; subpath `./copy-zu` in `packages/core/package.json`.
- Types and labels so typecheck stays green: `apps/admin/src/lib/reports.ts` (`statementKindText`, `statementCsvLabels`), `apps/admin/src/api.ts` (`StatementEntryView.kind` gains `refund` and `refund_returned`), `packages/pdf/src/statement-view.ts` (input kind), `packages/pdf/src/layout/statement.ts` (`StatementLineKind`), `packages/pdf/src/layout/copy.ts` (`kinds.refund_returned` in `STATEMENT_PDF_COPY` only; keep the hunk local, the invoice copy there belongs to another task). The `detailsOf` print and the note are the designer's.
- `apps/admin/worker/statements.ts`: cursor `SK` regex `[123]` → `[1-6]` (an existing bug: a page ending on a TDS or refund line made the next page a 400).
- `apps/jobs/src/warm.ts`: add `refund` and `refund_returned` to the warmed kinds if the list exists there.
- No migration (`payment_refunds_client (client_id, requested_at, id)` is sought on `client_id`); no warm-fixture regeneration (the statement isn't a hot route).
- **Tests:**
  - `packages/db/test/refund-statements.test.ts`, `describe("AU45 …")` with a fixed `now`: payment ₹500 on 2 Nov, refund ₹200 settled 3 Nov, reversed 2026-12-05T04:30Z. (1) Nov lines `[receipt, refund]`, Dec lines `[refund_returned]` dated 2026-12-05, number the refund id, 20,000. (2) closing(Nov) = balance-before(Dec) = opening(Dec); closing(Dec) = closing(Nov) − 20,000. (3) the Nov–Dec range lists both. (4) core twin: `statementEntries` over the SQL rows gives `STATEMENT_TOTALS_SQL` and the chained closing. (5) a range through today closes at `STATEMENT_LEDGER_SQL` before and after the return. (6) the excess-refund case with a release allocation: ledger = closing before and after. (7) IST boundary: reversed at 2026-11-30T18:29:59.999Z → 30 Nov; at 18:30:00.000Z → 1 Dec; the Nov line set agrees with `refundOutAtSql(f, istDayEndMsSql('2026-11-30'))`. (8) never a line: failed without success, requested/processing, a lost dispute, an L33 refund of a payment later rejected, another client's, another currency's. (9) `istDayOfMsSql` twin across IST midnight. Update the existing refund and AU37 statement tests (debit unchanged, credit +20,000, opening unchanged; add the chain).
  - `packages/db/test/reports.test.ts`: plans seek `payment_refunds_client` for `f` and `g`, never a scan; bind signature.
  - `packages/core/test/statement.test.ts`: the kind is a credit; refund then return nets to zero; debit types unchanged. A `copy-zu` test (flag and placeholder marks). `packages/core/test/gst/report-csv.test.ts`: the label.
  - `apps/admin/worker/reports.test.ts` "a client's statement": the Nov/Dec chain over HTTP; a cursor page ending on ord 4 and on ord 5 then 200 with the right `balanceBeforeMinor`; `after` with `|7` → 400.
  - `apps/admin/src/lib/reports.test.ts`: the new word; CSV kinds length 8.
  - `apps/jobs/test/statement-b.test.ts`: a statement with a refund and its return renders with no `totals_mismatch`.

### 3. Designer (PDF and the admin tab)
- `packages/pdf/src/layout/statement.ts`: `detailsOf` prints U1 for the new kind (the refund id beside it, like "Refund"); U2 printed once in the foot block only when an entry is `refund_returned` (`returnedNote: string | null` on `StatementLayoutView`, set by `statementView`), travelling with the last lines (never alone on a page).
- `STATEMENT_LAYOUT_ID` `"statement-4"` → `"statement-5"` (the view hash includes it, so cached PDFs re-render); `packages/pdf/test/statement.test.ts`, `statement-layout.test.ts` (the word, the note once and escaped).
- `packages/pdf/visual/page-count.spec.ts` has no statement fixture; the statement pins live in the local `layout-audit.spec.ts` over `packages/pdf/test/fixtures/audit.ts`. Keep the 200-entry rotation as it is; add a "statement-refund-returned" case (about 6 entries, refund and return on different days, the note) pinned at 1 page.
- Admin tab `apps/admin/src/routes/clients/statement.tsx`: `refund` and `refund_returned` print as plain text, never a `/invoices/` link (fixes an existing dead link); U2 under the table when a loaded entry is `refund_returned`. Both themes, phone width, empty/loading/error states, axe. Screenshots of the admin tab and the PDF with a returned refund across two periods (closing = next opening).

### Done
The shared FINISH, plus: in the admin route, the PDF view and the core twin, a refund out in period N that comes back in N+1 gives closing(N) = opening(N+1), and N's statement is identical before and after the return; a range through today closes at the ledger (release-allocation case too); every statement SQL seeks an index; cursors ending on ord 4, 5 or 6 page; no refund line links to `/invoices/`; layout `statement-5`; `APPROVED_07ZU` set once ZU is approved.

### Out of scope (other tasks' files)
`apps/admin/worker/gateway/*`; core `razorpay`/`paypal`/`stripe`; `apps/jobs/src/hooks/*`, `apps/jobs/src/pdf.ts`; `apps/admin/worker/document-pdf.ts` and the invoice PDF routes; AU46 and the other AU37 period readers; the 07-ZT email; any migration.

## Early check
**Analyst, 2026-11-07, on c52187c: GO.** No critical, high or medium finding. Re-ran on the merged head (with #193): db `refund-statements` + `reports` 79 passed, admin `worker/reports.test.ts` 24 passed, jobs `statement-b` 27 passed; the lead's repo-wide `pnpm typecheck` exit 0. Checked: the IST-day expression equals AU37's `istDayEndMsSql` boundary (tests 7, 9); the debit/credit pair (same client, currency, confirmed payment, number, amount; chargeback and manual excluded in SQL and trigger; L33 rejected payment gives neither line); AU37 preserved (Nov's whole statement equal before and after a Dec return, db and HTTP); closing(N) = opening(N+1) in db, admin and core; ledger agreement incl. the release-allocation case; `(sk, id)` unique (`|5` vs `|6`); binds (3 / 6 values; D1 refuses 4 for the 3-parameter form, pinned); cursor `[1-6]`; all 7 statement reads SEARCH `payment_refunds_client` for `f` and `g`, no scan; scope clean; copy-zu word for word.
Low findings (the lead's, in integration):
1. `refundReturnedSql` doesn't require `settled_on IS NOT NULL` (a malformed row could print a credit with no debit; today's code never writes one): add `settled_on IS NOT NULL` and `provider_refund_id IS NOT NULL` (mirrors 0082), with a test row.
2. `reports.ts` ledger comment formula: add "− refund-came-back lines".
3. `apps/admin/worker/statements.ts` header's credits list is from M5.5: name receipts, TDS and the two refund kinds.
Noted, not blocking: no test pins the statement route's rows read (`reports-stress.test.ts` doesn't cover it; older than AU45) → follow-up.

## Builder report
### Builder b1 (2026-11-07, claude-opus-5-5/high): §2 done. Stopped for the early check
Branch `fix/au45-statement-b1`, built on `origin/feat/au45-statement` at the head before 7b46da9 (the merge of main #193) and ed581f9 (07-ZU approved). `git merge-tree` against today's task head is clean. Commits: 61a8d15 (data, logic, route, labels, db tests) and 9f9e7bd (admin, SPA and jobs tests). No migration.

**Skills.** I tried `cloudflare:workers-best-practices` and `cloudflare:wrangler`. Both returned "Unknown skill": plugins don't load in a cloud session. No other skill in docs/14 §9 fits this task: there are no screens, no CPU benchmarks and no platform features.

**Files**
- `packages/db/src/sql-rules.ts`: new `istDayOfMsSql(ms)`, `refundReturnedSql(f)` and `refundWentOutSql(f)`.
  - `refundReturnedSql(f)` is `failed AND reversed_at IS NOT NULL AND origin <> 'chargeback' AND provider <> 'manual'`.
  - `refundWentOutSql(f)` is `succeeded OR returned`.
- `packages/db/src/reports.ts`:
  - `statementSource`'s `f` branch now uses `refundWentOutSql`.
  - New `g`/`gp` branch: `refund_returned`, ord 6, `INDEXED BY payment_refunds_client`, `gp.status = 'confirmed'`, `cond(istDayOfMsSql("g.reversed_at"))`, NULL parent, and the same number expression as the debit line.
  - `statementBalanceBeforeBinds` is back to its pre-AU37 shape (checked against 939d094^): `(client, currency, from, cursor?)` gives `[c, cur, from]` or `[c, cur, null, null, sk, id]`.
  - The doc comments now describe AU45 (ord 6 and the ledger).
  - `LINE_DEBIT_KINDS` is unchanged.
- `packages/core/src/statement.ts`: `refund_returned` added to `StatementKind`, plus the header comment. `STATEMENT_DEBIT_TYPES` is unchanged.
- `packages/core/src/copy-zu.ts` (new) and the `./copy-zu` export in `packages/core/package.json`:
  - `APPROVED_07ZU = true`, as the lead relayed the approval mid-run.
  - U1 "Refund came back" and U2, word for word, behind the `zu` gate, plus `zuAllText()`.
- Types and labels:
  - `apps/admin/src/lib/reports.ts`: `statementKindText` and `statementCsvLabels`.
  - `apps/admin/src/api.ts`: `StatementEntryView.kind` gains `refund` and `refund_returned`.
  - `packages/pdf/src/statement-view.ts` and `packages/pdf/src/layout/statement.ts`: the kind unions.
  - `packages/pdf/src/layout/copy.ts`: only `kinds.refund_returned` in `STATEMENT_PDF_COPY`.
- `apps/admin/worker/statements.ts`: the cursor `SK` regex `[123]` is now `[1-6]`, and both bind calls are updated.
- `apps/jobs/src/statement-pdf.ts`: the bind call.
- `apps/jobs/src/warm.ts`: `refund` and `refund_returned` added to `warmStatement`'s kinds.
- Tests:
  - `packages/db/test/refund-statements.test.ts`: a new describe "AU45 …" covering (1) to (9), the existing AU1 statement test, and the AU37 test (debit unchanged, credit +20,000, openings for Nov and Dec unchanged, Jan −20,000, closing(Nov) = opening(Dec)).
  - `packages/db/test/reports.test.ts`: plans for `f` and `g` across all 7 statement reads, and the binds and arity test.
  - `packages/core/test/statement.test.ts`, `packages/core/test/copy-zu.test.ts` (new), `packages/core/test/gst/report-csv.test.ts`.
  - `apps/admin/worker/reports.test.ts`: the Nov/Dec chain over HTTP; cursors after ord 4, 5 and 6 answer 200 with the right `balanceBeforeMinor`; `|7`, `|0` and `|56` answer 400.
  - `apps/admin/src/lib/reports.test.ts`: the word, and 8 CSV kinds.
  - `apps/jobs/test/statement-b.test.ts`: a refund and its return render, with no `totals_mismatch`.

**Commands and results.** Every heavy command went through `tools/heavy.sh`, one at a time.
- `pnpm --filter @techaust/core test`: 133 files, 2,718 tests passed (coverage gate included).
- `pnpm --filter @techaust/db test`: 62 files, 1,100 passed.
- `pnpm --filter @techaust/pdf test`: 27 files, 415 passed.
- `pnpm --filter @techaust/admin test`: 199 files, 5,312 passed.
- `pnpm --filter @techaust/jobs test`: 52 files, 781 passed.
- `typecheck` for core, db, pdf, admin and jobs: all exit 0.
- `pnpm exec biome check` on the 21 changed files: clean. `apps/admin/worker/reports.test.ts` still shows 2 `useTemplate` infos at lines 104 and 107. Those lines are not mine and were already there.

**The analyst's claims, checked**
- Bind count: D1 refuses 4 values for the 3-parameter `STATEMENT_BALANCE_BEFORE_SQL(false)` and accepts 3. A test in `reports.test.ts` pins this.
- Plan for alias `g`: `SEARCH g USING INDEX payment_refunds_client (client_id=?)` in the page (both forms), the balance before (both forms), totals, count and entries. `f` is the same. No `SCAN` of `f`, `g`, `fp`, `gp`, `payment_refunds` or `payments`.
- `payment_refunds` has `origin` and `provider` (schema `payments.ts`; values `manual|razorpay|stripe|paypal` and `owner|outside|chargeback`).
- The brief cites no test line numbers. The AU37 test it means is in `refund-statements.test.ts`, in the describe "AU1 (B0 1)".

**Where I differed from the brief, or something worth knowing**
1. The existing AU1 test "the statement, Collected and the refunds register drop the refund …" reversed at `Date.now()`. It would have started failing after 30 Nov 2026, because Collected and the register for November keep a refund that came back after November (AU37). It now reverses at a fixed 2026-11-20T04:30Z, and the title says what it checks.
2. In the db tests the payment is received on 1 Nov (the `razorpayPayment` fixture), not 2 Nov. The admin test uses 2 Nov. No assertion depends on that day.
3. The returned line shares the refund's `id` with its `refund` line. `(sk, id)` stays unique because ord 5 ≠ 6, and the admin `rowKey` is `${kind}-${id}`. **Designer:** anything keyed by `id` alone must add the kind.
4. Because `detailsOf` returns `C.kinds[kind]` for any kind it doesn't special-case, the PDF already prints "Refund came back" beside the refund id. I left the U2 note, `STATEMENT_LAYOUT_ID` (still `statement-4`) and the visual specs to the designer.
5. `statement.tsx` typechecks with no change. The `refund` and `refund_returned` rows still link to `/invoices/<refund id>` (the existing dead link). That fix is the designer's (§3).
6. `warmStatement()` at start-up still uses `count = 3`, so only the first 3 kinds warm. The new kinds are exercised by the 200-line CPU test (`reports-cpu.test.ts`, passed).

**Not verified**
- The whole-repo `pnpm lint`, `pnpm check` and builds were not run, as instructed. That leaves the Worker byte and start-up budgets unchecked; the SQL text grows by one UNION branch.
- Portal and web were not tested or typechecked. The portal imports none of the changed modules (checked by grep).
- My test runs are on my base. They do not include 7b46da9 / #193, which the lead merged into the task branch after I started.

**Open questions:** none.

## Designer report

## Review

## Integration notes

## Lead decisions (for 13)
- 2026-11-07, AU45: the statement lists every refund that went out (debit on its `settled_on`) and, for one that came back, a credit "refund came back" on the IST day of `reversed_at`; the statement is no longer "as at" its last day (AU37's as-at rule is kept by the dates themselves: a statement ending before the return is unchanged). The portal has no statement, so nothing changes there. Lead (analyst's draft).
- 2026-11-07: the statement cursor accepts ord 1–6 (an existing bug: pages ending on a TDS or refund line were a 400); refund lines on the admin Statement tab no longer link to `/invoices/`. Lead.

## Proposed CLAUDE.md text

## Follow-ups (for 12)

## Handover
