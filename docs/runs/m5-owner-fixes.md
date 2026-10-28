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
