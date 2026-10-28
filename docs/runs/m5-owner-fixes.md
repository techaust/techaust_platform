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
- **Q2 Cloudflare:** yes; the lead drafts the report (`.logs/m5-owner-fixes/cloudflare-report.md`, positions and hashes only), the owner posts it.

## Reviewer UI/UX sweep
_(pending)_

## Brief
_(written by the lead after the diagnosis and the sweep)_
