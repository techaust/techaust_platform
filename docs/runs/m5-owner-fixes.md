Status: open
Tier: B
Usage:

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
_(pending)_

## Reviewer UI/UX sweep
_(pending)_

## Brief
_(written by the lead after the diagnosis and the sweep)_
