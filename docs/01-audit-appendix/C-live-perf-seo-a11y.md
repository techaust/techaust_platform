# techaust.com: Live Production Audit (Performance, Accessibility, SEO, Security Headers, Links)

> **Phase 1 evidence (APPROVED 2026-10-06).** Parent: [01-audit](../01-audit.md). Fixes apply to the old site; for how the rebuild maps them, see [04 §10](../04-prd.md) (traceability) and §11 (later).
>
> **Not legal advice.** Legal and compliance remarks (privacy, DPDP, advertising) are **VERIFY WITH CA/LEGAL**.

- **Date:** 2026-10-06
- **Method:** Read-only. Only GET, HEAD and OPTIONS requests were sent (curl, Schannel and OpenSSL), plus the built-in Chromium pane. I checked layout at 1024px desktop, an approx. 406px pane, and a 375x812 mobile viewport. No form was submitted and nothing was POSTed to `/api/contact`.
- **Source:** I cross-checked `ASSETS/WEBSITE` read-only.
- **Stack observed:** vinext (Next.js App Router on Vite) on Cloudflare Workers, behind Cloudflare. The CF colo was MRS (Marseille; an earlier draft said "Chennai", but MRS is Marseille's airport code, so the curl timings in §3 may include the route to Europe). Build id is `40d41b75…`.
- **PageSpeed Insights:** **Not available.** The anonymous PSI API returned `429 RESOURCE_EXHAUSTED (Queries per day)` on all 4 runs, and again via WebFetch. Because of that, the performance section uses browser Performance APIs and curl byte counts. There are no Lighthouse scores or CrUX field data here (see Open questions).

Raw artefacts were kept in the session scratchpad, not committed: `html/*.html` (server HTML per page), `seo.txt`, `asset_sizes.txt`, `links_by_page.txt` and `psi_*.json` (the 429 bodies).

---

## Summary table

| # | Severity | Area | Issue |
|---|---|---|---|
| P1 | **High** | Perf/CWV | CLS 0.21–0.32 on homepage first load: footer jumps when streamed content replaces `app/loading.tsx` fallback |
| P2 | **High** | Perf | HTML is `Cache-Control: no-store`, `CF-Cache-Status: BYPASS`, TTFB 0.8–1.05 s (curl; colo MRS = Marseille, so it may include the route to Europe, see §3) for fully static marketing pages |
| S1 | **High** | SEO | `@techaustsocial` on X does not exist (404, same as a nonsense control handle) but is used in `twitter:site`, `twitter:creator`, footer and Organization `sameAs` |
| S2 | **High** | SEO | JSON-LD declares a `SoftwareApplication` "TecHaust Autonomous AI Platform" with `Offer price 0 USD` on every page: misrepresents a paid B2B services firm as a free app |
| S3 | **Medium** | SEO | Third-party index/brand data still describes TecHaust as a "digital marketing" company; brand confusion with Tech Australia (techaust.com.au, facebook.com/techaust) |
| S4 | **Medium** | SEO | Every page's main content is inside a hidden streaming `<div hidden id="S:0">`; SSR HTML visibly shows "LOADING TECHAUST CORE..." first |
| S5 | **Medium** | SEO/Local | No `LocalBusiness`/`ProfessionalService`, no `telephone`, no `streetAddress`; no `Service`/`BreadcrumbList` schema on service pages |
| S6 | **Medium** | SEO | OG/Twitter image is a 512x512 square icon while `twitter:card=summary_large_image`; `/og-image.png` & `/opengraph-image` 404 |
| S7 | **Low** | SEO | sitemap `lastmod` = time of request (changes every fetch) |
| S8 | **Low** | SEO | Title issues: About = 90 chars, brand repeated; Privacy/Terms "— TecHaust Technologies — TecHaust Technologies" |
| S9 | **Low** | SEO | 404 page has two `robots` metas, canonical + `og:url` pointing at homepage |
| S10 | **Low** | SEO | `/services` (hub) is 404; `og:locale en_US` for an Indian business; `meta keywords` includes founder name |
| H1 | **Medium** | Security | No `Content-Security-Policy` at all (not in next.config.ts either) |
| H2 | **Medium** | Security | `/api/contact` 502 path returns `debug: {stage, resendStatus, resendError, from, to}` to the browser (source line ~154) |
| H3 | **Low** | Security | No COOP / CORP / COEP; no `security.txt`; HSTS has `preload` but domain is not submitted to the preload list |
| H4 | **Low** | Security | DMARC `p=none`; no CAA records |
| H5 | **Low** | Security | Static assets (`/_next/static/*`, `/icon-512.png`) are served from the ASSETS binding without the security headers |
| H6 | **Info** | Security | `X-Vinext-Build-Id` header and very long `Vary` list disclose the framework |
| A1 | **Medium** | A11y | Homepage hero "Execution Feed" auto-advances on an interval with **two** `role="status"` live regions and **no pause control** (WCAG 2.2.2, 4.1.3 noise) |
| A2 | **Medium** | A11y | Text contrast failures (WCAG 1.4.3): `text-white/30` (2.6:1), `text-white/40` (3.8:1), `text-slate-500` (3.9–4.2:1) on 10–12px text |
| A3 | **Low** | A11y | `aria-controls` points at IDs that don't exist until opened (`services-menu`, `mobile-menu`, `c2-panel-workforce`, `c2-panel-security`) |
| A4 | **Low** | A11y | 8px "TECHNOLOGIES" wordmark text; 10px uppercase labels throughout |
| A5 | **Low** | A11y/Robustness | SSR contact `<form>` has no `method`/`action` (defaults to GET on the current URL) |
| L1 | **Info** | Links | All 9 internal routes and the calculator deep link return 200; no 4xx/5xx internal links; mailto correct; no `tel:` links anywhere |
| L2 | **Medium** | Links | Social profiles unverifiable or non-existent (see S1); LinkedIn/Instagram/Facebook handles could not be confirmed |
| C1 | **Info** | Console | Zero console errors/warnings on all 9 pages; only failed requests are aborted RSC prefetches (benign) |

---

## 1. HTTP & security headers

### Observed on `/` (HTML), and identically on `/api/contact` (405), the 404 page, robots.txt and sitemap.xml
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store, must-revalidate
CF-Cache-Status: BYPASS
Server: cloudflare            (no X-Powered-By: good, poweredByHeader:false works)
X-Vinext-Build-Id: 40d41b75e8101b76674dbc775371c646
Vary: RSC, Next-Router-State-Tree, ... (10 entries)
```
**next.config.ts vs production:** all 5 headers declared in `next.config.ts` appear in production on HTML and API routes. ✔ They do **not** appear on files served by the Workers ASSETS binding: `/_next/static/*.css|js|woff2` and `/icon-512.png` (see H5).

**Redirects:** `http://techaust.com` → 301 `https://techaust.com/` ✔. `https://www` → 301 apex ✔. `http://www` → 301 `https://www` → 301 apex, which is two hops (Low: one hop would be cleaner). `/about/` → 308 `/about` ✔. `/About` → 404 (case-sensitive; acceptable).

**TLS:** The cert is Google Trust Services WE1, CN=techaust.com, SAN `techaust.com, www.techaust.com, *.www.techaust.com`. It is valid 2026-09-04 → 2026-12-03 and auto-renewed by Cloudflare. TLS 1.3 negotiates (TLS_AES_256_GCM_SHA384). HTTP/3 is advertised (`alt-svc h3`). The legacy TLS 1.0/1.1 test was **inconclusive**: Schannel reported 200 with `--tls-max 1.0`, but OpenSSL probes timed out. Cloudflare's default minimum is TLS 1.0. *Recommendation: set Minimum TLS Version = 1.2 in Cloudflare SSL/TLS → Edge Certificates.*

**API:** `HEAD/GET /api/contact` → 405 with empty body; `OPTIONS` → 204 `Allow: OPTIONS, POST`; no CORS headers (correct, same-origin only). Probes for `/.env`, `/.git/config` and `/wp-admin` → 404 ✔.

| ID | Sev | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| H1 | Medium | No CSP header anywhere. | Header dumps above; `next.config.ts` has no CSP entry. The page loads inline scripts, `static.cloudflareinsights.com` (Cloudflare Web Analytics beacon) and same-origin chunks only. | Ship at least `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, starting as `-Report-Only`, and tighten to nonces later. |
| H2 | Medium | The contact API failure path echoes internal debug data to the client. | `app/api/contact/route.ts` ~L150-155 returns `debug:{stage:"resend",resendStatus,resendError,from,to}` with a 502. I did not trigger it (no POST). | Remove `debug` from the response body and keep it in `console.error` only. |
| H3 | Low | No `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`; `/.well-known/security.txt` → 404 (it renders the HTML 404 page). HSTS says `preload`, but hstspreload.org reports status `unknown` (not submitted; it is preloadable with no errors). | curl output | Add `COOP: same-origin` and `CORP: same-origin`. Publish `/.well-known/security.txt` (Contact, Expires, Policy). Either submit to hstspreload.org or drop `preload`. |
| H4 | Low | DMARC is `v=DMARC1; p=none` (reporting to Cloudflare) and there are no CAA records. SPF `include:zoho.in ~all` is on the apex. Resend DKIM (`resend._domainkey`) and `send.` SPF/MX via SES are present ✔. | DoH lookups | After monitoring, move DMARC to `p=quarantine`, then `reject`. Cloudflare adds its CA records automatically; check the existing records before adding any. |
| H5 | Low | Static assets have no HSTS/nosniff. | `/_next/static/css/index.CLS60pd_.css` headers show only `Cache-Control: public, max-age=31536000, immutable` | Add a `public/_headers` file, or a Cloudflare Transform Rule for `/*`. |
| H6 | Info | `X-Vinext-Build-Id` and the long internal `Vary` list leak the stack and build. | headers | Strip them with a Transform Rule (low value either way). |

Cookies: none are set on HTML responses ✔.

---

## 2. SEO

### Per-page meta (from server HTML)
| Page | Title (len) | Desc len | Canonical | H1 | robots |
|---|---|---|---|---|---|
| / | Autonomous AI Infrastructure for the Enterprise — TecHaust Technologies (71) | 158 | https://techaust.com | 1 | index, follow |
| /about | About TecHaust Technologies — The New Era of Autonomous Enterprise — TecHaust Technologies (**90**) | **183** | /about | 1 | index, follow |
| /services/knowledge-systems | (66) | 158 | ✔ | 1 | index, follow |
| /services/workforce-automation | (71) | 157 | ✔ | 1 | index, follow |
| /services/security-guard | (67) | 155 | ✔ | 1 | index, follow |
| /calculator | (59) | 155 | ✔ | 1 | index, follow |
| /contact | (51) | 145 | ✔ | 1 | index, follow |
| /privacy | Privacy Policy — TecHaust Technologies — TecHaust Technologies (62) | 158 | ✔ | 1 | index, follow |
| /terms | Terms of Service — TecHaust Technologies — TecHaust Technologies (64) | 131 | ✔ | 1 | index, follow |
| 404 | 404 — Core Node Not Found — TecHaust Technologies | 59 | **https://techaust.com** | 1 | **noindex** AND **noindex, nofollow** (two tags) |

All pages have `lang="en"`, exactly one H1, a logical heading order (no skipped levels in the rendered DOM), full OG and Twitter sets, a manifest, icons and theme-color. Favicon links are duplicated (`/favicon.ico?60f0…` plus `/favicon.ico`), which is harmless.

**robots.txt** ✔ `Allow: /`, `Disallow: /api/`, and a Sitemap line.
**sitemap.xml** lists 9 URLs, all return 200 and all are canonical-consistent. `lastmod` is the request time (`2026-10-06T00:15:54.120Z` on every URL; `app/sitemap.ts:17–20 lastModified: now`).

### JSON-LD (identical `@graph` on every page)
- `Organization`: name, legalName, url, logo (icon-512.png), founder Person (Rupak Sarkar, with sameAs to 4 personal profiles), PostalAddress (Balurghat, West Bengal, 733133, IN, **no streetAddress**), sameAs ×4 (@techaustsocial), and ContactPoint (email only, **no telephone**). The JSON parses as valid.
- `WebSite`: fine. It has no `SearchAction`, which is OK.
- `SoftwareApplication` "TecHaust Autonomous AI Platform", `applicationCategory: BusinessApplication`, `offers: {price:"0", priceCurrency:"USD"}`. There is no aggregateRating or review, so there are no fake ratings ✔.

| ID | Sev | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| S1 | High | **@techaustsocial does not exist on X.** `x.com/techaustsocial` → 404, the same as the control `x.com/zzqqnonexist8812x` → 404, while `x.com/r4rupak1997` and `x.com/elonmusk` → 200. The handle is used in `twitter:site`, `twitter:creator`, the footer link (all 10 pages) and Organization `sameAs`. | curl differential test | Create or claim the handle, or remove it from metadata, footer and `sameAs`. Only list profiles that exist. |
| S2 | High | `SoftwareApplication` with a free `Offer` on every page misrepresents the business (bespoke paid B2B services, no downloadable or self-serve app). This can produce a misleading "Free" rich result and risks a structured-data manual action. | JSON-LD above | Remove `SoftwareApplication`. Use `ProfessionalService` (or `Organization` + `Service` per service page with `provider`, `areaServed`, `serviceType`) instead. |
| S3 | Medium | The index shows a stale identity. WebSearch summaries and ZoomInfo describe "TecHaust Technologies" as a **digital marketing / web development / brand strategy** company. The `site:` search surfaced `https://www.techaust.com/` (the www variant, even though canonical is apex). The name collides with *Tech Australia* (techaust.com.au, facebook.com/techaust, LinkedIn techaustralia), and those dominate brand queries. Only `/` and `/contact` were seen indexed on the apex. | WebSearch `site:techaust.com`, `"TecHaust Technologies"` | Verify the apex domain property in Google Search Console (a `google-site-verification` TXT record already exists), submit the sitemap, and request indexing of all 9 URLs. Update ZoomInfo, Crunchbase and LinkedIn descriptions. Add `alternateName: "TecHaust"` and a disambiguating `description` to Organization. |
| S4 | Medium | **Streaming wrapper around all page content.** `app/loading.tsx` makes every route render `<div role=status aria-label="Loading TecHaust Core">LOADING TECHAUST CORE...</div>` first. The real `<main>` content sits in `<div hidden id="S:0">` and is swapped in by an inline `$RC` script. Googlebot renders JS and will see the content, but non-rendering crawlers (social unfurlers, many AI/LLM crawlers, some Bing passes) see a loading screen plus hidden text. It also causes P1. | `grep '<template id="B:0">'` hits on 9/9 pages | Delete `app/loading.tsx`, or scope it to genuinely dynamic segments. All these pages are static and should prerender without Suspense. |
| S5 | Medium | Local SEO (India) is thin. The contact page shows "REGISTERED OFFICE Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal - 733133" but the schema has no `streetAddress`, `telephone`, `geo`, `openingHours` or `areaServed`. There are no `tel:` links. There is no `LocalBusiness`/`ProfessionalService` type and no Google Business Profile link in `sameAs` or `hasMap`. Service pages have no `Service` or `BreadcrumbList` schema. | JSON-LD, links_by_page.txt | Add `ProfessionalService` with full PostalAddress, telephone, `areaServed: ["IN", …]`, `hasMap` (GBP URL) and `priceRange`. Add `Service` + `BreadcrumbList` per service page. Keep NAP identical to the GBP listing. |
| S6 | Medium | The social preview image is wrong. `og:image` = `https://techaust.com/icon-512.png` (512x512) with `twitter:card=summary_large_image`, so X, LinkedIn and WhatsApp crop or letterbox an icon. `/og-image.png` and `/opengraph-image` → 404. `/icon-512.png` is served with `max-age=0`. | seo.txt | Add a 1200x630 `opengraph-image` (static or per route). Use `summary` card if staying with a square image. |
| S7 | Low | sitemap `lastmod` is always "now", so Google learns to ignore it. | `app/sitemap.ts:17–20` | Use real content dates (build time or a per-page constant). Drop `changefreq`/`priority` (ignored by Google). |
| S8 | Low | Titles: About is 90 chars with the brand twice; Privacy and Terms repeat the brand (the page-level title already includes it and the template appends it again). About description is 183 chars (truncated). | table | Set `title: { absolute: … }` or drop the brand from page titles. Keep titles ≤60 and descriptions ≤155. |
| S9 | Low | 404 page has two `<meta name="robots">` tags, `canonical` = homepage, and `og:url` = homepage. | html/nonexistent-xyz.html | Emit a single `noindex` and no canonical on the not-found page. |
| S10 | Low | `/services` returns 404 (no hub page; the nav uses a dropdown). `og:locale en_US` is set for an India-based firm. `meta keywords` (ignored by Google) includes the founder name. | curl | Optionally add a `/services` hub. Use `en_IN` (or keep en_US if targeting US buyers deliberately). Drop `keywords`. |

---

## 3. Performance

**PSI/Lighthouse scores and CrUX field data are unavailable (API quota 429).** Measurements below come from the Chromium pane on a fast desktop connection and from curl (CF colo MRS = Marseille, so the TTFB figures may include the route to Europe; they were not shown to be what an Indian visitor sees, and should be re-measured from India).

| Metric (homepage) | Value |
|---|---|
| TTFB (curl, uncached HTML) | 0.80–1.05 s across all 10 pages (HTML is always rendered at the Worker). Served from colo MRS (Marseille), so it may include the route to Europe: re-measure from India. |
| TTFB (browser, warm connection) | 204–218 ms |
| FCP / LCP (desktop pane) | 444–540 ms; LCP element = hero `<h1>` (text, so no image LCP) |
| **CLS** | **0.317** (first visit, 1024px) and **0.208** (406px pane). The source is `FOOTER` moving from y=263 to off-screen at ~404 ms (content stream replacing the loading fallback). 0 on warm reloads where the swap precedes first paint. |
| Long animation frames / TBT proxy | 0 LoAF entries ≥50 ms on a fast desktop (mid-tier mobile will differ) |
| Requests on home load | 44 (33 JS module chunks, 1 CSS, 3 fonts, RUM beacon, ~6 RSC prefetches) |
| JS | 24 chunks referenced in HTML = **~197 KB brotli / 618 KB raw** (browser decoded ~764 KB incl. lazy chunks). Largest: framework 59 KB br, `use-reduced-motion` (framer-motion) 40 KB br, vinext runtime 40 KB br, index 34 KB br |
| CSS | 1 render-blocking file, 12 KB br / 80 KB raw |
| Fonts | 3 families × several unicode-range subsets; 3 woff2 preloaded via `Link` header (Plus Jakarta Sans 27 KB, Space Grotesk 22 KB, **JetBrains Mono 40 KB**). Fallback metric overrides (`size-adjust`/`ascent-override`) are present ✔ |
| Images | None (no `<img>` elements); visuals are CSS, SVG and canvas |
| Static caching | `/_next/static/*` → `public, max-age=31536000, immutable`, CF HIT ✔. `/icon.svg`, `/apple-icon.png`, `/favicon.ico` → `no-store` (served by the Worker on every request) |
| Third party | Cloudflare Web Analytics only (`static.cloudflareinsights.com` + `/cdn-cgi/rum`) |
| Compression | Brotli on HTML and JS ✔; HTTP/3 advertised ✔ |

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| P1 | High | CLS ≥0.2 on first visit (poor is >0.25; 0.317 measured at 1024px). It is caused by `app/loading.tsx` streaming: the footer renders right under a 60vh spinner, then jumps when the page body is revealed. | Remove the root `loading.tsx`, or reserve full height. Static pages need no Suspense fallback. Re-measure in PSI after the quota resets. |
| P2 | High | Static marketing pages are SSR'd per request with `Cache-Control: no-store`, `CF-Cache-Status: BYPASS`, giving 0.8–1.05 s TTFB by curl (colo MRS, Marseille: re-measure from India before quoting it) and unnecessary Worker invocations. RSC prefetches (`?_rsc`) for 5–8 routes also hit the Worker on every page view. | Prerender/ISR the pages and send `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` (or enable vinext/Workers cache for these routes, or a CF Cache Rule for HTML). Target TTFB <200 ms. |
| P3 | Medium | About 200 KB br of JS for a brochure site; framer-motion is loaded on every page for entrance animations. | Replace simple framer-motion fades with CSS. Lazy-load the hero matrix, guard monitor and stepper islands on visibility. Check `index` + `vinext` chunk duplication. |
| P4 | Low | JetBrains Mono (40 KB, the largest font) is preloaded although it is used only for small labels. | Drop the mono preload (keep `display: swap`) or subset it. |
| P5 | Low | `icon.svg`, `apple-icon.png` and `favicon.ico` are `no-store`; `icon-512.png` (also og:image) is `max-age=0`. | Serve them from `public/` or set long cache headers. |
| P6 | Info | The desktop neural-cursor canvas (1280x960 backing store, DPR capped at 1.5) runs an rAF loop on hover-capable devices. It is correctly disabled for `prefers-reduced-motion` and on touch devices (no canvas at 375px). | Pause on `visibilitychange` and when idle (`particle-canvas.tsx` already does this; `neural-cursor-canvas.tsx` and `ambient-light.tsx` do not). |

---

## 4. Accessibility (WCAG 2.2 AA)

**Passes:**
- Skip link "Skip to main content" → `#main-content` is the first Tab stop and visible on focus (2.4px cyan outline plus glow).
- Landmarks: 1 `header`, 1 `main`, 1 `footer`, and 3 labelled `nav` (Primary, Platform, Company).
- All 32 focusable elements on home show a visible `:focus-visible` style.
- No unlabeled buttons, links or inputs on any page. No `<img>` without alt. The decorative canvas is `aria-hidden`.
- No duplicate IDs. No positive tabindex. No horizontal scroll at 375px.
- Touch targets ≥44px at 375px, except inline text links (exempt).
- Mobile menu: `role=dialog aria-modal=true`, focus moves into it, Escape closes it and returns focus to the toggle, body scroll is locked, and the label toggles Open/Close.
- Calculator sliders: labelled, `aria-valuetext` ("45 employees"), 44px tall, and results sit in `role=status aria-live=polite`.
- Contact form: every field has `<label for>`, `aria-required`, `aria-invalid`, and `aria-describedby` that points at `role=alert` error text. It has autocomplete tokens (name/email/organization), a hidden honeypot (`tabIndex=-1 aria-hidden`), and a 44px submit button with `aria-busy`. Validation is client-side (`noValidate` + react-hook-form). Error rendering was reviewed in source; it was not triggered live (I submitted nothing).
- `prefers-reduced-motion` is honoured in CSS (4 media blocks) and in all motion islands.
- Workforce and Security service simulations have explicit Pause buttons ✔.

| ID | Sev | Page / element | Finding | Recommendation |
|---|---|---|---|---|
| A1 | Medium | `/`, `HeroMatrixIsland` (`components/hero-matrix-island.tsx` L121-125, L296, L330) | The "EXECUTION FEED" text and a sr-only summary both use `role="status"` and change every `cap.pulseDur` seconds forever. Screen readers get two announcements per tick indefinitely, and sighted users get moving and updating content with no pause or stop (2.2.2 Pause, Stop, Hide). The fake "ping" jitters randomly. It is only stopped for reduced-motion users. | Add a Pause/Play control (as on the service pages), stop after one cycle, or remove `role=status` from the visual feed and keep one sr-only summary that updates only on user tab change. |
| A2 | Medium | Several | Contrast below 4.5:1 for small text (computed by resolving Tailwind v4 `lab()` colours to sRGB):<br>• `/calculator`: "Forwards your figures to the contact aud…" `text-white/30` 10px **2.61:1**; "~ 3,499 workdays", "Manual effort eliminated" `text-white/30` 11px **2.68:1**; "WEEKS / YEAR", "AUTOMATION RATE", "SOURCE" `text-white/40` 10px **3.8:1**; "HOURS RECOVERED / YEAR", "EFFICIENCY GAIN" 11px **3.82:1**<br>• `/about`: stat labels "Focus / Deployment / Interop / Response" `text-white/40` 10px **3.8:1**<br>• `/`: "DOCS INDEXED" `text-slate-500` 10px **3.94:1**; "AI Agent • CORE://02", "System Guard • CORE://03", "Three divisions, one interoperable…" 11px **4.06:1**; "EXECUTION FEED" **4.23:1**; separator "•" `text-white/30` **2.68:1**<br>• `/contact`: "REGISTERED OFFICE", "RESPONSE SLA", "HANDLING", "Every enquiry lands with a named architect…" `text-slate-500` 11-12px **4.11:1**<br>• Footer (all pages): "PLATFORM", "COMPANY", "@techaustsocial", "© 2026 TecHaust Technologies…", "Engineered with … in India." `text-slate-500` 12px **4.2:1** | Raise `text-slate-500` → `text-slate-400` (about 7:1 on #07080C), and `text-white/30`/`/40` → `/60` or more. Avoid 10px body labels. |
| A3 | Low | All pages (navbar), `/` (C2 tabs) | `aria-controls` references IDs absent from the DOM while collapsed (`services-menu`, `mobile-menu`) and inactive tab panels (`c2-panel-workforce`, `c2-panel-security`) are not rendered. | Render the panels with `hidden`, or omit `aria-controls` while the target is unmounted. |
| A4 | Low | Logo (all pages) | The "TECHNOLOGIES" wordmark subtitle is 8px `text-slate-500`. Logotypes are exempt from contrast, but it is still unreadable. | Mark it decorative inside the logo link (the accessible name is already "TecHaust Technologies — Home") or enlarge it. |
| A5 | Low | `/contact` SSR form | `<form noValidate>` has no `method`/`action`. If hydration fails after the form is revealed, a native submit would GET `/contact?name=…&email=…`, putting PII in URL, logs and Referer. | Add `method="post" action="/api/contact"` as a progressive-enhancement fallback, or keep the form hidden until hydrated. |
| A6 | Info | `/` hero H1 | The H1 contains `<br>` with no spaces ("Next-GenAutonomous AIInfrastructurefor Enterprise."), so the text and accessibility name run words together for some tools and SERP snippets. | Put a space before each `<br/>` or use block spans. |

---

## 5. Links

Crawled: every `<a href>` on all 9 sitemap pages plus 404 (`links_by_page.txt`).

| Link | Status |
|---|---|
| `/`, `/about`, `/services/knowledge-systems`, `/services/workforce-automation`, `/services/security-guard`, `/calculator`, `/contact`, `/privacy`, `/terms` | 200 ✔ |
| `/contact?team=45&hours=18&rate=38&savings=1063772&recovered=27994` (calculator export) | 200 ✔ |
| `#main-content` | target exists ✔ |
| `mailto:contact@techaust.com` (contact, privacy, terms) | well-formed ✔; MX = Zoho ✔ |
| `tel:` | **none on site** |
| https://x.com/techaustsocial | **404, account does not exist** (control-tested) |
| https://linkedin.com/company/techaustsocial | 200 behind LinkedIn bot wall, so **unverified** |
| https://instagram.com/techaustsocial | 301 → 200 generic shell (IG returns this for any handle), so **unverified** |
| https://facebook.com/techaustsocial | 301 → 400 to bots, so **unverified** |
| https://x.com/r4rupak1997 | 200 ✔ (exists) |
| linkedin/in, instagram, facebook `r4rupak1997` | unverified (same bot walls) |
| Internal 4xx/5xx | none |

---

## 6. Console & network
- **Console:** 0 errors and 0 warnings on `/`, `/about`, all 3 service pages, `/calculator`, `/contact`, `/privacy` and `/terms` (desktop and 375px).
- **Network:** all document, asset and RSC requests are 200. The only failures are `net::ERR_ABORTED` on some `?_rsc` prefetches cancelled by navigation (benign).
- **Cloudflare Web Analytics:** `POST /cdn-cgi/rum` 204 per page view. The privacy policy mentions "privacy-preserving, cookie-minimal measurement" ✔. It lists "Cloudflare Pages", but the site runs on Cloudflare **Workers** (minor wording).

---

## Open questions for the owner
1. Do the social accounts **@techaustsocial** exist on LinkedIn, Instagram and Facebook? X definitely does not. Should metadata point to the founder's accounts until company pages exist?
2. Is the `SoftwareApplication` "free" offer intentional? Is there a self-serve product, or is TecHaust strictly a services and implementation firm?
3. Is the www → apex canonical set up in **Google Search Console** (Domain property)? Has the sitemap been submitted? Search results still show `www.techaust.com` and an old "digital marketing" description.
4. Is there a **Google Business Profile** for the Balurghat office? Should a public phone number be shown (it is needed for LocalBusiness/NAP consistency)?
5. Primary target market: India (`en_IN`, INR examples) or US/global (USD in the calculator, `en_US`)?
6. Is `app/loading.tsx` needed for any genuinely slow route? If not, removing it fixes P1 and S4 together.
7. Can HTML be edge-cached (no per-user content)? Is there a reason for `no-store` on marketing pages?
8. Can someone run PageSpeed Insights / Search Console Core Web Vitals manually (or provide a PSI API key), so lab scores and CrUX field data can be attached? The anonymous quota was exhausted during this audit.
9. Should the Cloudflare minimum TLS version be raised to 1.2 (this needs a dashboard check; I did not access it)?
10. The privacy policy has no mention of India's DPDP Act 2023 and no Grievance Officer (IT Rules 2011). Is legal review planned? (VERIFY WITH CA/LEGAL; not legal advice.)
11. Homepage hero numbers ("2,847 docs indexed", "258 threats blocked", the live "8ms ping") are simulated. Should they be labelled "demo"/"simulated" to avoid looking like real telemetry?
