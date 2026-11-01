Status: open
Tier: C
Usage:

# Company phone, WhatsApp and local hours (2026-11-01)

## Brief (lead, 2026-11-01)
**Owner's input (2026-11-01):** the company's registered phone is **+91 98830 23931**, on WhatsApp Business, and it goes everywhere a phone number belongs. Written **"+91 98830 23931"** wherever it is shown or printed (owner). The website gets the WhatsApp chat button (no live chat or AI auto-reply; owner, on the lead's recommendation) **and** a tappable "Phone" line in the footer and on the contact page (owner). The label **"Phone"** is owner-approved (2026-11-01).

**PRD:** WEB-G-18 (contact details from `site.ts`), WEB-G-16 (footer), the contact page (07 §5), docs/06 §1.6 (print: the business-card phone, an owner action now done).

**Designer, your own branch `feat/company-phone-design` from `origin/feat/company-phone`.** Load `frontend-design:frontend-design` first (and the Cloudflare `web-perf` skill for the Lighthouse check).

1. **`apps/web/src/config/site.ts`:**
   - `whatsapp: "919883023931"` (international form without "+", as the comment says).
   - A new `phone` field: the display text `"+91 98830 23931"` and the dial form `"+919883023931"` (for `tel:`), with a comment in the file's style; empty hides the line (WEB-G-18 pattern).
2. **Website screens** (Astro; docs/06; both themes; 1280, 768, 390, 375):
   - **Footer** (`SiteFooter.astro`): a "Phone" line beside the email, `tel:` link, with the hours the same way the WhatsApp line carries them; the WhatsApp line now shows (its placeholder goes).
   - **Contact page** (`pages/contact.astro`, the side panel; labels in `content/forms.ts` `panel`): a "Phone" row with the `tel:` link next to Email; the WhatsApp row now shows.
   - Everything already keyed on `site.whatsapp` simply appears: the CTA band button on home, service, industry and blog pages, the contact form description (07-ZA item 2 wording with WhatsApp), the "urgent" line after a sent form. Check each renders and reads right; no new wording beyond "Phone".
   - `tel:` and `wa.me` links: `wa.me` is external (through `ExternalLink`, the build check enforces it); `tel:` is not an external link (no new tab, no arrow). Make sure `scripts/web-dist-checks.mjs`, the link checker and the content lint accept `tel:` and do not mistake the digits for a typed price; if a guard needs a rule, add the narrowest one with a test.
   - 44 px targets, focus ring, `aria` as for the email link; the number never wraps mid-group on 375 px (keep it on one line).
3. **Search data** (`components/JsonLd.astro`): `telephone: "+919883023931"` on the organisation (Google's form); validate the JSON-LD stays valid.
4. **Print** (`packages/ui/src/brand/print.ts`): add `+91 98830 23931` to `CARD.lines` (after the email) and to `LETTERHEAD_FOOTER` (after the email); drop the "added once the owner confirms it" comment; `pnpm --filter @techaust/ui build:brand`; commit the outputs (drift tests). Look at the rebuilt card and letterhead PDFs (render to PNG) and check nothing crowds or overflows the 3.5 × 2 in card; docs/06 §1.6 and line 88: mark the owner action done.
5. **Content doc:** docs/07 — the contact panel's "Phone" label (owner, 2026-11-01) and the number's written form, in the contact section beside the existing labels.
6. **Hours in the visitor's own time** (owner, 2026-11-01; [13](../13-decisions.md)): **one time only, in the visitor's zone**. A visitor whose clock is on IST sees today's text ("Mon–Sat, 10:00–19:00 IST"); anyone else sees the same window in their own clock with their zone's short name and **no IST beside it**, e.g. London in winter "Mon–Sat, 04:30–13:30 GMT"; when the window crosses local midnight the end gets **"next day"** (owner-approved words) and the weekdays shift with the start, e.g. Los Angeles "Sun–Fri, 20:30–05:30 next day PST". Zone name from `Intl.DateTimeFormat(…, {timeZoneName: "short"})`; where the browser gives none, its "GMT+1" form. Computed in the browser for today's date (daylight saving included); **without scripts the IST text stays** (server-rendered, never empty).
   - **Where:** every rendering of the hours: the footer (with the WhatsApp and Phone lines), the contact page panel, the forms' "We reply within one business day (…)" description and lede and the sent-form "reply" line (`content/forms.ts`), and the care-plan page's response-time label and FAQ answer (`content/services/care-plans.ts`). Keep one source for the window (10:00–19:00 IST, Mon–Sat) instead of the repeated strings.
   - **Quote form "Best time for a call":** each window's label shows the visitor's local times only with the zone name (the "your time:" label in 07 §5.9 goes); the submitted value stays the IST window, so staff always read IST.
   - **Logic:** extend `apps/web/src/scripts/call-time.ts` (pure, Node-tested) for the day shift, "next day" and the zone name; tests for IST (no change), London winter and summer, New York, Los Angeles, a half-hour zone, a zone east of IST (e.g. Tokyo, Sydney: the window may start before the IST day), and a missing zone name.
   - **Unchanged:** "We're in India (IST, UTC+5:30)" in the FAQs (it says where we are); blog and legal *dates*. CSP hashes for any new inline script (the build checks them).
   - Record the wording in docs/07 (§1 "Times" rule: local time only, IST for India and without scripts; §5.9; the contact and footer lines; "next day").
7. **Checks:** `pnpm --filter @techaust/web build` (dist checks, link check, content lint), `pnpm --filter @techaust/ui test`, the web tests; axe 0 and no console errors on home, contact, one service page; Lighthouse on contact no lower than before. Heavy commands through `bash tools/heavy.sh --log <name> …`; the whole-repo lint once at the end. Screenshots to `.logs/company-phone/` in your worktree.

**Out of scope:** Admin › Settings › Company › "Phone on documents" (the owner types it on staging; the live value at Phase 7 L-checklist); a live-chat or AI assistant (later, its own milestone if ever); the social profiles (the owner adds the number on each platform); WhatsApp Business greeting/away messages (drafted by the lead for the owner, not code).

**Done means:** the number shows correctly in the footer, contact page, CTA bands and JSON-LD; the hours show in the visitor's own time everywhere (IST in India and without scripts); the business card and letterhead carry it; build guards and tests green; screenshots in this file; reviewer approves.

**Rules:** commit at each finished part and at least every 20 minutes; stop every dev server you started; never touch hosted services; append your "Designer report" here and push only your branch.
