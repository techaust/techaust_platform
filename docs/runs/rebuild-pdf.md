Status: builder running (b1)
Tier: A
Usage: analyst claude-opus-5-5/high (brief draft; skills: none, the Cloudflare skills don't load in a cloud session): 5-h 1 → 14 %; builder (b1) started at 5-h 14 %

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
- 2026-11-07: owner's answers recorded (Q1 B, Q2 A, 07-ZV approved); builder told.
- 2026-11-07 21:00 IST: final brief written; Q1, Q2 and 07-ZV asked; builder starting on the parts the questions don't block.
