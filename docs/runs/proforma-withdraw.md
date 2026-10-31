Status: analyst early check and designer running in parallel (disjoint files; started 13:54 IST); owner answered Q1–Q4, 07-ZF approved
Tier: A
Usage: analyst (brief draft) claude-opus-5-5/high, skills: none available (no Cloudflare plugin in the cloud); 5-h 8 % at start · builder r1 claude-opus-5-5/high, skills: none (same reason; flagged by model-audit); 5-h 8 → 46 % (reading 13:46)

# Withdraw a proforma the client has seen (cloud session "proforma-withdraw")

Branch `feat/proforma-withdraw` (from `origin/main` a5f9f92). Copy file [07-ZF](../07-content-appendix/ZF-proforma-withdraw.md). Merge order of today's parallel tasks (owner, 2026-10-31): T12, T6, **proforma withdraw**, T7, M6.1.

**The rule (owner, 2026-10-30, docs/13):** staff may take back a delivered proforma that has no payment and no invoice made from it, with a reason; it stays in the records (never deleted); the client sees it as withdrawn. It replaces "a delivered proforma stays until converted". The separate rule stays: a tax or export invoice the client has viewed is never voided (08-C RA-10, trigger 0053); withdrawing is for proformas only.

## Brief
Final brief by the lead (2026-10-31), from the analyst's draft (checked against the code: the void route `apps/admin/worker/invoices.ts:1155-1278`, `voidBody` 500 characters, triggers 0038/0040/0053). Lead changes to the draft: the `document_sends` trigger is scoped to invoice-family documents (offers stay T7's); the child check covers any child, and the builder confirms first that no code path makes a draft child of a proforma.

**PRD IDs:** ADM-INV-10 (proforma flow; commits tagged `[ADM-INV-10]`), ADM-INV-02 (void keeps its number, reason required), ADM-INV-13 (reminders stop), POR-06 (portal invoices and the emailed link), POR-03 (client scoping), ADM-G-06 / ADM-AUD-01 (audit).

**The rule** (owner 2026-10-30, docs/13): staff may take back a delivered proforma that has no payment and no invoice made from it, with a reason; it stays in the records (never deleted); the client sees it as withdrawn. Unchanged: a tax or export invoice that was emailed or viewed is never voided (08-C RA-10, trigger 0053). Withdrawing is for proformas only. 08-C basis: RA-17 and RA-28 (a proforma is not a tax document: no Rule 46/53 duty, no credit note, not in Table 13), so no new 08-C row.

### The model (lead decision L1)
A withdrawal **is a `void` of a delivered proforma**, through its own route, permission and audit action. **No new status, no new column:** the status list is the CHECK `documents_status` (a new value needs a rebuild of `documents`, forbidden: other tables reference it); a new column must join `documents_frozen_update` (re-created in 0047, 0050; T7 touches frozen-document triggers next). `header_extras` is frozen.
- **withdrawn** = `type = 'proforma' AND status = 'void' AND (viewed_at IS NOT NULL OR EXISTS document_sends for it)` (any send row, as the void route counts it). Unambiguous because `/void` refuses a proforma with a send row or a view, so a delivered proforma reaches `void` only through `/withdraw`. Two new triggers keep the facts from changing after the void (no `viewed_at` write, no `document_sends` insert).
- Reason in `void_reason`, time in `voided_at` (set-once; `documents_void_pairing` in 0038 needs both); who: the audit row (as `voidedByName` today, `invoices.ts:359`).
- Every reader already treats it as void, which is right: reminders stop (`packages/db/src/billing.ts:51` `voided_at IS NULL`, `apps/jobs/src/reminders.ts:141` `skipReasonOf` → `void`), the jobs send consumer refuses void (`apps/jobs/src/invoice-send.ts:54`), "proformas awaiting" excludes it (`packages/db/src/reports.ts:320`), statements exclude proformas, registers and Table 13 hold the four GST kinds only (`reports.ts:23`), unbilled readers exclude void (`billing.ts:29`).
- **Withdraw and void never overlap:** an issued, unpaid proforma not yet delivered → Void (unchanged, 07-ZA lines); delivered → Withdraw.

### Builder: data, logic, API (Tier A: stop after this layer is committed, for the analyst's early check)
**0. First check:** grep every `INSERT INTO documents` / Drizzle insert with a `parent_id` that can point to a proforma. If any path leaves a **draft** child of a proforma (the advance path creates and freezes the child in one batch), stop and report before step 3; otherwise the child checks below cover any child.

**1. Core** `packages/core/src/invoices.ts`:
- `WITHDRAW_BLOCKER_CODES = ["not_proforma","already_withdrawn","already_void","not_issued","proforma_converted","proforma_paid","not_delivered"]`.
- `withdrawBlockers(f: WithdrawFacts)`; `WithdrawFacts = {type, status, paidMinor, creditedMinor, hasChildDocument, hasAdvanceReceipt, emailed, viewed}`, all required. Non-proforma → `["not_proforma"]` only. Status void → only `already_withdrawn` (delivered) or `already_void` (not). `proforma_converted` when status `converted` or any child; `not_issued` when the status is not in `LEDGER_STATUSES` and not `converted`; `proforma_paid` when `paidMinor > 0`, `creditedMinor > 0` or an advance receipt; `not_delivered` when neither emailed nor viewed. Codes only, in that order.
- `isWithdrawn({type, status, emailed, viewed})` (twin of the SQL below); `WITHDRAW_REASON_MAX = 500`.
- Comments of `voidBlockers` (`:521-527`) and `INVOICE_STATUS_FLOW` (`:78-94`): a delivered proforma is withdrawn instead of "stays until converted" (behaviour unchanged). Comment tags in the 08-C form (`Researched 2026-10-28, … (08-C RA-17)`, `test/verify-tags.test.ts`).
- `packages/core/src/permissions.ts`: `"invoices.withdraw": { owner: "step-up" }` beside `invoices.void` (Q1 default; comment cites the docs/13 row and Q1). `packages/core/src/audit.ts`: `"invoice.withdraw"` in `FINANCE_AUDIT_ACTIONS`.

**2. Shared SQL** `packages/db/src/sql-rules.ts` (pure text): `proformaDeliveredSql(a)` = `(${a}.viewed_at IS NOT NULL OR EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = ${a}.id))`; `withdrawnSql(a)` = `(${a}.type = 'proforma' AND ${a}.status = 'void' AND ${proformaDeliveredSql(a)})`. Re-export from `issue.ts`; a light subpath export `"./sql-rules"` in `packages/db/package.json` so the portal doesn't pull in `issue.ts`.

**3. Migration 0056** `proforma_withdraw_triggers` (triggers only; `drizzle-kit generate --custom --name proforma_withdraw_triggers` + `scripts/write-triggers.ts proforma_withdraw_triggers`; a `TRIGGER_SETS` entry and `proformaWithdrawTriggerStatements()` in `packages/db/src/triggers.ts`; every abort message starts with its trigger's name):
1. `DROP TRIGGER documents_viewed_no_void;` and create it again, identical to 0053 except `OLD.type IN ('tax_invoice', 'export_invoice')` (pinned `VIEWED_NO_VOID_TYPES_0056`); 0053 still regenerates byte for byte from `VIEWED_NO_VOID_TYPES_0053`. Never edit 0053.
2. `documents_proforma_withdraw` `BEFORE UPDATE OF status ON documents WHEN NEW.status = 'void' AND OLD.status <> 'void' AND OLD.type = 'proforma' AND (OLD.status <> 'issued' OR OLD.paid_minor <> 0 OR OLD.credited_minor <> 0 OR EXISTS advance_receipts for it OR EXISTS any child (parent_id) OR NEW.void_reason IS NULL OR length(trim(NEW.void_reason)) = 0 OR length(NEW.void_reason) > 500)` → abort. Covers both proforma paths (void and withdraw).
3. `documents_void_no_view` `BEFORE UPDATE OF viewed_at ON documents WHEN OLD.status = 'void' AND NEW.viewed_at IS NOT OLD.viewed_at AND OLD.type IN ('proforma','tax_invoice','export_invoice')` → abort.
4. `document_sends_not_void` `BEFORE INSERT ON document_sends WHEN EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.type IN ('proforma','tax_invoice','export_invoice') AND (d.status = 'void' OR d.voided_at IS NOT NULL))` → abort.
No table rebuilt, no `documents` column, `documents_frozen_update` untouched (`scripts/check-migrations.mjs` stays green).

**4. Admin API** new `apps/admin/worker/invoice-withdraw.ts`, mounted in `routes-api.ts` (`/v1/invoices`); ROUTES row in `guard.ts` after `invoices/:id/void`: `R("POST", "/invoices/:id/withdraw", "invoices.withdraw", { audit: "invoice.withdraw" })` (JSON 16 KB, API Worker). Body `withdrawBody = z.strictObject({ expectedUpdatedAt: z.int(), reason: z.string().check(z.trim(), z.minLength(1), z.maxLength(WITHDRAW_REASON_MAX)) })`, warmed in `invoice-warm.ts`.
Handler: (1) one lean read (not `readInvoice`): id, type, status, frozen_at, updated_at, paid, credited, viewed_at, number_display, total_minor, client anonymised, emailed / any child / advance receipt; (2) 404; non-proforma → 409 `withdraw_proforma_only`; (3) `withdrawBlockers` → 409 with `reasons` (first code as `code`); (4) `stale_version`, then `client_anonymised` (`CLIENT_GONE`); (5) `mutate`, main statement:
```sql
UPDATE documents SET status = 'void', voided_at = ?3, void_reason = ?4, updated_at = ?3
WHERE id = ?1 AND updated_at = ?2 AND type = 'proforma' AND status = 'issued' AND frozen_at IS NOT NULL
  AND paid_minor = 0 AND credited_minor = 0 AND NOT ${clientGoneSql("client_id")}
  AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id = documents.id)
  AND NOT EXISTS (SELECT 1 FROM advance_receipts r WHERE r.proforma_id = documents.id)
  AND ${proformaDeliveredSql("documents")}
  AND <the owner session with a live step-up, exactly as invoices.ts void>
```
`t = max(now, updated_at + 1)`; audit `invoice.withdraw`, summary `{documentId, number, type, totalMinor, reasonLength, delivered: "emailed"|"viewed"|"both"}` (never the reason text); one side statement: the void's milestone release (`invoices.ts:1210-1214`). (6) Nothing changed → re-read as the void does (401 / 403 `step_up_required` / stale / gone) plus paid, converted, advance, child, delivered → the codes above. (7) A trigger abort matching `documents_(proforma_withdraw|invoice_status_flow|void_pairing|viewed_no_void)` → re-read, 409, never 500. (8) Response `{ok: true, status: "void", withdrawn: true, number, voidedAt, updatedAt, milestone}`.
Error constants in `invoice-model.ts` beside the void ones, API words from 07-ZF (lines shown `[Placeholder]` until approved, see the designer's switch). Read paths: `GET /invoices/:id` (`invoice-view.ts`) adds `withdraw: {canWithdraw, blockers}` (`decide(role, "invoices.withdraw") !== "deny"` and no blockers) and `void.withdrawn`; the facts read finds the actor for `invoice.void` or `invoice.withdraw`; `INVOICE_LIST_SQL`/`listRow` add `withdrawn` (`CASE WHEN d.type = 'proforma' AND d.status = 'void' THEN ${proformaDeliveredSql("d")} ELSE 0 END`), the client tab inherits it. The void route: its refusal re-read also reads `emailed`, so a send landing mid-void answers `already_emailed`; `voidRefused` for a delivered proforma points to Withdraw (07-ZF 15–16).

**5. Portal worker** (`apps/portal/worker`): `invoice-summary.ts` adds `openOrWithdrawnSql(d)` = `((d.voided_at IS NULL AND d.status IN (${STATUSES_SQL})) OR ${withdrawnSql(d)})` from `@techaust/db/sql-rules` and `d.voided_at` to `SUMMARY_COLS`; `CLIENT_INVOICE_STATUSES` unchanged; `VIEW_SQL`/`VIEW_PDF_SQL` unchanged. `listItemOf`/`summaryOf`: a withdrawn proforma → `status: "withdrawn"`, `withdrawnOn` (IST date of `voided_at`), `balanceMinor`/`balance`/`dueDate` null; never `void_reason` (Q3 default). `invoices.ts`: `LIST_SQL`/`ONE_SQL` use the predicate; `/:id/pdf` on a withdrawn proforma → 409 `withdrawn`, R2 never read. `doc-token.ts`: `DOC_READ` uses the predicate (the emailed link opens the withdrawn summary and isn't a failure); `/document/pdf` → 409 `withdrawn`. EXPLAIN/index tests stay green.

**6. Jobs:** no change (reminders and sends stop through existing SQL). Confirm the jobs bundle bytes are unchanged.

### Designer: screens (after the early check, from the newest branch tip)
Load `frontend-design:frontend-design` first (if absent in the cloud session, say so). `TECHAUST_PORT_OFFSET=0`.
- Admin `apps/admin/src/lib/copy-zf.ts`: `APPROVED_07ZF = false`, `ZF()` as `copy-z.ts`; `copy-zf.test.ts` checks every line word for word against 07-ZF.
- Admin invoice page (`routes/invoices/read.tsx`, `dialogs.tsx`): "Withdraw proforma" for the Owner when `withdraw.canWithdraw` (in place of the refused Void for a delivered proforma); a dialog reusing the void dialog's step-up flow and 07-ZA 18's reason label; a refusal reloads the page; toast + the existing milestone line; the withdrawn banner; the amended locked line and void-blocked lines through `ZF`.
- Admin list and client tab: a "Withdrawn" badge when `withdrawn`; `invoice.withdraw` in `lib/audit.ts` (audit-label test).
- Portal `apps/portal/src/copy-zf.ts` (same switch): list label; the page banner, no amount-due rows, no PDF button (signed in and through the emailed link).
- Visual: both themes, the in-app theme against the OS theme, widths, empty/error states, axe; screenshots in the report.

### Tests (failure paths first)
- **Core:** every blocker code and its order; fast-check: for an issued, unpaid, childless proforma exactly one of `voidBlockers`/`withdrawBlockers` is empty (by delivery), never both; tax/export/notes → `not_proforma`; `isWithdrawn` truth table; coverage ≥ 90 %.
- **db:** 0056 regenerates byte for byte, 0053 still does; raw `UPDATE … status='void'`: viewed tax invoice and viewed export invoice → abort `documents_viewed_no_void`; viewed unpaid proforma → passes; proforma with advance receipt / converted / part-paid / frozen child / draft child / blank or 501-character reason → abort; `viewed_at` UPDATE on a void document → abort (live → passes); `document_sends` INSERT for a void invoice-family document → abort (a live one, and offers, pass); `withdrawnSql`/`proformaDeliveredSql` twin-tested against core; trigger column coverage green; reminder claim for a withdrawn proforma → 0 rows.
- **Admin** `invoice-withdraw.test.ts`: Owner with step-up on a viewed proforma → 200 (void, reason stored, one `invoice.withdraw` audit row with `reasonLength` and no text, milestone freed, tokens and sends untouched); emailed only → 200; undelivered → 409 `not_delivered` and `/void` → 200; delivered proforma via `/void` → 409; tax/export/note → 409 `withdraw_proforma_only` (viewed tax invoice `/void` still 409 `viewed_by_client`); paid / converted / advance / already withdrawn / already void / draft → 409 codes; anonymised, stale → 409; no step-up, lapsed step-up → 403; revoked session → 401; Staff, Sales, Accountant → 403; bad bodies → 400; trigger abort → 409; a refusal writes no audit row; `split.test.ts` forwards the row; GET flags, list `withdrawn`, dashboard `proformasAwaiting` excludes it.
- **Portal:** list and page show it withdrawn (no balance, due date or reason) and write no view; an undelivered void proforma stays 404; PDF → 409 `withdrawn` with no R2 read; the emailed link → 200 with no `p:fail:` count, link PDF → 409; another client's withdrawn proforma or a token of another client → 404; contact without finance → 404; revoked/expired token → 404.

### Budgets
Admin API main 618,422 (plan line 650,000; stop and ask over it); jobs 984,266 of 1,000,000 (expected unchanged); portal ceiling 120,000. Builder records the real numbers.

### Out of scope / owned elsewhere
Any client email (Q2), a stamp on the write-once PDF, any change to void of tax/export invoices, a new list filter, auto-reissue, 08-C §5 (T12), erasing `void_reason` (T7/DPDP), M6 payments (handoff: M6.1's own migration must add "no payment row" to both proforma statements and `documents_proforma_withdraw`). Merge notes: T12 retags `OPEN (08-C RA-10)` comments in the same files (comment-only conflicts); 0056 is renumbered if T12 or T6 takes it.

### Done when
Builder: core, db, admin and portal tests green through `tools/heavy.sh`, `pnpm check` green, budgets under ceilings, committed and pushed, stopped for the early check. Designer: screens with screenshots under `[Placeholder]`. Review APPROVE, findings fixed, re-check; 07-ZF approved by the owner and `APPROVED_07ZF` on before the PR; run file filled.

## Questions for the owner
Asked 2026-10-31 (through the main session). **Answered by the owner 2026-10-31 (relayed by the main session): Q1 A, Q2 A, Q3 A, Q4 A (07-ZF lines 1–20 approved as drafted; line 21 dropped, as Q2 = A).**

**Q1. Who may withdraw a proforma?** Your rule says "staff may take back". Voiding today is Owner-only with a fresh authenticator code.
- A) **Owner only, with a fresh code, the same as voiding (Recommended).**
- B) The Owner, and Staff may ask (the Owner approves).
- C) The Owner and Staff, directly.

**Q2. Email the client when a proforma is withdrawn?**
- A) **No email: the portal and the emailed link show "Withdrawn", and its reminders stop (Recommended).** No new email template (the jobs Worker is near its size limit).
- B) One short email to the contacts it was sent to (07-ZF line 21).

**Q3. What does the client see of a withdrawn proforma?**
- A) **Its details with a "Withdrawn" banner, no amount due, no PDF download, and not your reason (Recommended).** The stored PDF can't change and still carries the bank details, so offering it invites a payment.
- B) As A, with the PDF.
- C) As A, with your reason.

**Q4. Approve the wording in [07-ZF](../07-content-appendix/ZF-proforma-withdraw.md)** (20 lines, plus line 21 only if Q2 = B).
- A) **Approve all as drafted (Recommended).**
- B) Approve with changes (name the line numbers and the new words).

## Lead decisions (for 13)
- **Owner, 2026-10-31 (Q1 A):** only the Owner withdraws a proforma, with a fresh authenticator code, the same as voiding (`invoices.withdraw: { owner: "step-up" }`).
- **Owner, 2026-10-31 (Q2 A):** no email to the client on a withdrawal; the portal and the emailed link show "Withdrawn" and its reminders stop; no new template.
- **Owner, 2026-10-31 (Q3 A):** the client sees the withdrawn payment request's details with the "Withdrawn" banner, no amount due, no PDF download, and not the staff's reason.
- **Owner, 2026-10-31 (Q4 A):** 07-ZF lines 1–20 approved as drafted; line 21 (the email) dropped; `APPROVED_07ZF` on.
- **L1 (2026-10-31):** a withdrawal is a `void` of a delivered proforma through its own route (`POST /api/v1/invoices/:id/withdraw`), permission `invoices.withdraw` and audit action `invoice.withdraw`; "withdrawn" = a void proforma that was emailed or viewed, derived in SQL (`withdrawnSql`) and kept stable by triggers; no new status or column (a status value needs a `documents` rebuild, forbidden; a column would re-create `documents_frozen_update`).
- **L2:** void and withdraw are exclusive by delivery: an undelivered proforma is voided, a delivered one is withdrawn.
- **L3:** links and sends are left alone (no token revoked, no send cancelled): the emailed link opens a "Withdrawn" page, not a 404; reminders stop through the existing claim.
- **L4:** the milestone is freed in the same batch, as on void.
- **L5:** 0053's `documents_viewed_no_void` is dropped and re-created in 0056 for tax and export invoices only (0053 never edited; precedent 0047, 0050); three new triggers (`documents_proforma_withdraw`, `documents_void_no_view`, `document_sends_not_void`, the last scoped to invoice-family documents).
- **L6:** no jobs change, no PDF change, no new list filter; 08-C basis RA-17/RA-28 (no new row); RA-10's §1 "Our rule" text is updated after T12 merges.

## Migrations added
- 0056 `proforma_withdraw_triggers` (triggers only: re-creates `documents_viewed_no_void` for tax/export invoices; adds `documents_proforma_withdraw`, `documents_void_no_view`, `document_sends_not_void`)

## Worker bytes
Branch (builder r1, c0b71b2): admin front 99,391; admin API **625,014** (+6,592; plan line 650,000); portal 103,476 of 120,000; jobs **984,407** of 1,000,000 (+141: the jobs bundle carries `permissions.ts`). Startup (fastest of 7): front 11.0 ms, API 55.9 ms, portal 10.2 ms, jobs 60.2 ms.
Main (a5f9f92): admin API 618,422 (plan line 650,000), jobs 984,266 of 1,000,000.

## Early check

## Builder report
Builder (round 1, branch `build/proforma-withdraw-r1`, head c0b71b2, merged into the task branch by the lead as 10b4f02; worktree removed, logs in `.logs/proforma-withdraw/`).
- **Step 0 gate passed:** no path leaves a draft child of a proforma (`advanceIssueStatements` inserts and freezes the child in one batch; note drafts take only tax/export parents; other inserts write no `parent_id`).
- **Commits:** 6f82ba0 core (withdraw blockers, `isWithdrawn`, `invoices.withdraw`, `invoice.withdraw`); a1b2856 db (0056, `withdrawnSql`, `proformaDeliveredSql`, subpath `./sql-rules`); fb65502 admin (`POST /invoices/:id/withdraw`, read and list flags, void refusals point a delivered proforma to Withdraw); 48c6111 portal (withdrawn view, no balance/due/PDF/reason); c0b71b2 a shorter permission comment (jobs carries it).
- **Results (tools/heavy.sh):** core 91 files / 1,873 tests (coverage 99.05 % statements, 98.13 % branches); db 36 / 531; admin 121 / 3,524; portal 26 / 658; `pnpm check` exit 0 (migration guard: 57 migrations, no rebuild); `pnpm lint` exit 0 (10 warnings, 8 infos, all in untouched files).
- **Existing tests changed:** `billing-sql.test.ts` (the void fixture sends while issued, then voids: 0056 refuses a send row on a void document); `invoices.test.ts` and `invoice-types.test.ts` (refusal regex also accepts `documents_proforma_withdraw`, which fires before 0038's flow trigger); `void-view.test.ts`, `migrations.test.ts`, `invoices-void.test.ts` (07-ZF 15 words), route table, `rbac.test.ts`, `invoice-notes-review.test.ts`, `invoices-cpu.test.ts` (warm count 19), portal `doc-token.test.ts` (`withdrawnOn` key).
- **API words:** the approved 07-ZF words directly. An emailed proforma's refused void keeps the code `void_not_allowed` (the SPA keys on it) with 07-ZF 16 and `reasons: ["already_emailed"]`; `already_void` and `not_issued` use 07-ZF 14. `apps/admin/src/lib/audit.ts` got `"invoice.withdraw": "withdrew a proforma"` (07-ZF 9; the audit-labels test needs it).
- **Refusal order** after a no-op batch: 401, stale, anonymised, 403 `forbidden` (no longer an active owner), 403 `step_up_required`, the withdraw codes, else 409 stale; a matching trigger abort goes through the same read (tested with a temporary trigger).
- **Not testable alone:** the advance-receipt clause of the trigger (`advance_receipts_scope_insert` needs a frozen child, which trips the child clause first); a cross-client token can't be minted (`doc_access_tokens_bound_insert`), so the portal test asserts that refusal plus 404 scoping.
- **Not verified:** two "Network connection lost" uncaught-exception lines in the admin test log (suite exit 0; not compared with main).
- **Open:** the portal summary still returns the frozen `bank` block for a withdrawn proforma (lead: to be nulled by the API, Q3's reason; see the early check). The portal SPA's types (`apps/portal/src/api.ts`) and the admin SPA's `copy-z.ts`/`voidErrorText` are the designer's.
- **Skills:** none (the Cloudflare skills aren't installed in this cloud session; supabase is Postgres-only).

## Designer report

## Review

## Integration notes

## Follow-ups (for 12)
- **Fixed by #126.** ~~Cloud setup script (found 2026-10-31 at this session's start):~~ the setup script stopped with "node -v says v24.22.1, not v24.22.2". Cause: the cloud image now ships `/opt/node24` as a real folder (Node 24.22.1), so `ln -sfn "/opt/${NODE_NAME}" /opt/node24` in `scripts/cloud-setup.sh` (line 57) puts the link inside that folder instead of replacing it, and the version check fails before the browser step. Fix: add `[ -L /opt/node24 ] || rm -rf /opt/node24` on the line before it, then paste the script into the environment's "Setup script" box again (owner). This session ran on the image's Node 24.22.1 (inside `engines` >= 24.19.0) and the lead installed the two Chromium builds by hand (`pnpm exec playwright install --with-deps chromium` from `apps/web`, and `npx @playwright/mcp@0.0.83 install-browser --no-shell chromium`, both into `/opt/ms-playwright`); `bash scripts/cloud-check.sh` then: all passed. Note: `npx -y playwright@1.64.1 install` picked up the image's own Playwright and installed revision 1243, not 1248; the repository's own binary is the reliable path.

## Handover
