Status: builder (b2) and designer (d1) running
Tier: A
Usage: analyst claude-opus-5-5/high (brief draft; skills: none, the Cloudflare skills don't load in a cloud session): 5-h 1 → 14 %; builder (b1) claude-opus-5-5/high (skills: none, as above; model-audit flags both runs for that, explained): 5-h 14 → 53 %; analyst early check claude-opus-5-5/high (skills: `security-review` tried, it failed to load: no `origin/HEAD`; checklist applied by hand): 5-h 53 → 53+

# Rebuild PDF (cloud session `rebuild-pdf`, branch `feat/rebuild-pdf`)

An Owner-only tool that re-creates a stored write-once PDF that is missing or damaged in R2 `DOCS`, from its sealed envelope, so a lost PDF can never block a client or an audit.

Basis: [13](../13-decisions.md) 2026-10-29 ("Rebuild PDF … its own Tier A task before production"); [m5-owner-fixes](m5-owner-fixes.md) F1; [m7.5-hardening](m7.5-hardening.md) L25; [full-audit-m6-m7](full-audit-m6-m7.md) follow-up; [phase7-production](phase7-production.md) A1.12.

Lead skills: none of docs/14 §9's Cloudflare skills load in a cloud session (no plugins there; CLAUDE.md "In a cloud session"); `code-review` and `security-review` are for the reviewer.

## Questions for the owner
**Answers (owner, 2026-11-07, relayed by the main session):** Q1 **B** ("No, send a new version"): a rebuild of an offer the client can still accept is refused with 07-ZV line 19; the portal's accept path is not changed; accepted offers and the invoice family can still be rebuilt. Q2 **A** ("No mark"). 07-ZV lines 1–19 approved as written (the lead, under the owner's delegation for staff-only lines, 2026-11-07).

Plain-English context: a rebuilt PDF is the same sealed content printed again through today's layout code. It is never the same file byte for byte (the PDF maker writes a new creation date and file ID every time), so its fingerprint (SHA-256) differs from the first file's. The printed "Content fingerprint" line inside the PDF stays the same.

- **Q1. May the Owner rebuild the PDF of an offer the client can still accept** (sent or viewed, still valid, the newest version)?
  - **A (Recommended):** yes. When the client accepts, the acceptance records the fingerprint of the file the portal actually showed them (the rebuilt one, if there is one), so the acceptance certificate always names the file the client was offered. The client is never blocked.
  - **B:** no. The Owner sends a new version of the offer instead (as was done for TH/PRP/2627/0001 on 2026-10-29); the rebuild is refused with "This offer can still be accepted. Send a new version instead."
  - Either way an offer that was already accepted keeps its certificate as it is: the certificate names the first file, and the rebuild record keeps that file's fingerprint and key.
- **Q2. Should a rebuilt PDF carry a mark?**
  - **A (Recommended):** no mark. The rebuilt file prints exactly what the first file printed (an invoice's recipient copy still reads "ORIGINAL FOR RECIPIENT", since it is the same invoice, CGST Rule 48(1)). The admin's "Rebuilt on {date}" line and the rebuild record say what happened.
  - **B:** a small line on the PDF, "Re-made on {date} from the sealed record" (a layout change and a new client-visible line for your approval).
- **ZV.** The staff lines in [07-ZV](../07-content-appendix/ZV-rebuild-pdf.md) (19 numbered lines, staff only): approve as written (Recommended), or change any line. Under the owner's delegation the main session may approve these.

The builder builds everything neither question touches; Q1 decides one refusal or one SQL change in the portal's accept, and Q2 = A is built by default.

## Brief
Analyst draft (claude-opus-5-5/high, 2026-11-07), checked and finalised by the lead. Changes by the lead are marked **(lead)**.

### Points that shape the task
1. **A rebuild is the same sealed content through today's layout, never the same file.** Envelopes don't pin a layout version (`packages/pdf/src/invoice-types.ts`, `types.ts`). "Verify" means the envelope seal or row seal, checked exactly as the first render checks it. The printed "Content fingerprint" line (`packages/pdf/src/invoice-view.ts:377`, the snapshot SHA) is unchanged. (Q1, Q2.)
2. **The acceptance certificate names the original PDF's hash** (`acceptances.pdf_sha256`, `ACCEPT_INSERT_SQL`, `apps/portal/worker/offer-sql.ts:104`). Q1.
3. **"Intact = bytes match `pdf_sha256`"** can't see the F1 case (there `pdf_sha256` equalled the damaged bytes). Since 2026-10-29 every PDF passes `checkPdfIntegrity` before it is stored (`apps/jobs/src/browser.ts:168`), so production can't hold such an object; pre-2026-10-29 staging objects are out of scope (L6).
4. **`pdf_asks` is not reused:** retention prunes it after 2 days (`packages/db/src/retention.ts:65`). The guarded request INSERT is both the throttle and the record (L2).
5. **Readers resolve at the R2 read boundary by the original key.** Every portal PDF download goes through `streamPdf` (`apps/portal/worker/offer-core.ts:255`); email attachments through `attachmentFor(env, {key})` (`apps/jobs/src/email.ts:143`). One indexed lookup `original_key → newest rebuilt key` covers all of them; reader SQL, `ATTACHMENT_KEY` and the hot routes' warm fixtures stay unchanged (L3).
6. **A missing envelope is refused, never re-made from rows** (L5).
7. **Statements need nothing:** a new request makes a new cache row and jobs re-renders under the content-hash key when the object is missing (`apps/admin/worker/statement-pdf.ts:112-120`, `:164-165`). No statement file is touched.

### PRD IDs
- JOB-PDF-01 ("never re-rendered for frozen documents"; this task is the recorded exception).
- **New JOB-PDF-02** (the main session adds it to 04): "Rebuild PDF: the Owner, with step-up, re-creates a stored PDF that is missing or fails its recorded SHA-256, from the sealed envelope or row, under a new write-once key. The frozen row and the old object are never changed. Each rebuild is recorded (`pdf_repairs`). Readers serve the newest rebuilt file." Acceptance: the done-test below.
- ADM-PROP-05, ADM-PROP-08 (only if Q1 = A), ADM-INV-07, ADM-PAY-09, POR-05, POR-06, POR-07, ADM-AUD-01, NFR-7.
- New 04 §9 row: "Rebuild a stored PDF (`pdfs.rebuild`) | ✅ (step-up) | — | — | —".

### Scope (subject kinds)
| kind | subject id | recorded key / hash | Worker |
|---|---|---|---|
| `offer` | documents.id (proposal, estimate) | `documents.pdf_r2_key` / `pdf_sha256` | API |
| `certificate` | acceptances.id (the route takes the document id) | `acceptance_certificates.r2_key` / `sha256` | API |
| `deed` | deeds.id (final or signed) | `deeds.unsigned_r2_key` / `unsigned_sha256` | API |
| `invoice` | documents.id (tax_invoice, export_invoice, proforma, credit_note, debit_note; void or withdrawn included) | `pdf_r2_key` / `pdf_sha256` | invoices |
| `supplier` | documents.id (`SUPPLIER_COPY_TYPES`) | `supplierPdfKey(...)` / no hash column: R2's stored `checksums.sha256` (passed on put since 2026-10-29). A test must prove workerd returns it; without one, a present copy counts as intact. | invoices |
| `receipt` | documents.id (type receipt, issued or void) | `pdf_r2_key` / `pdf_sha256` | invoices (`guard.ts:348-349`) |

**Out of scope:** never-rendered objects (signed deed uploads, payment proofs, vault files, envelopes, signature images: an incident, incident.md Step 4; the S3 copy); the statement cache; a bulk rebuild after a whole-bucket loss (follow-up); rows-derived envelopes; restoring the original key.

**Owned elsewhere (don't touch):** core `statement.ts`, `apps/admin/worker/statements.ts`, `statement-pdf.ts` (admin and jobs), the statement layout, the portal statement view (session `au45-statement`); `apps/admin/worker/gateway/*`, `packages/core/src/{razorpay,paypal,stripe}.ts`, `apps/jobs/src/hooks/*`, `.github/workflows/*`, settings and LUT code (the PC). If an item needs one of these, stop and report it as a follow-up.

### Data (builder)
**`packages/db/src/schema/pdf-repairs.ts`** (new; exported from `schema/index.ts`). `drizzle-kit generate --name pdf_repairs` makes **0087**: new tables only, nothing rebuilt.

`pdf_repairs` (the request; append-only):
- `id` text PK (UUIDv7)
- `subject_kind` text NOT NULL, CHECK in (`offer`, `certificate`, `deed`, `invoice`, `supplier`, `receipt`)
- `subject_id` text NOT NULL (no FK: polymorphic; the insert trigger checks it)
- `n` integer NOT NULL, CHECK 1–99
- `original_key` text NOT NULL (the key the subject records; the stem for every `-rN`)
- `old_key` text NOT NULL (the key served when the request was made)
- `old_sha256` text NULL (null only for a supplier copy with no stored checksum)
- `found` text NOT NULL, CHECK in (`missing`, `damaged`) (the reason)
- `new_key` text NOT NULL UNIQUE
- `requested_by` text NOT NULL, FK `staff_users.id`
- `requested_at` integer NOT NULL
- CHECKs: keys ≤ 512 characters starting `docs/` or `deeds/`; `old_sha256` null or 64 lower-case hex.
- Indexes: unique `(subject_kind, subject_id, n)`; `(requested_by)` (FK-child index rule, 0080); `(original_key)` if the insert trigger's served-key subquery needs it (**lead**: check EXPLAIN).

`pdf_repair_results` (the completion; append-only; at most one per request):
- `repair_id` text PK, FK `pdf_repairs.id`
- `original_key` text NOT NULL, `n` integer NOT NULL (copied from the request, checked by trigger)
- `outcome` text NOT NULL, CHECK in (`rebuilt`, `intact`, `refused`, `failed`, `skipped`)
- `code` text NULL, CHECK `code GLOB '[a-z_]*'`, length ≤ 40
- `new_key` text NULL, `new_sha256` text NULL, `bytes` integer NULL
- `completed_at` integer NOT NULL
- CHECK: (outcome = 'rebuilt') = (new_key IS NOT NULL AND new_sha256 IS NOT NULL)
- Partial index `pdf_repair_results_served ON (original_key, n) WHERE outcome = 'rebuilt'` (the readers' lookup; the SQL says `outcome = 'rebuilt'` literally).

Two tables (L1): an append-only request plus an append-only result needs no UPDATE carve-out. Idempotency comes from the result's PK (`INSERT … WHERE NOT EXISTS`), mirroring `acceptances` + `acceptance_certificates`. "In progress" = a request without a result.

**0088 custom** (`drizzle-kit generate --custom --name pdf_repair_triggers`, then `node scripts/write-triggers.ts pdf_repair_triggers`); the set in a new `packages/db/src/triggers-pdf-repairs.ts`, registered in `TRIGGER_SETS` (`packages/db/src/triggers.ts` ~2500) as `pdf_repair_triggers`:
1. `pdf_repairs_no_update`, `pdf_repairs_no_delete`, `pdf_repair_results_no_update`, `pdf_repair_results_no_delete` (the `appendOnly` helper, `triggers.ts:232`).
2. `pdf_repairs_insert` (BEFORE INSERT) refuses unless: the subject exists in the kind's state (frozen with a PDF recorded; an offer `redacted_at IS NULL`; a deed final or signed); the client is not anonymised; `original_key` equals the subject's recorded key (supplier: `substr(pdf_r2_key,1,length-4)||'-supplier.pdf'`, the same as `supplierPdfKey`; twin-test it); `n` = 1 + the max `n` for that subject; `new_key` = `substr(original_key,1,length(original_key)-4)||'-r'||n||'.pdf'`; `old_key` = coalesce(the newest rebuilt `new_key` for `original_key`, `original_key`).
3. `pdf_repair_results_insert` (BEFORE INSERT): the request exists; `original_key` and `n` equal the request's; `new_key` equals the request's when rebuilt; `new_sha256` 64 lower-case hex when rebuilt; `completed_at >= requested_at`.
4. `documents_redact_repairs_outbox` (AFTER UPDATE OF redacted_at, the same WHEN as `documents_redact_outbox` in `triggers-data-protection.ts:266`): queue every rebuilt `new_key` of `OLD.pdf_r2_key` (and of its certificate key, if a certificate is ever rebuilt for a never-accepted offer: it can't be, but keep the trigger to the offer key) into `r2_deletions` (`ON CONFLICT DO NOTHING`). It writes rows, so the redaction batch's checks must stay `changes() > 0` (confirm).

Also in the data layer: `RETENTION_MATRIX` (`retention.ts`) `record(…)` for both tables (never deleted; ids, keys and hashes only); `BACKUP_SCOPE` (`backup-scope.ts`) both finance-scope (`F`) so a restored monthly copy serves the right key; core audit `FINANCE_AUDIT_ACTIONS` add `pdf.rebuild` if the invoice family's audit rows are listed there; `packages/db/test/migrations.test.ts` table count and list. **(lead)** If #193's backup code lists tables elsewhere (the nightly backups), add both there too and say where.

### Core (builder)
- **`packages/core/src/pdf-repair.ts`** (new, pure): `REPAIR_KINDS`, `REPAIR_OUTCOMES`, `REPAIR_MAX = 99`; `repairKey(originalKey, n)` (refuses a key not ending `.pdf` or already ending `-r\d+.pdf`); `rebuildVerdict({recordedSha, objectSha | null})` → `missing | damaged | intact`; `REBUILD_WINDOW_MS = 300_000`; `REBUILD_OPEN_MS = 26 * 3_600_000` (queue retention 24 h plus a quota delay). Tests: a fast-check property for `repairKey` and a twin test against the trigger's SQL key expression. Core coverage stays ≥ 90 %. Add it to the package exports as a subpath.
- `packages/core/src/pdf-jobs.ts`: `PdfRebuildMessage = { v: 1; kind: "pdf.rebuild"; repairId: string; hop: number }` in the `PdfMessage` union and `isPdfMessage` (same bounds as `pdf.render`).
- `packages/core/src/permissions.ts`: `"pdfs.rebuild": { owner: "step-up" }` (every other role deny).

### SQL (builder): `packages/db/src/pdf-repairs.ts` (new)
- `SERVED_PDF_SQL` (`?1` original key): `SELECT new_key, new_sha256, completed_at FROM pdf_repair_results WHERE original_key = ?1 AND outcome = 'rebuilt' ORDER BY n DESC LIMIT 1` (EXPLAIN shows the partial index).
- `SUBJECT_SQL[kind]`: recorded key and hash, `gone` (`clientGoneSql`), `redacted_at`, number label, status.
- `REPAIRS_OF_SQL`: the newest 10 requests for a subject with their results.
- `REQUEST_INSERT_SQL`, guarded `WHERE NOT EXISTS (… same subject AND (requested_at > now − 5 min OR (requested_at > now − 26 h AND no result)))`.
- `RESULT_INSERT_SQL`, guarded `WHERE NOT EXISTS result` and, for `rebuilt`, the subject still not redacted and its client not anonymised.

### Admin API (builder)
New `apps/admin/worker/pdf-rebuild.ts` (one factory `rebuildRoutes(kinds)`) and `apps/admin/worker/pdf-served.ts` (`servedPdf(env, originalKey)`: one `SERVED_PDF_SQL` query, then the R2 get). No new bindings (both Workers bind `DOCS` and `PDF_QUEUE`; confirm).

| Method | Path (`/api/v1`) | Worker | Action | Audit | Body |
|---|---|---|---|---|---|
| POST | `/documents/:id/pdf/rebuild` | API | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` strict |
| POST | `/documents/:id/certificate/rebuild` | API | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` |
| POST | `/deeds/:id/pdf/rebuild` | API | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` |
| POST | `/invoices/:id/pdf/rebuild` | invoices | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` |
| POST | `/invoices/:id/pdf/supplier/rebuild` | invoices | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` |
| POST | `/receipts/:id/pdf/rebuild` | invoices | `pdfs.rebuild` | `pdf.rebuild` | JSON `{}` |
| GET | `/documents/:id/pdf/rebuilds` | API | `proposals.read` | none | none |
| GET | `/documents/:id/certificate/rebuilds` | API | `proposals.read` | none | none |
| GET | `/deeds/:id/pdf/rebuilds` | API | `deeds.view` | none | none |
| GET | `/invoices/:id/pdf/rebuilds` | invoices | `invoices.read` | none | none |
| GET | `/invoices/:id/pdf/supplier/rebuilds` | invoices | `invoices.supplierCopy` | none | none |
| GET | `/receipts/:id/pdf/rebuilds` | invoices | `payments.read` | none | none |

Check each read action name against `permissions.ts` (use the action the matching existing GET uses).

**POST flow:**
1. One batch: `SUBJECT_SQL` + `REPAIRS_OF_SQL`.
2. Refuse in this order: 404 (unknown, draft, wrong type); 409 `pdf_pending` (no PDF recorded: the existing Retry); 409 `client_gone` (`CLIENT_GONE`); 409 `pdf_erased` (a redacted offer); [Q1 = B only: 409 `offer_open`]; 409 `rebuild_in_progress` (an open request under 26 h); 429 `too_soon` (last request under 5 minutes).
3. Served key = the newest rebuilt key, else the original; the recorded hash = the newest result's `new_sha256`, else the row's (supplier: the stored checksum).
4. **(lead)** The check, cheapest first: `DOCS.head(served)`: null → `missing`. If the head carries `checksums.sha256`, compare it with the recorded hash (R2 computed it from the bytes it stored and checked it against ours at put) and stop there. Otherwise `DOCS.get` and hash with `crypto.subtle.digest`; an object over 5 MB is `damaged` without reading the body (cancel the stream). Equal → 409 `nothing_to_rebuild` (nothing written).
5. `mutate`: main = `REQUEST_INSERT_SQL`; the audit row only if a row changed (summary `{repairId, kind, number, n, found}`, entity `document`, `deed` for deeds). Not written → 409 `rebuild_in_progress`.
6. **Await** `PDF_QUEUE.send({v:1, kind:"pdf.rebuild", repairId, hop:0})` (not `waitUntil`). If it throws: insert a result `failed` / `queue_unavailable` and answer 503 `queue_unavailable`.
7. Answer 202 `{ repair: { id, n, found, state: "rebuilding" } }`.

Step-up is the guard's (`STEP_UP_REQUIRED`).

**GET answer:** `{ rebuiltAt: number | null, rebuilding: boolean, served: { sha256 } | null, history: [{ n, found, requestedAt, outcome, code, completedAt }] }` (≤ 10 rows). Separate from the existing reads, so no hot route's SQL changes and the warm fixtures stay (L4).

**Admin readers** call `servedPdf(env, originalKey)`: `document-pdf.ts:74` (offer and invoice GET; ETag = the served SHA) and `:148` (supplier: a rebuild wins; otherwise the current self-heal stays); `receipt-issue.ts:253`; `document-links.ts:281` (certificate); `deeds.ts:910` (unsigned only). Keep the "pdf object missing" log after the lookup.

### Jobs (builder)
- **Reuse refactor, no behaviour change** (the existing tests prove it): pull a "render plan" (verify, then HTML and options, or a refusal code) out of each first-render path: `offerPlan` (`apps/jobs/src/pdf.ts:622-648`), `invoicePlan(copy)` (`:333-413`: seal, signature, `signatureMissing`, statutory lines), `certificatePlan` (`:735`, plus a refusal `certificate_unsealed` when the document has no frozen `recipient.legalName`, so the live client name is never used), `receiptPlan` (`receipts.ts:186-206`; the status gate stays outside the plan), `deedPlan` (`deed-pdf.ts:119-138`). First-render callers keep their bells, `REFUSED_MARK_SQL`, adopt and settle.
- **`apps/jobs/src/pdf-rebuild.ts`** (new) `processRebuild(env, msg, now, …)`:
  1. One batch: the request, its result, the subject facts. A result already there → log, return.
  2. Subject gone, client anonymised or offer redacted → result `skipped` (`not_found`, `client_gone`, `redacted`); no render.
  3. Re-check `old_key` (the same head-then-hash check): present and equal to `old_sha256` → `intact` / `original_present`; no render.
  4. An object already at `new_key` (redelivery after the put) → hash it, adopt it, result `rebuilt`.
  5. Read the envelope (offer and invoice families). Missing → `failed` / `envelope_missing` and a bell.
  6. Plan. A refusal → `refused` / its code, a `pdf.refused` bell (entity `pdf_repair`), and **no** `pdf_failures` write.
  7. `renderPaced` (the 10 s pacer and the integrity check). Not ok → `failed(env, msg, …)` (rate and quota delay with `hop`; anything else throws, the queue retries).
  8. `putPdfOnce(DOCS, new_key, bytes)` (sha256 passed, `onlyIf etagDoesNotMatch "*"`).
  9. One batch: `RESULT_INSERT_SQL` (`rebuilt`, SHA, bytes), stats `pdf.renders`, `pdf.browser_ms`, `pdf.rebuilds`, `HALF_BELL_SQL`. If 0 rows changed and the subject is now redacted or gone → `DOCS.delete(new_key)` and `skipped` (the T7 pattern, `pdf.ts:563-567`).
  10. Bell `pdf.rebuilt` (entity `pdf_repair`).
- `queue.ts:113-133`: route `pdf.rebuild` before `processPdf` (as `pdf.deed` and `pdf.statement`). DLQ: `processRebuildDeadLetter` writes `failed` / `dead_letter` and the bell. The `failed()` union gains `PdfRebuildMessage`.
- Receipts and deeds keep their placeholder and copy gates inside the plan.

**R2 keys** (`repairKey`): `docs/proposal/2026-27/0001-v1-r1.pdf`, `docs/tax_invoice/2026-27/0003-v1-supplier-r1.pdf`, `docs/estimate/2026-27/0002-v1-certificate-r1.pdf`, `docs/receipt/2026-27/0001-v1-r1.pdf`, `deeds/<id>/unsigned-<sha>-r1.pdf`. The served key is used **only** at the R2 read; nothing stores it or derives another key from it (`certificateKeyOfPdfKey`, `ACCEPT_INSERT_SQL`'s certificate key, `ATTACHMENT_KEY`).

### Readers outside admin (after the early check)
- Portal `streamPdf` (`apps/portal/worker/offer-core.ts:255`) resolves `SERVED_PDF_SQL` first: offers, the certificate, invoices, receipts and doc-token (`doc-token.ts:302`, `invoices.ts:215,239`, `offer-core.ts:272,285`). The signed deed (`deeds.ts:78`) passes `{ rebuildable: false }`. Scoping unchanged: the key still comes from the client-bound row. **(lead)** The portal keeps under its plan line (180,000); measure.
- Jobs `attachmentFor` (`email.ts:156`) resolves the served key before `docs.get`; messages keep the original key.
- Q1 = A only: `ACCEPT_INSERT_SQL` takes `coalesce((SELECT new_sha256 … served for d.pdf_r2_key), d.pdf_sha256)` for `acceptances.pdf_sha256` and in `RETURNING`. Q1 = B only: the `offer_open` refusal. Wait for the answer.

### Error codes
| Code | Status | When |
|---|---|---|
| `not_found` | 404 | unknown, draft or wrong type |
| `pdf_pending` | 409 | no PDF recorded yet |
| `client_gone` | 409 | anonymised client |
| `pdf_erased` | 409 | redacted offer |
| `offer_open` | 409 | only if Q1 = B |
| `rebuild_in_progress` | 409 | open request, or a lost race |
| `too_soon` | 429 | last request under 5 minutes old |
| `nothing_to_rebuild` | 409 | stored file matches |
| `queue_unavailable` | 503 | the queue send failed |
| `forbidden` / step-up | 403 | not the Owner / the existing `STEP_UP_REQUIRED` |

Result codes: `original_present`, `envelope_missing`, `shape`, `row_mismatch`, the `verifyEnvelope` / `verifyInvoiceEnvelope` codes, `signature`, `signature_required`, `statutory_*`, `certificate_unsealed`, `receipt_seal`, `deed_seal`, `client_gone`, `redacted`, `not_found`, `queue_unavailable`, `dead_letter`.

### Copy
The staff lines of [07-ZV](../07-content-appendix/ZV-rebuild-pdf.md), word for word. **(lead)** The API messages use lines 6–10; the builder puts them in as written (staff-only lines under the delegation, as 07-ZT's staff lines). If the main session changes a line, the lead updates it.

### Screens (designer, after the analyst's GO)
- New `apps/admin/src/components/rebuild-pdf.tsx` (Owner button, confirm dialog, step-up and retry, polling the GET every 10 s while `rebuilding`, the result line) and `apps/admin/src/lib/pdf-repairs-api.ts`.
- Wired into `routes/documents/pdf-panel.tsx` (offer PDF), `routes/documents/offer-panels.tsx:100` (certificate), `routes/invoices/read.tsx` (PDF and supplier copy), `routes/payments/refund-parts.tsx:306` (receipt; grep `receiptPdfHref`), `routes/projects/deed.tsx` (unsigned PDF).
- The button only when `decide(role, "pdfs.rebuild") !== "deny"` and the PDF is ready; "Rebuilt on" for anyone who can read the document.
- 390 and 1280 px, both themes, the in-app theme against the OS theme, empty/loading/error, axe 0.

### Tests
**Done-test** (jobs pool, `apps/jobs/test/pdf-rebuild.test.ts`), for an invoice and for an offer: seed an issued document with its envelope and PDF in `DOCS`, delete the PDF object, insert the request with `REQUEST_INSERT_SQL`, run `processRebuild` with a fake Browser Run; prove the object at `-r1.pdf` (put with sha256), a `rebuilt` result, `SELECT *` of the `documents` row identical before and after, `SERVED_PDF_SQL` returns the new key. Admin half (`apps/admin/worker/pdf-rebuild.test.ts`): POST 202, the request row and exactly one `pdf.rebuild` audit row, the frozen row unchanged; after a result row and the object are added, `GET /invoices/:id/pdf` (and the offer GET) serves the new bytes with the new ETag. The two halves share one fixture (`packages/testing`).

**Admin:** intact → `nothing_to_rebuild`, 0 rows written; damaged bytes (a test put without `onlyIf`) → 202 `found: damaged`; anonymised → `client_gone`; redacted → `pdf_erased`; open request → `rebuild_in_progress`; < 5 min → 429; after a result and 5 min → `n = 2`, `old_key` = r1, `new_key` = r2; staff, accountant, sales → 403; Owner without step-up → step-up; queue failure → 503 and a `failed` result; every kind's GET and download serve the rebuilt file; `split.test.ts` ownership; route-inventory parity; the D1 budget (≤ 45).

**DB** (`packages/db/test/pdf-repairs.test.ts`): each insert-trigger refusal; UPDATE and DELETE abort on both tables; result shape and second insert; redaction queues the rebuilt key in `r2_deletions`; trigger-text drift; retention and backup matrices; EXPLAIN of `SERVED_PDF_SQL`.

**Jobs:** every kind through its plan; a tampered envelope (JSON edited in `DOCS`) → `refused`, no object at the new key, a bell; `envelope_missing`; original reappeared → `intact`, no render; redelivery adopted once; a result already there → no render; anonymised between request and render → no render; redacted after the put → object deleted; rate and quota → delayed with `hop`; DLQ → `failed` and a bell; `attachmentFor` serves the rebuilt key; workerd's `head()` returns `checksums.sha256` after a put with sha256 (or the test records that it doesn't, and the supplier and head-shortcut paths fall back).

**Portal:** offer, certificate, invoice, receipt and doc-token serve the rebuilt file when the original is gone; another client → 404; no repair → the original.

**Core:** `repairKey` property, `rebuildVerdict`, `isPdfMessage` bounds, the permission row.

### Early-check stop point (builder)
Stop after, committed and with their tests passing: (1) schema, 0087, 0088, retention and backup rows; (2) core; (3) `packages/db/src/pdf-repairs.ts`; (4) the six POST and six GET routes, their ROUTES rows, `servedPdf` and the admin readers; (5) `apps/jobs/src/pdf-rebuild.ts` with the plan refactor. After GO: portal `streamPdf`, `attachmentFor`, Q1's accept change, then the designer.

### Worker bytes (estimates, to be measured)
| Worker | Main | Added | Limit |
|---|---|---|---|
| admin front | ~120 K | ~1 K | 150 K |
| API | ~556 K | 6–9 K | 800 K |
| finance | ~425 K | ~1 K | plan 500 K |
| invoices | ~562 K | 6–9 K | plan 650 K |
| portal | ~164 K | 0.5–1 K | plan 180 K |
| jobs | ~871 K | 6–10 K | 1,000 K |

CPU: the admin check hashes at most one PDF (native digest, ~300 KB typical) only when R2 has no stored checksum. Staging cold reading after merge (runbook `cpu-baseline.md`).

### Risks
1. Bulk loss: each rebuild uses Browser Run time (10 min/day); a whole-bucket loss needs a bulk tool (follow-up).
2. Envelope or signature lost too: `refused` or `failed` with a clear code; incident.md Step 4 still applies.
3. Supplier copy: the download self-heal can still re-make a lost copy under its original key beside a rebuild; harmless, readers serve the newest rebuild.
4. An anonymised client's invoice PDFs can't be rebuilt (the owner's standing rule, 08-C RB-11) although the originals are kept for 8 years (08-C RA-25). Follow-up for the record, not re-opened here.
5. Migration numbers may collide with parallel branches: renumber at merge.
6. One extra D1 query per download (downloads aren't hot routes).

## Lead decisions (for 13)
- **2026-11-07, Rebuild PDF (L1–L12), Lead:** two append-only tables, `pdf_repairs` (request) and `pdf_repair_results` (completion), no UPDATE carve-out (L1); the guarded request INSERT is the 5-minute throttle, `pdf_asks` not used (L2); the served key is resolved at the R2 read by the original key (admin `servedPdf`, portal `streamPdf`, jobs `attachmentFor`), so reader SQL, `ATTACHMENT_KEY` and warm fixtures are unchanged (L3); rebuild status through separate GET routes, hot routes untouched (L4); a missing envelope is refused, never re-made from rows (L5); the check is the recorded SHA-256 only (the stored checksum first, then a hash); pre-2026-10-29 structural damage under a matching hash is out of scope (L6); keys `<original>-r<n>.pdf`, n ≤ 99 (L7); bells `pdf.rebuilt`, `pdf.refused`, `pdf.failed` with entity `pdf_repair` (L8); 07-ZV staff lines under the delegation (L9); a rebuild prints the same sealed content through today's layout (L10); Worker ownership as in the routes table (L11); a request without a result blocks another for 26 hours (L12). Run file: [rebuild-pdf](runs/rebuild-pdf.md).

## Proposed CLAUDE.md text
(after the build)

- **2026-11-07, Rebuild PDF b1 triage, Lead:** the builder's deviations 1–13 accepted (run file "Early check"); `pdf.rebuild` audit rows stay out of the monthly finance copy (`FINANCE_AUDIT_ACTIONS` holds money and tax events only; both rebuild tables are in the copy); the audit label and filter group are 07-ZV lines 20–21 (staff only, the lead's).

## Follow-ups (for 12)
- A bulk rebuild after a whole-bucket loss (Browser Run's 10 minutes a day paces it).
- An anonymised client's invoice PDFs can't be rebuilt (RB-11) while the originals are kept 8 years (RA-25): a one-off professional view would settle it.
- Restoring lost envelopes from the S3 backup copy (N8).

## Migrations
- 0087 `pdf_repairs` (drizzle: two new tables, indexes); 0088 `pdf_repair_triggers` (custom). Planned; numbers fixed at merge.

## Worker bytes
(measured after the build)

## Handover
- 2026-11-07 20:15 IST: branch made from `origin/main` (0ec9e8b); analyst drafting the Tier A brief.
- 2026-11-07 20:30 IST: USAGE 14 at 20:29; origin/main (#193) taken in.
- 2026-11-07 22:30 IST: USAGE 71; weekly all-models 82 %: only the planned agents (reviewer, then a re-check if needed). Merge order: #194, #195, #196, this branch, then the LUT fold (0089); this branch keeps 0087–0088.
- 2026-11-07 21:45 IST: early check GO; builder b2 (changes 1–9, portal, attachments) and designer d1 started in parallel.
- 2026-11-07 21:30 IST: builder b1 merged (head dfb06c9); worktree removed; analyst early check started (USAGE 53 at 21:30).
- 2026-11-07: owner's answers recorded (Q1 B, Q2 A, 07-ZV approved); builder told.
- 2026-11-07 21:00 IST: final brief written; Q1, Q2 and 07-ZV asked; builder starting on the parts the questions don't block.

## Early check

### Analyst early check (2026-11-07, claude-opus-5-5/high): **GO**
Checked `git diff f34ffec..64bca95` against the Brief, the owner's answers, L1–L12 and the builder's 13 deviations (all accepted). Ran: db `pdf-repairs.test.ts` 18 passed; jobs `pdf-rebuild.test.ts` 14; admin `pdf-rebuild.test.ts` 15; portal `offer-open-twin.test.ts` 2. No critical or high finding. Verified: 0087 create-only, 0088 from `TRIGGER_SETS` with the exact-text drift test; trigger logic per kind (supplier key twin-tested with `supplierPdfKey`, `repairKey` twin, `n`, served `old_key`); append-only; the redaction outbox and `changes()` (the only `redacted_at` batch guards on the audit row, nothing to change); the Q1 = B twin is word for word the portal accept's document conditions, in route, request guard and trigger; ROUTES ownership and permissions (GETs use the matching existing read action, return no personal data); one `mutate` batch with the guarded audit row; races serialised; every admin reader serves the rebuilt file and nothing derives keys from it; the plan refactor keeps first renders' order and outcomes; a tampered envelope is refused with no R2 write; write-once put under `new_key`; redelivery adopted once; anonymised and redacted handled before and after the put; pacing kept; the done-test proves JOB-PDF-02; no new secrets or bindings; logs and audit summary carry ids, kind, number, n, found only; finance gains only ROUTES and permission rows (its 436,784 is main's drift, not verified by a baseline build).

Required changes (for the builder's after-GO round, b2):
1. **Medium:** a lost rebuilt object answers the supplier copy's 202 forever: `servedPdf` falls back to `DOCS.get(originalKey)` (log `rebuilt pdf object missing`, rid only; ETag = the row's hash) when the rebuilt object is null; the same rule in portal `streamPdf` and jobs `attachmentFor`; test.
2. **Medium:** after a 503 `queue_unavailable`, "Try again in a minute" (line 10) is refused as `too_soon` (line 7): leave `queue_unavailable` results out of the 5-minute clause in `BLOCKED` and the route; test: retry after 503 is 202 with n = 2.
3. **Low:** an object at `new_key` with no `rebuilt` result is never deleted (a redacted offer's stray `-rN` would survive erasure): delete `new_key` before closing `intact` or `failed`/`dead_letter` (or adopt it in the dead letter when live); test the dead letter.
4. **Low:** the twin test skips unrecognised top-level accept conditions: allow exactly the person and link parts and fail on any other unknown part.
5. **Low:** the 5 MB hash cap vs 10 ms CPU: lower it to 2 MB.
6. **Low:** the `envelope_missing` bell says "Open it to try again": its own line (07-ZV 22).
7. **Low:** the access log records 202 when the answer is 503, and a throwing `failed` insert leaves the request open 26 h: try/catch around the result insert (log rid, still 503); keep the 202 access row with a comment.
8. **Low:** missing tests: a void receipt's rebuild; a jobs quota delay (`hop` + 1, the `pdf.quota` bell).
9. **Low (copy):** no line for a `skipped` outcome: 07-ZV 23.

After GO: a tiny import-free module for `SERVED_PDF_SQL` (`@techaust/db/pdf-served`) for the portal and jobs `email.ts`; portal `streamPdf` resolves the served key from the client-bound row's key (signed deed `{ rebuildable: false }`), counted in the portal's D1 budget; jobs `attachmentFor` resolves inside the function after the allow-list check. Not verified: real R2 checksums on `head`, byte deltas against a baseline, the staging cold CPU, two parallel HTTP requests racing.

### Lead's triage of the early check
All nine changes go to the builder (b2) with the after-GO items. Change 5: 2 MB. Change 7: the 202 access row stays (it records the accepted request), with a comment. Changes 6 and 9: 07-ZV lines 22 and 23 (staff, the lead's).

### Builder report (b1)
Builder claude-opus-5-5/high, cloud session, branch `fix/rebuild-pdf-b1` (from `origin/feat/rebuild-pdf` c6a9cb9), 2026-11-07. Scope: the brief's early-check items (1) to (5), with the owner's answers as the lead passed them on mid-run: Q1 = B (a rebuild of an offer the client can still accept is refused, 409 `offer_open`, 07-ZV line 19), Q2 = A (no mark), and 07-ZV lines 1 to 19 approved. Not started (they come after GO): portal `streamPdf`, jobs `attachmentFor` and every screen. The brief's Q1 = A change to the accept is dropped (owner Q1 = B).

**Skills.** None loaded. The docs/14 §9 rows for this task are:
- `cloudflare:workers-best-practices` and `cloudflare:wrangler` (Worker code, D1, queues);
- `cloudflare:workers-profiling` (Worker bytes and start-up);
- `cloudflare:cloudflare` (R2, Queues).

None of them exists in a cloud session (no plugins load there; CLAUDE.md "In a cloud session"). `code-review` and `security-review` are the reviewer's. No other listed skill fits builder work.

**Files by layer**
- Core:
  - `packages/core/src/pdf-repair.ts` (new; subpath `@techaust/core/pdf-repair`): `REPAIR_KINDS`, `REPAIR_OUTCOMES`, `REPAIR_FOUND`, `REPAIR_MAX`, `repairKey`, `rebuildVerdict`, `REBUILD_WINDOW_MS`, `REBUILD_OPEN_MS`, `REBUILD_HASH_MAX_BYTES`, `isRepairCode`.
  - `pdf-jobs.ts`: `PdfRebuildMessage` is in `PdfMessage` and `isPdfMessage`, with the same bounds as `pdf.render`.
  - `permissions.ts`: `"pdfs.rebuild": { owner: "step-up" }`.
  - Tests: `test/pdf-repair.test.ts` (new: a fast-check property for `repairKey`, the verdict, the message bounds, the permission row) and `test/permissions.test.ts` (the new row `S---`).
- Data:
  - `packages/db/src/schema/pdf-repairs.ts` (new, exported from `schema/index.ts`).
  - Migrations `0087_pdf_repairs.sql` (drizzle-kit: CREATE TABLE and CREATE INDEX only) and `0088_pdf_repair_triggers.sql` (custom, written by `scripts/write-triggers.ts pdf_repair_triggers`).
  - `src/triggers-pdf-repairs.ts`: the new trigger set, registered in `TRIGGER_SETS`.
  - `src/retention.ts`: both tables `record`, never deleted. `src/backup-scope.ts`: both `F`.
  - `src/pdf-repairs.ts` (new; subpath `@techaust/db/pdf-repairs`):
    - the key twins: `REPAIR_KEY_SQL`, `SUPPLIER_KEY_SQL`, `IST_DAY_SQL`;
    - the Q1 = B rule: `OFFER_OPEN_PARTS` and `offerOpenSql`;
    - the subject and the served key: `rebuildableKeySql`, `servedKeySql`, `SERVED_PDF_SQL`, `SUBJECT_SQL` and `subjectBinds`, `repairsOfSql`, `subjectServedSql`;
    - the writes and the jobs read: `REQUEST_INSERT_SQL`, `requestBinds`, `RESULT_INSERT_SQL`, `REPAIR_READ_SQL`.
  - Tests: `test/pdf-repairs.test.ts` (new) and `test/migrations.test.ts` (80 tables, the two migrations).
  - No other table list for backups exists in the repo: #193's backup code is `backup-scope.ts` only (scripts and workflows grepped).
- Admin API:
  - `apps/admin/worker/pdf-rebuild.ts` (new): the factory `rebuildRoutes`, the four mounted routers, `checkStored` and the 07-ZV refusals.
  - `pdf-served.ts` (new): `servedKey` and `servedPdf`.
  - `guard.ts`: 12 ROUTES rows, six on the API Worker and six on the invoices Worker. Mounted in `routes-api.ts` and `routes-invoices.ts`.
  - The readers:
    - `document-pdf.ts`: the offer and invoice GET (ETag = the served SHA); the supplier copy (a rebuild wins, the self-heal stays);
    - `receipt-issue.ts`;
    - `document-links.ts` (the certificate);
    - `deeds.ts` (the unsigned PDF only).
  - `apps/admin/src/lib/audit.ts`: the `pdf.rebuild` label and a "Stored PDFs" filter group (see deviation 9).
  - Tests:
    - `pdf-rebuild.test.ts` (new), with the helper `test-rebuild.ts` (new);
    - `split.test.ts` (the invoices regex, counts 47/49);
    - `invoices.test.ts` (the route table);
    - `rbac.test.ts` (one audit row per rebuild route).
- Jobs:
  - `apps/jobs/src/pdf.ts`:
    - the render plans `invoiceCheck`, `invoicePlan`, `offerPlan` and `certificatePlan`, with the types `PdfPage` and `RenderPlan`;
    - `bell` and `RenderRow` exported;
    - `failed()` takes `PdfRebuildMessage`;
    - a misrouted `pdf.rebuild` is logged.
  - The other plans: `receipts.ts` (`receiptPlan`, `receiptRow`) and `deed-pdf.ts` (`deedPlan`).
  - `certificate.ts`: the `name_sealed` column and `nameSealed`.
  - `pdf-rebuild.ts` (new): `processRebuild`, `processRebuildDeadLetter`, `storedVerdict` and the 07-ZV bells 16 to 18.
  - `queue.ts`: `pdf.rebuild` is routed before the other PDF kinds, and its dead letter.
  - Test: `test/pdf-rebuild.test.ts` (new).
- Shared:
  - `packages/testing/src/pdf-rebuild.ts` (new): the done-test fixture both halves import.
  - `scripts/route-inventory-lib.mjs`: `pdf.rebuild` in `QUEUE_KINDS`.
  - `apps/portal/worker/offer-open-twin.test.ts` (new, a test only): pins `OFFER_OPEN_PARTS` to the portal's `ACCEPT_INSERT_SQL`. No portal code changed.

**Migrations**
- **0087 `pdf_repairs`:** two new tables. Nothing is rebuilt and no referenced table is touched.
  - `pdf_repairs`:
    - CHECKs: kind; found; n from 1 to 99; subject id length; keys under `docs/` or `deeds/` and at most 512 characters; `old_sha256` null or 64 lower-case hex.
    - Indexes: unique `new_key`; unique `(subject_kind, subject_id, n)`; `(requested_by)`.
  - `pdf_repair_results`:
    - PK `repair_id` → `pdf_repairs.id`.
    - CHECKs: outcome; code glob and length; rebuilt ⇔ key and SHA; key shape; SHA shape; bytes ≥ 1.
    - The partial index `pdf_repair_results_served (original_key, n) WHERE outcome = 'rebuilt'`.
- **0088 `pdf_repair_triggers`:** CREATE TRIGGER only.
  - The four append-only triggers.
  - `pdf_repairs_insert`: the subject may be rebuilt now, and `original_key` is its recorded key. Per kind:
    - frozen, with its PDF recorded;
    - the client not anonymised;
    - an offer not redacted, and not open on the IST day of `requested_at` (Q1 = B);
    - a deed final or signed; a receipt issued or void;
    - a supplier copy's key = `SUPPLIER_KEY_SQL`.
  - `pdf_repairs_insert_n`: the next n.
  - `pdf_repairs_insert_keys`: `new_key` = `REPAIR_KEY_SQL`, and `old_key` = the served key.
  - `pdf_repair_results_insert`: the request exists; the same key and n; the request's new key when rebuilt, and no key, SHA or bytes otherwise; never before the request.
  - `documents_redact_repairs_outbox`: AFTER UPDATE OF redacted_at, with the same WHEN as `documents_redact_outbox`. It queues every rebuilt key of the offer's PDF in `r2_deletions` (`ON CONFLICT DO NOTHING`).
- **The redaction batch:** D1 counts these trigger writes. The db test shows the redaction UPDATE's `changes` > 1 when a rebuilt key exists. `offer-redaction.ts` already reads `changes() > 0`; it is unchanged and its tests pass.
- **Numbers:** planned. Renumber at merge if another branch takes 0087–0088 first.

**Commands and results** (the heavy ones through `tools/heavy.sh`)
- **Core** (`pnpm --filter @techaust/core test`): 134 files, 2,728 tests passed. Coverage: statements 98.11 %, branches 96.28 %, functions 98.31 %, lines 98.5 % (`.logs/rb-core-test.log`).
- **DB** (`pnpm --filter @techaust/db test`): 63 files, 1,111 tests passed (`.logs/rb-db-test2.log`, the run after the last SQL change).
- **Admin** (`pnpm --filter @techaust/admin test`):
  - first run: 8 failures, because the rebuild routes had no `rbac.test.ts` scenarios and no `invoices.test.ts` route-table lines;
  - after the fix: 200 files, 5,433 tests passed (`.logs/rb-admin-test2.log`).
- **Jobs** (`pnpm --filter @techaust/jobs test`):
  - first run: 1 failure (`pdf.rebuild` missing from the inventory's `QUEUE_KINDS`);
  - after the fix: 53 files, 794 tests passed (`.logs/rb-jobs-test2.log`).
- **Portal:** only `worker/offer-open-twin.test.ts`, run directly: 2 tests passed. The portal suite was not run, because no portal source changed.
- **Typecheck** (`pnpm -r --workspace-concurrency=1 typecheck`): every package passed (`.logs/rb-typecheck2.log`). The first, parallel `pnpm typecheck` failed on the new fixture's DOM globals in `packages/testing`; fixed.
- **`pnpm check`:** passed on the third run (`.logs/rb-check3.log`).
  - It covers lint, typecheck, the binding guard, the content lint, the Worker config guard, the SPA headers, the migration guard (89 migrations, none rebuilds a referenced table) and the CSS collisions.
  - The first two runs failed on Biome formatting: `packages/db/src/pdf-repairs.ts`, then the drizzle snapshots and journal. Both fixed.
  - So the whole-repository lint ran three times, each time inside `pnpm check`. No separate `pnpm lint` was run after that.
- **Builds** (`pnpm --filter @techaust/admin build`, `pnpm --filter @techaust/jobs build`): both pass the Worker budget (below).

**Worker bytes** (measured; no baseline build of the task branch was made, so there are no exact deltas, only a comparison with the brief's estimates)

| Worker | Bytes | Start-up (fastest of 7) | Ceiling or plan line |
|---|---|---|---|
| admin front | 122,717 | 30.2 ms | 150,000 |
| admin API | 572,452 | 83.0 ms | 800,000 |
| admin finance | 436,784 | 74.7 ms | plan line 500,000 |
| admin invoices | 579,222 | 86.1 ms | plan line 650,000 |
| jobs | 885,539 | 72.8 ms | 1,000,000 |
| portal | not rebuilt (no portal source changed) | | plan line 180,000 |

Finance does not import the rebuild code. Its figure is above the brief's estimate (~425 K), which more likely means the estimate predates main's latest finance changes than that this task grew it.

**workerd and `checksums.sha256`:** yes.
- After `put(key, bytes, { sha256 })`, `head(key).checksums.sha256` holds that SHA-256. After a plain put it is undefined.
- Proved in `apps/admin/worker/pdf-rebuild.test.ts` ("R2's stored checksum") and in `apps/jobs/test/pdf-rebuild.test.ts` (`storedVerdict`).
- So locally the head shortcut and the supplier copy's stored-checksum check both work, and an object stored by a plain put is hashed instead.

**Deviations from the brief, with reasons**
1. **`rebuildVerdict` takes `{ present, recordedSha, objectSha }`:** an object that is present but could not be hashed (over 5 MB) must read `damaged`, not `missing`.
2. **`pdf.rebuild` is not added to `FINANCE_AUDIT_ACTIONS`:** that list holds only events that move money or tax, and it says outright that a PDF re-request is not a finance event. Effect: the monthly copy holds both rebuild tables but not the rebuild audit rows. The lead decides.
3. **No `pdf_repairs (original_key)` index, because no query needs it:**
   - the insert trigger's served-key lookup reads `pdf_repair_results` through `pdf_repair_results_served` (EXPLAIN in the db test);
   - the max-n lookup uses the unique `(subject_kind, subject_id, n)`.
4. **The insert trigger is three triggers** (`pdf_repairs_insert`, `_insert_n`, `_insert_keys`): the same rule, but each refusal has its own message for the tests.
5. **`REQUEST_INSERT_SQL` is one statement per kind:**
   - it computes `n`, `new_key` and `old_key` in SQL;
   - beside the brief's 5-minute and 26-hour guard, it also requires that the subject can still be rebuilt now (Q1 = B included) and that the served key is the one the route checked;
   - so a request never records a stale old key or hash, and a lost race is 409 `rebuild_in_progress`;
   - the route works out `n` only for the audit summary.
6. **Jobs step 1 is two reads:** the request with its result and `live`, then the kind's own row. One batch would have had to read every kind's tables without knowing the kind.
7. **`certificate_unsealed` only when asked:** `certificatePlan` refuses only when the caller passes `sealedName: true` (the rebuild). The first render keeps M4.5's fallback name, so its behaviour is unchanged. `CERTIFICATE_READ` gains one column, `name_sealed`.
8. **Plans return a lazy `page()`:** an adopted PDF never builds its page, as before. Building it eagerly broke an existing receipt-adoption test whose sealed row doesn't render.
9. **Copy outside 07-ZV that an existing test requires:**
   - the audit-log label `"pdf.rebuild": "asked for a stored PDF to be rebuilt"` and the filter group "Stored PDFs", in `apps/admin/src/lib/audit.ts`;
   - `audit-labels.test.ts` fails without them;
   - both are builder drafts in the S-style used before, for the lead to approve; the designer may move or tighten them.
10. **The shared fixture holds bytes and helpers only:**
    - `packages/testing/src/pdf-rebuild.ts` has the original, damaged and rebuilt PDFs, the SHA, the whole row as JSON and `putWithSha`;
    - the apps import it by path, so it cannot use package imports;
    - each half seeds its documents through its own real paths: the issue and send statements in jobs, the issue routes and the receipt RPC in admin.
11. **Bells**, all with entity `pdf_repair` and linked to the subject's admin page:
    - `pdf.rebuilt` (line 16);
    - `pdf.refused` (line 17), for any plan refusal;
    - `pdf.failed` (line 18), for `envelope_missing` and `dead_letter`;
    - a skipped result rings nothing.
12. **The `client_gone` code:** it carries 07-ZV line 9, as the brief says. The existing admin `CLIENT_GONE` codes are `client_anonymised`, so this is a new code beside them.
13. **The `rebuilt` result's guard has no offer-open check:** an offer that was not open when the rebuild was asked can't become open again.

**Not verified**
- Not run: the portal suite, the staging cold CPU reading (nothing deployed), e2e.
- Not measured: real R2's checksum behaviour (workerd only), and the Worker-byte deltas against the task branch.
- A void receipt's rebuild: the SQL and the trigger allow it, but no test seeds one.
- `rebuild_in_progress` from two Owners racing: covered by the guarded INSERT and the db tests, but not exercised through two parallel HTTP requests.

**Open questions**
1. The two new admin strings in deviation 9 (the audit label and its filter group): approve them, or give the wording.
2. Deviation 2: should the `pdf.rebuild` audit rows go into the monthly finance copy (that is, be added to `FINANCE_AUDIT_ACTIONS`)?
3. The branch `fix/rebuild-pdf-b1` is pushed. The run file on `origin/feat/rebuild-pdf` has moved since my branch point (the owner's answers), so the lead keeps both sections when merging.
