Status: open
Tier: B
Usage:

# FX-2: security and website fixes from the full audit

This is part of the owner's full audit of M1–M5 ([full-audit-m1-m5.md](full-audit-m1-m5.md), "Fix plan").
- **Model:** Opus 5.5 at high effort for every agent.
- **Base:** `origin/fix/m5-owner-findings`.
- **Merge order:** after the M5 owner-fix PR, then FX-1. FX-1 also edits `apps/web/test/worker-config.test.ts`; keep both sets of changes when merging.

## Brief (lead, 2026-10-29)
Read each finding in full in the audit run file: sections A1 and A2.

### Builder (Opus high): headers, guards, Worker and build items
1. **A1 1:**
   - a new `apps/portal/public/_headers`, modelled on admin's, with the docs/08 §3.1 set for the portal: a CSP with `script-src 'self'` and `frame-src https://challenges.cloudflare.com`, `frame-ancestors 'none'`, HSTS for 1 year, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP `same-site`, and `X-Robots-Tag: noindex`. Leave out `wasm-unsafe-eval` and the pwnedpasswords host;
   - first check what the portal needs: Turnstile, fonts, its own API;
   - a new build guard that fails when any SPA's `dist/client/_headers` lacks the required set (admin and portal), wired into `pnpm check` or the SPA build;
   - tests.
2. **A1 2:** `Cross-Origin-Resource-Policy: same-site` on the static files of admin, web and the new portal file.
3. **A1 4:** explicit secure-headers options on the admin and portal APIs (`apps/admin/worker/app.ts:33`, `apps/portal/worker/index.ts:44`): HSTS `max-age=31536000; includeSubDomains`, and a Permissions-Policy as web does (`apps/web/src/worker.ts:10-19`).
4. **A1 6:** extend `scripts/check-prod-readiness.mjs` (it still runs only in `deploy-prod.yml`) with:
   - `[Placeholder` in the built admin and portal bundles;
   - an empty production `TURNSTILE_SITE_KEY` for web, admin or portal;
   - missing production `EMAIL_QUEUE` / `PDF_QUEUE` bindings where staging has them.

   Tests.
5. **A1 7:** `tools/model-guard.mjs` refuses an Agent call with no `subagent_type`, or one naming a banned built-in. Test it.
6. **A2 2:**
   - web `deploy:staging` (`apps/web/package.json:13`) runs the dist checks (`node ../../scripts/check-web-dist.mjs`, or whatever the build uses) before `wrangler deploy`;
   - the admin catalogue publish (`apps/admin/worker/catalogue.ts`) refuses "&", banned phrases (07 §1.3; reuse the content lint's list from one shared source) and typed price amounts in public text, with a 400 that names the field;
   - tests.
7. **A2 3:** the quote endpoint's list of quotable codes comes from the published snapshot at build time (`service-visibility.ts`, `forms.ts:220`), the same source as the pages. A parity test proves that pages and form agree.
8. **A2 4:** `Organization` structured data gains `alternateName`, `areaServed` (IN and worldwide), `naics: "541511"` and `disambiguatingDescription`, in docs/04's exact wording. Extend `test/structured-data.test.ts`.
9. **A2 9:** a unit test with a mocked rate limiter covering the 429 path and the limiter-error pass-through.
10. **A2 8:** the CLS assertion on the currency swap is `< 0.01` (WEB-G-06).
11. **A2 1 (test part):** the e2e axe run also runs at 375 px and fails on moderate issues too (A2 5).

### Designer (Opus high, after the builder): website screens
- **A2 1:** wrap the security.txt `<pre>` on /security.
- **A2 5:** unique landmark names on /pricing, the legal pages and /security.
- **A2 6:** curly apostrophes in /thanks, the quote hints and the 404 page. These are copy fixes inside approved lines.
- **A2 7:** prose notes at body size.
- **A2 10:** one site stylesheet instead of the per-component CSS, if the CSP allows; measure before and after.
- **A2 13:** the founder photo goes through `astro:assets`, ready for the real photo.
- **A2 14:** the footer's first rows line up.
- **Checks:** every page at 375, 768, 1280 and 1600 in both themes, with axe.

### Rules
- Never touch staging or any hosted service.
- No workflow changes (A1 3 and 5 and A6 8 wait for the owner's yes).
- Don't touch the files FX-1, FX-3 or FX-4 own (`packages/db`, `apps/jobs`, `apps/admin/src`, `apps/portal/src`, `packages/pdf`).

### Done means
`pnpm check` and the full `pnpm test` pass, including the web real-build tests after a fresh web build. Reports go in this file.

## Builder report
_(pending)_

## Designer report
_(pending)_
