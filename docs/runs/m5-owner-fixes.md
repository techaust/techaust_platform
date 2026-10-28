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
_(pending)_

## Designer report
_(pending)_
