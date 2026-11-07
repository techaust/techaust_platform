# Production check and fixes, 2026-11-08

**Tier:** B (a workflow change on the backup; two static-file changes). **Branch:** `fix/prod-check-2026-11-08`.

## Brief
The owner asked for a deep check of production (website, admin, portal, hooks, robots.txt, sitemap and the rest), then for the small findings to be fixed:
1. `/robots.txt` on admin and portal answered Cloudflare's managed block followed by the SPA's `index.html` (no file of their own; the SPA fallback served HTML). Fix: a real `robots.txt` in each app's `public/` (`User-agent: *`, `Disallow: /`), required by `scripts/check-spa-headers.mjs` (source and built).
2. Website addresses with a trailing slash (for example `/pricing/`) answered 307 from the assets' `auto-trailing-slash` handling. Fix: `/:a/ /:a 301` and `/:a/:b/ /:a/:b 301` after the static rules in `apps/web/public/_redirects` (pages are at most two segments deep); `apps/web/test/redirects.test.ts`.
3. GitHub starts scheduled workflows late or drops them (the catalogue job's 30-minute schedule ran every 4 to 7 hours; the first production night's 21:10 UTC backup had not started an hour later). Fix (owner's choice): two more tries, 23:10 and 01:10 UTC, and a `gate` job (permissions `actions: read` only, no secret, no checkout) that skips a scheduled try once a run's `backup` job succeeded since that night's 20:30 UTC; a run by hand always backs up; any unreadable answer, or a failed gate, backs up. Workflow-level permissions are now `{}`; the backup job keeps `contents: read`, `id-token: write`.
4. Admin CPU p99 7.3 ms: one request at 19:15 UTC during the first production deploy; every production Worker at or under 6.2 ms since (most at or under 5 ms). No change; watch after the owner's first sign-in.

Out of scope: DNSSEC (pending at the registry; re-check), the private-repository question (answered in chat, see Handover).

## The check (read-only, 2026-11-08 ~21:40–22:05 UTC)
- **Website:** 35 sitemap pages and 16 quote-form variants: 200, one h1, title, description ≤ 155, canonical, no noindex, og tags, valid JSON-LD, beacon once, full header set; every internal link, fragment and asset resolves; `llms.txt` prices match the pages; `security.txt` Expires 2027-10-22; RSS valid (no posts); http and www 301; the eight old addresses 301; unknown paths 404; `/api/health`, `/api/geo`, forms refuse GET (405); Turnstile renders; no horizontal scroll at 375 px.
- **Admin and portal:** sign-in screens render with no errors; noindex (meta and header); exact `_headers` set; cross-site GET 403; a forwarded route on each of the four admin Workers answers 401 (with and without a made-up session cookie), so every service binding and the D1 lookup work.
- **Hooks:** `/healthz`; unsigned posts refused before anything is recorded; no `hook_unconfigured`.
- **DNS, email, TLS:** Zoho MX and SPF, SES DKIM (3) and `noreply.` MAIL FROM, DMARC `p=none`, CAA; certificates to February 2027; TLS 1.1 refused.
- **Cloudflare:** seven production Workers match their configs (secrets, bindings, crons; workers.dev and previews off; `PAYMENTS_LIVE_ALLOWED` false); four custom domains; six queues with consumers and dead-letter queues, no backlog; D1 90 migrations and the seed; R2 buckets private; production Turnstile widgets on the right hosts; the 110 Worker errors of the day all 00:00–00:30 IST (the placeholder Workers, before the first deploy), none since; hourly cron on time.
- **Found and fixed by the owner's yes in chat:** Web Analytics collected nothing after #200 (the site had `enabled: false`); switched to `auto_install: false`; visits recorded again.

## Integration notes
- Local: `pnpm check` green; the four changed test files 120 passed (gate behaviour run through bash with stand-ins for `gh` and the clock); the built website in local workerd: `/pricing/`, `/services/`, `/services/custom-web-apps/`, `/industries/saas-startups/` 301 to the address without the slash (query kept), `/calculator/` still to `/pricing`, pages without a slash 200, `/api/health` 200.
- Not verified: the gate against GitHub's real API (first scheduled night after the merge); the robots files and redirects on production (next production deploy, owner's approval).

## Usage
