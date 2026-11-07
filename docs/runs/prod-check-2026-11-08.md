# Production check and fixes, 2026-11-08

**Tier:** B (a workflow change on the backup; two static-file changes). **Branch:** `fix/prod-check-2026-11-08`.

## Brief
The owner asked for a deep check of production (website, admin, portal, hooks, robots.txt, sitemap and the rest), then for the small findings to be fixed:
1. `/robots.txt` on admin and portal answered Cloudflare's managed block followed by the SPA's `index.html` (no file of their own; the SPA fallback served HTML). Fix: a real `robots.txt` in each app's `public/`, required by `scripts/check-spa-headers.mjs` (source and built). First `Disallow: /`; after review finding 1, `User-agent: *` with an empty `Disallow:` (crawling open, so crawlers see the noindex header).
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


## Review (reviewer, Opus 5.5 high; copied in by the lead)
**APPROVE**: no critical or high; 1 medium, 8 low. Skills: `cloudflare:workers-best-practices`, `code-review` (high). Verified against the bundled `workers-shared` rules engine: placeholders never match an empty segment, static before dynamic, `_redirects` before assets; no open redirect (`//evil.com/`, `/\evil.com/`, `/%5Cevil.com/`, `/%2F%2Fevil.com/` stay on site); query kept; `run_worker_first` paths untouched; no loop (Astro `format: "file"`, `trailingSlash: "never"`). Gate: GNU date and month ends, `gh api -f` encoding, `bash -e` with `&& continue`, `!cancelled()`, workflow-level concurrency, skipped-job runs, permissions and fork safety all sound. Tests: four files, 120 passed.
1. **Medium:** `Disallow: /` in the SPAs' robots.txt is outranked by Cloudflare's managed `User-agent: *` / `Allow: /` (crawlers merge `*` groups; equal specificity, allow wins), and if the managed block went away it would hide the noindex header from crawlers. **Fixed:** empty `Disallow:`; `checkRobots` now refuses HTML, a missing `*` group, any `Disallow: /` (or `/*`) in any group and non-rule lines; decision row reworded.
2. **Low:** CLAUDE.md, restore.md, environments.md still said one run at 21:10 UTC. **Fixed.**
3. **Low:** a night with a checked daily copy but a failed monthly copy counted as "no backup" (runs filtered by `status=success`), so later tries exported again. **Fixed:** the gate lists `status=completed` runs and counts a run whose `backup` job's "Check the uploaded object" step succeeded.
4. **Low:** the tick clearance holds only for a start within about 15 minutes. **Fixed** in the workflow comment and the test name.
5. **Low:** the gate finds the job by its display name. **Fixed:** comment on the job and a test that the job has no `name:` and the check step exists once.
6. **Low:** a by-hand run or re-run from 20:30 UTC counts as the night's copy. **Kept** (a copy is still made then; the owner works by day), recorded in the workflow comment and decision row.
7. **Low:** `checkRobots` read only the first `*` group. **Fixed** with 1 (every line is checked).
8. **Low:** the test's matcher doesn't model splats. **Fixed:** the test refuses a `*` source until `target()` models it.
9. **Low:** non-existent addresses with a slash now pass through a 301 before the 404. **Kept** (harmless, recorded).

## Integration notes
- Fixes on the same branch after the review; `check-spa-headers --source` ok; the four changed test files 121 passed, 1 skipped; `pnpm check` green again before the PR.
- Also today (owner's yes in chat, no code): Web Analytics site switched to manual snippet (visits recorded again at 21:59 UTC); GitHub secret scanning and push protection turned on (0 alerts at first read). The repository scan the owner asked for found no secret, client data or real tax or bank number in any of the 3,455 commits (gitleaks in CI plus a pattern search; only Turnstile site keys and made-up test values).
- Not verified: the gate against GitHub's real API (the first scheduled night after the merge); robots and redirects on production (next production deploy, the owner's approval).

## Usage
Lead: Opus 5.5 high. Reviewer (agent-aa4ccadacc7942f90): claude-opus-5-5 / high, skills cloudflare:workers-best-practices, code-review. The `code-review` skill's own read-only helper (agent-a0de9796344914dcb, general-purpose): claude-opus-5-5 / high, skills none (the docs/14 §9 exception). `node tools/model-audit.mjs 2026-11-07`: all runs within the plan.
