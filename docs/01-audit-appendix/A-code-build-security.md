# TecHaust Website: Code, Build and Security Audit

> **Phase 1 evidence (APPROVED 2026-10-06).** Parent: [01-audit](../01-audit.md). Fixes apply to the old site; for how the rebuild maps them, see [04 §10](../04-prd.md) (traceability) and §11 (later).

**Scope:** tech stack, build/deploy, code quality, tech debt, dead code, code-level security, testing.
**Source (read-only):** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`. Paths below are relative to that folder.
**Method:** I read every source file in app/, components/, lib/, scripts/, the root configs and .agents/. I copied the project, without .git, .next, dist, .wrangler or .vinext, to `scratchpad\audit-copy` and ran every gate there. I then ran the vinext Worker bundle locally (`wrangler dev`, no secrets present) and probed it with curl, including `/api/contact`. Raw logs were kept in the session scratchpad, not committed: `tsc-*.txt`, `lint*.txt`, `build-next.txt`, `build-vinext.txt`, `audit.json`, `outdated.txt` and `wrangler-dev*.txt`.
**Date:** 2026-10-06

Severity scale: Critical / High / Medium / Low / Info.

---

## 1. Gate results (run in the copy)

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | PASS (0 errors) | Also passes on a clean run with the tsbuildinfo deleted. `strict: true`. |
| `npm run lint` on a clean tree | PASS (0 problems) | |
| `npm run lint` **after** `npm run build:vinext` | **FAIL**: 5 errors, 4,728 warnings | ESLint lints the generated `dist/` folder because it is not in `globalIgnores` (see F-B3). |
| `npm run build` (Next 16.3.4, Turbopack) | PASS | 15 routes static (○), `/api/contact` dynamic (ƒ). Warnings: "Edge Runtime is deprecated" and "Using edge runtime on a page currently disables static generation". |
| `npm run build:vinext` (vinext 1.0.0-beta.9, Vite 8.2.2) | PASS, but **"Prerendered 1 routes (10 skipped)"** | All 9 pages were skipped as `reason: "dynamic"`. Only `/404` was prerendered. This contradicts AGENTS.md ("prerenders 9 pages"). See F-B1. |
| `npm audit --json` | 17 vulnerabilities: 1 critical, 15 high, 1 moderate | Details in section 3. |
| `npm outdated` | 22 packages behind | vinext and @vinext/cloudflare have stable 1.0.1 releases; next 16.3.8. See section 3. |
| Network | npm audit and npm outdated reached the registry fine | No network-related failures. |

**Bundle and route sizes**
- vinext client output: 36 JS files, 788 KB raw, about 239 KB gzip in total. Largest chunks (gzip): framework 58.8 KB, vinext router 39.3 KB, framer-motion core (`use-reduced-motion-*`) 38.5 KB, contact form (zod + react-hook-form) 36.4 KB, `index-*` 33.8 KB. CSS: 79.6 KB raw, 12.3 KB gzip.
- `next build` home page first-load JS: about **225 KB gzip** (11 script tags). The prerendered `index.html` is 140 KB raw because of the inlined RSC payload.
- Worker bundle (`wrangler dev` upload table): 141 modules, **1,249.9 KiB uncompressed**. That is well under the Workers limits.

**What the locally run Worker returned (curl against `wrangler dev` on the vinext output)**
- `GET /`, `/about` and other pages: `200`, **`Cache-Control: no-store, must-revalidate`**. All five next.config security headers are present (HSTS, Permissions-Policy, Referrer-Policy, nosniff, X-Frame-Options DENY). **There is no CSP.**
- `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.svg`, `/favicon.ico` and `/apple-icon.png` also return `no-store`.
- `/_next/static/*`: `public, max-age=31536000, immutable`, served from the ASSETS binding. These responses do not carry the security headers.
- `/icon-512.png`: `public, max-age=0, must-revalidate`.
- Fonts are self-hosted under `/_next/static/_vinext_fonts/...`. The HTML contains no googleapis/gstatic references, so README:184 is outdated.

---

## 2. Findings

### 2.1 Security: contact API (`app/api/contact/route.ts`)

**F-S1 [High] The rate limit can be bypassed by spoofing X-Forwarded-For and does not work across Worker isolates**
- Evidence: route.ts:55 reads `x-forwarded-for` and keys on the **first** element. That element is set by the client: Cloudflare appends the real IP to any client-supplied XFF rather than replacing it. route.ts:41 uses an in-memory `Map`, which exists per isolate only. Workers run many isolates across many colos, and isolates are recycled often.
- Verified locally: 8 consecutive POSTs with a rotating `X-Forwarded-For: 10.0.0.N` all passed (no 429). A fixed XFF value got a 429 on the 6th request.
- Requests with no XFF header all share the single key `"unknown"`, so one abuser can 429 every other header-less client in that isolate.
- The Map is never pruned (only re-set on a later hit), so a spoofed-XFF flood grows it without limit until the isolate is recycled.
- Impact: if the account is on Resend's free tier (plan not confirmed, [01 Q-H4](../01-audit.md)), only 100 emails per day are allowed. A trivial script can use up the quota, which silently kills the only lead channel, and can flood the inbox.
- Recommendation: key on `CF-Connecting-IP`. Enforce limits with a Cloudflare WAF rate-limiting rule (one free rule) or the Workers Rate Limiting binding, and add Cloudflare Turnstile (free) to the form.

**F-S2 [Medium] Error responses leak internal configuration and upstream errors**
- Evidence: route.ts:134-138 returns `debug: { stage, fetchError }`. route.ts:151-156 returns `debug: { resendStatus, resendError (up to 500 chars of Resend's body), from, to }` to **any** caller. route.ts:69 returns the full Zod `flatten()` issues (confirmed locally).
- Impact: this exposes the destination inbox and sender identity, plus Resend account or domain state (for example "domain not verified" or "API key invalid"), which helps an attacker map the setup. The comments say these were added for debugging.
- Recommendation: return only the generic message and keep the details in `console.error` with a request ID.

**F-S3 [Medium] No body-size limit; the body is parsed before validation**
- Evidence: route.ts:62 calls `await req.json()` with no `Content-Length` check. Verified: a 3 MB JSON body was fully parsed, and only then rejected by Zod.
- Recommendation: reject `Content-Length > ~16 KB` (and non-`application/json` requests) before parsing.

**F-S4 [Medium] Weak validation: free-text `size`, `focus` and `slot` fields flow into the subject and body**
- Evidence: route.ts:15-16 and 19 define `size`, `focus` and `slot` as `z.string().min(1)` or `.optional()`, with no max length and no enum. `sanitize()` (route.ts:32-35) only strips `<` and `>` and truncates to 2000 characters. It does not strip CR/LF.
- `lib/contact-email.ts:45-46` puts the company name and the unknown `focus` value verbatim into the email **subject**.
- Verified locally: a 5,000-character `focus`, `size` and `slot`, plus `company: "Acme\r\nBcc: x@evil.com"`, all passed validation (the request then reached the 503 no-key path).
- SMTP header injection is unlikely because Resend takes JSON. Even so, the attacker controls subject text up to 2000 characters, which enables phishing-style subjects in the owner's inbox.
- The HTML body itself is correctly escaped (`escapeHtml` in contact-email.ts:27-33). Single quotes are not escaped, but no value lands in an attribute, so that is acceptable.
- Recommendation: use `z.enum([...])` for `size`, `focus` and `slot`; strip `[\r\n]` from every single-line field; cap the subject length.

**F-S5 [Low] No Origin or CSRF check; `text/plain` bodies are accepted**
- Evidence: route.ts has no `Origin` or `Sec-Fetch-Site` check. `req.json()` parses regardless of Content-Type. Verified: `Content-Type: text/plain` with `Origin: https://evil.example` was processed. Any website can therefore make visitors' browsers submit the form as a CORS-safelisted "simple request", which spreads spam across many real IPs.
- Recommendation: require `Content-Type: application/json` and an `Origin` matching `https://techaust.com`.

**F-S6 [Low] `sanitize()` mangles legitimate input and duplicates escaping**
- Evidence: route.ts:32-35 strips `<` and `>`. Messages such as "need <50 users" or "a->b" are corrupted, and escaping is already done in contact-email.ts.
- Recommendation: remove `<>` stripping and rely on output escaping. Keep only trimming, length limits and CR/LF stripping.

**F-S7 [Info] Positives**
- The secret is read at runtime from `process.env` (route.ts:99), which works under `nodejs_compat` with the 2026 compatibility date.
- A missing key fails loudly with `503` (verified).
- `AbortSignal.timeout(10s)` is set on the Resend fetch.
- No PII is logged.
- The honeypot is accepted silently.
- GET returns 405 and OPTIONS returns 204 with no CORS allow headers, so there is no permissive CORS.
- Stale comment: route.ts:5-8 and 37-38 still mention Vercel, `@cloudflare/next-on-pages` and Upstash/Vercel KV.

### 2.2 Security: headers, keys and patterns

**F-S8 [Medium] No Content-Security-Policy**
- Evidence: next.config.ts:6-19 sets five headers and no CSP. Verified that the live-equivalent Worker response has no CSP header.
- Recommendation: add a CSP (`default-src 'self'; script-src 'self' 'unsafe-inline'` or nonce-based; `connect-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`), starting in Report-Only mode.

**F-S9 [Info] next.config.ts `headers()` IS applied under vinext/Workers, except on static assets**
- The headers array is compiled into the Worker bundle (`configHeaders:ug` in `dist/server/index.js`). Locally, every Worker-handled response (pages, metadata routes, API) carried all five headers.
- Static files served directly by the ASSETS binding (`/_next/static/*`, `/icon-512.png`) do **not** get them, because the Worker is not invoked for those. `dist/client/_headers` only sets Cache-Control.
- Recommendation [Low]: also emit `X-Content-Type-Options: nosniff` for `/*` via `public/_headers` (or the vinext equivalent). Re-check on production with `curl -I https://techaust.com/`.

**F-S10 [Info] HSTS `includeSubDomains; preload`**
- Evidence: next.config.ts:15. This commits every subdomain of techaust.com to HTTPS for two years. Confirm that no HTTP-only subdomain exists (mail, staging, etc.) before submitting to the preload list.

**F-S11 [Low] JSON-LD uses `dangerouslySetInnerHTML` with no `<` escaping**
- Evidence: app/layout.tsx:148-151, `JSON.stringify(orgSchema)`. The data is static config, so it is safe today. If a config value ever contains `</script>`, the markup breaks or becomes injectable.
- Recommendation: `.replace(/</g, "\\u003c")`. There are no other uses of `dangerouslySetInnerHTML`, no `eval`/`new Function`, and no third-party scripts or analytics tags anywhere in the code.

**F-S12 [Info] No exposed secrets found**
- Only `.env.example` exists, with a placeholder value. There is no `.env`, `.dev.vars`, `*.pem` or `*.key` anywhere in the tree (node_modules excluded).
- Searched the source `dist/`, `.wrangler/`, `.next/` and `.vinext/`:
  - The `re_…` pattern matches only code identifiers in Next internals (`re_pending…`, `re_runtime…`, `re_validation…`). These are false positives.
  - `RESEND_API_KEY` appears only as `process.env.RESEND_API_KEY` references.
  - No Stripe-style keys or private keys were found.
- `dist/server/vinext-server.json` contains a per-build `prerenderSecret`, and `draftModeSecret` is embedded in the server bundle. Both are server-only (not in `dist/client`), randomly generated per build, and dist/ is gitignored. Info only.
- `.wrangler/deploy/config.json` only points at `dist/server/wrangler.json`. The generated `dist/server/wrangler.json` contains absolute local file paths. Harmless, Info.
- I could not check git history for past secret commits, because git commands were out of scope. See the open questions.

**F-S13 [Low] Third-party calls**
- Only `api.resend.com`, server-side. The calculator export puts figures (no PII) into URL query params (app/calculator/page.tsx:21). Acceptable.

### 2.3 Build and deploy configuration

**F-B1 [High] Under vinext, no page is prerendered or cached: every page view is a Worker SSR render with `no-store`**
- Evidence: the `build:vinext` output says "Prerendered 1 routes (10 skipped)". `dist/server/vinext-prerender.json` marks all 9 pages `skipped / reason: dynamic`.
- The local Worker returns `Cache-Control: no-store, must-revalidate` on every page **and** on robots/sitemap/manifest/icons. So `vite.config.ts:9` `cache: { cdn: cdnAdapter() }` and `wrangler.jsonc:17-19` `cache.enabled` have no effect on HTML.
- AGENTS.md:21, README:60 and the old site's CLAUDE.md all claim prerendered static pages.
- Impact:
  - Every hit costs a Worker request plus React SSR CPU (27–54 ms wall time locally; wall time, CPU not measured).
  - The free plan has a 10 ms CPU cap and 100k requests per day, which risks Error 1102 / CPU-limit failures and quota exhaustion under traffic or bot load.
  - No edge caching means slower TTFB.
  - Search-engine bots and scrapers all hit SSR.
- Likely cause: vinext beta's speculative prerender classifies all routes as "Unknown" and the render comes back no-store. I did not pinpoint the root cause.
- Recommendation:
  1. Run `curl -I https://techaust.com/` to confirm production behaves the same.
  2. Upgrade to vinext 1.0.1 and @vinext/cloudflare 1.0.1.
  3. Add `export const dynamic = "force-static"` (or `revalidate = false`) to the static pages/layout and confirm the build reports "Prerendered 9 routes".
  4. Failing that, add a Cache Rule for HTML at the zone.

**F-B2 [High] No CI quality gate; every push to master deploys straight to production**
- Evidence: README:141-147 shows Workers Builds runs only `npm run build:vinext` and then deploy. `tsc`, `lint` and `next build` are "gates" only by convention (AGENTS.md:30). There is no `.github/` folder, no test runner and no tests (see section 2.8).
- Recommendation: add a GitHub Actions workflow on pull requests running `tsc --noEmit`, `lint`, `build` and `build:vinext`, plus a smoke test. Protect `master`, or change the Workers Builds build command to `npx tsc --noEmit && npm run lint && npm run build:vinext`.

**F-B3 [Medium] ESLint lints `dist/`, so the documented gate order fails**
- Evidence: eslint.config.mjs:9-15 ignores `.next`, `out`, `build` and `next-env.d.ts`, but **not** `dist/**`, `.vinext/**` or `.wrangler/**`. Verified: running `npm run lint` after `build:vinext` gives 5 errors and 4,728 warnings and exits 1.
- Recommendation: add `dist/**`, `.vinext/**` and `.wrangler/**` to `globalIgnores`. Consider `eslint --max-warnings 0`.

**F-B4 [Medium] A beta framework runs production**
- Evidence: package.json:17 and 28 pin `vinext ^1.0.0-beta.9` and `@vinext/cloudflare ^1.0.0-beta.7` (caret on a pre-release). Stable 1.0.1 of both now exists. vinext reimplements Next on Vite, so the dual build can diverge.
- Divergence observed: the home `<title>` is "Autonomous AI Infrastructure for the Enterprise" with **no brand** under `next build` (Next does not apply `title.template` to the page in the same segment as the layout). Under vinext it is "… — TecHaust Technologies".
- Recommendation: pin exact versions, upgrade to 1.0.1, and keep a smoke test that diffs the key HTML between the two builds.

**F-B5 [Low] Deprecated Edge runtime on the contact route**
- Evidence: route.ts:9 sets `export const runtime = "edge"`. `next build` warns that it is deprecated. vinext ignores it, because everything runs on Workers.
- Recommendation: remove it, or use `"nodejs"` for the Next/Vercel path. Update the stale comments.

**F-B6 [Low] Worker configuration hygiene**
- wrangler.jsonc has no `observability` block, so `console.error` output from the contact route is only visible in a live `wrangler tail`.
- Recommendation: add `"observability": { "enabled": true }` (free tier includes logs).
- `compatibility_date: 2026-09-04` and `nodejs_compat` are fine. `assets.not_found_handling: "none"` is fine because vinext renders the 404.

**F-B7 [Info] Environment and secrets model**
- The README correctly says `RESEND_API_KEY` must be a runtime Secret. `CONTACT_RATE_LIMIT_*` are read at module scope (route.ts:39-40). README:104-105 labels them "Build/Runtime", which is ambiguous: they must be runtime vars.
- `.env.example:2-3` still refers to "Vercel / Cloudflare Pages".

### 2.4 Dependencies

| Package | Version | Purpose | Notes |
|---|---|---|---|
| next | 16.3.4 | Next build path, types, `next/*` APIs | **npm audit critical** GHSA-vcvr-r3jv-pc5j (RCE in `next/og` ImageResponse, fixed in 16.3.6+). `next/og` is not used and production serves vinext, so it is not exploitable here. Upgrade to 16.3.8 anyway. |
| react / react-dom | 19.2.8 | UI | 19.3.0 available |
| vinext | 1.0.0-beta.9 | Vite-based Next reimplementation (prod) | Beta; 1.0.1 stable available. Audit "high" comes via vite-plugin-commonjs → fast-glob → micromatch → braces (build-time only). |
| @vinext/cloudflare | 1.0.0-beta.7 | CDN cache adapter, deploy CLI | Beta; 1.0.1 available |
| react-server-dom-webpack, @vitejs/plugin-react, @vitejs/plugin-rsc | — | **Peer deps of vinext** | Not imported directly but required. Not dead. |
| framer-motion | 13.2.0 | Animations (navbar, islands, form) | About 38 KB gzip loaded on **every** page, because the navbar uses it (see F-Q3). |
| lucide-react | 1.40.0 | Icons | Tree-shaken, fine. |
| react-hook-form, @hookform/resolvers, zod | 7.87 / 5.x / 4.5.4 | Contact form | Zod 4 `z.string().email()` is deprecated in favour of `z.email()`. |
| clsx, tailwind-merge | | `cn()` used by `ui/card.tsx` | Used |
| **class-variance-authority** | 0.7.1 | — | **Unused** (no imports). Remove. |
| wrangler, @cloudflare/vite-plugin | 4.129 / 1.54.4 | Dev/deploy | Audit high: miniflare → undici (10 advisories) and sharp (libheif). Dev-time only; `npm audit fix` resolves without a major bump. |
| eslint-config-next | 16.3.4 | Lint | Audit high via fast-glob/micromatch/braces (dev only). npm's suggested "fix" downgrades to 14.2.35. **Do not apply it.** |
| typescript | 5.9.3 | | 7.0 is out (major) |
| @types/node | ^20 | | The runtime is Node 24 (`.nvmrc`). Align to ^24. |

**F-D1 [Medium]** Run a non-breaking update (`npm update`), then bump next to 16.3.8 and vinext/@vinext/cloudflare to 1.0.1. Ignore audit's major-downgrade suggestions. All high findings are build-time or dev-time; the only runtime-relevant one is next (not exploitable as used).
**F-D2 [Low]** Remove `class-variance-authority`. Pin exact versions for the beta packages, or move to stable.

### 2.5 Code quality and architecture

**F-Q1 [Medium] The client and server contact schemas are duplicated and have drifted; a functional bug results**
- Client schema (components/contact-form-island.tsx:10-20) vs server schema (route.ts:11-30): the client has no max length on name, email or company, and no `calc` schema. README:51 claims "Shared schemas client/server", which is false.
- **Bug (verified):** contact-form-island.tsx:40 fills missing calculator params with `"-"`. The server regex `^\d{1,6}$` (route.ts:24-28) then rejects `"-"`. Any `/contact?team=…` URL missing one of hours, rate, savings or recovered (a hand-edited, truncated or shared link) makes **every submission fail** with a generic "Validation failed". Non-numeric params (`?team=abc`) also block submission.
- Over-long names or companies likewise fail only on the server, with no field-level message.
- Recommendation: move the schema to `lib/contact-schema.ts` and import it on both sides. Drop non-numeric or missing calc params on the client instead of sending `"-"`.

**F-Q2 [Medium] Hard-coded content is duplicated across files despite the "single source of truth"**
- The three-division list (names, routes, taglines) is redefined in: app/page.tsx:30-61, about/page.tsx:110-114, navbar.tsx:129-131 and 196-198, footer.tsx:40-42, hero-matrix-island.tsx:42-100, contact-form-island.tsx:173-176, and lib/contact-email.ts:20-25.
- `contact@techaust.com` is hard-coded about 20 times in app/ and components/ rather than read from `siteConfig.email.general`.
- `"@techaustsocial"` is repeated in lib/seo.ts:48-49, layout.tsx:72-73 and footer.tsx:21.
- Recommendation: add `lib/divisions.ts` and use `siteConfig` everywhere. A route/email change today needs edits in about 10 places.

**F-Q3 [Medium] Heavy client JS and continuous animation loops on every page**
- app/layout.tsx:139-140 mounts `AmbientLight` and `NeuralCursorCanvas` site-wide.
- `neural-cursor-canvas.tsx` runs an endless requestAnimationFrame loop with O(n²) link checks (up to 120 nodes, about 7,100 pairs per frame, lines 237-266). Each link is a separate `beginPath()/stroke()`, and four arrays are allocated per frame (lines 215-218), which causes GC churn. Only the browser's tab-hidden throttling stops it.
- `ambient-light.tsx` animates a 1400px element with `filter: blur(180px)` every frame (lines 64-87, 110-115).
- Both components are correctly disabled for touch devices and reduced motion.
- The navbar imports framer-motion (navbar.tsx:5) only for a dropdown fade, so the motion core (about 38 KB gzip) ships on every route.
- Home first-load JS is about 225 KB gzip, which is heavy for a marketing site.
- Recommendation:
  - Stop the rAF loops when the pointer is idle.
  - Batch strokes into one path and reuse typed arrays.
  - Replace framer-motion in the navbar with CSS transitions, or use `LazyMotion` + `m`.
  - Measure INP/TBT with Lighthouse.

**F-Q4 [Low] Unnecessary or overly broad "use client"**
- app/calculator/page.tsx:1 makes the whole page a client component, including the static hero and methodology copy. Extract a small `<CalculatorIsland>`; that also removes the need for the pass-through calculator/layout.tsx.
- components/brand-logo.tsx:1 is "use client" only for `useId`, which also works in Server Components.
- The three `services/*/layout.tsx` files are pass-through layouts used only for metadata. Those pages are server components, so `metadata` can live in page.tsx.

**F-Q5 [Low] Fragile error handling on the client**
- contact-form-island.tsx:58 calls `await res.json()` unguarded. A non-JSON response (a Cloudflare 5xx/1102 HTML page) shows the user a raw "Unexpected token <" message.
- The toast `setTimeout` (line 62) is not cleared on unmount.
- There is no `app/global-error.tsx`, so root-layout errors fall back to the framework default.

**F-Q6 [Low] Calculator rate input UX bug**
- app/calculator/page.tsx:89 clamps on every keystroke. Typing "50" becomes "10" after the first key and then "100", so values from 10 to 99 are hard to type. Clamp on blur instead.

**F-Q7 [Low] Rendered titles duplicate the brand**
- `pageMetadata({ title: "Privacy Policy — TecHaust Technologies" })` plus the layout template produces `"Privacy Policy — TecHaust Technologies — TecHaust Technologies"`. The same happens on /terms and /about (verified in the built HTML).
- Files: app/privacy/page.tsx:7, terms/page.tsx:7, about/page.tsx:8. Drop the suffix from these titles.

**F-Q8 [Low] Build-time-frozen and stale values**
- footer.tsx:61 calls `new Date().getFullYear()`, which freezes at build time on static output.
- sitemap.ts:17–20 sets `lastModified: now` on every build or request, so it is meaningless to crawlers.
- Stale platform references: route.ts:5-8, .env.example:2-3, privacy/page.tsx:86 ("Vercel Edge / Cloudflare Pages"), README:184.

**F-Q9 [Info] Type safety and lint strictness**
- Good: `strict: true`, no `any`, and no `@ts-ignore`.
- The lint config is the stock `next/core-web-vitals` + `next/typescript` with no extra a11y or security plugins and no `--max-warnings 0`.
- `META` in hero-matrix-island.tsx:102 is `Record<string,…>`, so a typo in an id is not caught. Use the union of capability ids.

### 2.6 Accessibility patterns in code

**F-A1 [Medium] Input focus indicators are suppressed**
- `focus:outline-none` on inputs and selects (contact-form-island.tsx:68, 184, 195; calculator/page.tsx:91; knowledge-systems/demo.tsx:47) overrides the global 3px ring in globals.css:262-273. The utility's specificity is higher, so it wins.
- The only replacement is a border change to 40% opacity cyan, which likely fails WCAG 2.4.7 / 2.4.11 and AGENTS.md rule 4.
- Recommendation: use `focus-visible:ring-2 focus-visible:ring-cyan-400`, or drop `focus:outline-none`.

**F-A2 [Medium] Auto-updating live regions are too chatty and the hero has no pause control**
- hero-matrix-island.tsx:296 and 330 contain two `role="status"` regions that update every 1.7–2.1 s indefinitely, so screen readers announce constantly. The hero has no pause button (WCAG 2.2.2). The guard monitor and stepper do have one.
- workforce-stepper-island.tsx:27 announces every 2 s.
- Recommendation: announce only on user interaction (tab change) and add a pause control to the hero.

**F-A3 [Low] ARIA widget patterns are incomplete**
- The tablist (hero-matrix-island.tsx:155-207) has no arrow-key navigation or roving tabindex.
- The navbar uses `role="menu"`/`menuitem` (navbar.tsx:111, 121, 136) without menu keyboard semantics. Plain disclosure navigation without menu roles is more appropriate.
- `role="banner"` (navbar.tsx:92) and `role="contentinfo"` (footer.tsx:8) are redundant.
- calculator/page.tsx:126 puts an `aria-label` on a live `role="status"` region, which can override the announced content.

**F-A4 [Low] Touch targets below 44px**
- The `h-9` (36px) CTA links at privacy/page.tsx:142-143 and terms/page.tsx:149-150 violate AGENTS.md rule 4.
- `ui/button.tsx:19` combines `h-9 min-h-[44px]`, which is contradictory (and the component is unused).

**F-A5 [Info] Positives**
- Skip link, single h1 per page, labelled inputs with `aria-describedby`, `aria-invalid`, `aria-hidden` on decorative icons.
- A global `prefers-reduced-motion` override (globals.css:29-36), and the canvases are disabled for reduced motion and touch.
- `useReducedMotion` is used in the islands, and the mobile drawer has a focus trap with focus return.
- Minor: framer `exit` animations ignore reduced motion, which is harmless.

### 2.7 Dead code and unused assets

| Item | Evidence | Severity |
|---|---|---|
| `components/ui/button.tsx` | No imports anywhere | Low |
| `components/particle-canvas.tsx` | No imports. It also has a bug: `onVis` (line 118) starts a second rAF loop each time the tab becomes visible. | Low |
| `EMAIL_DIRECTORY`, `EmailKey` in lib/site-config.ts:37-45 | No imports | Low |
| `app/icon-512.png` (5.5 KB) | Not a Next metadata-convention name, so it is not served. It is stale compared with `public/icon-512.png` (22.8 KB); scripts/generate-brand-assets.mjs:245-246 even says so. | Low |
| CSS classes `.glass`, `.glass-strong`, `.glow-cyan`, `.glow-violet`, `.matrix-active`, `.orbit-pulses`, `.fluid-h3`, `.text-mono-label` | Not referenced in any TSX (globals.css:97-108, 201-212, 232-238, 72-76, 282-287) | Low |
| `class-variance-authority` dependency | Not imported | Low |
| `.agents/skills/migrate-to-vinext/**` | Agent tooling for a migration that is already done | Info |
| `tsconfig.tsbuildinfo`, `next-env.d.ts` | Generated files, already gitignored | Info |

### 2.8 Testing and CI

**F-T1 [High]** There are **no tests** (no unit, integration or e2e; no vitest, jest or playwright config) and **no CI** (no `.github/`). The contact route, the most critical code path, has no automated coverage. The `"-"` calculator bug (F-Q1) and the rate-limit bypass (F-S1) are exactly what tests would catch.
- Recommendation:
  - Add vitest tests for `lib/contact-email.ts` and the route handler (validation, honeypot, 503, oversized body, header spoofing).
  - Add a Playwright smoke test: every route returns 200, one h1 per page, the form submits against a mocked Resend.
  - Run both in GitHub Actions on pull requests (combine with F-B2).

---

## 3. npm audit summary (17 total)

- **Critical (1):** `next` 16.3.4, GHSA-vcvr-r3jv-pc5j (next/og RCE). Fix: 16.3.8 (non-major). Not used by the app and not on the production (vinext) path.
- **High (15)**, all build-time or dev-time:
  - `wrangler` and `@cloudflare/vite-plugin` → `miniflare` → `undici` (10 advisories: DoS, response splitting, cert-validation bypass in BalancedPool, cookie disclosure) and `sharp` (libheif). Fix: `npm audit fix` / update wrangler to 4.147.
  - `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` (ReDoS/DoS).
  - `vinext` → `vite-plugin-commonjs` → `vite-plugin-dynamic-import` → `fast-glob` (same chain). The audit's "fix" suggestions (vinext 0.0.15, eslint-config-next 14) are bogus downgrades; check whether vinext 1.0.1 drops the chain instead.
  - `@vinext/cloudflare` inherits from vinext.
  - `brace-expansion` (DoS).
- **Moderate (1):** `fast-uri` (host normalization).

---

## 4. Prioritised fix list

1. **F-S1 / F-T1 / F-B2:** Fix the contact rate limiting (CF-Connecting-IP plus a WAF/Workers rate-limit rule plus Turnstile), add tests, and add a CI gate before auto-deploy.
2. **F-B1:** Confirm production HTML caching with `curl -I`. Upgrade vinext to 1.0.1 and get the pages prerendered or edge-cached.
3. **F-S2, F-S3, F-S4, F-Q1:** Strip `debug` from responses, add a body-size limit, enums and CR/LF stripping, and share the schema. Fix the `"-"` calc bug.
4. **F-S8, F-A1, F-A2:** Add a CSP and restore focus rings on inputs. Calm the live regions and add a hero pause control.
5. **F-D1, F-B3:** Dependency bumps and ESLint ignores for dist.
6. **F-Q2–Q8 and dead code:** Clean up when convenient.

---

## 5. Open questions for the owner

1. Does production behave like the local build, with every HTML page served `Cache-Control: no-store` and SSR'd per request? (`curl -I https://techaust.com/` will tell.) Is the Worker on the Free plan (10 ms CPU) or Paid?
2. Has the contact form ever been abused, or has the Resend daily quota been hit? Is Turnstile acceptable on the form?
3. Is GitHub branch protection or a PR workflow in place, or do pushes go straight to `master`? Would you accept a GitHub Actions gate before Workers Builds deploys?
4. Has git history ever contained a `.env`, `.dev.vars` or real `RESEND_API_KEY`? I was not allowed to run git commands, so a secret scan of history (for example gitleaks) is recommended.
5. Are any subdomains of techaust.com served over plain HTTP? HSTS uses `includeSubDomains; preload`.
6. Was the `debug` payload in contact error responses meant to be temporary? Can it be removed now?
7. Is the dual build (`next build` for Vercel compatibility) still needed? Dropping it would remove the divergence risk and the deprecated edge runtime.
8. The site shows simulated "live" numbers and statuses ("ALL AI SYSTEMS OPERATIONAL", "Live: 1,847 documents processed today", the threat counters) and the privacy page claims "System Guard" controls and analytics on techaust.com that do not exist in the code. Should these be relabelled as demos or removed? This is not a code bug, but it is a trust and compliance exposure for a security-positioned brand (VERIFY WITH CA/LEGAL; not legal advice).
9. The privacy policy and terms name "Vercel Edge / Cloudflare Pages" and Delaware law for an India-based entity. Should legal review these? (VERIFY WITH CA/LEGAL; not legal advice.)
