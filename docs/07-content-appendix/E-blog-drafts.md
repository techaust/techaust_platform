# 07-E: Launch blog posts (drafts for the owner's review)

_Drafted by the lead on 2026-10-22 from the outlines in [07 §7](../07-content.md). **Awaiting the owner's review, one post at a time.** Once a post is approved, it moves word for word into `apps/web/src/content/blog/<slug>.md` with `draft: false`; until then it isn't on the site._

**Rules applied (07 §7, §1):** no invented statistics, clients or results; the only figures are GST rules, cited to the sources in [02-A](../02-research-appendix/A-ai-services-market.md) and [02-B](../02-research-appendix/B-software-services-market.md); tax statements say "confirm with your CA" (**VERIFY WITH CA**, and re-check against U-9, the 57th GST Council, before publishing); author: Rupak Sarkar; no banned phrases; "and", never "&".

---

## B1 · Automating invoice entry into Tally: what works in 2026

```yaml
slug: automating-invoice-entry-into-tally
description: "The options for getting vendor invoices into TallyPrime without retyping them: import templates, connectors and AI extraction with review, and how to judge accuracy."
tags: [Tally, AI document automation, accounting]
relatedServices: [S9, S14]
```

If your team types vendor invoices into Tally by hand, you already know the cost. It isn't only the hours. It's the typo in a GSTIN that turns up during GSTR-2B reconciliation, the invoice that sat in someone's inbox for three weeks, and the month-end rush when everything has to be entered at once.

There are several ways to stop retyping. They suit different volumes and different kinds of invoices, so it's worth knowing all of them before you buy anything.

### The manual process, and where it really costs you
A typical flow looks like this: invoices arrive by email, WhatsApp or courier; someone downloads or scans them; someone else types the vendor, invoice number, date, line items, tax and totals into a purchase voucher; and a senior person checks a sample at month end.

The typing is the visible cost. The hidden costs are the errors that surface later (a wrong ledger, a missed tax line, a duplicate entry), and the delay between receiving an invoice and having it in the books, which makes cash-flow reports less useful than they should be.

### Option 1: Tally's own import
Recent TallyPrime releases can import vouchers from structured files, and Tally has long accepted XML imports. If your invoices already exist as structured data (an export from a supplier portal, or a spreadsheet your team maintains), this can be the cheapest route: map the columns once, check a few imports by hand, then make it routine.

It doesn't help with PDFs and scans. Someone still has to turn each document into a row first.

### Option 2: connectors from other systems
If the invoice data already lives in another system (Zoho Books, an e-commerce platform, a purchase portal), a connector can post it into Tally automatically. Tally exposes an HTTP-XML interface, and a small connector running on the PC or server where Tally runs can sync over the internet. Tally needs to be running for the sync, so a good connector also tells you when it stops.

This is the most reliable option when it fits, because nothing is being read from a picture. The limit is the same as before: it only works for data that's already structured somewhere.

### Option 3: AI extraction with human review
For PDFs, scans and photos, document AI can read the vendor, GSTIN, invoice number, dates, line items and tax amounts, check them, and prepare the voucher. The important part is what happens when the system isn't sure. A well-built pipeline sends uncertain fields to a review screen, where a person on your team checks them before anything is posted. Nothing reaches Tally without passing those checks.

Useful checks include:
- the GSTIN's format and check character
- the sum of line items against the invoice total
- tax amounts against the stated rates
- the vendor and ledger against your existing masters
- duplicates (same vendor, same invoice number)

### What "accuracy" really means, and how to measure it
Vendors often quote a single accuracy figure. Ask what it measures. Field-level accuracy (how many individual fields are right) sounds better than document-level accuracy (how many invoices needed no correction at all), and only the second tells you how much work your team still does.

The honest way to measure is on your own invoices:
1. Collect a test set of a few hundred real invoices, including the awkward ones: poor scans, handwritten notes, multi-page bills.
2. Record the correct values once, by hand.
3. Run the system and compare, field by field and document by document.
4. Measure how many documents went to review, and how long the review took.

That gives you a baseline you can compare against your current process, and a number to watch after launch.

### A sensible pilot plan
- **Week 1:** agree the fields, the checks and the test set; measure today's time per invoice.
- **Weeks 2–3:** build the extraction and the review screen; run the test set.
- **Week 4:** run it alongside your current process on live invoices, posting to a test company in Tally first.
- **Decision:** compare the measured numbers with the baseline, then roll out or adjust.

Your accountant or CA stays in charge of ledgers and tax treatment throughout. The software prepares entries; people decide.

### Questions to ask a vendor
- Which accuracy figure are you quoting, and was it measured on our documents?
- What happens to an invoice the system isn't sure about?
- Which checks run before anything is posted to Tally?
- Where are our documents processed and stored, and does the AI provider train on them?
- What happens when Tally isn't running, or a vendor changes their invoice layout?
- Who owns the code and the configuration at the end?

### FAQ
**Do we need to change our Tally setup?** Usually not. The integration works with your existing TallyPrime and its licence.

**What if Tally is on a local PC?** That's common. A small connector runs on that PC or your server and syncs over the internet; Tally needs to be running for the sync.

**Will the AI decide our ledgers and tax treatment?** No. It proposes entries based on your existing masters and rules; your team reviews anything uncertain, and your CA stays in charge of tax decisions.

**How long does a pilot take?** Typically about four weeks, measured against your own baseline.

---

## B2 · GST e-invoicing API integration, explained for business owners

```yaml
slug: gst-e-invoicing-api-integration
description: "What GST e-invoicing means for your billing system: IRN and QR codes, the GSP and direct API routes, integration patterns and the failures to monitor."
tags: [GST, e-invoicing, integration]
relatedServices: [S14]
```

GST e-invoicing changes one thing about how you bill: before a B2B invoice is valid, its details are reported to the government's Invoice Registration Portal (IRP), which returns a reference number and a signed QR code to print on the invoice. Everything else (your invoice design, your numbering, your accounting) stays yours.

This article explains the moving parts in plain words, so you can talk to your CA and your software vendor with confidence. **It isn't tax advice: confirm how the rules apply to you with your CA.**

### Who has to e-invoice
At the time of writing, e-invoicing applies to businesses whose aggregate annual turnover (AATO) in any financial year since 2017–18 exceeds ₹5 crore, for B2B invoices, exports and certain other documents [02-B S11]. Since 1 April 2025, businesses with AATO of ₹10 crore or more must report each invoice to the IRP within 30 days of its date, or the IRP will reject it [02-A S29, 02-B S11].

Rules change, and there are exemptions by sector, so check your position with your CA each year.

### IRN and QR, in plain words
- **IRN (Invoice Reference Number):** a unique number the IRP generates from your GSTIN, the document type, the financial year and your invoice number. It proves the invoice was registered.
- **Signed QR code:** contains the key invoice details and the IRN, signed by the IRP. It's printed on the invoice so anyone can verify it.
- **Cancellation:** an e-invoice can be cancelled on the IRP only within a short window after generation (currently 24 hours); after that, corrections go through credit or debit notes.

Registered invoices also flow into the GST returns system, which reduces the data you enter separately later.

### Two routes: a GSP, or the IRP directly
**Through a GST Suvidha Provider (GSP).** A GSP is a licensed intermediary that offers its own API (and often a dashboard) in front of the IRP. Most businesses integrate this way: the GSP handles authentication, retries and format changes, and many offer e-way bill generation through the same connection.

**Directly with the IRP.** Some businesses can integrate with the IRP's API themselves, subject to eligibility conditions (check the current rules on the e-invoice portal). You take on more of the work (security, credentials, keeping up with schema changes) in exchange for one less party.

For most small and mid-sized businesses, a GSP is the practical choice.

### Integration patterns
**From Tally.** TallyPrime has built-in e-invoicing for many setups. Where it doesn't fit your process, a connector can take invoices from Tally, register them through a GSP, and write the IRN and QR back.

**From an ERP or Zoho.** Many ERPs, including Zoho Books, offer e-invoicing integrations. The work is usually configuration plus checking that your item and tax data are clean enough to pass validation.

**From custom billing software.** If you issue invoices from your own app or portal, the app calls the GSP when an invoice is issued, stores the IRN and the signed QR, prints them, and handles failures. This is where most of the engineering effort sits.

### Common failures, and how to monitor them
Most e-invoicing problems are data problems, not network problems:
- invalid or inactive buyer GSTINs
- HSN codes or tax rates that don't match the item
- totals that don't add up because of rounding
- duplicate invoice numbers
- missing state or PIN codes

Then there are the operational failures: the GSP or IRP is slow or down, credentials expire, or an invoice is issued but registration silently fails.

Good monitoring answers three questions every day: which invoices were issued, which were registered, and which are stuck. For businesses under the 30-day rule, it should also show how many days each stuck invoice has left.

### A checklist before you start
1. Confirm with your CA whether e-invoicing and the 30-day rule apply to you, and for which documents.
2. Clean your masters: customer GSTINs and addresses, HSN codes, tax rates.
3. Choose a route: your accounting software's built-in feature, or a GSP.
4. Test in the sandbox environment with real-looking invoices, including the awkward ones.
5. Decide who watches failures, and how they'll be alerted.
6. Plan what happens when registration is down: the invoice must wait, not go out without an IRN.

### FAQ
**Is e-invoicing mandatory for us?** It depends on your turnover and sector; your CA confirms it. We build the integration either way.

**Does e-invoicing replace our invoice design?** No. You keep your layout and numbering, and add the IRN and QR code.

**What happens if the portal is down?** The invoice waits and is registered when the service is back; monitoring makes sure nothing is forgotten. Plan for it rather than issuing without an IRN.

**Can it generate e-way bills too?** Usually yes, through the same GSP connection, where your goods movement needs one.

---

## B3 · What an automation audit should cover (and what it shouldn't)

```yaml
slug: what-an-automation-audit-should-cover
description: "Before buying tools, map the work: what a useful automation audit covers, how to rank opportunities, and what a good deliverable looks like."
tags: [automation, process, discovery]
relatedServices: [S1, S10]
```

Most automation projects that disappoint don't fail because of the tool. They fail because nobody mapped the work first: the automation copies a broken process, handles the easy 70 % of cases, and leaves people cleaning up the rest.

An automation audit is a short, structured look at how work actually gets done, before anyone picks a tool. Done well, it tells you what to automate first, what to leave alone, and what it's likely to cost.

### Why audit before you buy
Tools are easy to start and hard to undo. A workflow built in a hurry in an automation platform can become the system nobody understands six months later. An audit costs a little up front and saves you from automating the wrong thing, or the right thing in the wrong way.

It also gives you numbers to measure against. Without a baseline, you can't tell whether the automation helped.

### What to map
For each process worth looking at:
- **Trigger:** what starts it (an email, a form, a WhatsApp message, the end of the month).
- **Steps:** who does what, in which system, and how long each step takes.
- **Hand-offs:** where work waits for another person or system.
- **Exceptions:** what goes wrong, how often, and who fixes it.
- **Volume:** how many times a day, week or month.
- **Systems:** every tool involved, and whether it has an API, an export or nothing at all.

Watching the work being done (or a screen recording of it) beats a description in a meeting. People describe the ideal process; the real one has workarounds.

### Data readiness
Automation is only as good as the data it runs on. An audit should check:
- whether the data you need exists, and where
- whether it's consistent (the same customer spelt three ways is a problem)
- who owns each system, and who can grant access
- what personal data is involved, and what the law and your contracts say about moving it

### Ranking the opportunities
A simple, honest ranking uses two scores per process:
- **Effort:** how hard it is to automate reliably, including the exceptions.
- **Return:** time saved, errors avoided, faster cash or happier customers, in your own numbers.

Start with high-return, low-effort processes. They pay back quickly and teach your team how automation behaves. Leave the processes that need judgement at every step for later, or keep people in charge of them with automation doing the preparation.

### Risk and data protection
Every automation that moves personal data should have a short note: what data, why, where it goes, who can see it, and how long it's kept. In India, the DPDP Act and its Rules set obligations for how personal data is handled (confirm what applies to you with your legal adviser). The audit is the cheapest point to get this right.

Also note what happens when the automation fails. Someone should be alerted, and the work should be visible, not lost.

### What an audit shouldn't be
- **A sales pitch for one tool.** The recommendation should fit your work, not the auditor's favourite platform.
- **A 60-page report nobody reads.** The useful output fits on a few pages and a map.
- **A list of everything that could be automated.** It should say what not to automate, too.
- **Open-ended.** One or two weeks is enough for most small and mid-sized teams.

### What a good deliverable looks like
- A map of each process reviewed, as it works today.
- A ranked list of opportunities, with effort and return for each.
- For the top few: the proposed approach, the tools, the data involved and the risks.
- A costed plan and, if you want to go ahead, a fixed quote.
- The baseline numbers you'll measure against.

### FAQ
**How long does an audit take?** For most small and mid-sized teams, one to two weeks.

**Do we have to use the auditor for the build?** No. A good audit is yours to use with any team.

**Which tools do you recommend?** Whichever fits the job and your team: platforms such as n8n or Make for flows your team may adjust themselves, custom code where volume, reliability or a missing connector calls for it.

**What if the audit finds nothing worth automating?** Then it has saved you from a project that wouldn't have paid back, and you'll know why.
