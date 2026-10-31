# Run: T7, erase a person's data in the frozen copies of never-accepted offers
Status: WAITING ON OWNER (Q2, an audit label; not blocking); early check CHANGE, fix builder running (branch fix/t7-offer-erasure-b2)
Tier: A (deleting or anonymising data; docs/14 §2)
Usage: lead claude-opus-5-5/high (cloud session t7-erasure); analyst claude-opus-5-5/high (brief draft; skills: tried `cloudflare:workers-best-practices` and `cloudflare:wrangler`, both "Unknown skill" in the cloud session although model-audit lists them; 5-h 8 % at 12:58 IST); builder claude-opus-5-5/high (agent-ac9b3fbc, layers to the Tier A stop point, 13:25–14:16 IST; same two skills tried, both unknown; 5-h 46 % at 13:46 IST); analyst claude-opus-5-5/high (agent-af81419a, early check; tried the two skills and `cloudflare:workers-profiling`, all unknown)

**Task (main session, 2026-10-31):** 08-C RB-37(a), settled by the lead on the safest reading (2026-10-30, [settle-08c](settle-08c.md)): on an erasure request, erase the person's data in the frozen copy of every proposal or estimate that was **never accepted**; keep the number, status, dates and hash. Accepted offers and every invoice-family document stay untouched (financial records). Due before 13 May 2027 (DPDP core duties).

Branch `feat/t7-offer-erasure` from `main` 8d5b958. Copy file: [07-ZG](../07-content-appendix/ZG-offer-erasure.md) (3 lines, approved by the owner 2026-10-31). Merges fourth (T12 → T6 → proforma withdraw → **T7** → M6.1).

## Questions for the owner
**Q1. An offer that is still open when the person it is addressed to asks to be erased.** Once their details are erased from an offer it can't safely be accepted any more: the acceptance is proved against the PDF, and the PDF is deleted. At a business client, other people at the company may also have the offer by email. Today a sent offer stays open until a new version replaces it (your rule of 2026-10-25); this would be the one exception.
- **A. (Recommended)** The offer is withdrawn at once: it disappears from the client portal for everyone, nobody can accept or decline it, and it still expires on its normal date. If the deal goes on, you send a new version to another contact.
- B. Refuse to anonymise the person while an open offer is addressed to them: you let it expire or send a new version to someone else first, then anonymise. Erasure can wait up to the offer's validity period.
- C. Leave open offers alone and erase them automatically once they close (expire, are declined or replaced). Needs background work in the jobs Worker, which has little room left.

**Copy 07-ZG lines 1–3** (staff-facing; [07-ZG](../07-content-appendix/ZG-offer-erasure.md)): approve as written (Recommended), or change a line.

**Owner's answers (2026-10-31, through the main session):** Q1 **A** (an open offer is withdrawn at once when its addressee is anonymised: hidden from the portal for everyone, accept and decline refused, it still expires on its date). 07-ZG lines 1–3 **approved as written**; the code uses the real text (builder told at once).

**Q2 (new, 2026-10-31, not blocking).** The staff audit log needs a label for the new action `document.redact` (one row per offer whose personal details were erased); it shows "[Placeholder]" until approved. Proposed 07-ZG line 4: "erased personal details from a proposal or estimate".
- **A. (Recommended)** As written (it matches "viewed a proposal or estimate" next to it).
- B. "erased a person's details from an offer".

## Brief
Final version by the lead from the analyst's draft (2026-10-31). Lead changes to the draft are marked **(lead)**.

**PRD IDs:** ADM-CLI-05 (data-subject tools), ADM-PROP-05 (frozen versions, with this one exception), ADM-PROP-08 and POR-05 (a redacted offer can't be accepted), JOB-PDF-01 (never rendered again), ADM-AUD-01, NFR-6.
**Comment tag** on every new code comment about the rule: `Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)`. Never a bare VERIFY; never `OPEN (08-C RB-37)` for part (a) (part (b), keeping accepted offers, stays as it is).

### Where a frozen offer holds a person's data (all four are erased)
1. the `documents` row: `recipient` (JSON), `title`, `decision_note` (the person's own typed words);
2. the child rows: `document_sections` (title, body_md, including the Acceptance text filled from `{{client.contact}}`), `document_lines` (description, detail), `payment_schedules` (label, detail);
3. the R2 envelope in `DOCS` (`…-v<v>.json`);
4. the R2 PDF in `DOCS` (`…-v<v>.pdf`).

### Decisions (lead; for 13 when merged)
- **L1 Per version.** Each version is judged on its own: a version never accepted itself (e.g. v1 "revised" while v2 was accepted) is redacted; the accepted version stays untouched.
- **L2 Kept:** id, type, number and display, series, FY, version and group, status, every date (issue, valid until, sent, viewed, decided), amounts and `computed`, the terms pin, `contact_id`, `decided_contact_id`, `decision_reason` (a code), `content_sha256`, `snapshot_sha256`, `pdf_sha256`, the R2 key columns, `issuer`. **Erased:** the personal values in `recipient`, `title` and the child text columns; `decision_note` → NULL. **Deleted:** the envelope and the PDF objects. A decline keeps its fact, date, who (by id) and reason code (s.17(1)(a)).
- **L3 Replacement:** values become core `ANONYMISED_CLIENT` ("Anonymised client", the one wording on frozen documents, 07-Q Q2), matched as whole words with `@techaust/core/text` `wholeWordPattern` (never hand-rolled), longest value first. Values: those the admin view redacts today, plus the contact's live name, email and phone; for an individual client's last live contact also the client's legal name, display name and GSTIN. Blank values and values under 2 characters are skipped (the view uses the same shared helper, so it agrees).
- **L4 Erase eligibility unchanged:** `CONTACT_ON_ISSUED_DOCUMENT_SQL` still refuses `erase`; the redaction runs in `anonymise` mode, which leaves no personal data on the contact row. In erase mode nothing is redacted (a frozen offer naming the person already refuses the erase).
- **L5 Cap:** at most 10 offers per anonymise request (the Free plan's 10 ms CPU); over it, 409 `too_many_offers` and nothing is written (07-ZG line 3). Chunking is a follow-up only if it ever happens.
- **L6 No backfill:** there is no production data before launch; staging has only sample data.
- **L7** The open question of row 233 (2026-10-26, "serving the existing PDF of an anonymised client") is answered for never-accepted offers: the PDF is deleted. It stays open for accepted offers.
- **L8 (lead)** RB-37(a)'s settlement (13, 2026-10-30) replaces, for never-accepted offers only, the 2026-10-26 rows that kept "the stored snapshot untouched"; for accepted offers those rows stand (view-only redaction).

### 1. Which documents (one helper, new `packages/db/src/offer-redaction.ts`, subpath export `@techaust/db/offer-redaction`)
`REDACTABLE_OFFER_SQL(d, c, cl)` (`c` = the contact being anonymised, `cl` = its client):
```sql
d.client_id = c.client_id AND d.type IN ('proposal','estimate') AND d.frozen_at IS NOT NULL AND d.redacted_at IS NULL
AND d.status NOT IN ('accepted','converted') AND NOT EXISTS (SELECT 1 FROM acceptances a WHERE a.document_id = d.id)
AND ( json_extract(d.recipient,'$.contactId') = c.id OR lower(json_extract(d.recipient,'$.email')) = lower(c.email)
      OR d.contact_id = c.id OR d.decided_contact_id = c.id
      OR (cl.type = 'individual' AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = c.client_id AND o.id <> c.id AND o.anonymised_at IS NULL)) )
```
(Builder: check the real status names and the acceptance table name in the schema; the list above follows the analyst's reading: in scope sent, viewed, rejected, expired, revised; out: draft, accepted, converted, every invoice-family type.)

| Scope | Recipient | Words taken out of the texts |
|---|---|---|
| **Client scope:** an individual client's last live contact | the whole recipient: `legalName`, `displayName`, `contactName` → "Anonymised client"; `gstin`, `address`, `deliveryAddress`, `email` removed (keys absent, never null) | the client's values and the contact's |
| **Contact scope:** a business client's contact, or a non-last contact of an individual | only when `recipient.contactId = c.id` or the emails match: `contactName` → "Anonymised client", `email` removed; the business's own name, GSTIN and address stay (13, 2026-10-25) | that contact's values |
| **Decliner only** (`decided_contact_id = c.id`, offer addressed to someone else) | untouched | that contact's values; `decision_note` → NULL |

Kept in every scope: `country`, `clientType`, `gstStatus`, `stateCode`, `contactId`.

**Open offers (Q1 = A, owner, 2026-10-31):** redaction withdraws the offer for everyone: the portal hides it; accept and decline are refused (SQL and trigger); its not-yet-queued sends are cancelled; if it is the newest frozen version of its group, the group's live offer links are revoked; its status is unchanged, so the expiry job still moves it to `expired` and a revision still moves it to `revised`.

### 2. How the write is made (no read-then-write race)
- D1 has no regex and SQLite can't express the Unicode whole-word boundary, so the **Worker computes** the redacted values from one read, then runs the existing audit-first anonymise batch.
- Frozen content can't change between the read and the batch. What can change is guarded in the batch: the audit-first row of `contact.anonymise` is written only if, at batch time, the eligible id set equals the id set read, `contacts.updated_at` equals the value read, and (client scope) `clients.updated_at` equals the value read. Every later statement is guarded on that row (`g.sql`), as today.
- On a mismatch nothing is written: the route reads again and retries once, then answers 409 `stale_version`.
- **Fixed statement count** whatever the number of offers, through `UPDATE … FROM json_each(?plan)` (the pattern in `apps/jobs/src/expire.ts`): documents 1; child text updates 3; child "mark the rest" `redacted_at` 3; `document.redact` audit rows 1; cancel sends 1; revoke links 1; bells 2; approvals' reason and note 1.
- The new statements are step **2e** in `apps/admin/worker/clients.ts` `POST /:id/erase`, after step 2d and before step 3 (client) and 4 (contact), because eligibility reads the live email and the last-live condition. Replace the comment "nothing is read before it" and the RB-37 OPEN text at the step 2d comment (T12 may have retagged it; take T12's wording on merge).

### 3. Core helper (new `packages/core/src/redaction.ts`, export `./redaction`; core keeps ≥ 90 % coverage)
- `redactionValues({recipient, contact, client?, scope})` → trimmed, unique values, blank and < 2 characters skipped, longest first.
- `redactRecipient(r, scope, contact)` → a new object.
- `redactOffer({recipient, title, sections, lines, schedule}, values, scope, contact)` → `{recipient, title, sections, lines, schedule}` (changed rows only) plus `fields: string[]` (field names only, e.g. `recipient.contactName`, `sections.body_md`, `decision_note`, `pdf`, `envelope`).
- Move `viewRecipient`, `redactionNames` and `redactor` from `apps/admin/worker/document-view.ts` onto this helper: one rule; the view of an accepted offer behaves exactly as today.

### 4. Schema and triggers
**Migration 0056** (drizzle-kit; `ALTER TABLE … ADD COLUMN` only, no rebuild): `redacted_at integer` on `documents`, `document_sections`, `document_lines`, `payment_schedules`.

**Migration 0057** (`drizzle-kit generate --custom --name offer_redaction_triggers` + `scripts/write-triggers.ts offer_redaction_triggers`; new set `offerRedactionTriggerStatements()` in `packages/db/src/triggers.ts`). New pinned lists: `SET_ONCE_0057 = [...SET_ONCE_0050, "redacted_at"]` (and `redacted_at` in the live `SET_ONCE_AFTER_FREEZE`); `REDACTABLE_FROZEN_0057 = ["recipient","title"]`; `REDACTION_CLEARS_0057 = ["decision_note"]`; frozen columns = `FROZEN_COLUMNS_0047` (builder: confirm these are the newest pinned lists on main). The move **M** = `OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND OLD.type IN ('proposal','estimate')`.
1. `DROP TRIGGER documents_frozen_update;` and recreate it (same name, same message "issued document is frozen") with a new generator `frozenUpdateTriggerRedactable(frozen, setOnce, redactable, clears)`: every frozen column `NEW.c IS NOT OLD.c`, except `recipient` and `title`: `(NEW.c IS NOT OLD.c AND NOT M)`; every set-once column `(OLD.c IS NOT NULL AND NEW.c IS NOT OLD.c)`, `decision_note` adds `AND NOT (M AND NEW.decision_note IS NULL)`. The coverage test (every frozen and set-once column named) keeps passing.
2. `documents_redaction_scope` BEFORE UPDATE OF redacted_at WHEN `NEW.redacted_at IS NOT OLD.redacted_at AND (OLD.redacted_at IS NOT NULL OR OLD.frozen_at IS NULL OR OLD.type NOT IN ('proposal','estimate') OR OLD.status IN ('accepted','converted') OR NEW.status IS NOT OLD.status OR EXISTS (SELECT 1 FROM acceptances a WHERE a.document_id = OLD.id))`.
3. `documents_redaction_insert` BEFORE INSERT WHEN `NEW.redacted_at IS NOT NULL`.
4. `documents_redacted_fixed` BEFORE UPDATE WHEN `OLD.redacted_at IS NOT NULL AND ((NEW.status IS NOT OLD.status AND NEW.status NOT IN ('expired','revised')) OR` NULL → value on any of `snapshot_r2_key, pdf_r2_key, pdf_sha256, viewed_at, decided_at, decision_reason, decision_note, decided_contact_id)`: a redacted offer takes no new PDF, view or decision.
5. `acceptances_redacted` BEFORE INSERT ON the acceptances table WHEN the document's `redacted_at IS NOT NULL`.
6. Child tables: `DROP` and recreate `document_sections_frozen_update`, `document_lines_frozen_update`, `payment_schedules_frozen_update` (same names and messages) with WHEN `(parentFrozen(OLD) OR parentFrozen(NEW)) AND NOT (OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND (SELECT redacted_at FROM documents WHERE id = OLD.document_id) IS NOT NULL AND <every non-text column: NEW.x IS OLD.x>)`; non-text column lists pinned (`*_COLUMNS_0057`). Insert and delete triggers unchanged.

Never edit an applied migration; never rebuild a referenced table (`scripts/check-migrations.mjs`).

### 5. The kept hash stays explainable
- `redacted_at` is the record that the rows no longer reproduce `content_sha256` and `snapshot_sha256`; one `document.redact` audit row per offer gives the field names, `snapshotSha12` and `pdfDeleted`.
- Nothing ever verifies a redacted offer, so no `pdf.refused` or integrity bell can fire. Jobs (`apps/jobs/src/pdf.ts`): `processSnapshot` skips `"redacted"` before `envelopeOfBundle`; `DocumentRow` and `DOCUMENT_COLUMNS` (`packages/db/src/documents.ts`) gain `redacted_at`; `RENDER_ROW_SQL` gains a `redacted` flag and render and the supplier copy skip on it; `SWEEP_SQL` adds `AND documents.redacted_at IS NULL`; `processPdfDeadLetter` rings no bell for a redacted offer; the snapshot and settle UPDATEs add `AND redacted_at IS NULL`, and if a settle changes nothing because the offer was redacted mid-render, the object just stored is deleted.

### 6. Audit (same batch)
- The existing first row `contact.anonymise` (entity client): summary `json_object('contactId', …, 'mode', …, 'reason', …, 'offers', <count>)`; its WHERE gains the guards of §2.
- After the documents UPDATE, one `INSERT … SELECT` writes a `document.redact` row per offer (entity `document`): `json_object('documentId', d.id, 'version', d.version, 'contactId', ?, 'eraseAuditId', ?, 'fields', json(<plan fields>), 'snapshotSha12', substr(d.snapshot_sha256,1,12), 'pdfDeleted', 1)` over `documents d JOIN json_each(?plan) … WHERE d.redacted_at = ?t AND g`.
- Ids, counts and field names only; never names, emails or text (a test checks).

### 7. Stored envelopes and PDFs (write-once R2 `DOCS`)
- After a successful batch, delete both objects of each offer: the keys from `pdfKeys({type, fy, number, version})` (`.json`, `.pdf`) plus any different stored `snapshot_r2_key` / `pdf_r2_key` from the read (covers an envelope whose row update was lost). Retry once; on failure log ids and keys only (no personal data) and leave them to the M7.4 sweep (follow-up F2).
- Make `dropObjects` (`apps/admin/worker/files.ts`) take the bucket, or add a small DOCS helper.
- Nothing is ever rendered from the redacted copy (trigger 4 and the jobs guards).

### 8. Afterwards
- **Export:** the contact is anonymised, so 409 `contact_anonymised` as today; another contact's export never shows the redacted rows' old values.
- **Admin document GET** (`document-view.ts`): adds `redactedAt`; `pdfOf` gains the state `"erased"`; the stored values are already redacted.
- **PDF routes** (`document-pdf.ts`, `pdfRowSql` gains `redacted_at`): GET 410 `pdf_erased`, retry 409 `pdf_erased` (message 07-ZG line 2).
- **Resend** (`document-links.ts`): adds `AND d.redacted_at IS NULL`; a redacted offer answers 409 `not_resendable` (existing copy). Revoke links still works.
- **Revise:** allowed; the new version copies the redacted text, and the anonymised contact blocks sending until another contact is chosen (existing `contactGone`).
- **Portal** (`apps/portal/worker/offer-sql.ts`): `d.redacted_at IS NULL` in `LIST_SQL`, `DOC_SQL`, `KEYS_SQL`, `VIEW_SQL`, `PRE_SQL`, `REREAD_SQL`, `ACCEPT_INSERT_SQL`, `DECLINE_UPDATE_SQL`: a redacted offer is a 404. A link to v1 whose newest version v2 was redacted answers "superseded", then v2 is 404 (kept).
- **Emails:** a not-yet-queued `offer.send` is cancelled. An email already in `EMAIL_QUEUE` still goes (link-only once the PDF is gone): accepted limit (F3).
- **Bells and activity:** document and approval bells for these offers are deleted; activity rows show the number only.

### 9. Layers
**Builder** (data → logic → API → jobs), on sub-branch `fix/t7-offer-erasure-b1` in its own worktree:
- `packages/db`: `src/schema/documents.ts` (4 columns), migrations 0056 + 0057 (snapshots, journal), `src/triggers.ts`, `src/offer-redaction.ts` + export, `src/documents.ts`;
- `packages/core`: `src/redaction.ts`, `./redaction` export, tests;
- `apps/admin/worker`: `clients.ts`, new `offer-redaction.ts` (read and plan statements, exported SQL for EXPLAIN tests), `document-view.ts`, `document-pdf.ts`, `document-links.ts`, `files.ts`;
- `apps/portal/worker/offer-sql.ts`;
- `apps/jobs/src/pdf.ts`;
- every new user-facing string uses the approved 07-ZG text word for word.

**Tier A stop point:** all of the above committed, tested and pushed; then the analyst's early check before any screen.

**Designer** (after GO), from the newest T7 branch: the admin offer read view banner (ZG-1); the PDF panel's "erased" state (ZG-2); the anonymise dialog's `too_many_offers` message (ZG-3); resend and retry hidden when `redactedAt` is set (`apps/admin/src/routes/documents/*`, `apps/admin/src/lib/offers.ts`); both themes, the usual widths, axe. No portal screen change. **(lead)** T6's "Client accepted by email?" box isn't on this branch; hiding it for a redacted offer is done when T7 takes `main` in after T6 merges (integration item).

### 10. Tests (failure paths included)
- **DB** (`packages/db/test/offer-redaction.test.ts` + the existing trigger coverage tests): the move passes on a sent proposal; every other frozen column (loop over `frozenDocumentColumns()` minus recipient and title) refuses even inside the move; recipient or title changed without the move refuses; a second redaction refuses; `redacted_at` can't change or clear; `decision_note` → another value refuses, → NULL passes; the scope trigger refuses each invoice-family type, a draft, accepted, converted, and sent-with-an-acceptance; insert with `redacted_at` refuses; after redaction: viewed, accepted and rejected refuse, expired and revised pass, a PDF or snapshot key refuses, an acceptance insert refuses; child tables: a text update needs the marker and a redacted parent, every non-text column refuses (loop), a second update refuses, insert and delete still refuse; EXPLAIN shows the eligibility read uses an index; the migration guard passes.
- **Core:** individual, business and decliner-only scopes; whole words ("Ram" vs "Ramp-up", Indic combining marks); longest first; emails; blank and 1-character values skipped; idempotent; a fast-check property that no whole-word value survives.
- **Admin** (`apps/admin/worker/offer-erasure.test.ts`): (1) individual, last contact: sent, viewed, declined-with-note, expired and revised offers redacted, every kept column byte-equal; (2) business: only that contact's offers; client name, GSTIN, address kept; another contact's offer untouched; (3) accepted and converted offers byte-identical, their R2 objects still there; (4) tax invoice, proforma, credit note untouched; (5) families: v1 (to A) revised + v2 accepted → v1 redacted, v2 untouched; v1 (to A) + v2 open to B → v1 redacted, B's links live; (6) an open offer to A also sent to B: B's waiting sends cancelled, group links revoked, portal 404 on list, view, accept, decline; (7) legal hold on contact, client or lead → 409, nothing changed, objects present; (8) envelope and PDF deleted, incl. the derived key when `snapshot_r2_key` is NULL; (9) audit summaries contain none of the person's values; (10) race (the hook used by the clients-data test "a document frozen after the request began…") → retry, then 409 `stale_version`, nothing written; (11) 11 offers → 409 `too_many_offers`; (12) erase mode unchanged (409 `on_issued_document`, nothing redacted); (13) export afterwards → 409; (14) GET shows `redactedAt` and pdf `erased`; PDF GET 410, retry 409, resend 409; (15) bells deleted, approvals' reason and note cleared. Update comments and assertions in `documents-anonymised*.test.ts` and `clients-data.test.ts` that describe "the stored snapshot stays byte-identical" for sent offers.
- **Portal:** `offer-routes`, `offer-links`, `offer-fixes` cases for a redacted offer.
- **Jobs:** snapshot of a redacted offer skipped (no object, no bell); render skipped; sweep excludes it; redacted mid-render → row unchanged, object deleted; dead letter → no bell.
- **Runs**, each through `bash tools/heavy.sh --log <name> …`: `pnpm --filter @techaust/{core,db,admin,portal,jobs} test`; admin build (record API bytes; main 618,422, line 650,000; **stop and report if over 640,000**); jobs build (main 984,266; **stop if over 995,000**); portal build; finally `pnpm check`.

### 11. Done when
Analyst GO on the early check; designer screenshots; reviewer APPROVE with the visual review; every finding fixed or kept with a reason; `pnpm check` and `pnpm test` green at the branch tip; Worker bytes recorded; 08-C RB-37 and docs 04/05/08 lines updated by the lead.

### 12. Out of scope
Accepted offers and the invoice family; serving an anonymised client's accepted-offer PDF (row 233 stays open there); logs kept under Rule 8(3) (M7.4); emails already queued; free-text mentions in offers not addressed to, or declined by, the person; a backfill; chunking past the cap.

### 13. Shared areas
- **proforma-withdraw** will likely touch `schema/documents.ts`, `triggers.ts` (may recreate `documents_frozen_update` and extend the set-once lists), `documents.ts` (`DOCUMENT_COLUMNS`), migrations and `triggers.test.ts`. T7 merges after it: take out the unapplied 0056/0057, merge `main`, rebuild the pinned lists on proforma's newest lists, regenerate.
- **T6:** `apps/admin/src/lib/offers.ts`, `offer-panels.tsx`, maybe `packages/core/package.json` exports. T7 doesn't touch `core/offers.ts`, `packages/email`, `packages/pdf` or the portal SPA copy.
- **T12:** the RB-37 comments in `apps/admin/worker/clients.ts` (step 2d) and `packages/db/src/contact-access.ts`, and 08-C §5 (T7 edits only the RB-37 row).

## Early check
**Analyst, 2026-10-31, at c687cc9: CHANGE** (1 high, 3 medium, 4 low; ran `offer-redaction.test.ts` 18 passed and `offer-erasure.test.ts` 15 passed). Checked and sound: triggers (0057's `documents_frozen_update` equals 0050's except the four intended lines; child triggers equal 0001's plus the carve-out), the batch guard proves set equality, audit rows hold no personal data, R2 keys (D1) and deletion only after success, jobs (D12), portal and D13, D5 bounded to the plan's ids, bundle growth is T7's own code (nothing large pulled in).

| # | Sev | Finding | Lead's triage |
|---|---|---|---|
| 1 | High | A frozen offer can be redacted only once (`redacted_at IS NULL` in eligibility and the triggers), so a second person's later erasure never reaches it (business: decliner then addressee; individual: first contact, then the last live contact, whose client's name stays) | **Fix:** redaction moves forward: eligibility drops `redacted_at IS NULL`; the move is `NEW.redacted_at > OLD.redacted_at` (never cleared, never backwards) on documents and children; tests for both sequences and for backwards/equal/clear refused. 0056/0057 are unapplied, so regenerate (no new migration) |
| 2 | Med | Contact scope at an INDIVIDUAL client keeps the person's own name in `recipient.legalName`/`displayName` | **Fix:** in contact scope with `clientType = individual`, run the redactor over `legalName` and `displayName`; address and GSTIN stay until the client itself is anonymised (then finding 1 lets the client scope reach the offer); test |
| 3 | Med | Whole-word matching is case-sensitive ("ASHA RAO", "Asha@Example.com" survive) | **Fix:** case-insensitive option on core `wholeWordPattern`, used by the stored redaction **and** the view of accepted offers (one rule; it only hides more); tests incl. mixed case, emails and an Indic name |
| 4 | Med | The D3 guard paths are untested beyond "an extra offer appears" | **Fix:** four `beforeBatchHolding` cases (set shrinks; last-live flips; contact `updated_at`; client `updated_at`), each retry-then-success and twice → 409 `stale_version`, nothing written |
| 5 | Low | A child row inserted with `redacted_at` set isn't refused | **Fix:** `*_redaction_insert` BEFORE INSERT triggers on the three child tables (new names); test |
| 6 | Low | Missing tests: credit note untouched; portal `offer-fixes`; EXPLAIN of the three mark statements and the guard's subqueries | **Fix:** add them |
| 7 | Low (optional) | jobs send processing doesn't check `redacted_at` | **Fix:** read it and refuse (defence in depth); test |
| 8 | — | Merge items: main (T12) conflict in `clients.ts`; proforma-withdraw takes 0056 | Main taken in by the lead (49dd653f, T7's comment kept). Renumbering to 0057/0058 waits for the main session's word after proforma merges (proforma doesn't touch T7's pinned lists) |
| CPU | — | Cheap savings: cache the compiled regex per distinct value list; `push` instead of spreads in `byDoc` | **Fix** (cheap); F4 stays |

## Builder report
**Early check** (Tier A stop point; builder, 2026-10-31, branch `fix/t7-offer-erasure-b1`, tip after this report). No screens touched except one data line (see D14).

**Skills:** `cloudflare:workers-best-practices` and `cloudflare:wrangler` were tried first; both answer "Unknown skill" in this cloud session (plugins don't load here), so none was loaded. No other skill in docs/14 §9 fits a data/logic/API task. Library behaviour was checked against the code and the running tests, not Context7 (not reachable here).

**Files by layer**
- Data (`packages/db`): `src/schema/documents.ts` (`redacted_at` on `documents`, `document_sections`, `document_lines`, `payment_schedules`); `src/triggers.ts` (`redacted_at` in the live set-once list; `SET_ONCE_0057`, `REDACTABLE_FROZEN_0057`, `REDACTION_CLEARS_0057`, `*_COLUMNS_0057`, `*_TEXT_0057`, `REDACTION_MOVE_SQL`, `offerRedactionTriggerStatements`, set `offer_redaction_triggers`); new `src/offer-redaction.ts` (`REDACTABLE_OFFER_SQL`, `LAST_LIVE_SQL`, `MAX_REDACTED_OFFERS` = 10) + export `@techaust/db/offer-redaction`; `src/documents.ts` (`redacted_at` in `DOCUMENT_COLUMNS` and `DocumentRow`); tests `test/offer-redaction.test.ts` (new), `test/migrations.test.ts`, `test/invoice-types.test.ts` (live set-once list).
- Migrations: **0056_offer_redaction** (4 × `ALTER TABLE … ADD redacted_at integer`, no rebuild) and **0057_offer_redaction_triggers** (generated by `scripts/write-triggers.ts offer_redaction_triggers`), with snapshots and journal.
- Logic (`packages/core`): new `src/redaction.ts` (`offerScope`, `redactionValues`, `redactRecipient`, `redactOffer`; `viewRecipient`, `redactionNames`, `redactor` moved here from the admin Worker), export `./redaction`, test `test/redaction.test.ts` (fast-check property included).
- API (`apps/admin/worker`): new `offer-redaction.ts` (the read, the guard, the 13 statements, exported SQL); `clients.ts` (erase route: read, guard, step 2e, one retry, 409 `too_many_offers` / `stale_version`, R2 delete after the batch; step 2d comment retagged); `document-view.ts` (`redactedAt`, `pdfOf` state `erased`, helpers imported from core); `invoice-view.ts` (import); `document-pdf.ts` (`PDF_ERASED`, GET 410, retry 409); `document-links.ts` (resend refuses a redacted offer); `files.ts` (`dropObjects(bucket, …)`, retried once); tests `offer-erasure.test.ts` (new), `documents-convert.test.ts`, comment-only updates in `documents-anonymised*.test.ts`, `clients-data.test.ts`; `apps/admin/src/lib/audit.ts` (one label, D14).
- Portal: `apps/portal/worker/offer-sql.ts`; tests in `offer-routes.test.ts`, `offer-links.test.ts`.
- Jobs: `apps/jobs/src/pdf.ts`; test `test/pdf-redacted.test.ts` (new).

**Differences from the brief (and why)**
- D1 `pdfKeys` is in `@techaust/core/pdf-jobs`, not db, and `documents.fy` holds the token (`2627`), so the derived keys use `fyLabelOfToken` first. The stored `snapshot_r2_key` / `pdf_r2_key` are added when present.
- D2 Status names, the `acceptances` table and the newest pinned lists (`FROZEN_COLUMNS_0047`, `SET_ONCE_0050`) are as the brief read them. `converted` can't be reached by a quote through `documents_status_flow` today; the db test covers it with a directly inserted converted estimate.
- D3 The batch guard also checks the **last-live state** (`(cl.type = 'individual' AND last live) = <read>`), besides the eligible set, `contacts.updated_at` and (client scope) `clients.updated_at`: a contact added or anonymised between the read and the batch would change the scope (client vs contact) without changing either `updated_at`.
- D4 `decision_note` goes to NULL on **every** redacted offer (L2 "Erased: decision_note → NULL"), not only in the decliner-only scope of the table; the reason code, date and decider id stay.
- D5 Sends: every send of a redacted offer **that holds no link yet** is cancelled (the rule the "Revoke links" route already uses). This is a superset of "not-yet-queued": a send queued but not yet processed is stopped too, because jobs mints a link only while `cancelled_at` is NULL. An email whose link was already minted still goes (F3).
- D6 Values in client scope also include the recipient snapshot's own GSTIN (it is removed from the recipient anyway; a text mention holds the PAN).
- D7 Scope is decided by a new core `offerScope`; "addressed to the contact" also counts `documents.contact_id = c.id` (matches `REDACTABLE_OFFER_SQL`). `redactRecipient(r, scope)` takes no contact (unused). `redactOffer` takes `decisionNote` in its input and its `fields` always end with `envelope`, `pdf`.
- D8 Erase mode reads nothing and adds no statement (as today). In anonymise mode with no eligible offer the 13 statements are left out, but the guard still proves the set is empty at batch time.
- D9 The read is one batch of 5 statements (contact and client; offers, at most 11; sections; lines; schedule). Each `document.redact` row's id is a Worker `uuidv7` carried in the plan.
- D10 Messages use the owner-approved 07-ZG text (lead's message, 2026-10-31), not "[Placeholder]": `pdf_erased` "The PDF was deleted when the personal details were erased." (`document-pdf.ts`), `too_many_offers` line 3 (`offer-redaction.ts`). Line 1 is the designer's; no constant added.
- D11 Trigger `acceptances_redacted`'s message is "…erased is never accepted" (the apostrophe of "can't" broke the SQL string literal of `RAISE`).
- D12 Jobs: the snapshot step also guards its row update (`AND redacted_at IS NULL`) and deletes an envelope stored while the offer was being redacted (the brief named this for the settle only); `processRender` checks the redacted flag before its "already done" branch, so a redacted offer that had a PDF never wakes a send. The supplier-copy skip is kept for completeness (a proposal has no supplier copy).
- D13 Portal: `LATEST_SQL`, `CERT_KEY_SQL`, `HAS_ACCEPTANCE_SQL` unchanged (the superseded rule; accepted offers are never redacted).
- D14 `apps/admin/src/lib/audit.ts` gains `"document.redact": "[Placeholder]"`: the admin test `audit-labels.test.ts` fails without a label for every written action, and 07-ZG has no line for it. This is the only `apps/admin/src` change.

**Commands and results** (heavy ones through `tools/heavy.sh`)
- `pnpm --filter @techaust/db test`: 36 files, **533 passed** (first run: 1 failed, the migration list; fixed).
- `pnpm --filter @techaust/core test`: 92 files, **1878 passed**; coverage statements 99.02 %, branches 97.98 %, functions 98.54 %, lines 99.15 %.
- `pnpm --filter @techaust/admin test`: 121 files, **3508 passed** (first run: 2 failed, `documents-convert` and `audit-labels`; fixed).
- `pnpm --filter @techaust/portal test`: 25 files, **655 passed**. `pnpm --filter @techaust/jobs test`: 34 files, **555 passed**.
- `pnpm --filter @techaust/admin typecheck`: exit 0.
- Builds: admin front **99,271** bytes (limit 150,000); admin API **629,427** bytes (main 618,422, +11,005; under the 640,000 stop line); portal **100,916** (limit 120,000); jobs **985,464** (main 984,266, +1,198; under the 995,000 stop line). Startup fastest of 7: admin 13.3 ms, admin API 79.8 ms, portal 12.5 ms, jobs 74.5 ms.
- `node scripts/check-migrations.mjs`: ok (58 migrations, none rebuilds a referenced table).
- `pnpm check`: first run failed (biome format of the drizzle-written `_journal.json` and the 0056/0057 snapshots); after `biome format` on those three files, **exit 0** (lint, typecheck, guards, migration guard).
- EXPLAIN (in `offer-erasure.test.ts`, `offer-redaction.test.ts`): every read and write statement searches by an index (`documents_client_type_status`, `acceptances_document`, `contacts_client_email`, the child tables' `*_position`, `document_sends_document`, `offer_links_group`/`offer_links_send`, `notifications_entity`, `approvals_document`); the only scan is the bound `json_each` list.
- No dev server was started.

**Not verified**
- CPU of a 10-offer anonymise on staging (F4); no staging access here.
- An R2 delete that fails twice (only the log line by key is written; not forced in a test).
- The screens (designer), and the T6 "Client accepted by email?" box (integration item).

**Open questions**
- Q-B1 (owner, copy): the activity label for `document.redact` (now "[Placeholder]"). Suggested line: "erased the personal details in a document".
- Q-B2 (lead): D5, cancelling a queued-but-unprocessed send as well; keep (recommended, fewer emails to a withdrawn offer) or narrow to `queued_at IS NULL`?
- F1 (backups leaving out proposals and estimates) still stands before Phase 7.

## Designer report

## Review

## Integration notes

## Lead decisions (for 13)
- 2026-10-31, Lead (early-check triage): a never-accepted offer's redaction can run again when a later erasure names another person on it (`redacted_at` only moves forward); whole-word redaction ignores case, in the stored copy and in the view of accepted offers; an individual client's own name in the recipient block is redacted when its matching contact is anonymised, the rest of its details when the client itself is.
- 2026-10-31, Lead (builder's Q-B2): erasing details from an open offer cancels every send of it that has no link yet, queued-but-unprocessed ones included (the "Revoke links" rule), so no email goes out about a withdrawn offer. The builder's other differences from the brief (D1–D14 in the Builder report) are accepted, subject to the early check.
- 2026-10-31, **Owner** (T7 Q1): when a never-accepted open offer's addressee is anonymised, the offer is withdrawn at once: hidden from the portal for everyone, accept and decline refused, it still expires on its date; the one exception to "a sent offer stays open until the next version" (2026-10-25). Applied: `apps/portal/worker/offer-sql.ts`, trigger `acceptances_redacted`, `apps/admin/worker/clients.ts`.
- 2026-10-31, **Owner**: 07-ZG lines 1–3 approved word for word ([07-ZG](../07-content-appendix/ZG-offer-erasure.md)).
- 2026-10-31, Lead (analyst's draft): T7 design L1–L8 above (per-version scope; what is kept and erased; "Anonymised client" by whole words, values under 2 characters skipped; erase eligibility unchanged, redaction in anonymise mode; cap 10 offers per request; no backfill; never-accepted offers' PDFs deleted; RB-37(a) supersedes the 2026-10-26 "stored snapshot untouched" rows for never-accepted offers only).

## Follow-ups (for 12)
- **F1 (before Phase 7):** the 10-year monthly finance backup exports the whole `documents` table; it must leave out proposals and estimates (or redacted rows), or backups keep erased data.
- **F2 (M7.4):** the R2 sweep deletes any envelope or PDF a failed delete left behind.
- **F3 (optional):** mark the person's still-`queued` `email_log` rows skipped in the batch (check the `email_log` triggers first).
- **F4:** a staging cold CPU reading of anonymise with the 10-offer fixture (`docs/runbooks/cpu-baseline.md`).

## Handover
