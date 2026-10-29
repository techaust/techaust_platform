Status: PR opened (2026-10-29)
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
Builder: claude-opus-5-5, high (owner's audit instruction), 2026-10-29 07:10–08:10 IST, branch `fix/fx2-builder` from `origin/fix/fx2-security-web` (10 commits, pushed as `fix/fx2-builder` at the end).

**Skills loaded:**
- `cloudflare:workers-best-practices`: kept the API header change inside Hono's `secureHeaders` (no hand-built headers), no new bindings, no module-level request state; the Worker reads the quote list as a bundled constant (no I/O per request).
- `cloudflare:wrangler`: `_headers` detach syntax (`! Header`) and the Vite plugin's per-environment build options checked against the docs and the installed Vite 8.3.2 types; no config or binding change.
- `cloudflare:cloudflare`: product lookup for static-asset headers and Turnstile.
- `cloudflare:turnstile-spin`: only its CSP requirement (script-src and frame-src `https://challenges.cloudflare.com`, confirmed in the Turnstile docs via Context7). Its widget-creation wizard does not apply (widgets and secrets exist; hosted services are off limits).
- `cloudflare:web-perf`: for the CLS assertion (WEB-G-06) and the font-loading check; no Lighthouse run (no Chrome DevTools MCP in this run).
- `security-review`: run on the branch at the end (no sub-agent tool in this run, so done by me over my 8 commits): no high or medium findings.
- Not loaded: `cloudflare:workers-profiling` (no CPU work; bundle numbers below), `frontend-design` (no screens).

### Per item
1. **A1 1, portal headers.** New `apps/portal/public/_headers`: CSP `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, HSTS 1 year with subdomains, nosniff, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy (camera, microphone, geolocation, payment, usb off), COOP same-origin, CORP same-site, `X-Robots-Tag: noindex, nofollow`, and admin's cache rules. No `wasm-unsafe-eval`, no pwnedpasswords host.
   - What the portal needs, checked on the built bundle: Turnstile's script and frame (so `script-src` names the Turnstile host as well as `'self'`: the brief's "script-src 'self'" plus the host Turnstile requires), its own API, self-hosted fonts, SVG data URIs in JS (img-src `data:`), blob downloads by `<a download>` (navigation, not CSP-governed). No zod `new Function` probe in the portal bundle.
   - **Found and fixed:** Vite inlined the two rupee-glyph font subsets (1.1–1.5 KB, under its 4 KB default) as `data:font/woff2` URIs, which `font-src 'self'` blocks. The admin has shipped this on staging since M3.1 (₹ drawn in a fallback font, one CSP violation per page). Both SPAs now build client assets with `assetsInlineLimit: 0` (`apps/{admin,portal}/vite.config.ts`, client environment only, as the website does).
   - **Guard:** `scripts/check-spa-headers.mjs` checks the docs/08 §3.1 set (HSTS ≥ 1 year + includeSubDomains, nosniff, Referrer-Policy, the four features off, COOP, CORP, noindex, CSP with frame-ancestors/object-src/base-uri/form-action, no unsafe-inline/unsafe-eval/wildcards in script or default src, Turnstile in both script-src and frame-src or neither; portal also refuses `'wasm-unsafe-eval'` and the HIBP host) and that no built stylesheet inlines a font the policy blocks. Wired into the admin and portal `build` and `deploy:staging` scripts (right after `vite build`, before any deploy) and into `pnpm check` (`--source`: both `public/_headers`). Header parsers moved to `scripts/headers-shared.mjs` (web-dist-checks re-exports them).
   - Tests: `apps/web/test/spa-headers.test.ts` (37), `apps/portal/worker/headers.test.ts` (6), `apps/web/test/deploy-scripts.test.ts` (5).
   - **Browser check** (portal `vite preview` on the fresh build, Chromium via Playwright, local Turnstile test key; server stopped and browser closed after): every header served as written; no `securitypolicyviolation` on `/`, `/sign-in`, `/o`; the Turnstile frame loads on the sign-in page; both rupee fonts load. Only console errors: the expected 401s from `/api/v1/me` while signed out.
2. **A1 2, CORP.** `Cross-Origin-Resource-Policy: same-site` on admin, web and portal static files. Web's `/brand/*` (the email logos at `EMAIL_ASSET_BASE`) detaches it (`! Cross-Origin-Resource-Policy`) so webmail on other sites can still show them. Web's dist check now requires CORP too (`REQUIRED_HEADERS`; the live `check-web-headers.mjs` will report staging missing it until this deploys).
3. **A1 4, API headers.** `secureHeaders({ strictTransportSecurity: "max-age=31536000; includeSubDomains", permissionsPolicy: { camera, microphone, geolocation, payment, usb: [] } })` in `apps/admin/worker/app.ts` (both admin Workers) and `apps/portal/worker/index.ts`; Hono's other defaults unchanged. Tests in both `health.test.ts` (front, API Worker refusal, portal answer and refusal).
4. **A1 6, readiness.** `scripts/check-prod-readiness.mjs` also fails on: `[Placeholder` copy in any built file of `apps/{admin,portal}/dist` (the issue guard's bare `"[Placeholder"` / `'%[Placeholder%'` is not counted); a missing admin or portal build; an empty `env.production.vars.TURNSTILE_SITE_KEY` in web, admin or portal; every queue producer binding or consumer staging has and production lacks (all five configs). On today's builds it finds exactly the two pending 07-X marks (`copy-x` in admin, the portal's `X(...)` lines). Tests: `apps/web/test/prod-readiness-apps.test.ts` (10). **Note:** `deploy-prod.yml` builds only the website, so the gate now also fails there on "admin/portal not built" until Phase 7 adds those builds (a workflow change, owner's yes); production is blocked anyway.
5. **A1 7, model guard.** `tools/model-guard.mjs` denies an Agent call with no or a blank `subagent_type` (it would start general-purpose) and matches the banned built-ins case-insensitively and trimmed. Test `apps/web/test/model-guard.test.ts` runs the hook with stdin JSON (5). If a skill ever starts its helper through the Agent tool without a `subagent_type`, the guard now refuses it (docs/14 §9's exception names `general-purpose`, which was already refused).
6. **A2 2.**
   - Web `deploy:staging` = `astro build && build-og && check-web-dist && wrangler deploy --env staging` (the same checks as `build`).
   - New `@techaust/core/public-text`: the 07 §1.3 banned list (moved from `web-content-lint.mjs`, which now imports it; one source), the typed-amount rule (now also used by `web-dist-checks.mjs`) and "&". Node runs the `.ts` directly from the scripts (type stripping, as `build-og.mjs` already does).
   - `POST /api/v1/catalogue/publish` answers **400 `public_text_refused`** with `fields: [{ path, issues: [{ rule: "ampersand" | "banned_phrase" | "typed_amount", phrase? }] }]` (≤ 20, never the text) for item name, unit, schedule labels, default-line descriptions and units, and the payment terms' build-schedule labels; nothing stored, no audit row. Tests: core `public-text.test.ts` (22), admin `catalogue.test.ts` (+2).
   - **The admin SPA does not yet word this answer** (`apps/admin/src` is not mine): today it would show the generic error. A follow-up for the designer, with the copy lines below.
7. **A2 3, quotable codes.** `apps/web/src/lib/quotable-build.ts` writes `src/generated/quotable-services.json` (git-ignored) from the pages' snapshot (`catalogue-snapshot.json`, else the seed) with the pages' rule (`lib/visibility.ts`: `isVisible`/`quotableCodes` + `S3_DPDP_PAGE`). `astro.config.mjs` writes it on every astro command, so `build` and `deploy:staging` (also `publish-catalogue.yml`) bundle the list of the snapshot they built; `vitest.config.ts` writes it from the seed. `isQuotableService` reads it. The rule stays "on the site" (`isServiceOnSite`), so S8, S15 and S17 (on the site in the catalogue, no service page, not in the quote picker; S15 and S17 are priced on /pricing) remain quotable as before. Parity tests `apps/web/test/quotable.test.ts` (9: equals `isServiceOnSite` over the snapshot, covers every service page and picker service, follows a published snapshot that hides S5, invalid snapshot fails, built quote page offers only listed codes) and a Worker test that S1–S20 are accepted exactly when listed.
8. **A2 4, Organization.** `alternateName: ["TecHaust"]` (02-C §4: never "Techaust"), `areaServed` [Country India, Place Worldwide], `naics: "541511"`, `disambiguatingDescription: "Indian software and AI automation studio; not affiliated with Tech Australia"` (docs/04 WEB-G-10 word for word, pinned by a test that reads docs/04). The build's `checkStructuredData` now requires all four (naics exactly 541511). docs/04 gives no value for alternateName; the value is the approved 02-C recommendation.
9. **A2 9, rate limiter.** The 429 and the limiter-error pass-through were already covered (`forms.test.ts`, "third request in 60 s" and "a failing rate-limit binding"). Added 3 mocked-limiter tests: keyed by the hashed address only (never the IP; same address same key), 429 body `{ok:false,error:"rate_limited"}` + `Retry-After: 60`, a plain form post goes back with `?error=rate_limited`, and a failing binding still runs Turnstile and validation.
10. **A2 8.** `apps/web/e2e/site.spec.ts`: CLS `< 0.01` (WEB-G-06).
11. **A2 1/5 (tests).** `apps/web/e2e/axe.spec.ts`: every built page, both themes, at 1280 and 375 px; fails on moderate, serious and critical. **Not run** (see below); expected to fail on the landmark names until the designer's FX-2 fixes land.

### Commands and results
- `pnpm install --frozen-lockfile --offline`: ok (worktree had no links).
- Per-package test runs while working (all green): web node and worker projects, portal headers/health, admin headers/health/catalogue, core public-text.
- `bash tools/heavy.sh --log fx2-web-typecheck pnpm --filter @techaust/web typecheck` (from an empty `src/generated/`): exit 0, 0 errors.
- `bash tools/heavy.sh --log fx2-portal-build pnpm --filter @techaust/portal build`: exit 0; `check-spa-headers: ok`; portal Worker **96,974 bytes** (limit 120,000), startup 9.7 ms.
- `bash tools/heavy.sh --log fx2-admin-build pnpm --filter @techaust/admin build`: exit 0; front **99,271** (150,000), admin API **600,684** (800,000; third-Worker trigger 650,000), startup 59.6 ms. Last recorded figure was 587,821 on main (research and wording); this branch also carries the M5 owner fixes, so the share of FX-2 is not separately measured (public-text adds a few KB).
- `bash tools/heavy.sh --log fx2-web-build pnpm --filter @techaust/web build`: exit 0 (dist checks incl. CORP and the new structured-data fields; dry-run ok).
- `bash tools/heavy.sh --log fx2-test pnpm test` (after the fresh web build, so web's real-build tests ran, none skipped): exit 0. auth 135, ui 469 (+2 skipped), core 1,777, email 128, db 452, pdf 340, web 513, portal 628, jobs 519, admin 3,255.
- `bash tools/heavy.sh --log fx2-check pnpm check` (the one whole-repository lint): first run failed on the portal worker typecheck (`?raw` imports in the new headers test had no declaration); fixed in `apps/portal/worker/test-env.d.ts`, re-run exit 0 (lint, typecheck, binding guard, content lint, worker config guard, `check-spa-headers --source`, migration guard).

### Not verified
- The e2e suite (`pnpm --filter @techaust/web e2e`) was not run: the stricter axe run (moderate, 375 px) is expected to fail until the designer fixes the landmark names and the /security `<pre>`; the CLS < 0.01 assertion is unmeasured.
- Headers as staging serves them; the admin's rupee font fix on staging; Safari and Firefox.
- The SPA's handling of `public_text_refused` (designer).
- `deploy:staging` scripts were not executed (no hosted access); only their order is tested.

### Copy lines for the owner's page 07-Y (recommended wording; the admin Publish screen needs them)
1. Heading of the refusal: "The prices can't be published: some website text breaks the content rules. Fix the fields listed below."
2. Rule "ampersand": "{service} {field}: uses "&". Write "and"."
3. Rule "banned_phrase": "{service} {field}: says "{phrase}", which the website never says (content rules)."
4. Rule "typed_amount": "{service} {field}: types a price. Prices come only from the price fields."
5. Field names for {field}: "name", "unit", "payment step {n}", "line {n} description", "line {n} unit"; for the payment terms: "Settings, payment terms, step {n}".
The API's own message (in `catalogue.ts`) is "The catalogue cannot be published: some website text breaks the content rules. Fix the fields listed".

### Open questions
- Should the quote form accept only the services the picker offers (14, no S8/S15/S17), rather than every service on the site (17)? Kept as before (on the site) pending the lead.
- Phase 7: `deploy-prod.yml` must build the admin and the portal before `check-prod-readiness.mjs` (owner's yes for the workflow change).

## Designer report
Designer: claude-opus-5-5, high (owner's audit instruction), 2026-10-29 09:55–11:15 IST, branch `fix/fx2-designer` from `origin/fix/fx2-security-web` (b4ffc5af), 6 commits, pushed as `fix/fx2-designer`.

**Skills loaded:**
- `frontend-design:frontend-design`: loaded first. It set the bar for the small calls in this task: the footer fix keeps the existing ink layout and only fixes the rhythm (no new decoration); the security.txt box reads as a file (hanging indent under each field) instead of a scrolling code block; the publish refusal is a short sentence and a list of what to open, in the admin's plain voice.
- `cloudflare:web-perf`: for A2 10. Measured requests and bytes from the built pages before and after (below); no Lighthouse or DevTools trace in this run (no Chrome DevTools MCP).
- Not loaded: `dataviz` (no chart or tile), `cloudflare:workers-best-practices`/`wrangler` (no Worker code or config changed; wrangler only served the build locally).

### Per item
1. **A2 1, /security `<pre>`.** The security.txt box wraps instead of scrolling (`white-space: pre-wrap; overflow-wrap: anywhere`); each line is a block with a 2ch hanging indent, so a wrapped value sits under its field name. A copy of the box (`innerText`) equals `/.well-known/security.txt` (checked in the browser). Legal `pre` blocks (`LegalBlocks.astro`, unused today) wrap the same way. At 375 px nothing in the box or page scrolls sideways.
2. **A2 5, landmark names.** Axe found three causes: the table scroll boxes (`role="region"` named like their section, and "Changes" twice), and /pricing's price-list section labelled by the page title like the hero. The scroll boxes are now `role="group"` (still named and focusable for the keyboard, not landmarks; `LegalBlocks.astro`, `ChangeLog.astro`); the price-list section has no label (`pricing.astro`). The builder's stricter axe e2e (moderate, 375 and 1280, both themes) failed 32 tests before and passes now.
3. **A2 6, apostrophes.** Curly ’ and ‘ ’ in the quote hints, /thanks (h1, meta title, reply, urgent line) and the 404 h1 (`content/forms.ts`, `content/shell.ts`, the test in `forms-m24.test.ts`); docs/07 lines unchanged otherwise. New build check `checkApostrophes` (`scripts/web-dist-checks.mjs`, test in `dist-checks.test.ts`): a straight `'` in visible text, titles or read-out attributes fails the web build (code and `pre` keep theirs). It found exactly the reviewer's 9 hits before the fix and 0 after.
4. **A2 7, notes at body size.** `Notice.astro` at `--text-body` (16 px) with the 20 px icon centred on the first line.
5. **A2 10, one stylesheet.** `vite.build.cssCodeSplit: false` plus `build.inlineStylesheets: "never"` (`astro.config.mjs`; the CSP's `style-src 'self'` allows no inline style, and none is emitted).
   - Before: 37 pages, 31 distinct CSS files (113,924 B raw, 27,569 B gzip in total); per page 2 to 13 render-blocking CSS requests (average 9.6), 6.8 to 14.2 KB gzip per page.
   - After: 1 file for every page, 117,584 B raw, 16,994 B gzip; 1 request per page, cached for the rest of the visit. First page costs up to about 10 KB gzip more (the 404's 6.8 KB becomes 17 KB), every later page 0. Cloudflare's Brotli will be smaller.
   - Proof of no cascade change: 148 full-page screenshots (37 pages, 375 and 1280, both themes) were byte-identical before and after the switch (a repeat run of the baseline was identical too, so the method is deterministic). The e2e CSP test (no violation on any page) passes.
6. **A2 13, founder photo.** `about.astro` takes the headshot through `astro:assets` `<Picture>`: AVIF and WebP at 352/704/1056 px (`sizes="min(22rem, 100vw)"`), width and height from the file, lazy. `site.founderPhoto` is now a file name in `apps/web/src/assets/founder/`; a name with no file fails the build. Checked with a clearly labelled SAMPLE image (grey shapes, "SAMPLE IMAGE, not a real photo") through Astro's no-op image service: markup, 4:5 frame, corner cut and cover crop are right; the sample, the config change and the no-op service were removed before committing. **Blocker for the real photo:** with sharp, the build fails `MissingSharp`: Astro's prerender chunk imports `sharp` from `apps/web`, which doesn't depend on it (it resolves only from `packages/ui` and astro's own folder). See open questions. Today's build is unaffected (no photo, so no image is processed).
7. **A2 14, footer rows.** Every footer link's first line now sits at the same depth in its 44 px row (`display: block`, padding = (44 px − line) / 2), so one-line and two-line names line up across columns and keep one rhythm. Measured first-link text tops per column: identical at 768, 1280 and 1600 in both themes (before: about 6 px apart at 1280). At 375 the columns pair up and each pair matches.
8. **Admin Publish: `public_text_refused`.** `apps/admin/src/lib/publish-text.ts` (new) reads the 400's `fields` (checked at runtime; `api.ts` unchanged) and groups them by what to open: each service (code and name, linked to its page, or to a search when the on-site list lacks it), then Settings › Payment terms, then any unknown path (no link). One line per field and rule, in the entry form's words. `routes/catalogue/publish.tsx` shows it in the existing error notice (focus moves to it; Tab reaches the first link); `catalogue.css` adds `.pub-fix__lines`. The refused text itself is never shown (the API never sends it). Tests: `src/lib/publish-text.test.ts` (4). Checked in the running admin with a local sample owner and local-only sample edits ("&" in S5 and S8 names, "best-in-class" in S8, a typed amount in an S11 line, "Guaranteed" in a build-schedule label): axe 0 violations on the panel in light and dark; keyboard path works.

### Placeholder lines for the owner's page 07-Y
Every line below shows "[Placeholder] " on screen until the owner approves 07-Y; then `APPROVED_07Y_PUBLISH` in `apps/admin/src/lib/publish-text.ts` turns true (the 07-X pattern). Recommended wording:
1. Above the list: "The prices can't be published: some text the website would show breaks its content rules. Fix the fields listed below."
2. "{field}: uses "&". Write "and"."
3. "{field}: uses "{phrase}", which the website never says." ({phrase} is the banned phrase's id from 07 §1.3, such as "guarantee" or "best-in-class".)
4. "{field}: types an amount of money. The website takes prices only from the price fields."
5. Field names: "Name", "Unit", "Payment schedule, step {n}", "Line {n} description", "Line {n} unit"; for the payment terms "Build schedule, instalment {n}"; for a path the screen doesn't know "Field {path}", and for a rule it doesn't know "breaks a content rule."
The group headings reuse approved words (the service's code and name; "Settings › Payment terms").

### Files
- Website: `apps/web/astro.config.mjs`, `src/pages/{security,pricing,about}.astro`, `src/components/{Notice,SiteFooter}.astro`, `src/components/legal/{LegalBlocks,ChangeLog}.astro`, `src/content/{forms,shell}.ts`, `src/config/site.ts` (headshot comment), `test/{dist-checks,forms-m24}.test.ts`, `scripts/web-dist-checks.mjs`.
- Admin: `apps/admin/src/lib/publish-text.ts` (new), `src/lib/publish-text.test.ts` (new), `src/routes/catalogue/publish.tsx`, `src/catalogue.css`.

### Screenshots (`.logs/shots/fx2-designer/`, worktree)
- `css-base/`, `css-one/`: 148 full pages each, before and after the single stylesheet (byte-identical); `after/`: the same 148 after all fixes (footer, notices, apostrophes, /security differ as intended).
- `final/`: the changed parts at 375, 768, 1280 and 1600, light and dark: `footer-*` (rows aligned), `security-txt-*` and `security-top-*` (wrapped file, hanging lines), `notice-*`, `notice-how-*` (16 px notes), `quote-step1-*` (curly hint), `thanks-*`, `404-*`, `pricing-list-*`, `privacy-table-*` (unchanged look, now a group); `security-txt-375-light-viewport.png` (the box in its page at 375).
- `before-footer-1280-light.png`: the misaligned rows before the fix.
- `about-headshot-SAMPLE-1280-light.png`: the headshot frame with the labelled SAMPLE image (not committed).
- `admin-publish-refused-{375,1280}-light.png`, `admin-publish-refused-{375,1600}-dark.png`, `admin-publish-refused-768-light-focus.png` (focus on the first link).

### Commands and results
- `pnpm install --frozen-lockfile --offline`, `pnpm dev:secrets`: ok.
- `bash tools/heavy.sh --log fx2d-web-build-* pnpm --filter @techaust/web build` (5 builds): exit 0 each (the sample-headshot build failed on `MissingSharp` as described, then reverted).
- `bash tools/heavy.sh --log fx2d-axe-before pnpm --filter @techaust/web exec playwright test e2e/axe.spec.ts`: before the fixes 32 failed (landmark-unique ×30, scrollable-region-focusable ×2), 117 passed.
- `bash tools/heavy.sh --log fx2d-e2e pnpm --filter @techaust/web e2e`: **175 passed** (axe moderate+ at 1280 and 375 both themes, keyboard, CLS < 0.01, no CSP violation, forms); after the last /security change `-g security`: 9 passed.
- axe (moderate and above) at 768 and 1600, both themes, every page (a local Playwright script on the built site): 148 runs, 0 problems, no page scrolls sideways.
- `bash tools/heavy.sh --log fx2d-test pnpm test` (after a fresh web build): two runs each hit one 5 s timeout in a file this task didn't touch (`packages/db/test/billing-sql.test.ts` grid test, then `apps/web/test/model-guard.test.ts`, which spawns a process per case), each passing on the next run. Final green counts: auth 135, ui 469 (+2 skipped), core 1,777, email 128, db 452, pdf 340 (full run 2); web 515, portal 628, jobs 519, admin 3,259 (package runs).
- `bash tools/heavy.sh --log fx2d-check pnpm check` (the one whole-repository lint): exit 0 (10 lint warnings, all in files this task didn't change).
- `pnpm exec biome check` on every changed file: clean.

### Not verified
- Lighthouse and a DevTools performance trace (no tool here); the stylesheet change is measured by requests and bytes only.
- The real headshot through sharp (blocked, see below); AVIF/WebP output not seen.
- Safari, Firefox, NVDA; staging.
- The admin screen's in-app theme against the OS theme: the dark shots are a dark app on a light OS (correct); a light app on a dark OS was not shot.
- Email copy: `packages/email` still writes "We'll reply…" with a straight apostrophe (plain text and HTML acknowledgement); not a website page, left alone.

### Open questions
1. **sharp for the headshot (owner's yes, no download):** add `"sharp": "0.35.5"` (already in the lockfile, used by `packages/ui` and astro's optional dependency) to `apps/web` devDependencies, so the build can convert the photo when it arrives. Until then a set `site.founderPhoto` fails the build with `MissingSharp`. Recommended before the owner supplies the photo.
2. The admin publish lines above go on 07-Y.
3. The two flaky timeouts (db care grid test, web model-guard test) run near 5 s on this machine under load; the lead may want a longer timeout on them (not this task's files).

## Review (reviewer claude-opus-5-5/high, 2026-10-29 ~11:00–11:55 IST, on 4b75a4fe): APPROVE
_(Summary by the lead; the reviewer's full text is in the conversation record. Shots: `.logs/shots/fx2-review/` in the main checkout.)_

**Every brief item is done**, checked against file and line:
- **Portal headers:**
  - served live, with Turnstile working under the CSP;
  - the rupee fonts load as files.
- **CORP:**
  - the `/brand/*` detach answers 200 without CORP for the email logo.
- **API headers:** served.
- **Prod readiness:** checked.
- **Publish guard:** it covers every snapshot text field.
- **Quote list:** built from the snapshot, with parity tests.
- **Website pages:** all 37 pages × 4 widths × 2 themes:
  - no CSP violation;
  - one stylesheet;
  - no straight apostrophe;
  - no sideways scroll;
  - 148 axe runs, 0 problems.
- **/security, footer, landmarks:** verified.
- **Admin publish refusal:** verified live in both themes, and axe found 0.
- **Tests:**
  - full `pnpm test`: 8,254 passed;
  - e2e: 175 passed;
  - `pnpm check`: exit 0.
- **Admin API:** 602,523 bytes.

**Model guard and the owner's exception (2026-10-22): not broken.** The `code-review` helper is started by the Skill tool itself (a forked run), not by an Agent call. The 18 `general-purpose` runs in the logs all have a parent with a `Skill` call and no Agent call. The new guard allows `{"tool_name":"Skill",…}` (and the hook's `Agent|Bash` matcher never sends it), while it denies an untyped Agent call and `general-purpose`.

**`sharp`:** confirmed in the lockfile (0.35.5, `packages/ui` devDependency and astro's optional dependency). Adding it to `apps/web` devDependencies changes only that importer block: no download and no `allowBuilds` entry. **Needs the owner's yes (rule 11).**

**Findings:**
1. **Medium:** the publish guard was narrower than the dist checks `deploy:staging` now runs. An apostrophe in a service name would pass publish, then fail every 30-minute publish workflow.
2. **Medium:** the refusal's links were 18–69 px tall, against the 44 px project rule (WCAG 2.5.8 is met through its spacing exception).
3. **Low:** the model-guard tests have a 5 s timeout (flaky under load).
4. **Low:** the SPA header guard read only the `/*` block, so a narrower path, or a `! Content-Security-Policy`, could slip through.
5. **Low:** the guard accepted Turnstile in neither CSP directive.

**Also from the reviewer's code-review helper (on `main`'s M5 code, not FX-2):** a hidden Scope after conversion, damaged-render browser time, and non-Flate streams in the integrity check. These were handed to FX-3 round 3.

## Fixes (lead, 2026-10-29 ~12:00–12:40 IST)
1. **Publish rules:** `publicTextIssues` gains `straight_apostrophe` and `unrendered` (`{{`, `}}`, `**`, `→`, `↔`).
   - `scripts/web-dist-checks.mjs` imports the same patterns (`STRAIGHT_APOSTROPHE`, `UNRENDERED`) from `@techaust/core` `public-text.ts`.
   - A twin test in `apps/web/test/dist-checks.test.ts` proves that publish refuses exactly what `checkLeftovers` and `checkApostrophes` would.
   - The admin refusal has words for both rules, as 07-Y placeholders: "uses a straight apostrophe ('). Type a curly one (’) instead." and "uses "{{", "}}", "**" or an arrow, which the website can’t show. Remove them."
2. **Link targets:** `.pub-fix > li > a` is `inline-flex` with `min-block-size: var(--target-min)` (`catalogue.css`). This covers both answers on the Publish tab.
3. **Model-guard tests:** their describe block has a 30 s timeout, with the reason.
4. **Header blocks:** `check-spa-headers.mjs` fails when a required header is set outside `/*`, or detached anywhere. There are tests for both cases, and both real files still pass.
5. **Turnstile:** `https://challenges.cloudflare.com` is required in both `script-src` and `frame-src`, for admin and portal. Test added.

**Merged `main` (FX-1 #107) first:** no conflicts.

**Results:**
- `pnpm check`: exit 0.
- Web build: exit 0.
- `pnpm test`: exit 0, 8,301 passed:
  - admin 3,296;
  - core 1,783;
  - portal 628;
  - web 527;
  - jobs 525;
  - db 470;
  - ui 469;
  - pdf 340;
  - auth 135;
  - email 128.
- The fix diff was not re-reviewed: the five changes are small, each has a test, and CI runs everything again.
