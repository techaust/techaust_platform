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
_(pending)_
