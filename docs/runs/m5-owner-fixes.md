Status: open
Tier: B
Usage: analyst claude-opus-5-5/high: 5-h 3 → ? % (skills: cloudflare:workers-best-practices, cloudflare:cloudflare); reviewer claude-opus-5-5/high (sweep): 5-h 3 → ? % (skills: frontend-design)

# M5 owner findings: fix task

The owner's staging check of the M5 batch (2026-10-28) found two defects (recorded in [m5-batch.md](m5-batch.md), "Owner's staging findings"). This task fixes both, plus whatever the reviewer's UI/UX sweep finds on the affected screens (owner rule 2026-10-26: sweep first, then one fix task). Admin staging: `https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev` (behind Cloudflare Access; agents can't sign in, so they work locally).

## Findings

### F1. A proposal PDF is stored damaged (PRD ADM-PROP-05, JOB-PDF-01)
- Owner: "Download PDF" saves a file that no reader opens.
- Lead's diagnosis from the owner's downloads: `TH-PRP-2627-0001-v1.pdf` (270,658 bytes; Creator HeadlessChrome; 4 pages; 756 objects) starts `%PDF-1.4` and ends `%%EOF` with a correct `startxref`, but 26 cross-reference offsets are off by exactly −16,384 or +8,192 bytes: blocks of 8 KB / 16 KB are out of order. Three downloads are byte-identical, so the object in R2 `DOCS` is damaged at write time; the admin download route (`apps/admin/worker/document-pdf.ts`) only streams it.
- The estimate `TH-EST-2627-0001-v1.pdf` (203,963 bytes) and invoice `TH-INV-2627-0001-v1.pdf` (162,279 bytes), rendered the same evening, check clean: the damage is intermittent.
- Render path: `apps/jobs/src/pdf.ts` (consumer, write-once store), `apps/jobs/src/browser.ts` (Browser Run call, `res.arrayBuffer()` at line 135; the only check is the `%PDF` magic at line 35).
- The lead's check script (Python, xref offsets vs `N 0 obj` positions) is in this file's "Lead's xref check" below.

### F2. A new proposal can't be sent: "These placeholders have no value yet: {{service.assumptions}}, {{service.exclusions}}. Fill them in before sending."
- Cause: no seeded catalogue item has `assumptions_md` / `exclusions_md` (`packages/db/src/seed/catalogue.ts`), but both seeded templates' "Assumptions and exclusions" section is `{{service.assumptions}}\n{{service.exclusions}}` (`packages/db/src/seed/templates.ts:31`, `:103`). The draft fills placeholders once at creation (`apps/admin/worker/document-draft.ts:154`, a `null` leaves the token), and the send check refuses (`apps/admin/worker/quote-model.ts:971`, `unresolved_placeholders`).
- **Owner's decision (2026-10-28, docs/13):** when the services have no such text, the "Assumptions and exclusions" section is hidden automatically and the draft shows a note naming the service (add the text in Catalogue or write it in the draft); sending is not blocked by it.
- Also in scope: placeholders filled again when a service line or the contact is added after creation (the M4.5 follow-up "refill `{{client.contact}}` when a draft's contact changes").
- New copy (the note) goes to the owner as one page of numbered lines with a recommendation; until approved it shows `[Placeholder]`.

### Lead's xref check
```python
import re
b=open(path,"rb").read()
sx=int(re.findall(rb"startxref\s+(\d+)",b)[-1]); x=b[sx:]
m=re.match(rb"xref\s+(\d+)\s+(\d+)\s+",x); start,n=int(m.group(1)),int(m.group(2))
ents=x[m.end():m.end()+20*n]
bad=[i for i in range(n) if ents[i*20+17:i*20+18]==b"n" and not re.match(rb"%d\s+\d+\s+obj"%(start+i),b[int(ents[i*20:i*20+10]):][:20])]
```

## Analyst diagnosis (F1)
- **A pure permutation, proven.** Three 8,192-byte blocks over bytes [3770, 28346) are stored in the order 3, 1, 2; nothing is missing, duplicated or foreign. Moving the third block back gives 0/755 bad xref offsets, 0/395 bad `/Length`→`endstream`, and every Flate stream passes its Adler-32. The boundaries are 3770 + k·8192 (a short first chunk, then 8 KB chunks): the shape of a chunked producer or transport, in one response.
- **Lead's check (2026-10-29, staging D1, read-only SELECT):** `documents.pdf_sha256` for TH/PRP/2627/0001 v1 is `2eadd761…1e05`, equal to the damaged download. The estimate (`ff3dee04…`) and invoice (`127c450a…`) hashes equal their clean downloads. Since jobs hashes the bytes it got from `readPdf` before the put, **the damage came from Browser Run's `quickAction("pdf")` response (or its stream into workerd), not R2 and not the download path.** Our code does one `arrayBuffer()` (`apps/jobs/src/browser.ts:135`), the same buffer to the hash and the put (`putOnce`, `apps/jobs/src/pdf.ts:141`); ruled out by reading.
- **Exposure:** every PDF kind goes through `renderPaced` → `readPdf` (proposal/estimate `pdf.ts:583`, invoice family and supplier copy `pdf.ts:348`, certificate `pdf.ts:680`, statement `statement-pdf.ts:290`), so one check in `readPdf` covers all five.
- **Fix design (Tier B):** `packages/pdf/src/integrity.ts` (`@techaust/pdf/integrity`), called in `readPdf` after the magic check: content-length = byteLength when present; one `startxref` and `%%EOF` in the last 1 KB (more → `incremental`); classic xref entries land on `N G obj`; each stream's `/Length` lands on `endstream`; every `/FlateDecode` stream ≥ 4,096 bytes inflates through `DecompressionStream("deflate")` (Adler-32: a block inside one stream moves no header); an xref stream fails closed (`xref_stream`). Failure → `RenderError` kind `damaged` → `failed()` throws → queue retries with a fresh paced render (max 5) → the existing dead-letter bell. Log `pdf.damaged {code, bytes, firstBadOffsetMod8192, displacement}` (numbers only). Pass `sha256` to `bucket.put`. CPU estimated < 1 ms (builder measures); bundle +3–5 KB on 851 KB.
- **Repairing a stored PDF (Tier A):** `pdf_r2_key` / `pdf_sha256` are set-once (`documents_frozen_update`, latest in 0047), ~35 readers, `ATTACHMENT_KEY` (`packages/core/src/offers.ts:112`) pins the key, and `attach_pdf` means a damaged file may already have been emailed. Design: append-only `pdf_repairs` table, the frozen trigger re-created with a carve-out only when a matching repair row exists and the stored object fails the check, an Owner-only step-up route enqueuing `pdf.repair`, a new write-once key (`…-v1-r1.pdf`), the old object kept; supplier copy and certificate as kinds of the same table; statements need none (cache row / next day). Owner question Q1.
- **Tests:** synthetic PDF passes (the staging files must not be committed: public repo); 3-block rotation fails `xref_offset`; two blocks swapped inside one 20 KB Flate stream fail `stream_checksum` (proves workerd's Adler check); one failing case per code; `damaged` → throw → bell; put carries `sha256`.
- **Not verified:** R2's behaviour on a `sha256` mismatch; workerd's `DecompressionStream` Adler-32 rejection; the CPU figure.

## Owner's answers (2026-10-29)
- **Q1 repair:** own Tier A task before production (follow-up); this task stops new damage only; the staging proposal gets a version 2.
- **Q3 Deliverables (2026-10-29):** the same rule as assumptions and exclusions (hide the empty part with a note naming the service; never block sending for missing Catalogue text).
- **Q2 Cloudflare:** yes; the lead drafts the report (`.logs/m5-owner-fixes/cloudflare-report.md`, positions and hashes only), the owner posts it.

## Reviewer UI/UX sweep (2026-10-28, reviewer claude-opus-5-5/high, before the fix): SEND BACK
Screenshots: `.logs/shots/m5-owner-sweep/` (main checkout, git-ignored). axe clean on every swept screen; no text < 12 px; no overflow at 375; theme precedence correct; PDF panel states correct (simulated ready).
1. **High:** a service with only some of the text still blocks (S5 assumptions set, exclusions empty → `…
{{service.exclusions}}`); a first service empty and a later one filled appends under leftover tokens (`document-draft.ts:162-164`, `:177-186`). Staging confirms: S1 has assumptions but no exclusions. Shot 24.
2. **High:** `{{service.deliverables}}` blocks the same way (seed has no `deliverables_md`; staging: S3, S8, S9, S15–S18 have none). Owner Q3: same rule. Shots 03, 04.
3. **High:** the send-check banner shows raw `{{…}}`, names no section or service, no links (`apps/admin/src/lib/documents.ts:147-151`); the Send card only "Some placeholders have no value yet." (`:414`); in-section warnings are bare amber tokens. Shots 04, 05, 08, 09, 10.
4. **Medium:** the send dialog ignores the draft's "Send to" contact (`apps/admin/src/lib/offers.ts:291-298`, `send-dialog.tsx:71`); preview reads "Hi ...,". Shots 12, 35.
5. **Medium:** the line editor's unit is clipped ≥ 1408 px ("Per milest") (`apps/admin/src/documents.css:228`). Shots 11, 25, 28.
6. **Medium:** every section body textarea is named "Text" (`sections.tsx:272-277`).
7. **Medium:** a revoked, expired or unknown offer link shows "Page not found" (`apps/portal/src/routes/offer-link.tsx:3-4`, `:55`); invoice links have 07-U's "This link no longer works…". Shot 34b.
8. **Low:** `/estimates` empty state ignores the type filter (`apps/admin/src/routes/documents.tsx:76`). Shot 18.
9. **Low:** Catalogue doesn't say Deliverables / Assumptions / Exclusions fill proposal sections. Shots 20, 21.
10. **Low:** the Emails panel doesn't refresh when the PDF becomes ready (only the PDF state polls). Shot 16.
11. **Low:** "Download supplier copy" while being made is a 409, logged as a console error each click (202 instead). Shot 31.
12. **Low:** the skip link is 43 px tall.
13. **Low:** stale comment `pdf-panel.tsx:5` ("PENDING the owner's approval"; 07-Q approved it).
14. **Low:** the draft's "Send to" select offers contacts without portal access.
15. **Low:** an empty invoice draft shows two blockers for one cause (shot 26).
16. **Low:** dark in-app theme flashes white on load (`apps/admin/index.html` sets nothing before `main.tsx`).
17. **Low:** at 768 the facts grid leaves "Created" alone on a second row (shot 10).
- Note for F1: the portal lists an offer only once `pdf_sha256` is set (`apps/portal/worker/offer-sql.ts:33`, `:107`); a damaged stored PDF unlocks it, so the structure check must run before the store.
- Not verified: real PDF rendering, the portal offer page with a real offer and accept/decline (needs jobs), emails, the second proposal template, production builds.

**Lead's triage:** all 17 are fixed in this task (lead practice: medium and low in the same task); none is kept.

## Brief (lead, 2026-10-29). Tier B
- **PRD:** ADM-PROP-02/05 (drafts, send, PDF), JOB-PDF-01, POR-OFF (portal offers).
- **Base:** `origin/fix/m5-owner-findings`.
- **Running in parallel:** the builder and the designer work at the same time, against the contract below: two agents, only one of them using a browser.
  - Each branches from the base in its own worktree (`fix/m5-owner-fixes-builder`, `fix/m5-owner-fixes-design`), pushes only that branch, and appends its report to this file.
  - The lead merges the builder's branch first, then the designer's, then the designer does a short pass against the real API.
- **Working rules:**
  - load every skill that fits (docs/14 §9);
  - run heavy commands through `bash tools/heavy.sh`;
  - never touch staging or any hosted service;
  - commit at least every 20 minutes;
  - stop every dev server before reporting.

### Builder (Sonnet, medium): logic, API, jobs, tests
**B1. PDF integrity (F1): the analyst's design above.**
- `packages/pdf/src/integrity.ts`, with the subpath export `@techaust/pdf/integrity`, is pure. It checks:
  - the content-length;
  - `startxref` and `%%EOF`: more than one is `incremental`;
  - that each classic xref entry lands on `N G obj`;
  - that each `/Length` lands on `endstream`;
  - the Adler-32 of every Flate stream ≥ 4,096 bytes, via `DecompressionStream("deflate")`;
  - an xref stream fails closed with `xref_stream`.
- **Where it runs:** in `readPdf` (`apps/jobs/src/browser.ts`), after the magic check. A failure becomes `RenderError` kind `damaged`; `failed()` then throws, the queue retries, and after the last retry the existing dead-letter bell rings.
- **Log:** `pdf.damaged {code, bytes, firstBadOffsetMod8192, displacement}`, numbers only.
- **Storing:** compute the SHA-256 before the put, and pass `sha256` to `bucket.put` in `putOnce`.
- **Tests:** the analyst's list, on **synthetic** PDFs only. Never commit the staging files: the repo is public.
  - Prove that workerd's `DecompressionStream` rejects a bad Adler-32.
  - If it doesn't, say so and use a hand-written Adler-32 instead.
- **Measure and report:**
  - the CPU on a synthetic 270 KB, 760-object PDF in workerd (target: well under 1 ms added);
  - the jobs bundle (ceiling 1,000,000 bytes).

**B2. Template filling at draft creation (F2).** Owner decisions: docs/13, 2026-10-28, and Q3 of 2026-10-29.
- **"Unknown" and "empty" are different:**
  - **Unknown:** there's no service line yet, or no contact. The `{{token}}` stays in the text, as today.
  - **Empty:** a service exists, but its `deliverables_md`, `assumptions_md` or `exclusions_md` is null or blank. A line that holds only that token is dropped.
  - On a line that mixes other words with an empty token, drop only the token. Never leave `{{…}}` behind.
- **Every service counts:** a section's text is built from every service's values, the first service and the appended ones. A later service's text must never sit under a leftover token.
- **Empty sections:** a section whose body is empty after the dropping is created **hidden**.
- **Other callers:** keep `renderTemplateBody`'s contract for them. Add an option to it, or do this work in `document-draft.ts`.
- **Refill on save** (`document-save.ts`): when a draft save adds the first service line, fill every remaining **unknown** `service.*` token by the same rules, hide-if-empty included. The contact is already covered by the existing `renameContact`.
- **Catalogue gaps, worked out when the draft is read:**
  - The draft GET, and the documents view the editor uses, return `catalogueGaps: { sectionId: string | null; sectionKind: "deliverables" | "assumptions_exclusions"; field: "deliverables" | "assumptions" | "exclusions"; serviceCode: string; serviceName: string; catalogueItemId: string; catalogueHasTextNow: boolean }[]`.
  - Compute it from the draft's service lines and their **current** catalogue rows, in one batched query, for drafts only, never for sent versions.
  - Report a gap while its section is hidden or its body is empty, and in the partial case where one field is missing.
  - `catalogueHasTextNow` is true once Catalogue has been filled since.
- **"Use Catalogue text" action:** `POST /api/v1/documents/:id/sections/fill-from-catalogue {sectionId, expectedUpdatedAt}`.
  - A new `ROUTES` row in `routes-api.ts`, with the same permission as a draft save and the audit action `document.update`.
  - It appends the texts that are now available, rendered by the same rules, and unhides the section, in one `mutate` batch.
  - Errors: 409 `stale_version`; 409 `nothing_to_fill` while Catalogue still has no text.
- **More detail on the send-check blocker:** `unresolved_placeholders` keeps `names` and adds `where: { name: string; sectionId: string | null; sectionKind: string | null; part: "title" | "line" | "section" | "schedule" }[]`, so the screen can name the place and link to it.
- **Tests:**
  - only assumptions; only exclusions; deliverables empty;
  - the first service empty and a later one filled; everything empty, so the section is hidden;
  - no service at creation, so the tokens are kept, then filled by the save that adds one;
  - the fill route: it works; stale; nothing to fill; no permission; an anonymised client is refused;
  - the seeded templates with the seeded catalogue give a sendable draft (no `unresolved_placeholders`).

**B3. Small API items from the sweep.**
- **Supplier copy still being made** (finding 11): answer **202** `{state:"making"}` instead of 409. Keep the 409 code for any other caller, and check the SPA and the tests.
- **Draft contact choices** (finding 14): add whatever the SPA needs to mark or leave out contacts without portal access. If the client payload already carries it, leave this to the designer and say so.

### Designer (Opus, high): screens and copy (load `frontend-design` first)
**D1. The F2 messages (sweep finding 3).**
- **Banner and Send card:** replace the raw-token banner and the Send card's line with a list in plain words. Each item names the section and the service, and links to:
  - the section itself (focus it);
  - for a catalogue gap, `/catalogue/<catalogueItemId>`;
  - a "Use Catalogue text" button (the B2 route), when `catalogueHasTextNow`.
- **No `{{…}}` on screen:** staff never see the token syntax. Map each token to words, for example service.deliverables → "Deliverables", client.contact → the contact's name. The warning inside a section uses the same words.
- **Note on a hidden section:** sits on that section in the editor, names the service, and offers "add it in Catalogue or write it here" (unhide and write).
- **New lines:** they go in `docs/07-content-appendix/X-m5-owner-fixes.md` as numbered lines, each with a recommended wording. Until the owner approves them, they show `[Placeholder]` in code (the house rule). The lead takes the page to the owner.
- **Order:** build against the B2 contract with a mocked response, then do the real-API pass once the lead has merged the builder's branch.

**D2. Sweep findings 4–17.**
- 4: the send dialog pre-ticks the draft's `contactId` when that contact has portal access (`apps/admin/src/lib/offers.ts:291`).
- 5: widen the unit column or let the unit wrap (`documents.css:228`); check at 1280, 1408, 1440 and 1600.
- 6: each section's text box gets the `aria-label` "Text of {section}".
- 7: the portal's offer-link error page follows the invoice link's pattern (07-U), with a new line for offers on the X page.
- 8: the empty state honours the type filter.
- 9: a Catalogue hint that the three texts fill proposal sections (a new line on the X page).
- 10: the Emails panel refreshes when the PDF becomes ready.
- 11: the SPA handles the new 202.
- 12: the skip link is at least 44 px tall.
- 13: fix the stale comment.
- 14: the draft's "Send to" list marks or leaves out contacts without portal access.
- 15: an empty invoice draft shows one blocker, not two.
- 16: no white flash: set the theme and background in `index.html` before `main.tsx` runs, in admin and in the portal if it has the same gap.
- 17: the facts grid at 768.
- **Screenshots:** every changed screen at 375, 768, 1280 and 1600, in both themes, axe clean, saved under `.logs/shots/m5-owner-fixes/`.

### Done means
- `pnpm check` and `pnpm test` pass. The full-repo lint runs once, as the final check.
- The new tests listed above exist and pass.
- The builder reports the CPU and bundle figures.
- The X copy page is written.
- The reports say what wasn't verified: a real Browser Run render, and the portal offer page with a real offer.

### Out of scope
- The `pdf_repairs` path: its own Tier A task (owner Q1).
- Re-making the staging proposal: a version 2 is sent after the deploy.
- The Cloudflare report: the owner posts it.

## Builder report
Builder: Sonnet 5.5 (medium), branch `fix/m5-owner-fixes-builder` from `origin/fix/m5-owner-findings`. Skills loaded: `cloudflare:workers-best-practices` (no `import()` in Worker code, streams for bodies, no hand-written `Env`, the `sha256` put option instead of unchecked writes). Not loaded, with reasons: `frontend-design` (no screens), the AWS, Supabase, Upstash, Sentry and cloudflare product skills (no matching work). Context7 not used: only the platform's `DecompressionStream` and the R2 `put` options were involved, both checked by tests in workerd.

### Commits
1. `727ce98` fix(jobs): verify PDF structure before store, sha256 on put [JOB-PDF-01, ADM-PROP-05]
2. `455a732` fix(admin): empty vs unknown service text, catalogue gaps, Use Catalogue text, blocker where, supplier copy 202 [ADM-PROP-02, ADM-PROP-05, ADM-CAT-03]
3. a last commit with the type fixes (`BlobPart`, `TestSession`) and this report.

### B1 PDF integrity (F1)
- `packages/pdf/src/integrity.ts`, subpath export `@techaust/pdf/integrity` (`checkPdfIntegrity(bytes, declaredLength)`, async, never throws). Codes: `length_mismatch`, `no_startxref`, `no_eof`, `incremental`, `xref_stream` (fails closed), `xref_unreadable`, `xref_offset`, `stream_length`, `stream_checksum`. It reads classic xref entries (each must land on `N G obj`), each direct `/Length` (must land on `endstream`) and inflates every `/FlateDecode` stream of 4,096 bytes or more through `DecompressionStream("deflate")`.
- `apps/jobs/src/browser.ts` `readPdf`: after the magic check, a failure is `RenderError` kind `damaged` (message `PDF structure damaged (<code>)`), logged as `pdf.damaged {code, bytes, firstBadOffsetMod8192, displacement}` (numbers only). `failed()` already throws for any kind other than rate and quota, so the queue retries with a fresh paced render and the existing dead-letter bell rings after the last retry. Not changed.
- `putOnce(bucket, key, body, contentType, sha256?)`: the PDF puts (invoice family and supplier copy, proposal and estimate, certificate, statement) hash the bytes first and pass `sha256`, so R2 refuses a write whose bytes differ.
- Tests: `packages/pdf/test/integrity.test.ts` (Node: one case per code, the 3-block rotation, a block swap inside one 24 KB Flate stream) and `apps/jobs/test/pdf-integrity.test.ts` (workerd: the same on a 308 KB, 760-object synthetic PDF, `renderPdf` returns `damaged` and logs numbers only, `failed()` throws, `putOnce` accepts a matching sha256 and rejects a mismatch). `browser.test.ts` fixtures now use `stubPdf()` (a structurally valid PDF), because every response is checked now.
- **Workerd's `DecompressionStream` does reject a bad Adler-32** (a block moved inside one stream fails `stream_checksum` in workerd), so no hand-written Adler was needed.
- **R2 `sha256` mismatch is refused** (the test expects the put to throw, and it does, in the local R2 of the test pool).
- **CPU:** 308,932 bytes, 760 objects, one 262 KB incompressible Flate stream, in the workerd test pool on this loaded 8 GB PC (wall time, 20 runs after a warm-up): whole check 6.15 ms; 756 objects alone 0.55 ms; the 262 KB stream alone 3.50 ms. The inflate is native and is a worst case (random data); real Chrome PDFs are mostly fonts, a smaller inflate. This is wall time, not Worker CPU, and the pool cannot measure CPU. **Not verified:** the real staging CPU of the render consumer with the check. The brief's target "well under 1 ms added" is NOT met on the wall-clock figure for a large Flate stream. If the staging reading shows the consumer near 7 ms, the cheap options are inflating only the largest stream, or capping the inflated total (say 400 KB); the xref and `/Length` checks alone (0.55 ms) already catch the owner's damage. Open question 1.
- **Bundle:** jobs 855,879 bytes (limit 1,000,000; baseline in docs 851,190, so +4,689). Startup 124.8 ms (limit 200).

### B2 Template filling (F2)
- Core: `renderTemplate(body, data, { empty })` and `renderTemplateBody(body, data, { empty })` (`packages/core/src/catalogue.ts`; the old two-argument calls are unchanged). A token named in `empty` is taken out (its whole line when the line holds nothing else, only the token in a mixed line; three or more newlines collapse) and is not `unresolved`. Tests in `packages/core/test/catalogue.test.ts`.
- `apps/admin/worker/service-fill.ts` (new): `serviceData`, `emptyServiceTokens`, `appendedText`, `fillServiceTokens`, `servicesOf`, `catalogueGaps`, `textToFill`.
- Creation (`document-draft.ts`): with a first service its blank texts are EMPTY tokens (taken out); with no service nothing is empty, so the tokens stay (UNKNOWN). The other services add their text under `**Name**` as before. A section whose template text was only empty tokens and that nobody filled is created `hidden: true` (body null). Every service counts: a later service's text never sits under a leftover token.
- Save (`document-save.ts`): the save that ADDS the first catalogue-linked line to a draft with none fills every remaining `service.*` token in the sections by the same rules (and hides a section left empty); the extra read of the items of existing lines only happens on that path. A token typed into a draft that already has a service is the person's own text and is left alone and named by the send check. The contact is covered by the existing `renameContact`.
- **Note for the lead:** `POST /documents` requires at least one service and a lead convert without a service has no template (no category), so the UNKNOWN state is reachable today only through a draft whose lines were all removed and then given a service (tested that way) and through a direct `buildNewDraft` with no services. The rule is in place for any later route that creates a draft without a service.
- **Reads:** `GET /api/v1/documents/:id` adds `catalogueGaps` (below), from one more statement in the same D1 call (`ITEMS_OF_DOCUMENT`, the current catalogue rows of the lines' services). A sent version returns `[]`. The slim PATCH answer does not carry `catalogueGaps` (it carries `blockers` with `where`); the screen re-reads after a save if it needs the gaps.
- **`catalogueGaps` as built** (array, each item exactly): `{ sectionId: string, sectionKind: "deliverables" | "assumptions_exclusions", field: "deliverables" | "assumptions" | "exclusions", serviceCode: string, serviceName: string, catalogueItemId: string, catalogueHasTextNow: boolean }`. Rules: for every service on the draft's lines and each field, in the order deliverables, assumptions, exclusions, per service:
  - section hidden or body empty: a gap for every field of its kind (`catalogueHasTextNow` = Catalogue has text for it now);
  - section shows text: a gap where Catalogue has text now that the section does not hold (it is compared by the first 60 characters, so wording edited further down is not a gap), and, in Assumptions and exclusions only, a field with no text while the sibling field has (the partial case);
  - a section that shows text from another service raises no gap for a service with no text at all;
  - **`sectionId` is never null as built:** a draft with no section of that kind (the estimate template has none) has nothing to fill or hide, so it reports no gap (reporting it would nag every estimate). The type in the brief allows null; the screen can ignore that case.
- **`POST /api/v1/documents/:id/sections/fill-from-catalogue`** body `{ sectionId: string, expectedUpdatedAt: number }`. ROUTES row in `guard.ts` (not `routes-api.ts`: that file only mounts the router; both are changed), action `proposals.draft`, audit `document.update` (summary has `fill: <section kind>`), mounted in `routes-api.ts` (`document-fill.ts`). One `mutate` batch like a save. Answer 200: the full slim save answer (`updatedAt`, `contentSha256`, totals, `blockers`, `canSend`, `needsResave`, ids, ...) plus `filled: { sectionId, title, bodyMd, hidden: false }` and a fresh `catalogueGaps`. It appends only the parts Catalogue has that the section does not hold, the first service plain into a blank section, the others under `**Name**`, and unhides the section. Errors: 409 `stale_version`; 409 `nothing_to_fill`; 409 `client_anonymised`; 409 `frozen` (a sent version); 404 `not_found` (unknown document or section id, or not a proposal or estimate: `not_a_quote`); 403 for a role without `proposals.draft`; 400 `sections_invalid` if the section text would pass the limits.
- **`unresolved_placeholders` blocker** keeps `names` and adds `where: { name: string; sectionId: string | null; sectionKind: string | null; part: "title" | "line" | "section" | "schedule" }[]`, one entry per name and place (a hidden section is not scanned), in the order title, lines, sections, schedule. It rides in the draft GET `blockers`, the PATCH answer `blockers` and the 409 `reasons` of a refused send. The view's flat `unresolved` list is unchanged.
- Existing tests updated to the new behaviour: `documents.test.ts` (a service with no assumptions now gives a hidden section, no blocker and two gaps), `documents-send.test.ts` (`where`), `rbac.test.ts` (a scenario for the new route).
- New tests: `apps/admin/worker/documents-service-text.test.ts` (only assumptions; only exclusions; deliverables empty; the first service empty and a later one filled; everything empty and the draft sends; the real seeded proposal templates with seeded-style items in all five categories give no `unresolved_placeholders`; no service then a save that adds one; `where` for title, line, section, schedule; the fill route: works, audit row, stale, nothing_to_fill, 404, 403 for the accountant, anonymised client, sent version) and `service-fill.test.ts` (the pure rules). `packages/db/package.json` gets a subpath export `./seed-templates` so the test reads the real seeded templates.
- **Note:** the seeded templates also have empty optional sections (summary, problem and goals, timeline, team), which still block a send with `section_empty` until written or hidden. That is existing M4.3 behaviour and not part of F2; the new tests hide them before a send. The screen may want to say so.

### B3
- `GET /api/v1/invoices/:id/pdf/supplier` while the copy is not made: **202 `{ "state": "making" }`** (it still asks jobs once in 5 minutes when the original exists). An erased client's copy is never made, so that case stays 409 `pdf_pending` (asking never helps). `supplier-copy.test.ts` updated.
- **The SPA is not changed (designer's file):** `apps/admin/src/lib/invoices-api.ts` `askSupplierCopy` treats a 202 JSON answer as `failed` until it handles `res.status === 202` as `pending` (D2 item 11).
- Contact choices: the client payload already carries `portalAccess` per contact (`clients.ts`, `contactRow`), so nothing was added; the designer marks or leaves out contacts from it.

### Commands and results
- `pnpm --filter @techaust/pdf test`: 328 passed, coverage lines 99.39 %, branches 92.7 %.
- `pnpm --filter @techaust/core test`: 1,755 passed, branches 98.05 %.
- `pnpm --filter @techaust/jobs test`: 514 passed (31 files).
- `pnpm --filter @techaust/admin test` (full, 530 s): 3,183 passed, 10 skipped, **7 failed**, none in files this diff touches in behaviour: six in `invoice-notes.test.ts` and `note-research.test.ts` and the whole `reports-totals.test.ts` file fail on `fx_same_day_exists` with date 2026-10-29 (the FX fixtures against today's date), and one `documents-send.test.ts` V8 (20 parallel sends) timed out at 5 s under load. All passed in the targeted run of `worker/documents*`, `offers-send`, `split`, `rbac`, `supplier-copy` (1,396 tests, after my fixes). **Not verified on the base commit** whether the FX failures also fail there; the diff touches no invoice, note or FX code. Open question 2.
- `pnpm typecheck`: exit 0 (after fixing `BlobPart` in two test and source files, and a `TestSession` type).
- `pnpm check`: exit 0 (lint, typecheck, binding guard, content lint, Worker config guard, migration guard: 49 migrations, none new).
- `pnpm build`: exit 0; budgets: jobs 855,879 / 1,000,000 (+4,689), admin API 594,764 / 800,000 (baseline 587,821, +6,943; the third-Worker trigger is 650,000), admin front 99,131, portal 96,834; startup 124.8 / 105.2 / 19.9 / 19.8 ms.
- `pnpm lint` (whole repository, once, last): exit 0 (10 warnings and 8 infos, all existing).
- Dev servers: none started. No hosted service touched, no staging file committed. No migration.

### Not verified
- A real Browser Run render and the CPU of the consumer on staging (Worker CPU is not measurable in the test pool; the wall figures are above).
- Whether R2 on staging rejects a `sha256` mismatch the same way as the local R2.
- The portal offer page and the screens (the designer's).
- The 7 admin failures on the base commit (above).

### Open questions
1. If the staging cold or warm reading of the render consumer is near 7 ms, do you want the check limited (largest stream only, or a 400 KB inflate cap)? I left the full check in, as designed.
2. Should the lead have me re-run the 7 failing admin tests against the base to prove they are date-dependent and unrelated?

## Designer report
Designer: Opus 5.5 (high), branch `fix/m5-owner-fixes-design` from `origin/fix/m5-owner-findings` (c41c532), worktree `agent-ad88b1b123ab6efe8`. Built first against the B2 contract with a dev-only mock; the lead had already merged the builder into `origin/fix/m5-owner-findings` (6a260d3) by the time the screens were done, so I merged it into this branch (643b3cb, no conflicts), removed the mock and did the **real-API pass** in the same run (1333f58).

### Skills
- `frontend-design:frontend-design`: **loaded first**, before any other work. It set one bold element and kept the rest quiet: the Catalogue gap is drawn as an editor's margin note on its section (a fine verdigris rule down the left of the section's text column, quiet type, plain text actions), kept in full colour on a hidden section whose struck-through name it explains; the send check became a list of places in plain words instead of code; no new colours, chips, cards or label chrome.
- `dataviz`: not loaded (no chart, stat tile or dashboard in this task). No other docs/14 §9 row fits screens. Context7 not needed (no library API in question).

### What changed (D1)
- **Send panel, one list in plain words** (replaces the main-column banner with raw `{{…}}` and the panel's "Some placeholders have no value yet."): "Fill these in before sending:", then one item per place, "{place}: waiting for {values}." (07-X §1). A section's name is a link that opens it and puts the cursor in its text; "Title", "Lines" and "Payment schedule" name the other places. Built from `unresolved_placeholders.where`; an answer without `where` (the PATCH answer of an older API) falls back to the text on screen. Fixes beside an item: "Add a service line" (cursor to "Add from the catalogue") when a service value has no service yet, "Choose a contact" (cursor to "Send to") for the contact's name. Staff never see token syntax in a message; a hand-typed unknown value is "a value that can't be filled in".
- **Catalogue gaps** (`catalogueGaps`): notes (information mark, never the warning mark: they block nothing) under the blockers on the Send panel, one per section, naming the section (link), the service and the missing fields, "Add the text in Catalogue" (`/catalogue/<catalogueItemId>`), "This section is hidden until it has text." for a hidden one, and "Use Catalogue text" when `catalogueHasTextNow`. The same note sits on the section itself, open or closed, with "Write it here" on a hidden section (shows it, opens it, cursor in the text). A gap goes when the person shows and writes in a section that was hidden or empty when read; the partial case (section had text, a field missing) stays.
- **"Use Catalogue text"**: saves everything typed first, calls `POST /api/v1/documents/:id/sections/fill-from-catalogue {sectionId, expectedUpdatedAt}`, toasts "Catalogue text added.", reads the draft again (the new `updatedAt` redraws the editor). `nothing_to_fill` has its 07-X line; other errors use the existing 07-O sentences.
- **Inside a section**: the amber mono tokens became "This text is waiting for {values}." with the warning icon; the flag's screen-reader text uses the same words.
- **Real-API follow-up found in the pass**: the save that adds the first service line fills the sections on the server, but a save answer never carries text, so the screen would keep showing the old tokens and a later save could write them back. The editor now reads the draft again after such a save, once nothing typed is waiting (`editor.tsx`, `SERVICE_TOKEN_RE`).
- Remaining by design: the text boxes themselves still hold whatever text the section has, so a `{{client.contact}}` that has no contact yet stays visible inside the textarea (it is the stored text being edited). Every message about it is in words.

### What changed (D2, sweep findings 4–17)
4. Send dialog ticks the draft's "Send to" contact when it has portal access (`recipientChoices(contacts, preferredId)`), so the preview greets that person; otherwise billing contacts as before. Verified: "Hi Team" with Team ticked (shot 04).
5. Line editor unit: the quantity cell sizes to its unit (`minmax(8rem, max-content)` at ≥ 88 rem, `minmax(min-content, max-content)` at 64–88 rem) and the unit wraps inside its box if it ever must. "Per milestone" whole at 1280, 1408, 1440 and 1600 (shot 13), no overflow.
6. Each section's text box is named "Text of {section}" (custom sections keep their number, like the title field).
7. Portal: an ended offer link (and a malformed one) shows "Proposals and estimates" with 07-X §5 line 30 and "Sign in", the invoice link's pattern (`OfferScreen` takes a `missing` element; `offer-link.tsx`).
8. `/proposals` and `/estimates` empty states name their type ("No proposals yet", "No estimates yet"); 07-O's line stays when both types show.
9. Catalogue service page and edit form: a hint under "Deliverables, assumptions and exclusions" (07-X line 29).
10. Emails panel: the PDF panel tells the page when the PDF turns ready (`onReady`), and while an email still waits for it the page reads again every 10 s for up to a minute (`useMailAfterPdf`; proposals and the invoice family).
11. Supplier copy: a 202 is "still being made" (the toast, no console error); a 409 `pdf_pending` from an older API means the same.
12. Skip link 44 px tall, admin and portal (measured 44 px in both).
13. Stale "PENDING" comment in `pdf-panel.tsx` corrected (07-P approved with 07-Q).
14. Draft "Send to": contacts without portal access are grouped under "Has no portal access yet" (the approved send-dialog line), still choosable for the Acceptance name; the same line shows as the hint when one is chosen. The payload already had `portalAccess`.
15. An invoice draft with no lines lists "Add at least one line." only; `computed_errors` and `zero_total` are left out while `no_lines` is there (`shownBlockers`, every `BlockerList`).
16. **Not fixed: stopped, it needs a file outside my scope.** The admin CSP has no `'unsafe-inline'` and no hash, so the theme must be set by a blocking same-origin script in `<head>` (`/theme-boot.js` in `apps/admin/public/`). `apps/admin/worker/headers.test.ts` (worker/, not mine) asserts `index.html` holds only the one module script, so the fix fails that test. Patch for the lead (three small edits): (a) new `apps/admin/public/theme-boot.js`: `try{var t=localStorage.getItem("ta-admin-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`; (b) `apps/admin/index.html`: `<script src="/theme-boot.js"></script>` in `<head>` before the module, plus `<meta name="color-scheme" content="light dark" />`; (c) in `headers.test.ts` "index.html needs no inline script…", expect `['<script src="/theme-boot.js">', '<script type="module" src="/src/main.tsx">']`. `script-src 'self'` already allows it; `lib/theme.ts` keeps applying it too. The portal has no in-app theme (it follows the OS and already has the `color-scheme` meta), so it has no such gap.
17. Facts strip at 48–64 rem: the client's name and code take the first row, the short facts share the second (editor and sent view), hairlines between rows (shots 07, 31 at 768).

### Files changed
- `apps/admin/src/lib/documents.ts` (07-X words, `unresolvedItems`, `gapGroups`, `gaps` in the figures, `gapBase`, `LIST_EMPTY_BY_TYPE`, `nothing_to_fill`), `lib/documents-api.ts` (`PlaceholderWhere`, `CatalogueGap`, `catalogueGaps`, `fillFromCatalogue`), `lib/copy-x.ts` (new: the 07-X mark switch and the Catalogue hint), `lib/offers.ts`, `lib/invoices.ts` (`shownBlockers`), `lib/invoices-api.ts` (202)
- `apps/admin/src/routes/documents/{editor,side,sections,send-dialog,lines,pdf-panel,read}.tsx`, `routes/documents.tsx`, `routes/invoices/{read,dialogs}.tsx`, `routes/catalogue/{editor,service}.tsx`
- `apps/admin/src/{documents,catalogue,shell}.css`
- `apps/admin/src/lib/gaps.test.ts` (new), `lib/offers.test.ts`
- `apps/portal/src/{copy-documents.ts,portal.css}`, `routes/{offer,offer-link}.tsx`
- `docs/07-content-appendix/X-m5-owner-fixes.md` (new)
- `apps/admin/src/lib/gaps-mock.ts` added for the mock phase and removed in the real-API pass.

### Placeholder lines
All 07-X lines show "[Placeholder] " before the recommended words until the owner approves 07-X (`APPROVED_07X` in `apps/admin/src/lib/copy-x.ts` and `apps/portal/src/copy-documents.ts`): lines 1–22, 24, 25, 27–30. Not marked (the brief's own words): "Use Catalogue text" (23) and "Text of {section}" (26). The page has 30 numbered lines with recommendations; the lead takes it to the owner.

### Screenshots (`.logs/shots/m5-owner-fixes/` in this worktree; 110 files; light and dark; 375, 768, 1280, 1600 unless noted)
- `31-real-draft-gaps-top-*`: a fresh S5 proposal on the real API: send panel with `section_empty`, the two Catalogue notes (Deliverables, Assumptions and exclusions hidden); 768 shows the tablet facts strip (finding 17).
- `32-real-draft-gaps-section-*`: the margin note on hidden Deliverables with "Add the text in Catalogue" and "Write it here".
- `33-real-draft-catalogue-now-*`: Catalogue given assumptions only: the A&E note says exclusions are missing and Catalogue now has the assumptions, with "Use Catalogue text".
- `34-real-draft-after-fill-*`: after "Use Catalogue text" through the screen: the section shown with the assumptions, the note left with the missing exclusions (partial case).
- `06-estimate-values-missing-*`: an estimate draft with no contact and a hand-typed value: "Validity: waiting for the contact's name and a value that can't be filled in." with "Choose a contact".
- `04-send-dialog-preferred-contact-1280-light`: send dialog with the draft's contact (Team) ticked, "Hi Team" (finding 4).
- `07-sent-read-facts-*`: the sent proposal: facts strip, PDF "Making the PDF…", Emails panel waiting (findings 10, 17).
- `08-estimates-empty-by-type-*` and `08-proposals-empty-by-type-1280-light`: empty lists by type (finding 8).
- `09-catalogue-service-hint-*`, `10-catalogue-new-hint-*`: the Catalogue hint (finding 9).
- `11-invoice-empty-one-blocker-*`: empty invoice draft, one line blocker (finding 15).
- `12-skip-link-focus-{375,1280}-*`, `21-portal-skip-link-focus-{375,1280}-*`: the 44 px skip links (finding 12).
- `13-draft-line-unit-{1280,1408,1440,1600}-*`: the unit column (finding 5).
- `14-keyboard-send-panel-1280-*`, `15-keyboard-section-note-1280-*`: keyboard pass (taken in the mock phase; same components): Tab order section links → section notes → "Use Catalogue text" → next section; 2 px solid focus outline on every stop.
- `20-portal-offer-link-ended-*`: the portal's ended offer link (finding 7).

### Commands and results
- `pnpm install --frozen-lockfile --offline` (via heavy.sh): ok. Local setup: `pnpm dev:secrets`, `db:migrate:local`, `db:seed:local`, `portal:sample`, `invite --role owner`: ok (local D1 of this worktree only).
- `tsc -p tsconfig.json` admin and portal (heavy.sh): exit 0, before and after the merge.
- `pnpm exec biome check --write <my files>`: clean.
- `pnpm --filter @techaust/admin exec vitest run src` (heavy.sh): 21 files, 378 tests passed (before the merge; the new `gaps.test.ts` and the `offers.test.ts` case included).
- `pnpm check` (heavy.sh), after the merge, my final check (it runs the whole-repository `pnpm lint`): exit 0; lint 1,266 files, 10 warnings and 8 infos, all existing; typecheck, binding, content, Worker config and migration guards ok.
- `pnpm --filter @techaust/portal test` (heavy.sh), after the merge: 24 files, 620 passed.
- `pnpm --filter @techaust/admin test` (heavy.sh), after the merge: 3,198 passed, 10 skipped, **6 failed in 3 files, none mine**: `worker/invoice-notes.test.ts` (3), `worker/note-research.test.ts` (3) and `worker/reports-totals.test.ts` (whole file), all on `fx_same_day_exists` with date 2026-10-29 (the FX fixtures against today's IST date), the same ones the builder reported. My diff touches no `worker/`, `packages/` or jobs file (`git diff --stat c41c532 HEAD -- apps/*/worker apps/jobs packages` lists only the builder's merged files).
- Screenshots and axe: Playwright 1.64.1 + `@axe-core/playwright` 4.14.0 from `apps/web` (scripts in my scratchpad, not committed), WCAG 2.2 AA tags at 375 and 1280 on every shot. **axe clean** on every real-API shot (31–34), 04, 06–11, 13–15, 20 and the portal skip link. Two findings, both on the target-size rule and both from what overlaps the target, not from these screens: the admin skip link, while focused, covers the phone top bar's menu and mark (12, 375 only); and in the mock-phase section shot at 375 the sticky top bar covered the "Show Scope" checkbox at that scroll position. No horizontal overflow on any shot. Console: only the expected 401 before sign-in and the expected 404 of the ended-link API.
- Dev servers (admin, then portal, one after the other) and every Playwright browser were stopped before this report; the MCP browser closed.

### Mocked, then replaced
- The B2 answer was mocked in `lib/gaps-mock.ts` (dev only, behind `import.meta.env.DEV` and a localStorage switch) for the first round; removed in 1333f58. Every screen above in 31–34 is the real API (`catalogueGaps`, `where`, the fill route); the builder's shapes matched the brief, except that `sectionId` is never null as built (the screen still handles null) and the PATCH answer carries no `catalogueGaps` (the screen keeps the last ones and filters them by what is on screen).

### Not verified
- A real Browser Run render, so the Emails panel moving on by itself once the PDF is ready (finding 10) is untested end to end (no jobs Worker locally); the hook and `onReady` are only read and type-checked.
- The supplier copy 202 path in the browser (no PDF locally); the code path is a status check.
- The portal offer page with a real offer, accept and decline (the ended-link page only).
- Finding 16 (not fixed, above). Screen readers (NVDA) not run; names checked through the accessibility tree.

### Open questions
1. Finding 16: apply the three-edit patch above (it touches `apps/admin/worker/headers.test.ts`)? Recommended: yes, by the lead or a one-file builder fix.
2. The send panel now carries the only list (the main-column banner is gone, as the brief's "replace the banner and the Send card's line with a list"); on desktop the panel sits beside the editor and on phones before it. Keep one list (recommended), or also repeat a short summary at the top of the editing column?
3. 07-X goes to the owner as one page (30 numbered lines, recommendations given; two lines offer an "Or:").

## Fix round 1 (lead's brief, 2026-10-29 night; builder claude-opus-5-5/high per the owner's audit instruction)
Inputs: the builder's and designer's open items, and two audit findings that land in this task's files (docs/runs/full-audit-m1-m5.md, A0 and A6).
1. **CI clock, A0 high 1:** `apps/admin/worker/test-notes.ts:62` and `note-research.test.ts:230-231` use the UTC date while the server uses IST, so 6 tests fail every day from 00:00 to 05:29 IST. Use `todayIso()` (`test-invoice-types.ts:34`). Add a guard test that fails any worker test or helper using `toISOString().slice(0, 10)` for "today" without the IST offset. Also pin the module-load clocks (A0 low 7): `documents-send.test.ts:28`, `reports-totals.test.ts:56`, `dashboard-finance.test.ts:20`. Compute the value inside each test, or use fake timers set to 12:00 IST, mid-month, mid-FY.
2. **PDF check CPU bound, A6 high 1** (lead's decision, recorded in docs/13). The check must never make a legitimate PDF unrenderable:
   - (a) raise `INFLATE_MIN_BYTES` to 8,192: a moved 8 KB block can't hide inside a smaller stream;
   - (b) keep a running total of inflated bytes with a hard budget (1.5 MB, a named constant). Over budget, the remaining streams are **not inflated**. The PDF is accepted on the header, xref and `/Length` checks alone, and `pdf.integrity_partial {bytes, inflated, skippedStreams}` is logged (numbers only). Never refuse, never retry for this.
   - (c) hash the rendered bytes once and reuse the hash (A6 low 5, `pdf.ts:352/370`, `595-607`).
   - Tests: the budget path, the 8 KB threshold, and that the owner's 3-block permutation is still caught with the budget at its minimum.
   - Measure the check's wall time again on a synthetic PDF that holds a large Huffman-coded (not stored) stream, and report it.
3. **The white flash, sweep 16:** apply the designer's three-edit patch above (`apps/admin/public/theme-boot.js`, `apps/admin/index.html`, `apps/admin/worker/headers.test.ts`).
4. **The editing column (designer question 2):** keep the list on the Send panel only (lead's decision). No change.
- **Done means:** `pnpm check` and `pnpm test` all green, including the 6 tests run at any hour (prove it with fake timers set to 01:00 IST). Bundle and startup budgets reported. Append "### Fix round 1 report" here.

### Fix round 1 report
Builder: Opus 5.5 (high), branch `fix/m5-owner-fixes-r1` from `origin/fix/m5-owner-findings` (bb6f3b5), worktree `agent-ab4f52512f8d28dfa`. Run 01:50–02:45 IST, inside the 00:00–05:29 IST window of A0 finding 1, so every real-clock run below is also a night run.

**Skills:**
- `cloudflare:workers-best-practices`: the bounded inflate cancels the stream instead of buffering it; the check stays pure; no hand-written `Env` (the new test binding is declared in `test-env.d.ts`).
- `cloudflare:workers-profiling`: the method and its limit. The pool measures wall time, not Worker CPU, so the staging `cpuTimeMs` reading stays the gate.
- `cloudflare:wrangler`: used only to read the existing configs; no config changed.
- Not loaded: `frontend-design` (the white-flash fix is the designer's patch applied as given, no design work); `cloudflare:cloudflare` (no new platform feature); the AWS, Supabase, Upstash and Sentry skills (no matching work).
- Context7: vitest 4 (`useFakeTimers` with `shouldAdvanceTime`, `setSystemTime`, the test context's `annotate`).

**Commits:**
1. `7f4bcb2` test(admin): IST today in note helpers, no clock read at module load, guard and opt-in shifted clock [ADM-INV-11, ADM-INV-17]
2. `8d924ee` fix(admin): set the in-app theme before the first paint, no white flash [ADM-G-01]
3. `8bf0c01` fix(jobs): bound the PDF check: 8 KB inflate threshold, 1.5 MiB budget, partial accept, hash once [JOB-PDF-01, ADM-PROP-05]
4. `beb4af3` test(jobs): Huffman-coded PDF check timings and the integrity_partial log line [JOB-PDF-01]
5. This report.

#### 1. CI clock (A0 findings 1 and 7)
- **The two helpers:** `test-notes.ts:63` takes the FX date from `issueDateOf(Date.now())` (the server's IST day); `note-research.test.ts:231` takes it from `todayIso()`.
- **No clock read at module load any more:**
  - `documents-send.test.ts`: `fyToken()`.
  - `invoices-issue.test.ts`: `fy()`.
  - `test-invoices.ts`: `invoiceCounter` defaults to the FY at the moment of the call. Every caller reads it before and after at the same clock, and tests that move the clock put it back in `afterEach`.
  - `reports-totals.test.ts`: the whole file is pinned with `pinClock()` in `beforeAll`, `today` is that pinned day, and `afterAll` puts the real clock back.
  - `dashboard-finance.test.ts`: `istToday()` is `issueDateOf(Date.now())`, and the two fixture tests call `pinClock()`.
- **`pinClock(at = NOON_IST_MID_FY)`** (in `test-helpers.ts`): fakes Date only, with `shouldAdvanceTime: true` so timestamps keep increasing. The default is 2026-10-15 12:00 IST (mid-month, mid-FY).
- **Guard, `apps/admin/worker/clock-ist.test.ts`** (each rule first checks itself against sample lines):
  - (a) No `new Date()` or `new Date(Date.now() ± …)` cut with `.toISOString().slice(0, 10)` without the IST offset, in every `worker/*.ts` file and every SPA source.
  - (b) No top-level constant in a test or helper whose value reads the clock.
  - (c) At 01:00 IST (19:30 UTC the day before), `todayIso()` is the IST day, and `mkIssuedInvoice` with an overseas client issues with `issue_date` = `fx_date` = the IST day. This is the exact path that failed.
- **Opt-in shifted clock** (`worker/test-setup.ts`; the binding `TEST_CLOCK_AT` comes from `TA_TEST_CLOCK` in `vitest.config.ts`):
  - With `TA_TEST_CLOCK=<ISO instant>` every test runs as if the run had started at that instant (Date only, still moving).
  - A test that sets its own clock keeps it.
  - Unset (as in CI), nothing changes.
- **Proof with fake timers at 01:00 IST:** with `TA_TEST_CLOCK=2026-11-18T01:00:00+05:30`, the files note-research, invoice-notes, reports-totals, dashboard-finance, documents-send and clock-ist: 6 files, 93 passed.
- **Control** (the old `test-notes.ts` line put back for the run, never committed):
  - At `2026-11-18T12:00+05:30`, invoice-notes and reports-totals pass (47 tests).
  - At `2026-11-18T01:00+05:30`, invoice-notes fails 3 tests with `fx_same_day_exists` dated 2026-11-18, the reported failure.
  - So the shift is live, and the fix is what makes the tests pass. reports-totals passes even with the old line now, because the file is pinned to noon.
- **Real-clock night run:** the 7 touched files at 01:53 IST, 137 passed. The full admin suite at 02:26 IST: 104 files, **3,218 passed, 0 failed**.

#### 2. PDF check bound (A6 findings 1 and 5; docs/13, 2026-10-29)
**The check (`packages/pdf/src/integrity.ts`):**
- `INFLATE_MIN_BYTES = 8192` and `INFLATE_BUDGET_BYTES = 1_572_864` (1.5 MiB).
- An option `{ inflateBudget }`, used by the tests only. A non-finite value means the default, never unbounded.
- Each Flate stream is read chunk by chunk with a running total. Once the total passes the budget, the reader is cancelled, and every later eligible stream is counted but not inflated.
- The verdict is `{ ok: true }` when everything was checked, else `{ ok: true, partial: { inflated, skippedStreams } }`.
- The header, xref and `/Length` checks always run. A broken stream found before the budget runs out is still `stream_checksum`.

**The consumer (`apps/jobs/src/browser.ts`, `readPdf`):** a `partial` verdict logs `pdf.integrity_partial {bytes, inflated, skippedStreams}` (numbers only) and returns the PDF. It is never refused and never retried for its size.

**Hashed once:** `putPdfOnce(bucket, key, rendered)` in `apps/jobs/src/pdf.ts` hashes the rendered bytes once, passes that hash to R2 and returns it for the row. Only when another render got there first does it read and hash the stored file. It is used by the invoice family and the supplier copy, proposals and estimates, certificates and statements (`statement-pdf.ts`).

**Tests in Node (`packages/pdf/test/integrity.test.ts`):**
- The constants.
- A Flate stream of 8,191 bytes is not inflated; one of 8,192 bytes is (a block swapped inside it gives `stream_checksum`).
- The budget path: three 100 KB streams with a 150 KB budget give `skippedStreams` 2, and `inflated` between the budget and one chunk past it. Damage in a skipped stream is the accepted risk; damage in the first stream is still caught.
- The default budget stops a 16 MB blank-image stream just past 1.5 MiB, with `ok: true`.
- **Budget 0:** nothing is inflated, the owner's 3, 1, 2 permutation is still `xref_offset`, and a bad `/Length` is still `stream_length`.

**Tests in workerd (`apps/jobs/test/pdf-integrity.test.ts`):**
- `renderPdf` past the budget returns the bytes, with one `pdf.integrity_partial` line of numbers only and no `pdf.damaged`.
- `putPdfOnce` makes one digest for a new file, and returns the stored file and its hash when another render got there first.

**Wall time** (workerd test pool on this shared 8 GB PC, with another agent's browser sweep running; mean of 5–20 runs after a warm-up; wall time, not Worker CPU). Each synthetic PDF has 755 small objects and one Flate stream:

| Stream | File | Check |
|---|---|---|
| Random, 262 KB (the builder's case) | 308,932 B | 8.0–9.3 ms (builder: 6.15) |
| Huffman-coded, 262 KB inflated | 220 KB | 3.9–5.2 ms |
| Huffman-coded, 1,556,480 B inflated (just under the budget) | 1.08 MB | 19.4–19.8 ms, of which 7.8 ms with nothing inflated |
| Huffman-coded, 4 MiB inflated, cut at the budget | 2.82 MB | 42.0–50.6 ms, of which 18.8 ms with nothing inflated |

- The Huffman stream is skewed text from 40 symbols with no long repeats, so deflate codes it with dynamic Huffman tables, not stored blocks.
- Inflating costs about 7–8 ms of wall time per MiB of Huffman output here. The budget caps that part at about 12–23 ms, whatever the stream's size: a 40 MB blank stream took 269 ms unbounded and 36 ms capped.
- The rest of the cost grows with the file's size: the latin1 decode and the regex scans of the whole file, about 7 ms per MB here.

#### 3. White flash (sweep finding 16)
- The designer's patch, as given:
  - `apps/admin/public/theme-boot.js` reads `ta-admin-theme` and sets `data-theme` for light or dark (written with `const` and `catch {}` to satisfy the linter);
  - `apps/admin/index.html` gets `<meta name="color-scheme" content="light dark">` and `<script src="/theme-boot.js">` before the module;
  - `headers.test.ts` expects the two scripts in that order, the boot script inside `<head>`, and the same key in the boot script and `src/lib/theme.ts`.
- The built `dist/client/index.html` keeps the boot script before the module and the stylesheet. `script-src 'self'` covers it.

#### 4. The editing column
No change (lead's decision).

#### Commands and results
- `bash tools/heavy.sh --log r1-install pnpm install --frozen-lockfile --offline`: ok. The worktree lacked the apps' bins; no version changed and the lockfile is untouched.
- `pnpm exec biome check --write <changed files>`: clean.
- Targeted `vitest run` on the admin worker tests:
  - 7 files on the real clock at 01:53 IST: 137 passed;
  - with `TA_TEST_CLOCK` at 01:00 IST: 93 passed;
  - the control runs described in item 1.
- `pnpm --filter @techaust/pdf test`: 333 passed. Coverage: statements 97.58 %, branches 92.79 %, functions 99.28 %, lines 99.4 %.
- `pnpm --filter @techaust/jobs test`: 517 passed (31 files).
- `pnpm build`: exit 0. **Budgets:**

  | Worker | Bundle (bytes) | Startup (limit 200 ms) |
  |---|---|---|
  | jobs | 856,496 / 1,000,000 (+617 on the builder's 855,879) | 118.0 ms |
  | admin API | 594,764 / 800,000 (unchanged) | 99.7 ms |
  | admin front | 99,131 | 19.1 ms |
  | portal | 96,834 | 17.0 ms |

- `pnpm test` (full, 02:26 IST), all passed: auth 135, ui 469 (2 skipped), core 1,755, email 128, db 452, pdf 333, web 443, jobs 517, portal 620, admin 3,218.
- `pnpm check` (the final check, which runs the whole-repository lint once): exit 0. Lint checked 1,268 files with 10 warnings, all in files this branch doesn't touch. Typecheck, the binding guard, the content lint, the Worker config guard and the migration guard (49 migrations, none new) all ok.
- No dev server started, no hosted service touched, no PDF committed (every PDF in the tests is built by the test), no migration.

#### Not verified
- The check's Worker CPU on staging. Every figure above is wall time in the local pool on a loaded PC, so the staging `cpuTimeMs` of `pdf.rendered` (the A6 follow-up) is still the gate.
- A real Browser Run PDF going through the bounded check (none can be made locally).
- The white flash in a browser. It was checked through the built HTML and the header test, not with a screenshot (the screens are the designer's).

#### Open questions
1. **The 1.5 MiB budget against the 10 ms CPU limit.**
   - Here, a check that uses the whole budget on Huffman-coded streams costs about 19 ms of wall time for a 1.08 MB file and 42–50 ms for a 2.8 MB file. The size-dependent part (decode and scans) is about 7 ms per MB on its own.
   - If staging CPU comes anywhere near these wall figures, a large signed PDF could pass the 10 ms limit through the check alone.
   - Cheap options for the lead, one constant or a few lines each: a smaller budget (512 KiB would roughly halve the inflate part), or no inflating at all above a file size.
   - I kept the decided 1.5 MiB.
2. The base branch moved while I worked (`937e86d`, `1b788a8`: the audit A1 and A2 notes in `docs/runs/full-audit-m1-m5.md`). This branch doesn't touch that file, so the merge should be clean.

## Review (reviewer claude-opus-5-5/high, 2026-10-29 ~02:50–03:40 IST, on 24d9d3e2): SEND BACK
The lead's summary of the reviewer's reply.
- **Verified:**
  - All 7 real Chrome PDFs on this PC pass the check; the owner's damaged proposal fails `xref_offset` at budget 0 and by default.
  - Every PDF put goes through `putPdfOnce` with a `sha256`.
  - The fill route's ROUTES row and the `mutate` WHERE match the save's.
  - The clock fixes landed: the full admin suite passed at 03:02 IST, inside the old failure window.
  - The theme boot script is correct.
  - pdf 333, jobs 517, portal 620 and admin 3,218 tests pass; `pnpm check` passes.
  - The visual review (from screenshots, since another agent had the browser) found no brand or accessibility break apart from finding 6.
  - 07-X is clear; only line 29 needs a correction.
- **Findings:**
  1. **High:** the check's CPU comes from a `new RegExp` built per xref entry (`packages/pdf/src/integrity.ts:119`). Measured with Node 24's V8 on real Chrome PDFs, with nothing inflated: cold, 37.0 ms on a 486 KB, 1,926-object file and 15.3 ms on the owner's 204 KB estimate; warm, 5.8 ms and 2.2 ms. The regex loop alone, cold, costs 24.6 ms against 1.9 ms with one precompiled regex. So a cold consumer would pass 10 ms, then retry and dead-letter. Fix:
     - one module-level sticky regex (`/(\d+)\s+(\d+)\s+obj/y`, set `lastIndex`, no `slice`);
     - find `startxref` and `%%EOF` with `lastIndexOf` in the last 1 KB;
     - optionally scan bytes instead of latin1-decoding the whole file;
     - a workerd test on a synthetic PDF of about 2,000 objects.
  2. **Medium:** Content-Length is compared with the decoded body (`browser.ts:147`). Pass `null` when `content-encoding` is present and not `identity`, or when the header isn't digits.
  3. **Medium:** "Catalogue now has…" and the duplicate fill after a normal edit (`service-fill.ts:121-124`, a 60-character match). Report "now" only for Catalogue text changed after the draft was made (`catalogue_items.updated_at > documents.created_at`), or record what filled each section.
  4. **Medium:** the Catalogue notes go stale after the lines change (`lib/documents.ts:1030`; the PATCH answer has no `catalogueGaps`). Return `catalogueGaps` in the PATCH answer whenever the lines changed.
  5. **Medium:** the re-read after the first service line is fragile (`editor.tsx:93-122`): stale token text written back, typing lost on remount, `reread` never reset, titles not checked. Root fix: return the refilled sections in the save answer, apply them in `applySave`, and drop the re-read.
  6. **Medium:** at 375 px the section-row chevron drops onto its own line (shots 33 and 34). Keep it inline.
  7. **Low:** never auto-hide `REQUIRED_SECTIONS` (`service-fill.ts:88-89`, `document-draft.ts:192`).
  8. **Low:** `document-fill.ts:86-161` copies the save's write path. Make one shared `writeDraftState` helper.
  9. **Low:** `ITEMS_OF_DOCUMENT` runs for sent versions too (`documents.ts:411`). Add a `frozen_at IS NULL` condition.
  10. **Low:** check edge cases: cap the xref `count` at `(size - at) / 20`; accept a CR-only line end before `endstream`; recognise a linearised file (two `startxref`) instead of reading it as incremental.
  11. **Low, copy:** 07-X line 29 should read "A new proposal takes…", since estimates have no such sections.
  12. **Low:** a second service with no text, in a section that shows the first service's text, gets no note. **Lead's reading of the owner's Q3:** yes, the note names every service whose text is missing.
  13. **Low:** loosen or remove the wall-time limits in `apps/jobs/test/pdf-integrity.test.ts`.
- **Not verified:**
  - Worker CPU on staging;
  - whether Browser Run sends a `Content-Encoding`;
  - R2's `sha256` refusal on staging;
  - a live keyboard and axe pass;
  - the portal offer page with a real offer.

## Fix round 2 (lead's brief; builder claude-opus-5-5/high, designer claude-opus-5-5/high for item 6)
Fix every review finding, 1–13, as described above. Items 1, 2 and 10 are in `packages/pdf` and `apps/jobs`. Items 3, 4, 5, 7, 8, 9 and 12 are in the admin worker, plus the SPA's `applySave`/editor for 4 and 5. Item 6 is CSS in `apps/admin/src`. Item 11 is the copy page. Item 13 is the jobs test.
- **Item 1:** report cold and warm timings (Node V8, a fresh process for cold) on the two real PDFs in the main checkout's `.logs/m5-owner-fixes/`. Read them locally and never commit them. Target: cold ≤ 3 ms on the 204 KB file.
- **Item 3:** prefer the `updated_at` rule. If you record what filled each section instead, it must need no migration, or stop and report.
- **Done means:** `pnpm check` and the full `pnpm test` pass. Append "### Fix round 2 report".

### Fix round 2 report
Builder: Opus 5.5 (high), branch `fix/m5-owner-fixes-r2` from `origin/fix/m5-owner-findings` (69494ee3), worktree `agent-a6238019a4d9fee85`. All 13 findings are fixed. No migration. No hosted service touched. No dev server started. No PDF committed: the real PDFs were only read in place from the main checkout's `.logs/`.

**Skills:**
- `cloudflare:workers-best-practices`: the check stays pure and never throws. The module-level sticky state was dropped (no regular expression is left in the check). The decoded-body rule follows the runtime's handling of `Content-Encoding`. No hand-written `Env`.
- `cloudflare:workers-profiling`: the method. A cold first call is measured in a fresh process, with the fastest and median of many runs. Wall time in the workerd pool is not CPU (its clock doesn't move during computation), so the staging `cpuTimeMs` stays the gate.
- `cloudflare:wrangler`: no config changed (only the builds' `--dry-run`).
- `frontend-design:frontend-design`: item 6. Restraint: the row keeps its look. The chevron stays beside the name, and on a phone the word "Hidden" goes to screen readers only (the struck-through name and the unticked eye already show it).
- Not loaded: `dataviz` (no chart); `cloudflare:cloudflare` (no new platform feature); the AWS, Supabase, Upstash and Sentry skills (no matching work). Context7 not needed: only platform built-ins were used (`Uint8Array.indexOf`, `DecompressionStream`), and tests in workerd cover them.

**Commits:**
1. `7fc7e158` fix(pdf): byte-level PDF check for a cold isolate, linearised files, bounded xref, decoded-body length [JOB-PDF-01, ADM-PROP-05]
2. `1fe043c5` fix(admin): catalogue gaps by row change, every service named, sections in the save answer, one draft write path [ADM-PROP-02, ADM-PROP-05, ADM-CAT-03]
3. `3753c5a7` test(admin): the slim save answer lists catalogueGaps and sectionsChanged [ADM-PROP-02]
4. This report.

#### 1. The check's cold CPU (high)
`packages/pdf/src/integrity.ts` now reads the bytes directly:
- No whole-file text decode. The windows-1252 decode alone cost about 2 ms cold on the 204 KB file.
- No regular expression anywhere. The per-entry `new RegExp` is gone.
- Every search is the native `Uint8Array.prototype.indexOf` / `lastIndexOf` on the rarest byte of the keyword (the "x" of `startxref`, the "j" of ` obj`, the "h" of `/Length`), then a short byte compare.
- The per-entry work is two flat functions with no helper calls (`entryOffset`, `objectNumberAt`): a cold isolate interprets them, and every call costs there.
- `startxref` and `%%EOF` are found with `lastIndexOf` in the last 1 KB only. An earlier revision is found by its trailer's `/Prev` (PDF 32000-1 7.5.6) instead of a whole-file count.
- The stream scan jumps past `endstream`, so each stream's keyword is read once.

Timings in Node 24.19 (V8): a fresh process per cold run, the fastest and median of 9 runs (5 for the base). Warm is the median of 31 later calls. The PC was shared and loaded; the import of the module is not counted.

| File | Bytes | Verdict | Base, cold (min / median) | Now, cold (min / median) | Now, warm | Now with inflate, cold (platform loaded) | Now with inflate, warm |
|---|---|---|---|---|---|---|---|
| TH-EST-2627-0001-v1 (the 204 KB estimate) | 203,963 | ok | 13.27 / 18.20 | **2.24 / 2.54** | 0.37 | 3.66 / 4.51 | 0.73 |
| TH-PRP-2627-0001-v1 (the owner's damaged proposal) | 270,658 | `xref_offset` | 2.55 / 3.21 | 0.63 / 0.70 | 0.03 | 1.20 / 1.27 | 0.03 |
| inter-estimate | 203,491 | ok | 12.27 / 14.15 | 2.18 / 2.50 | 0.39 | 3.88 / 4.02 | 0.68 |
| intra-estimate | 209,757 | ok | 12.17 / 14.51 | 2.42 / 2.54 | 0.40 | 3.50 / 4.48 | 0.85 |
| long-inter-inr (1,926 objects) | 486,091 | ok | 34.39 / 38.80 | 3.22 / 3.58 | 0.42 | 6.40 / 6.91 | 1.33 |
| long-names | 250,149 | ok | 15.61 / 16.94 | 2.21 / 2.67 | 0.38 | 3.76 / 4.18 | 0.77 |
| short-intra-inr | 251,702 | ok | 14.60 / 16.24 | 2.23 / 2.73 | 0.45 | 3.67 / 4.54 | 0.79 |
| usd-export | 204,996 | ok | 13.59 / 14.10 | 2.16 / 2.77 | 0.40 | 3.47 / 3.89 | 0.70 |

How to read the table:
- **"Base" and "Now" are the structure check:** header, `startxref`/`%%EOF`, every xref entry and every `/Length`, with nothing inflated (budget 0). The reviewer measured this same part. **Target met:** 2.24 ms fastest and 2.54 ms median, cold, on the 204 KB estimate (was 13–18 ms).
- **"With inflate"** is the full check at the default 512 KiB budget. Each real file has one Flate stream of 8 KB or more. "Platform loaded" means Node's `DecompressionStream` modules were loaded first, untimed: Node builds that class from JS modules on first use, while workerd has it built in. Without that preload, Node's first inflate alone adds about 11–13 ms (cold 12.9–20.8 ms). That is Node's start-up, not our code, and it says nothing about workerd.
- **Not verified:** workerd's own cold cost of one native inflate. The staging `cpuTimeMs` of `pdf.rendered` stays the gate (A6 follow-up).
- Every real file passes. The owner's damaged proposal still fails `xref_offset`, with the budget at 0 and at the default.
- The scratch scripts that produced these figures live in the scratchpad and are not committed.

#### 2. Content-Length vs the decoded body (medium)
`declaredBodyLength(headers)` in `apps/jobs/src/browser.ts` returns the length the bytes must have, or null. It is null when a `Content-Encoding` other than `identity` is present (the runtime has decoded the body, so the wire length is shorter), and null unless the header is 1–15 plain digits. `readPdf` passes that value to the check. The size pre-check (`MAX_PDF_BYTES`) is unchanged.

#### 3. "Catalogue now has…" and the duplicate fill (medium): the `updated_at` rule
`service-fill.ts` has one shared predicate, `offered(section, service, text, createdAt)`. Catalogue text the section lacks is offered only when:
- the section shows nothing (adding to it can't repeat anything), or
- the Catalogue row changed after the draft was made (`catalogue_items.updated_at > documents.created_at`).

Text Catalogue already had when the draft was made went into it then. So a section that shows text without it holds the person's own wording: it is never called new and never added again. `catalogueGaps` (`catalogueHasTextNow`) and `textToFill` (the route) both use `offered`, so the button adds exactly what the note offers. `ITEMS_OF_DOCUMENT` now also reads `updated_at`.

**Residual, by design (no migration):** the rule works per row, not per field. After any edit of that Catalogue item (a price as well), texts the section doesn't hold are offered again, and the test proves it. Text the section already holds is never offered twice. Per-field precision would need the `catalogue.update` audit rows or a new column. I didn't do it, and it is open question 1.

#### 4. Stale Catalogue notes after the lines change (medium)
A PATCH that changes lines or sections now answers with `catalogueGaps`. The save reads `ITEMS_OF_SAVE` in its one read batch: the services it adds, plus, only for such a save, those already on the draft. Any other save sends no `catalogueGaps`, and the screen keeps the ones it has. The extra read of the first-service refill path is gone, because those rows are now in the same batch.

#### 5. The re-read after the first service line (medium): root fix
- **Server:** the save answer carries `sectionsChanged`: the sections the server itself wrote in this save, as stored (`{id, title, bodyMd, hidden}`). That covers the first-service fill and the contact's name in the Acceptance text. It is empty otherwise, so the person's own text is still never sent back.
- **SPA:** `applySave` puts those sections on screen. `buildPatch`'s `Sent` keeps each section object as it was sent (`sectionsAt`). A section the person touched while the save was in flight keeps what they typed. It saves next, and anything left unfilled is named by the send check.
- **Removed from `editor.tsx`:** the `reread` state, the effect, `SERVICE_TOKEN_RE` and the first-service guess. So no stale token text is written back, nothing typed is lost on a remount, and titles come from the server too.
- **"Use Catalogue text" too:** it no longer re-reads. Its answer goes through the same `applySave`, and an autosave waits for it (`inflight`).

#### 6. Section-row chevron at 375 px (medium, CSS)
- `sections.tsx`: the name (and the kind under a custom title) sit in a `.section-row__label`, which may wrap. The toggle itself no longer wraps, and the chevron is `flex: none` beside the label.
- `documents.css`: below 30 rem the word "Hidden" goes to screen readers only. Otherwise "Deliverables" plus its chevron didn't fit beside the flags and the controls.
- **Checked in a static harness, not the app:** the real `tokens.css` and `documents.css` with the row markup, rendered with Playwright at 375, 768 and 1280 px in both themes. At every width and in both themes the chevron is beside the label, no name text overflows, and the page has no horizontal overflow. Screenshots are in the scratchpad, not in the repo. The app itself was not run (it needs a signed-in local session).

#### 7. Required sections never auto-hidden (low)
`autoHides(kind)` (not estimate, terms or acceptance) is used in `fillServiceTokens` and in `document-draft.ts`.

#### 8. One write path (low)
The new `apps/admin/worker/document-write.ts` (`writeDraftState`) holds the save's whole write: the changed columns, the child diffs, approval expiry, one `mutate`, telling a refusal apart (frozen, anonymised, stale, `documents_contact_scope`) and the `after` bundle. `document-save.ts` and `document-fill.ts` both call it. The fill route's 409s and its audit summary (`fill: <kind>`) are unchanged.

#### 9. Catalogue rows for drafts only (low)
`ITEMS_OF_DOCUMENT` adds `AND EXISTS (SELECT 1 FROM documents WHERE id = ?1 AND frozen_at IS NULL)`. A test runs the statement on a draft (1 row) and on the same document once sent (0 rows).

#### 10. Edge cases of the check (low)
- **The xref entry count:** a count larger than `(size − at) / 20` is `xref_unreadable` (bounded, never spins). An entry that is neither `n` nor `f` is also `xref_unreadable` (before, it was skipped silently).
- **The end of line before `endstream`:** CR LF, LF, CR alone or none are all accepted.
- **A linearised file:** `/Linearized` in the first 1 KB means exactly two sections are read through the `/Prev` chain, and a wrong entry in the main section is still `xref_offset`. A third section is `incremental`. A small linearised file (under 2 KB) may hold both `startxref` in the last 1 KB.
- **`/Prev` in a file that isn't linearised** is `incremental`.
- **`/Length1` to `/Length3`** of a font file are skipped, and an indirect `/Length n 0 R` falls back to the `endstream` search.

#### 11. 07-X line 29 (low, copy)
"A new proposal takes its Deliverables section…", in `docs/07-content-appendix/X-m5-owner-fixes.md` and in `apps/admin/src/lib/copy-x.ts`. It still shows `[Placeholder]` until the owner approves 07-X.

#### 12. Every service named (low; lead's Q3 reading)
A service with no text is named when:
- the section is hidden or empty;
- the service has the sibling field (the partial case);
- the section shows another service's Catalogue text (new).

A section that shows only the person's own writing names nobody: they filled it by hand. The creation test now expects the first service's three blanks next to the later service's exclusions.

#### 13. Wall-time limits (low)
The `toBeLessThan(50)` and `toBeLessThan(500)` limits in `apps/jobs/test/pdf-integrity.test.ts` are removed; the figures stay as annotations.

New workerd test: a 2,000-object PDF passes. The owner's 3, 1, 2 permutation fails at two places, and the last entry one byte off fails (every entry is read, not a sample). It carries no timing, because workerd's clock doesn't move during computation.

#### Tests added or changed
- **`packages/pdf/test/integrity.test.ts`:** 7 new cases (item 10, and the displacement number). Byte-exact `splice` replaces a text re-encode that shifted the binary. `no_eof` and `no_startxref` follow the last-1-KB rule.
- **`apps/jobs/test/pdf-integrity.test.ts`:** item 2 (`declaredBodyLength`, and `renderPdf` with gzip and with identity), the 2,000-object case, the limits removed.
- **`apps/admin/worker/service-fill.test.ts`:** the gap and fill rules rewritten for items 3 and 12, plus item 7.
- **`documents-service-text.test.ts`:** `sectionsChanged` and the PATCH gaps (items 4 and 5), item 3 end to end (an edit isn't new; a changed row is offered once), item 9 and item 7. Direct Catalogue edits in the tests now move `updated_at`, as the Catalogue route does.
- **`documents-batch-fixes.test.ts`:** the contact rename comes back in `sectionsChanged`.
- **`documents-fixes.test.ts`:** the slim answer's keys, and `sectionsChanged` is empty for typed text.
- **`apps/admin/src/lib/documents.test.ts`:** `applySave` applies the server's sections and keeps text typed while the save was in flight.

#### Commands and results
- **Install:** `pnpm install --frozen-lockfile --offline`: ok (the worktree lacked links).
- **Lint:** `pnpm exec biome check --write <changed files>`: clean each time.
- **Package tests:**
  - `pnpm --filter @techaust/pdf test` (heavy.sh): 340 passed. Coverage: statements 97.04 %, branches 90.95 %, lines 99.27 %.
  - `pnpm --filter @techaust/admin typecheck` (heavy.sh): exit 0.
  - SPA tests (`vitest run src`): 380 passed.
- **Targeted admin worker runs** (documents-service-text, documents, service-fill, batch-fixes, documents-send, documents-fixes, rbac, split): all passed.
- **`pnpm build`** (heavy.sh): exit 0. Budgets:

  | Worker | Bundle (bytes) | Change | Startup (limit 200 ms) |
  |---|---|---|---|
  | jobs | 862,642 / 1,000,000 | +6,146 on round 1's 856,496 (the byte-level check and its comments) | 127.8 ms |
  | admin API | 594,509 / 800,000 | −255 (the shared write path; the third-Worker trigger is 650,000) | 73.6 ms |
  | admin front | 99,131 / 150,000 | | 18.0 ms |
  | portal | 96,834 / 120,000 | | 31.6 ms |

- **Full `pnpm test`** (heavy.sh), three runs:
  - **Run 1:** jobs `stats.test.ts` "exactly 50 plans is one page" timed out at 5 s under load, and the admin run was cut short. That file is untouched by this branch, and it passed alone: 25/25.
  - **Run 2:** one admin failure, `documents-fixes.test.ts`. Its key list of the slim save answer lacked the two new keys; fixed in `3753c5a7`.
  - **Run 3, all passed:** auth 135, ui 469 (2 skipped), core 1,755, email 128, db 452, pdf 340, web 443, portal 620, jobs 519, admin 3,226.
- **`pnpm check`** (heavy.sh; the final check, with the whole-repository lint run once): exit 0. Lint checked 1,269 files with 10 warnings, all existing. Typecheck ok. Binding, content, Worker config and migration guards ok (49 migrations, none new).

#### Not verified
- Worker CPU on staging. That includes the cold cost of one native inflate in workerd: Node's figure is not workerd's.
- Whether Browser Run sends a `Content-Encoding`. The code handles both cases.
- R2's `sha256` refusal on staging.
- Item 6 in the running app. It was checked in a static harness with the real CSS, so no axe run and no real editor.
- The editor's `sectionsChanged` path in a browser. It is unit-tested through `applySave` and API-tested through the PATCH and fill answers.
- The portal offer page with a real offer.

#### Open questions
1. **Item 3's precision.** Keep the per-row `updated_at` rule (Recommended: no migration; it never adds text twice, and after a Catalogue edit of an item the texts a section lacks are offered again)? Or get per-field precision from the `catalogue.update` audit rows (their `summary.changed` names the fields; an indexed read of `audit_log_entity`, but a coupling to the audit summary format)? Or add a "filled from" record (a migration, a Tier A question)?
2. **The base moved during the run** (`46e0c3b2`, `e1576b57`: docs only, `docs/runs/full-audit-m1-m5.md`). This branch doesn't touch that file, so the merge should be clean.

## Re-check of round 2 (reviewer claude-opus-5-5/high, 2026-10-29 ~04:15–04:45 IST, on 846b92da): SEND BACK
- **Verdicts on the 13 review findings:** 11 FIXED; 2 PARTLY (3 and 5).
- **Verified:**
  - tests: pdf 340, jobs 519, admin 3,226; `pnpm check` exit 0;
  - the PDF check on real files: all 7 clean ones pass, the damaged one fails `xref_offset`;
  - fuzzing (about 365 truncations, 400 byte flips, 60 block swaps, 100 inserts or deletes, junk inputs): no throw, no hang, every input returns a code; every block swap and insert/delete fails;
  - cold time: 2.73 ms fastest, 3.01 ms median on the 204 KB estimate;
  - `document-write.ts` keeps every guard of the old save.
- **New findings:**
  1. **High:** a service added after the draft was created never has its Catalogue text offered or named (`service-fill.ts:145`, `offered`). The save that adds a later service writes no text, and the `updated_at` rule skips it. The test `service-fill.test.ts:188` pins the regression. Fix: a save that adds a service line to a draft that already has services appends that service's text under its name by the creation rule (no migration), and the section comes back through `sectionsChanged`. Add end-to-end tests for adding service B later.
  2. **Medium:** on a revision, the baseline is the revision's own `created_at` (`documents.ts:503-580`). Use the version group's first `created_at`.
  3. **Medium (visible):** `gapBase` is never refreshed after a fill or `sectionsChanged` (`lib/documents.ts:781,1321`), so the Q3 note for B goes missing until a reload. Refresh it from the server's answer.
  4. **Low:** a fill can be lost to typing while it runs (`editor.tsx:213-223`). Make the section read-only while it fills.
  5. **Low (one-line × 2):** `inflight.current = null` in a `finally` must check the promise is its own (`editor.tsx:227`, `:118`).
  6. **Low (CPU):** `gapsChange` is true on every sections autosave (`document-save.ts:133`). Narrow it to lines changed, or a deliverables or assumptions/exclusions section sent.
  7. **Low:** `filled` in the fill answer is unused (`document-fill.ts:102`, `documents-api.ts:431`). Remove it.
  8. **Low (copy):** the 07-X "Or (shorter)" alternative at line 44 says "and estimates". Change it to "New proposals take…".
- **Not verified:**
  - item 6 and the editor paths in a live browser;
  - workerd's native inflate cost when cold, and staging CPU;
  - Browser Run's `Content-Encoding`;
  - R2's `sha256` refusal on staging;
  - a real linearised PDF.

## Fix round 3 (lead's brief; builder claude-opus-5-5/high)
- Fix the re-check's new findings 1–8 as described above.
- Finding 1 replaces the old "add B later" behaviour, and the test at `service-fill.test.ts:188` changes with it.
- Keep every round-2 behaviour the re-check marked FIXED.
- **Done means:** `pnpm check` and the full `pnpm test` pass. Append "### Fix round 3 report".

### Fix round 3 report
Builder: Opus 5.5 (high), branch `fix/m5-owner-fixes-r3` from `origin/fix/m5-owner-findings` (7d1b62de), worktree `agent-afb26b806ae7979cf`. All 8 findings are fixed. No migration, no hosted service touched, no dev server started, `packages/pdf` untouched, and every round-2 behaviour marked FIXED is kept.

**Skills:**
- `cloudflare:workers-best-practices`: the save still does one read batch and one write batch. The gap work runs only when its inputs change (finding 6). No module-level request state, no hand-written `Env`.
- `cloudflare:wrangler`: no config changed. It was used only through the builds' `--dry-run`.
- Not loaded:
  - `frontend-design`: the SPA changes are behaviour only (read-only while filling, the gap base); nothing was restyled;
  - `cloudflare:workers-profiling`: no CPU-path change worth measuring (finding 6 removes work);
  - `cloudflare:cloudflare`: no platform feature;
  - the AWS, Supabase, Upstash and Sentry skills: no matching work.
- Context7: not needed. No library API was in question; the changes are our own code and D1 SQL already in use.

**Commits:**
1. `bda167a1` fix(admin): a service added later brings its Catalogue text, group baseline, gaps only on change, fill answer slim [ADM-PROP-02, ADM-CAT-03]
2. `5eb4d8db` test(admin): service B added later, the revision baseline, gapBase after a fill [ADM-PROP-02, ADM-PROP-05]
3. This report.

#### 1. A service added later (high)
- **The rule:** `appendServices(sections, added)` (new, in `apps/admin/worker/service-fill.ts`) follows the decided approach.
  - Each service a save adds goes at the end of the Deliverables and Assumptions and exclusions sections, under `**Name**`.
  - Blank texts are dropped. No `{{…}}` token is ever written.
  - A part the section already holds is not added again (the same 60-character check the gaps use). So a second line of a service that's already on the draft, or a service taken out and put back, adds nothing.
- **Visibility:** a section hidden *because it had no text* is shown once it gets text, as the creation rule would have made it. A section the person hid while it had text stays hidden, with the text appended.
- **The save** (`document-save.ts`):
  - "Added" means a service on the new lines that wasn't on the stored lines. Its row is already in the save's one read batch (`ITEMS_OF_SAVE`, the services this save adds).
  - The first-service token fill runs as before. Then `appendServices` runs over every section; the sections the token fill just wrote already hold the text, so nothing is doubled.
  - Every section the server wrote comes back in `sectionsChanged`. The audit summary lists `sections`.
  - The appended text is checked by the same limits as typed text (`checkSections`; 400 `sections_invalid`, as for the contact rename).
- **Gaps after the append:** a missing text of B is named by the existing rules (the partial case, or "shows another service's text"), and nothing of B's is ever "now" until Catalogue changes.
- **The pinned test** `service-fill.test.ts:188` keeps its assertion: a section that lacks B's text now means the person removed it. Its comment now says so.

#### 2. The revision baseline (medium)
- `gapBaseline(bundle)` (`document-view.ts`) is the smallest `created_at` of the version group, falling back to the document's own.
- The group's versions query (`LOAD_DOCUMENT_SQL.versions`, `packages/db/src/documents.ts`) now also reads `created_at`. That's one column on a query the bundle already runs; the EXPLAIN no-scan test still passes.
- The draft GET, the save and the fill route all use the baseline.

#### 3. `gapBase` refreshed (medium, visible)
- In the SPA's `applySave` (`apps/admin/src/lib/documents.ts`), an answer that carries `catalogueGaps` also resets `gapBase`.
- The new base comes from the server's copy those gaps were worked out from: each section as it was when the save was built (`sent.sectionsAt`), with `sectionsChanged` applied.
- So after a fill, or a save that shows a section, the note for a service whose text is still missing stays on screen. An answer without gaps keeps the base and the gaps together.
- `initEditor` uses the same helper (`closedSections`).

#### 4. A fill lost to typing (low)
- While "Use Catalogue text" runs, from the click until the answer is on screen, that section is read-only (`sections.tsx`):
  - its title and text are `readOnly`;
  - its "Show in the document" checkbox is disabled;
  - the row is `aria-busy`.
- "Write it here" is disabled during any fill.

#### 5. `inflight` (low)
In `editor.tsx`, both `finally` blocks clear `inflight.current` only when it still holds their own promise.

#### 6. Gaps on every sections autosave (low, CPU)
- **Before the read:** the save reads the draft's existing catalogue rows only when it sends lines, or a Deliverables or Assumptions and exclusions section.
- **After it is built:** `gapInputsChanged` decides whether the answer carries `catalogueGaps`. It does when the services on the lines changed (which ones, in which order), or when the id, kind, visibility or text of a gap section changed (null and spaces count as the same blank).
- A quantity edit, or a save of the other sections, carries no gaps. The screen keeps the ones it has.

#### 7. `filled` (low)
- The fill answer is now exactly the slim save answer. The filled section is in `sectionsChanged`.
- The SPA type `fillFromCatalogue` returns `SaveAnswer`. The editor never read `filled`.

#### 8. 07-X line 44 (copy)
The "Or (shorter)" alternative now reads "New proposals take their Deliverables and Assumptions and exclusions sections from these texts. An empty text hides its section." (`docs/07-content-appendix/X-m5-owner-fixes.md`). The code shows the main line 29, which was already right.

#### Tests added or changed
- **`apps/admin/worker/documents-service-text.test.ts`** has a new block, "round 3":
  - **Service B added to a draft with A, end to end:**
    - the text goes under B's name in both sections, and A's second line adds nothing;
    - `sectionsChanged` holds exactly the two stored sections;
    - the answer's gaps equal the read's: B's missing assumptions are named, and `nothing_to_fill` before Catalogue changes;
    - Catalogue gets B's assumptions: the gap is offered as "now", the fill adds it, and no gaps are left;
    - a later quantity-only save and a terms-only save carry no `catalogueGaps` and no `sectionsChanged` (finding 6).
  - **Hidden section and a service with no text:**
    - a service with no text added to A's draft writes no section, and is named on every field;
    - a service with deliverables added later shows the hidden, empty Deliverables section with its text, while A and the blank service stay named there.
  - **Revision baseline:** Catalogue is changed between version 1's creation and the revision. The revision offers the change as "now", and the fill adds it.
  - The `filled` assertions became `sectionsChanged` assertions.
- **`apps/admin/worker/service-fill.test.ts`:**
  - `appendServices`: under names, blanks dropped, same objects when there is nothing to add, no repeat, hidden-empty shown, a hidden section with text kept hidden;
  - the gaps after an append;
  - `gapInputsChanged` and `serviceIdsOf`;
  - the comment of the pinned case.
- **`apps/admin/src/lib/documents.test.ts`:** a fill answer with fresh gaps resets `gapBase`, so the note for the missing exclusions stays. The old base drops it. An answer without gaps keeps both.

#### Commands and results
- `pnpm install --frozen-lockfile --offline`: ok. The worktree lacked links; no version changed.
- `pnpm exec biome check --write <changed files>`: clean.
- Targeted runs (heavy.sh):
  - `service-fill.test.ts`: 18 passed;
  - SPA `vitest run src/lib`: 355 passed;
  - documents-service-text, service-fill, documents-fixes, documents-batch-fixes, documents, documents-plans: 95 passed;
  - the three new end-to-end tests, verbose: 3 passed.
- `pnpm --filter @techaust/admin typecheck`: exit 0.
- **Full `pnpm test`** (heavy.sh), all passed: auth 135, ui 469 (2 skipped), core 1,755, email 128, db 452, pdf 340, web 427 (16 skipped: the real-build tests, since no `apps/web/dist` was present), portal 620, jobs 519, admin 3,235 (+9).
- **`pnpm build`:**
  - The first run failed only on the jobs startup reading (213.4 ms against 200). It started as the test run ended, on a loaded PC. This branch changes no jobs code (one column name in a shared SQL string, +12 bytes).
  - Run alone, it gave exit 0:

  | Worker | Bundle (bytes) | Startup (limit 200 ms) |
  |---|---|---|
  | jobs | 862,654 / 1,000,000 (+12) | 116.0 ms |
  | admin API | 595,533 / 800,000 (+1,024; the third-Worker trigger is 650,000) | 88.1 ms |
  | admin front | 99,131 / 150,000 | 21.6 ms |
  | portal | 96,834 / 120,000 | 21.4 ms |

- **`pnpm check`** (heavy.sh; the final check, with the whole-repository lint run once): exit 0.
  - Lint checked 1,269 files with 10 warnings and 8 infos, all existing.
  - Typecheck ok.
  - Binding, content, Worker config and migration guards ok (49 migrations, none new).

#### Not verified
- The editor paths in a live browser: the read-only section while filling, the note staying after a fill, and `sectionsChanged` from a service added later. They are covered by `applySave` unit tests and the API tests only.
- Drafts made before this branch that already had a later service added: that service's text is not in them, and nothing offers it until its Catalogue row changes. There is no record to tell it apart from a removal without a migration. This only matters on staging.
- Carried over from round 2:
  - workerd's cold native inflate and staging CPU;
  - Browser Run's `Content-Encoding`;
  - R2's `sha256` refusal on staging;
  - a real linearised PDF;
  - the portal offer page with a real offer.

#### Open questions
None.

## Re-check of round 3 (reviewer claude-opus-5-5/high, live browser, 2026-10-29 ~05:30–06:20 IST, on 16f967eb): SEND BACK
- **Verdicts on round 2's re-check findings:** 1–5, 7 and 8 FIXED; 6 PARTLY.
- **Tests:** admin 3,235 pass, pdf passes, jobs 519 (2 load timeouts while FX-1 ran; they pass when re-run alone), `pnpm check` exit 0.
- **Live walk:**
  - the hidden section and its note;
  - the Send panel's list in words;
  - Use Catalogue text;
  - a service added later, with its text appended;
  - removing a service;
  - send (the draft's contact pre-ticked);
  - the PDF stub;
  - a new version;
  - the estimates empty state;
  - the dark load with no flash (dev);
  - the 44 px skip link;
  - the chevron at 375.

  axe clean at 1280.

  Shots: `.logs/shots/m5-r3/` (main checkout).
- **New findings:**
  - **H1. High (app-wide, older than this task; WCAG 2.4.11):** the sticky top bar (64 px) hides focused controls as you Shift+Tab, because `html` has `scroll-padding-top: auto`. Fix: `scroll-padding-top` = the bar height + a gap, in `app.css`.
  - **M1. Medium:** "Use Catalogue text" adds a second `**Name**` heading for a service already in the section (`service-fill.ts:283`, `textToFill`, with `appendServices` `:123`). Fix: insert the part into that service's block, assumptions before exclusions.
  - **M2. Medium (reproduced):** text appended by the server is lost if the person types in that section while the save is in flight (`lib/documents.ts:1040`). Fix: when the server's body starts with the body that was sent, add the server's suffix to the typed text and leave the section dirty.
  - **M3. Medium:** an append that pushes a section over 6,000 characters fails every later save with 400 (`document-save.ts:270`). Creation can also exceed the limit (`document-draft.ts:181-190`). Fix: skip an append that would pass the limit, name it as a gap, and apply the same rule at creation.
  - **M4. Medium (visible):** the section note stacks identical "Add the text in Catalogue" links. Use the side panel's layout: each link after its own sentence.
  - **M5. Medium (visible):** line columns misalign at ≥ 1408 px because the quantity cell sizes to its unit. Fix: one fixed unit width for the whole list.
  - **L1. Low:** text the person edited is offered again as new (`service-fill.ts:206-209`). Lead: document the limit (no migration).
  - **L2. Low:** skip `appendServices` when the draft had no services before.
  - **L3. Low:** compare whole trimmed texts in `appendServices` (`:122`), not a 60-character prefix.
  - **L4. Low:** a section the person hid and emptied comes back when a service is added. Lead: accept it, and say so in the note's behaviour (document it).
  - **L5. Low (one-line):** `while (inflight.current) await inflight.current.catch(() => null);` (`editor.tsx:91`).
  - **L6. Low:** the extra catalogue read still runs on every sections save (`document-save.ts:143`). Compare the gap sections with the stored ones before reading.
  - **L7. Low (owner's copy, older than this task):** the send email says the proposal "covers scope, timeline…" even when Timeline is hidden. Goes on the 07-Y page.
- **Not verified:** a production build's first paint; the real PDF and jobs; the portal; NVDA; a full Tab pass; dark at 375 and light at 768; creation over the limit (read, not run); staging CPU.

## Fix round 4 (lead's brief; builder claude-opus-5-5/high)
- Fix H1, M1–M5, L2, L3, L5 and L6 as described above.
- Document L1 and L4 in a code comment and in the run file.
- L7 goes on the 07-Y page (not code).
- H1 is a one-line CSS change in `apps/admin/src/app.css`; test it with a Shift+Tab pass in the browser at 768.
- M4 and M5: check them in the browser at 375 and 1408 in both themes, with axe.
- **Done means:** `pnpm check` and the full `pnpm test` pass, with tests for M1, M2, M3, L2, L3 and L5. Append "### Fix round 4 report".

### Fix round 4 report
Builder: Opus 5.5 (high), branch `fix/m5-owner-fixes-r4` from `origin/fix/m5-owner-findings` (b5495f77), worktree `agent-ab46f6c859fee4560`. H1, M1–M5, L2, L3, L5 and L6 are fixed. L1 and L4 are documented. L7 is a line for 07-Y (below). No migration. No hosted service touched. `packages/db`, `apps/jobs` and `packages/core` are untouched (FX-1's). Every behaviour marked FIXED in rounds 1–3 is kept (the full suite passes).

**Skills:**
- `cloudflare:workers-best-practices`: the save keeps one read batch and one write batch. L6's comparison moved into that read's SQL instead of a second round trip. No module-level request state, no hand-written `Env`.
- `cloudflare:wrangler`: only the local D1 (`d1 execute --local`) for the browser data, and the build's dry runs. No config changed.
- `frontend-design:frontend-design`: M4 and the new no-room note keep the margin-note look. Restraint: each link sits inline at the end of its own sentence (the send panel's pattern), with no new styles. M5 is one width token.
- Not loaded:
  - `cloudflare:workers-profiling`: no CPU path changed in a way worth measuring (the bundle is reported);
  - `cloudflare:cloudflare`: no platform feature;
  - `dataviz`: no chart;
  - the AWS, Supabase, Upstash and Sentry skills: no matching work.
- Context7: not needed. No library API was in question; Playwright was only used from scratch scripts.

**Commits:**
1. `bcdbd376` fix(admin): Catalogue text into its service's block, left out past a length limit and named, first-service save only fills tokens, gap sections compared in SQL [ADM-PROP-02, ADM-CAT-03]
2. `b48122fe` fix(admin): section note links after their own sentence, no-room gaps on screen, server text merged into typing in flight, wait for every request, top bar clear of focus, one quantity width [ADM-PROP-02, ADM-PROP-05, ADM-G-01]
3. `483fe161` docs(07-X): lines for Catalogue text left out for the length limit [ADM-PROP-02]
4. `76d8050f` fix(admin): Send panel's Catalogue link right after its own sentence [ADM-PROP-02]
5. This report.

#### What changed
- **H1 (focus under the top bar):** `apps/admin/src/app.css` gets `html:has(.shell) { scroll-padding-top: calc(4rem + var(--space-4)); }`. That is the bar's 4 rem from shell.css plus a gap, and only inside the shell (the sign-in screens have no bar).
- **M1 (a second `**Name**` heading):** `insertParts` in `apps/admin/worker/service-fill.ts` places each part:
  - beside the service's other part when the section holds it (assumptions just before its exclusions, exclusions just after its assumptions);
  - else at the end of the block under its name;
  - else as a new block.

  "Use Catalogue text" uses it through `filledBody`, which replaces `textToFill` and returns the section's new text. A save that adds a service uses it, and so does creation. The first service's plain block (no heading) is found by its sibling text too.
- **M2 (server text lost to typing in flight):** `mergeServerEdit(sent, server, typed)` in `apps/admin/src/lib/documents.ts`. `applySave` uses it for a section the person typed into while the save ran.
  - The server's change is one span. Text it appended goes after what was typed.
  - A span it changed inside (a part put into a block, the contact's name) is changed where it still stands, found from the start or from the end.
  - In a section that was empty, the server's block goes after the typed text.
  - The section stays dirty, so the next save carries both.
  - When the person changed that very span, or the server emptied the text, what was typed stays (as before).
- **M3 (length limits, the decided rule):** `fits` checks the limits of `checkSections` (6,000 characters per section, 30,000 for the document) for every addition:
  - in `appendServices`, for saves and now for creation too (`document-draft.ts` uses `appendServices` for every service after the first);
  - in `fillServiceTokens`, the save that adds the first lines;
  - in "Use Catalogue text".

  A service that doesn't fit is left out of that section only; its other section still gets its text. The gaps name it with `CatalogueGap.noRoom: true`, never also `catalogueHasTextNow`. A save is never refused for Catalogue text it adds. The `checkSections` that stays after the fill only guards the first service's own template fill (open question 2). The fill route answers `nothing_to_fill` when nothing is offered. When something is offered but has no room, it answers the limit's own 400; the screen shows no button in that case, because the gap is `noRoom`.
- **M3 on screen:** `gapGroups` gives each service a `noRoom` list. The section's note and the Send panel show 07-X line 31, followed by line 32's link ("Open it in Catalogue"). Both show `[Placeholder]` until the owner approves 07-X.
- **M4 (stacked identical links):** the section's note has one sentence per service, with its own link at the end (`CatalogueLink` in `parts.tsx`, shared with the Send panel). The actions row keeps only "Write it here" and "Use Catalogue text", and is left out when it would be empty. The Send panel's link now also follows its own sentence (it used to come after the "now" sentence).
- **M5 (line columns):** `.qledger { --qledger-qty: 12rem }` is the quantity column for every row, at ≥ 88 rem and in the 64–88 rem range. Both used to size it per row, from the row's own unit.
- **L2:** a save runs `appendServices` only when the draft already had services. The save that adds the first service fills the template's tokens only, so text the person wrote over the tokens stays as it is.
- **L3:** `appendServices` and `fillServiceTokens`' later services compare whole trimmed texts (`holds`). The gaps keep their 60-character sample, so an edit further down a filled text is still not a gap.
- **L5:** `waitForInflight(slot)` waits for every request in flight, including one started while it waited. It awaits each promise once, so a settled promise left in the slot ends the wait instead of spinning. `save` and `flush` use it.
- **L6:** `ITEMS_OF_SAVE` compares the sent Deliverables and Assumptions and exclusions sections with the stored ones in SQL (`?4`: id, kind, visibility, exact text, and the count). An autosave of the other sections reads no catalogue row.
  - `gapSectionsOf` builds `?4` the way `resolveSections` will store the sections. It forces the read when a gap section has no id, or two share one.
  - `gapInputsChanged` now compares by kind, so moving a section changes nothing. Whenever it says "changed", the SQL read has said so too.
- **L1 and L4 (documented, no migration):** in the header of `service-fill.ts` and in `appendServices`' comment.
  - The "now" rule works per Catalogue row (`updated_at`), so after any edit of an item, a part the section no longer holds word for word is offered again.
  - A section the person hid and emptied reads like one hidden for having no text, so a service added later shows it with its text.
  - M3 adds a limit of the same kind: once the person shortens a section, a text that was left out for room and now fits is no longer named (nothing tells it apart from text the person removed). That's why line 31 tells them to copy it from Catalogue.
- **L7 (for the owner's 07-Y page, not code):** the proposal-sent email says "It covers scope, timeline, price and payment schedule" whatever sections are shown (`docs/07-content.md` line 542, `apps/admin/src/lib/offers.ts:146`, `packages/email`). 07-Y doesn't exist on this branch, so the lead adds it.
  - Recommended line: "Hi {{first_name}}, your proposal is ready, with the price and payment schedule. It's valid until {{valid_until}}." The estimate and the schedule are always in a proposal.
  - Or: list only the sections actually shown.

#### Tests added or changed
- **`apps/admin/worker/service-fill.test.ts`** (26 tests):
  - M1: `insertParts` beside the sibling (before or after), in the first service's plain block, at the end of the named block, as a new block, and plain; "Use Catalogue text" into the service's block with one heading; a service taken out and put back gets only its missing part.
  - L3: whole-text matching.
  - M3: `fits` and `textLength`; `appendServices` skips the service that would pass 6,000 while a later one that fits goes in, the other section is still filled, the gap is `noRoom`, and the fill adds nothing past the limit; the 30,000 total; `fillServiceTokens` skips a third long service.
  - L6: `gapInputsChanged` by kind.
  - The `textToFill` cases became `filledBody` cases.
- **`apps/admin/worker/documents-service-text.test.ts`** (21 tests), new block "round 4":
  - **M3 at save:** a third long service is left out and named; the next sections save and the next lines save are 200; the fill has nothing to add.
  - **M3 at creation:** three long services stay within the limit, the third is named, and the draft saves and sends.
  - **L2:** the first service fills only the tokens; the person's words stay; only the filled section comes back.
  - **L6:** the statement reads no row for an unchanged, moved, terms-only or section-less save, and reads for a changed text, a changed visibility, a removed section or lines; `force` for a missing or shared id; end to end, a terms-only save answers without gaps.
  - Three round-2 and round-3 expectations that pinned the old second heading now expect M1's block.
- **`apps/admin/src/lib/documents.test.ts`:**
  - M2: typed text plus the server's block, still dirty, and the next patch carries both; text appended after typed text.
  - `mergeServerEdit`: an append; a change inside the text, with typing before it and after it; the contact's name; the person's own change of that span; an empty section; a text the server emptied.
  - L5: `waitForInflight` waits for a fill started during a save, and ends on a settled or rejected promise.
- **`apps/admin/src/lib/gaps.test.ts`:** the `noRoom` group, its line and link words, and no fill offered.

#### Browser checks
Local D1 in this worktree; Playwright scripts in the scratchpad; screenshots in `.logs/shots/m5-r4/` (42 files).
- **H1:** Shift+Tab at 768 px, from the foot of a long draft (122 presses) and of Catalogue (32), in both in-app themes. **0 focused controls under the bar**, counting the sticky table head too. A control run with `scroll-padding-top: auto` put back found 20 and 4 under the bar, so the check catches the old behaviour. `focus-*.png`.
- **M4 at 375 and 1280, both themes:** every sentence of the note ends with its own link, no link is left in the actions row, and nothing overflows sideways. `mixed-note-*`, `long-note-*`.
- **M3 on screen at 375 and 1280, both themes:** a proposal made from three services whose Deliverables are 2,500 characters each keeps the first two (5,048 characters) and names the third, on the section and on the Send panel. `noroom-section-*`, `noroom-panel-*`.
- **M5 at 1280, 1408, 1440 and 1600, both themes:** five lines with the units Per milestone, Fixed price, Per workflow, Per connector and Per month share one set of column positions at every width. No unit is clipped, and nothing runs past the card. `lines-*`, `lines-page-*`.
- **axe** (WCAG 2.0–2.2 A and AA): clean at rest on every page above, at every width and in both themes.
  - One finding to know: when the page is scrolled so that a section row sits half under the sticky top bar, axe's `target-size` flags that row's toggle and menu button as "partially obscured". `scrollIntoView` of the note below the row leaves it there, now that the scroll stops 80 px down.
  - That comes from the scroll position under any sticky bar, not from the controls. At rest, and after any Tab, nothing is obscured.
- The dev server and every browser are stopped; no process of this worktree is left.

#### Commands and results
- `pnpm install --frozen-lockfile --offline` (heavy.sh): ok (links only).
- `pnpm exec biome check --write <changed files>`: clean each time.
- **Targeted runs** (heavy.sh):
  - `service-fill.test.ts`: 26 passed;
  - `src/lib` with service-fill: 385 tests, one failure, then fixed. An old test re-applied a stale answer whose text was null; the merge now keeps the typed text when the server empties a text;
  - documents-service-text: 21 passed, after three old expectations were updated for M1;
  - `pnpm --filter @techaust/admin typecheck`: exit 0, after a test-only type fix.
- **Full `pnpm test`** (heavy.sh), all passed: auth 135, ui 469 (2 skipped), core 1,755, email 128, db 452, pdf 340, web 427 (16 skipped: no `apps/web/dist`), portal 620, jobs 519, admin 3,251 (+16).
- **`pnpm --filter @techaust/admin build`** (heavy.sh): exit 0.

  | Worker | Bundle (bytes) | Startup (limit 200 ms) |
  |---|---|---|
  | admin front | 99,131 / 150,000 | 21.9 ms |
  | admin API | 597,341 / 800,000 (+1,808 on round 3; the third-Worker trigger is 650,000) | 51.7 ms |

- **`pnpm check`** (heavy.sh; the final check, with the whole-repository lint run once): exit 0.
  - Lint checked 1,269 files, with 10 warnings and 8 infos, all existing.
  - Typecheck ok.
  - Binding, content, Worker config and migration guards ok (49 migrations, none new).

#### Not verified
- The staging admin (behind Access) and staging CPU.
- The L6 SQL on real D1. It ran only on the local workerd D1, which has the same SQLite JSON functions.
- A screen-reader (NVDA) pass of the new note.
- Firefox and Safari. H1's rule needs `:has()`; without it the page behaves as before.
- The editor's M2 merge in a live browser race. It is covered by the `applySave` unit tests only.
- Carried over: the real PDF and jobs, the portal offer page with a real offer, Browser Run's `Content-Encoding`, and R2's `sha256` refusal.

#### Open questions
1. **07-X lines 31 and 32** are new and show `[Placeholder]` until approved. They go to the owner with the rest of 07-X. Recommended as written.
2. **The first service's own fill can still pass 6,000 characters** in one case: a template section of up to 2,000 characters around both `{{service.assumptions}}` and `{{service.exclusions}}`, with both Catalogue texts near their 2,500 limit.
   - That is a template fill, not an append, so the decided rule doesn't cover it.
   - The save that adds that first service still returns `sections_invalid` (as before), and creation would store the long section.
   - The seeded templates are far below this.
   - Recommended: a follow-up that applies the same rule to the template fill (leave the service's text out and name it), or a Catalogue or template limit that makes the case impossible. Lead's call.
3. **07-Y doesn't exist on this branch.** The L7 line above is for it.

## Re-check of round 4 (reviewer claude-opus-5-5/high, live browser, 2026-10-29 ~07:00–07:40 IST, on c4e1a5b6): SEND BACK
- **Verdicts:**
  - FIXED: H1 (104 controls in reverse order, 0 under the bar), M2 (the text, though see 2 below), M3, M4, M5, L2, L3, L5, L6;
  - PARTLY: M1;
  - DOCUMENTED: L1, L4;
  - known: L7 and round 4's question 2.
- **Tests:** admin 3,251 (one load timeout; passes alone); `pnpm check` exit 0.
- **axe:** clean at rest at 375 and 1280.

Shots: `.logs/shots/m5-r4/` (main checkout).
- **New findings:**
  1. **High:** `insertParts` (`service-fill.ts:126-139`) looks for the sibling text anywhere in the section, so a part lands in another service's block, or splits another service's sentence. Reproduced live: S5 and S6 share "Third-party fees are billed separately." Contractual scope wording changes silently.
  2. **Medium (reproduced):** when the server's edit is merged into the textarea the person is typing in, the caret jumps to the end (`lib/documents.ts:1100-1107`, `sections.tsx`).
  3. **Low:** `roomFor` (`:389-396`, `:354-357`) checks room for parts that aren't offered, and calls a deliberately deleted part "no room".
  4. **Low:** `holds` (whole text) and `included` (60 characters) disagree. A service re-added after its text was edited gets its text repeated; two texts that share their first 60 characters can hide a gap.
  5. **Low (one-line):** the discard confirm should use `waitForInflight` (`editor.tsx:614`).
  6. **Low:** `headingAt` ends a block at the first `\n\n`, which cuts a two-paragraph Catalogue text (fold into the fix for 1).
  7. **Low:** the `document-save.ts:~299-301` comment says the gaps name what is missing, but a first service whose tokens the person wrote over gets no gap.
  8. **Low:** move `--topbar-h` to `:root` and use it in `app.css:18`; the quantity column becomes `minmax(12rem, max-content)` (`documents.css:178`), for WCAG 1.4.12.

## Fix round 5 (lead's brief; builder claude-opus-5-5/high)
**Lead's design decision (finding 1, recorded in docs/13):** a section's text for services is a list of **blocks**.
- **What a block is:** each block starts with that service's `**Name**` heading line and ends just before the next line that is exactly another service's `**Name**` heading, or at the end of the text. Its paragraphs may contain blank lines.
- **The first service's unheaded opening:** the text before the first heading belongs to the draft's first service only when that service has no heading of its own.
- **Inserting a part (assumptions or exclusions) for service X:**
  - work only inside X's block: assumptions before X's exclusions if they are there, else at the end of the block;
  - if X has no block, append a new `**X**` block at the end;
  - match whole lines only, never a substring;
  - never search other blocks.
- **The same block rule decides:**
  - whether X already holds a part (`holds`, `included` and the part filter use X's block, with whole-text comparison, which also resolves finding 4);
  - what "Use Catalogue text" offers;
  - what `roomFor` checks: only the parts being offered or appended (finding 3). "No room" is said only for those.
- **Tests:**
  - shared exclusions between two services;
  - "None." inside another service's sentence;
  - a two-paragraph Catalogue text;
  - re-adding a service whose block was edited;
  - creation with shared texts.

**Also fix:**
- finding 2: keep the caret; restore the selection, shifted by any text inserted before it;
- finding 5, finding 7 (correct the comment) and finding 8.

**Done means:** `pnpm check` and the full `pnpm test` pass, and a live check of the shared-text case in the browser. Append "### Fix round 5 report".

### Fix round 5 report
Builder: Opus 5.5 (high), branch `fix/m5-owner-fixes-r5` from `origin/fix/m5-owner-findings` (8ba2c1a3), worktree `agent-a14d5df2bcb190ce5`.
- Findings 1, 3, 4 and 6 are fixed by the block model.
- Findings 2, 5, 7 and 8 are fixed.
- No migration, and no hosted service touched.
- `packages/db`, `apps/jobs`, `packages/pdf`, `apps/web`, `catalogue.ts` and the headers files are untouched.
- Every behaviour marked FIXED in rounds 1–4 is kept: the full suite passes, and the expectations I changed are listed below.

**Skills:**
- `cloudflare:workers-best-practices`: the new module is pure, with no module-level request state. I briefly wrote a module-level `Map` and replaced it with a parameter before the first commit. The save keeps one read batch and one write batch, and there is no hand-written `Env`.
- `cloudflare:wrangler`: used only for the local D1 (`d1 execute --local`: migrations, seed, Catalogue texts by SQL) and the dev server. No config changed.
- `frontend-design:frontend-design`: the caret fix and the two CSS changes keep the existing look. Restraint: no new styles.
- Not loaded:
  - `cloudflare:workers-profiling`: no CPU path worth measuring (the bundle is reported below);
  - `cloudflare:cloudflare`: no platform feature;
  - `dataviz`: no chart;
  - AWS, Supabase, Upstash and Sentry: no matching work.
- Context7: not needed. No library API was in question; only React's `useLayoutEffect` and DOM `setSelectionRange` are used, as they already are elsewhere.

**Commits:**
1. `0cd745dc` fix(admin): service text as blocks, one per service; inserts, holds, offers and room only inside the service's own block [ADM-PROP-02, ADM-CAT-03]
2. `8c8f58e9` fix(admin): caret kept when the server's text is merged into typing, discard waits for every request, top bar height on :root, quantity column may grow [ADM-PROP-02, ADM-G-01]
3. This report.

#### The block model (finding 1; also 3, 4 and 6)
**The module:** `apps/admin/worker/service-blocks.ts` is new and pure. It provides `parseBlocks`, `hasBlock`, `holdsText`, `insertParts` and `headingLine`.

How it reads a section's text:
- **A block** starts at a line that is exactly a draft service's `**Name**`; spaces around the line are ignored, and the name is the line name, with "&" written "and". It runs up to the next line that is exactly *another* service's heading, or to the end of the text, blank lines included.
- **The unheaded opening** is the draft's first service's block, only while that service has no heading of its own. Otherwise no service owns it.
- **Lines that only look like headings** do not start a block: `**Note**`, a heading the person edited (`**Beta (phase 1)**`), or a different case.
- **A repeated heading** of the same service (an older second heading) stays part of that service's text.
- **Services taken off the lines:** in a save, their headings still end the block above them (`others`).

How it compares:
- `holdsText` matches whole lines, each trimmed, as one consecutive run, with any run of blank lines counted as one.
- So "None." inside a sentence is never "None.", and a two-paragraph text is held whole.
- CRLF is read as LF.

How it inserts:
- **Into the service's own block:** assumptions go just before the service's *own* exclusions when its block holds them, else at the block's end, after its last line with text.
- **No block:** a new block goes at the end, under the heading. It is plain only for the draft's first service in a blank section.
- **Where the edit lands:** each insert is a splice at one place, in the text's own line ending (CRLF kept). Nothing else in the text changes.

**Used everywhere:** `service-fill.ts` uses only this module, which keeps creation, save, "Use Catalogue text" and the gaps on one rule.
- `holds`, `included` (the 60-character sample) and the old `insertParts`/`headingAt` are gone.
- `appendServices(sections, added, services, others)` and `fillServiceTokens` take the draft's services in line order, so the first service is known.

**The save** (`document-save.ts`) passes the services the draft already had first, then the added ones. So an added service never owns the opening, which was written before it came. The services the save took off the lines are passed as `others`.

**Creation** (`document-draft.ts`) passes every service in line order.

**Finding 4 (re-add after an edit):**
- A service that already has a block in the section gets nothing appended by a save. That covers a service taken off and put back, and a heading the person wrote. Its block, edited or not, is the person's, so text is never repeated under an edit.
- The gaps read it the same way: a part missing from a block the service has is the person's edit. It is named only when the Catalogue row changed (L1).
- This replaces round 4's "adds only its missing part" for a re-added service. I recommend keeping it: whole-text comparison can't tell an edited part from a deleted one.

**Finding 3 (`roomFor`):** the room check counts only the parts that would really be put in:
- the offered parts, for "Use Catalogue text" and "now";
- for a service with no block at all (left out whole by a save or at creation, round 4 M3), the parts an append would add.

A service that has a block and a part the person deleted is never called "no room".

**Finding 6:** blocks run past blank lines, and texts are compared and inserted whole (two-paragraph tests).

**Finding 7:** the comment in `document-save.ts` was wrong. When the person wrote over the first service's tokens, no gap names its missing Catalogue text: that text is offered only once its row changes (L1). The comment now says so.

**Known limits, documented in the header of `service-fill.ts`:**
- **The opening follows line order.** After the person reorders the lines so that another service with no heading of its own comes first, the opening is that service's. The service whose text it holds then has no block, so nothing names it, and it is offered again under its name only after its Catalogue row changes.
  - The pure test "the order of the lines does not matter" (finding 12, round 2) now expects no gap for that reordered case. A new assertion shows that B is still named once A's text sits under its own heading.
  - This is the decision's own rule ("the draft's first service").
- **The read routes see only the services on the lines.** For the gaps and "Use Catalogue text", the block of a service taken off the lines runs on as part of the block above it, until its text is removed.

**Expectations changed by the decision:**
- **The first service's new Catalogue text goes at the end of its unheaded opening, without a `**Name**` heading.** It used to go in a new headed block. This affects `service-fill.test.ts` "finding 3" and `documents-service-text.test.ts` "finding 3": `"We build five pages\nBuild six pages"`.
- **A whole line in the first service's opening no longer counts for another service.** `appendServices` gives that service its own block with its own copy (round 4 L3 test).
- **Round 4 M1 tests:** the cases of inserting into an existing block now run through "Use Catalogue text", because an append no longer writes into an existing block (finding 4).

#### Finding 2 (caret)
- **`apps/admin/src/lib/caret.ts`:**
  - `shiftSelection(before, after, start, end)` is pure. It takes the change as one span. A position before the span stays, a position after it moves by the change in length, and a position inside a replaced span goes to the end of the new text. Text put in exactly at the caret goes after it.
  - `useKeptCaret(value)` notes the caret on every edit, selection and focus. When `value` arrives from elsewhere while the box has focus, it restores the selection in a layout effect, before paint.
- **Where it is used** (`routes/documents/sections.tsx`): each section's title and text box.

#### Finding 5
The discard confirm in `editor.tsx` now uses `await waitForInflight(inflight)`.

#### Finding 8
- **`--topbar-h`** moves from `.shell` to `:root` in `shell.css`. `app.css` uses `scroll-padding-top: calc(var(--topbar-h) + var(--space-4))`.
- **The quantity column** (`documents.css`) is `--qledger-qty: minmax(12rem, max-content)`. Rows still share one width at normal spacing, and a unit may grow instead of clipping (WCAG 1.4.12).

#### Tests added or changed
- **`apps/admin/worker/service-blocks.test.ts`** (new, 18 tests), the adversarial cases:
  - blocks and the opening; an opening that belongs to nobody;
  - a blank opening; a two-paragraph text, including a run of blank lines;
  - a heading-like `**Important**` line inside a text; a person-edited heading; a different case;
  - CRLF and trailing spaces; a heading with spaces around it;
  - a repeated heading;
  - "None." inside a sentence, and as part of a line;
  - `others`;
  - inserts: before the service's own exclusions; at the block's end before blank lines; into the first service's opening;
  - shared exclusions in both directions; "None." inside another service's sentence;
  - a two-paragraph text inserted whole, with a later part after it;
  - new blocks, plain or headed; CRLF kept on insert; a heading-like line inside a block.
- **`apps/admin/worker/service-fill.test.ts`** (33 tests):
  - a new "round 5" group: creation with shared texts; S6's part into its own block; "None." in another service's sentence; a two-paragraph Catalogue text never offered again and a part placed after it; finding 3's room rule; a person-edited heading;
  - finding 4: a re-add adds nothing, and the gaps name nothing until Catalogue changes;
  - the existing tests moved to the new signatures and the decided behaviour.
- **`apps/admin/worker/documents-service-text.test.ts`** (24 tests), a new group "round 5", end to end through the API:
  - creation with a shared exclusion line (each block holds its own copy; no gaps; `nothing_to_fill`);
  - the reviewer's case: S6's new assumptions are filled into S6's block, before S6's own copy;
  - a service taken off and put back after its block was edited: `sectionsChanged` is empty, and the text is unchanged.
- **`apps/admin/src/lib/caret.test.ts`** (new, 4 tests): insert before, after and at the caret; a replaced span; deletion; clamping; and together with `mergeServerEdit`.

#### Live check (local D1 in this worktree; Playwright scripts in the scratchpad; screenshots in `.logs/shots/m5-r5/`, 8 files)
- **Setup:** `pnpm dev:secrets`, `db:migrate:local`, `db:seed:local`, `pnpm invite --email owner@example.test --role owner` and `portal:sample`. Enrolment went through with a TOTP made by the script.
- **Catalogue texts, set by SQL on the local D1 only:** S5 has assumptions plus "Third-party fees are billed separately."; S6 has only that same exclusion line.
- **Creation** (S5, then S6): the Assumptions and exclusions text is `…before work starts.\nThird-party fees are billed separately.\n\n**MVP and SaaS Product Development**\nThird-party fees are billed separately.`. S6 gets its own block with its own copy. Shot `01-created-shared-1280-light.png`.
- **"Use Catalogue text":** S6 got assumptions by SQL, with its `updated_at` moved on.
  - The note offers "Catalogue now has the assumptions for MVP and SaaS Product Development" (shot `02`).
  - After the click, the text is `…\n\n**MVP and SaaS Product Development**\nYou name one person who signs off each release.\nThird-party fees are billed separately.`. That is inside S6's block, before **S6's own** copy of the shared line. S5's block is unchanged, and the note closes (shot `03`).
- **axe** (WCAG 2.0–2.2 A and AA): no violations at 1280 light, 1280 dark, 375 light and 375 dark (shots `04-*`).
- **Caret, two runs:**
  - Plain typing mid-text through an autosave: the caret stayed right after the typed text (7).
  - The race: the save's answer was held for 3 s, "Send to" was changed (the server renames the contact in Acceptance), and "Q" was typed right after the old name while the save was in flight. The merged text was `Prepared for Team Contact (no finance)Q (…`, and the caret stood right after "Q" (39), not at the end (247). Shot `06`. The script's own "expected" figure printed 12, because it cut the new name at the first " (": an error in the script's arithmetic, not in the app.
- **Stopped:** the dev server and every browser. No process of this worktree is left.

#### Commands and results
- `pnpm install --frozen-lockfile --offline` (heavy.sh): ok (the worktree lacked links; no version changed).
- `pnpm exec biome check --write <changed files>`: clean.
- **Targeted runs** (heavy.sh):
  - service-blocks, service-fill, documents-service-text, documents, documents-batch-fixes and documents-fixes: 127 passed;
  - SPA `vitest run src`: 389 passed;
  - `pnpm --filter @techaust/admin typecheck`: exit 0.
- **Full `pnpm test`** (heavy.sh): auth 135, ui 469 (2 skipped), core 1,755, email 128, db 452, pdf 340, web 427 (16 skipped: no `apps/web/dist`), portal 620 and jobs 519 all passed. Admin had 3,280 passed and **1 timeout**: `reports.test.ts`, "the statement PDF … refuses…", at 5 s under load while FX-2 ran its web build. That file is untouched by this branch, and it passed alone (21/21).
- **Admin package re-run in full:** 106 files, **3,281 passed, 0 failed**.
- **`pnpm --filter @techaust/admin build`:** exit 0.

  | Worker | Bundle (bytes) | Startup (limit 200 ms) |
  |---|---|---|
  | admin front | 99,131 / 150,000 | 15.5 ms |
  | admin API | 599,123 / 800,000 (+1,782 on round 4's 597,341; the third-Worker trigger is 650,000) | 56.6 ms |

- **`pnpm check`** (heavy.sh; the final check, with the whole-repository lint run once): exit 0.
  - Lint checked 1,273 files, with 10 warnings and 8 infos, all existing.
  - Typecheck ok.
  - Binding, content, Worker config and migration guards ok (49 migrations, none new).

#### Not verified
- Firefox and Safari, for the caret restore and `:has()`.
- NVDA.
- The staging admin and staging CPU.
- Text spacing overrides (WCAG 1.4.12) in a browser: the quantity column change was checked by reading the CSS only.
- Drafts made before this branch whose text has a service's part inside another service's block, from round 4's insert: they stay as they are, and nothing moves text that is already stored.
- Carried over: the real PDF and jobs, the portal offer page with a real offer, Browser Run's `Content-Encoding`, and R2's `sha256` refusal.

#### Open questions
1. **Finding 4's rule** (an existing block gets nothing on re-add) replaces round 4's "adds only its missing part". Recommended to keep: whole-text comparison can't tell an edited part from a deleted one. The other way would re-add the Catalogue text under the person's edit.
2. **The opening after a reorder** follows line order (the decision's "first service"). An alternative is "the first service in line order with no heading of its own", which survives a reorder but gives the opening to a later service when the first has a heading. I kept the decision as written.
