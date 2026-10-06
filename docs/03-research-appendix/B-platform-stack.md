# TecHaust platform research: marketing site + admin/client portal (as of 2026-10-06)

**Legend:** **[S]** = sourced fact (URL given, checked 2026-10-06 unless another date is shown). **[I]** = my inference or recommendation. **[?]** = uncertain or conflicting; check again before you commit.
**FX assumption [I]:** US$1 ≈ ₹90. All ₹ figures are rough. (A rough per-appendix assumption: this appendix uses ₹90, [appendix A](A-payments.md) uses ₹88, and [05](../05-architecture.md) uses 88.42.)
**Assumed scale [I]:** 10–50k visits/month, about 50 invoices or proposals a month, about 2k transactional emails a month, a database under 1 GB, files under 10 GB, 2–5 staff users, and fewer than 100 portal clients.

> **Outcome (research record).** Decisions differ from this appendix's recommendations: the **Free** Workers plan with browser-side Argon2id and a server HMAC ([03 §3C.4](../03-plan.md), [ADR 0001](../adr/0001-cloudflare-free-plan.md), [ADR 0004](../adr/0004-in-house-auth.md)) instead of Workers Paid and Better Auth; a React SPA + Hono API ([ADR 0003](../adr/0003-spa-plus-hono.md)) instead of React Router framework mode; Amazon SES ([ADR 0007](../adr/0007-ses-aws4fetch.md)) instead of Cloudflare Email Service or Resend. Public-site forms do not "write to D1" (§2): the site has no database binding, and forms go web → Queue only ([ADR 0002](../adr/0002-static-astro-site.md)). Where this appendix and [05](../05-architecture.md) differ, **05 wins**; see also [05-A](../05-research-appendix/A-stack-verification.md) for the Free-plan checks.

---

## 0. TL;DR

- **The free Workers plan won't be enough. Budget for Workers Paid at $5/month (about ₹450).** Two hard blockers: (a) Better Auth's scrypt password hashing takes 73–170 ms of CPU, and the free plan allows 10 ms per request; (b) Browser Run (the new name for Browser Rendering) gives free accounts only 10 minutes a day, and Cloudflare's own email *sending* is paid-only. **[S]** (sources in §1 and §4)
- **Recommendation [I]: Option A, all-Cloudflare.** Astro 6 for the public site. React Router (framework mode) on Workers for admin and portal. D1 + Drizzle for the database, R2 for files, Better Auth for login, with Cloudflare Access in front of the admin. Browser Run renders HTML templates to PDF. Email goes through Cloudflare Email Service or Resend. Expected cost: **about $5–8/month (₹450–720)**.
- **Data residency:** D1 has **no India location** (the closest hint is `apac`). **The DPDP Act doesn't require localisation.** It uses a negative list, and the cross-border rule only takes effect on 13 May 2027. **VERIFY WITH CA/LEGAL**; see [08-B §1](../08-research-appendix/B-dpdp-legal.md) (the SPDI Rules apply now). If a client contract does require India residency, switch the DB to **Supabase Mumbai (ap-south-1) through Hyperdrive** (Option B2, about ₹2.7k/month) or move to a **VPS in Mumbai or Bangalore** (Option C).

---

## 1. Cloudflare developer platform (2026)

### Workers plans
| Item | Free | Paid ($5/mo) | Source |
|---|---|---|---|
| Requests | 100,000/day | 10M/mo included, then $0.30/M | [S] https://developers.cloudflare.com/workers/platform/pricing/ |
| CPU per HTTP request | **10 ms** | default 30 s, max 5 min; 30M CPU-ms/mo included, then $0.02/M | [S] same + https://developers.cloudflare.com/workers/platform/limits/ |
| CPU per Cron or Queue consumer | 10 ms (cron); queue consumers: 10 ms (assumed; [05-A #11](../05-research-appendix/A-stack-verification.md)) | 30 s for crons under hourly, 15 min for hourly or longer; queue consumers up to 15 min | [S] limits page |
| Subrequests | 50/request | 10,000/request | [S] limits page |
| Memory | 128 MB per isolate | 128 MB | [S] |
| Worker size | **64 MiB uncompressed, on both plans** ("There is no compressed size limit") | 64 MiB | [S] limits page. This is a 2026 change; the old 3 MB/10 MB compressed limits are gone. |
| Workers per account | 100 | 500 | [S] |
| Cron Triggers per account | 5 | 250 | [S] |
| Static asset files per version | 20,000 | 100,000 (25 MiB per file) | [S] |
| Static asset requests | free and unlimited | free and unlimited | [S] pricing page |

### Pages vs Workers static assets
- [S] Cloudflare's migration guide **doesn't call Pages deprecated**. It presents Workers as having "a distinctly broader set of features". https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- [S, secondary] Third-party write-ups from 2026 say Pages is being *absorbed* into Workers rather than shut down. They also say Workers reached feature parity in March 2026 and Cloudflare no longer recommends Pages for new full-stack projects: https://cogley.jp/articles/cloudflare-pages-to-workers-migration , https://mecanik.dev/en/posts/cloudflare-pages-vs-workers-which-to-use-in-2026/
- [S] **The Astro Cloudflare adapter (v13, Astro 6) has dropped Pages entirely**: "no longer supports deployment on Cloudflare Pages… migrate to Cloudflare Workers." https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- [I] **Use Workers + static assets for everything new.** Treat Pages as legacy.

### D1 (SQLite)
- [S] Free tier: 5M rows read/day, 100k rows written/day, 5 GB total. Paid: 25B reads/month included ($0.001/M after), 50M writes/month included ($1/M after), 5 GB included then $0.75/GB-month. https://developers.cloudflare.com/workers/platform/pricing/
- [S] Limits: max database size **500 MB on free, 10 GB on paid**; 10 databases on free vs 50,000 on paid; 50 vs 1,000 queries per invocation. https://developers.cloudflare.com/d1/platform/limits/
- [S] **Time Travel (point-in-time restore)** is always on and free. You can restore to any minute in the last **7 days (free) or 30 days (paid)**. For longer retention, Cloudflare documents exporting to R2 with Workflows or the REST API. https://developers.cloudflare.com/d1/reference/time-travel/
- [S] Location hints are wnam, enam, weur, eeur, **apac** and oc. Jurisdictions are eu, us and fedramp. **There's no India option.** Read replication is available. https://developers.cloudflare.com/d1/configuration/data-location/
- [?] Cloudflare doesn't publish which city `apac` maps to.
- [I] `wrangler d1 export` produces a SQL dump. Schedule a nightly or weekly export to R2 to cover GST record-keeping beyond 30 days; CGST s.36 expects about 6 years of retention (that period is from general knowledge, not a source checked here; **superseded:** ≥ 8 years from FY end, default 10; [08 §6](../08-security-compliance.md), [08-A #13](../08-research-appendix/A-gst-invoicing.md); VERIFY WITH CA).

### Hyperdrive (connection pooling to an external Postgres)
- [S] Free plan: 100,000 queries/day. Paid: unlimited queries. Pooling and caching are included, with no egress charges. https://developers.cloudflare.com/hyperdrive/platform/pricing/

### R2 (object storage)
- [S, official pricing page; the bucketmate.app blog link is secondary] Free each month: 10 GB-month storage, 1M Class A ops, 10M Class B ops. After that: $0.015/GB-month, $4.50 per million Class A ops, $0.36 per million Class B ops. **Egress is free.** Infrequent Access costs $0.01/GB-month with a 30-day minimum and has no free tier. https://developers.cloudflare.com/workers/platform/pricing/ , https://www.bucketmate.app/blogs/cloudflare-r2-pricing-2026
- [S] Jurisdictions are limited to eu and fedramp. There's no India jurisdiction outside the Data Localization Suite (see §8).

### Queues, Cron, Durable Objects, Workflows
- [S] **Queues:** free 10,000 ops/day with fixed 24 h retention. Paid: 1M ops/month included, then $0.40/M, retention 4 days by default and up to 14. https://developers.cloudflare.com/workers/platform/pricing/
- [S] **Durable Objects:** free 100k requests/day and 13k GB-s/day, SQLite-backed only. Paid: 1M requests/month and 400k GB-s/month included. SQLite storage billing started in January 2026. Same page.
- [S] **Workflows:** free 3,000 steps/day, 1 GB-month storage, 10 ms CPU. Paid: 500k steps/month included, then $0.80 per 100k. **Step and storage billing start date: date not captured** (see the 2026-07-07 changelog). https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/ [?] Check that start date.
- [I] At our volume, Cron plus Queues cover reminders, dunning and webhook retries. Workflows suit multi-step jobs such as "generate PDF, store in R2, email client, log".

### Browser Run (formerly Browser Rendering): HTML to PDF
- [S] Renamed to **Browser Run**. It has a `/pdf` Quick Action (REST API, or a Worker binding with no token), and you can also drive it with Puppeteer or Playwright. https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- [S] Pricing. Free: **10 min/day**, 3 concurrent browsers. Paid: **10 h/month included**, then $0.09/h; 10 concurrent browsers (monthly average), then $2 per extra browser. https://developers.cloudflare.com/browser-run/pricing/
- [S] Limits. Free: Quick Actions 1 per 10 s, new browser 1 per 20 s, 60 s timeout. Paid: 30 Quick Actions/s, 200 concurrent, timeout extendable to 10 min. https://developers.cloudflare.com/browser-run/limits/
- [I] One invoice takes about 2–5 s of browser time, so 50–200 PDFs/month is about 5–15 minutes. That's well inside the 10 included hours.

### Email from Workers (Cloudflare Email Service)
- [S] **Email Sending entered public beta on 2026-04-16** and needs Workers Paid. You call `env.EMAIL.send()` or the REST API. HTML, attachments, inline images and custom headers all work. https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/
- [S] Pricing: **3,000 emails/month included, then $0.35 per 1,000.** Not available on the free plan, except sending to verified addresses in your own account. Inbound Email Routing is unlimited on both plans. https://developers.cloudflare.com/email-service/platform/pricing/
- [S] SPF, DKIM and DMARC are configured automatically (per secondary sources, e.g. https://whichdevtool.com/tools/cloudflare-email-service/). [?] It's still a beta, so the price is provisional.

### Security and edge
- [S] **Turnstile:** free, unlimited challenges, 20 widgets, 10 hostnames per widget. https://developers.cloudflare.com/turnstile/plans/
- [S] **Rate Limiting binding:** GA since 2025-09-19, works on Free and Paid with 10 s or 60 s periods. https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/ (Free/Paid availability as described in secondary sources)
- [S, official docs; the blazingcdn.com link is a secondary blog] **WAF on the free zone plan:** Free Managed Ruleset, **5 custom rules**, and 1 rate-limiting rule (10 s window, keyed by IP). https://developers.cloudflare.com/waf/custom-rules/ , https://blog.blazingcdn.com/en-us/understanding-cloudflares-rate-limiting-pricing
- [S, secondary] **Zero Trust / Access free plan:** up to 50 users, Access (ZTNA) included, 24 h log retention. Pay-as-you-go is $7 per user per month. Source is secondary: https://costbench.com/software/business-vpn/cloudflare-zero-trust/free-plan/ [?] Cloudflare's own plan page didn't render the table, so confirm in the dashboard.
- [I] Put **admin.techaust.com** behind Access with email OTP or Google login for staff. Leave the **portal** subdomain on app-level auth only, because clients shouldn't have to go through Access.

### Observability
- [S] **Workers Logs.** Free: 200k events/day, 3-day retention. Paid: 20M/month included, then $0.60/M, 7-day retention. **From 2026-12-01 this moves to "Cloudflare Observability" pricing** (resolved in [05-A #13](../05-research-appendix/A-stack-verification.md): Free = 0.5 GB ingestion/day, 7-day retention). https://developers.cloudflare.com/workers/observability/logs/workers-logs/ [?] The new pricing isn't known yet.

### Astro and Cloudflare
- [S] **Cloudflare acquired The Astro Technology Company on 2026-01-16.** Astro stays open source. https://www.businesswire.com/news/home/20260116386991/en/Cloudflare-Acquires-Astro-to-Accelerate-the-Future-of-High-Performance-Web-Development
- [S] **Astro 6.0 shipped on 2026-03-10.** The rebuilt `@astrojs/cloudflare` adapter runs workerd in dev, prerender and production, and bindings work locally through `cloudflare:workers`. https://astro.build/blog/astro-6/
- [S] `Astro.request.cf?.country` gives the visitor's country. Sessions are auto-wired to KV. The default image service is now `cloudflare-binding`. https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- [I] For INR/USD pricing: prerender the pricing pages and fill the currency block with a **server island** or a tiny Worker endpoint that reads `cf.country`. That keeps pages cacheable and fast for Core Web Vitals. Add a manual currency toggle too, because VPNs and NRI visitors will be misdetected.

---

## 2. Frameworks

| Framework | Status (2026) | Content/SEO site | Admin app on Workers | Notes |
|---|---|---|---|---|
| **Astro 6** | Stable since 2026-03-10; now owned by Cloudflare [S] | **Best fit** [I] | Possible but awkward for a heavy CRUD UI [I] | Zero JS by default, content collections, MDX, islands |
| **Next.js 16 via OpenNext** | Adapter supports all Next 16 minors; Next 16.2 Adapter API stable (March 2026) [S] https://opennext.js.org/cloudflare , https://nextjs.org/blog/nextjs-across-platforms | Good | Good | Larger bundles and more CPU; Node Middleware is a gap [S]; more moving parts [I] |
| **vinext** (Cloudflare's Vite re-implementation of Next) | README says **"not yet a drop-in replacement"** and recommends OpenNext for mature production [S] https://github.com/cloudflare/vinext | Avoid for now | Avoid for now | [?] Some blogs call it "1.0 stable", but the README contradicts them |
| **React Router v7/v8 (framework mode)** | **v8 released 2026-06-17**; needs Node 22.22+, React 19.2.7+, Vite 7+; uses the Cloudflare Vite plugin; v7 still gets security fixes; RSC still unstable [S] https://remix.run/blog/react-router-v8 | OK | **Best fit** [I] | Loaders and actions suit forms and CRUD; resource routes handle webhooks and PDF endpoints |
| **TanStack Start** | [?] Conflicting. Some 2026 blogs say v1.0 went stable in March 2026, but tanstack.com still shows an **"RC"** badge today [S] https://tanstack.com/start/latest | OK | Good | Cloudflare is an official partner [S]; type-safe; still fast-moving [I] |
| **SvelteKit** | Stable, with an official Cloudflare adapter [I] | Good | Good | Team skills matter more here; React has the larger hiring pool [I] |
| **Hono** | Stable, Workers-native [I] | n/a | Good as the **API, webhook, cron and queue** layer | Pair it with a React SPA, or mount it beside React Router [I] |

**[I] Recommendation:**
- `apps/site`: **Astro 6**, mostly static, with server islands for currency and forms. Forms post to a Worker endpoint that checks Turnstile, applies the rate-limit binding, writes to D1 and sends email. *[Superseded: the site has no D1 binding; forms go web → Queue only, ADR 0002.]*
- `apps/admin`: **React Router (framework mode)** on Workers. It serves both admin and client portal, split by role. Add `scheduled()` and `queue()` handlers in the same Worker, or a small separate Hono "jobs" Worker.
- Use a **monorepo** (pnpm workspaces): `packages/db` (Drizzle schema and migrations), `packages/pdf` (HTML invoice templates), `packages/email`, `packages/ui`, `packages/gst` (pure tax functions with unit tests). Deploy as separate Workers. They can bind the same D1 database (the site writes leads; the admin owns the rest). A monorepo keeps shared types and schema in one place, and separate Workers keep deploys and risk independent.

---

## 3. Databases and ORM

| DB | Free tier | Paid entry | India/near region | Backups/PITR | Source |
|---|---|---|---|---|---|
| **Cloudflare D1** | 5 GB account, 500 MB per DB | Included with Workers $5; DB max 10 GB | **No India**; `apac` hint | Time Travel 7 d (free) / 30 d (paid), free; export to R2 | [S] §1 |
| **Neon** (Databricks-owned since 2025) | 100 projects, **1 GB per project** (20 GB total), 100 CU-h per project, **6 h PITR**, scale-to-zero after 5 min | Launch: $0.106/CU-h, $0.35/GB-month, **no monthly minimum** (since Dec 2025), up to 7 d PITR (restore history $0.20/GB-month) | **Singapore (aws-ap-southeast-1)**; **no Mumbai** | Instant restore (branch-based) | [S] https://neon.com/docs/introduction/plans , https://neon.com/docs/introduction/regions , https://neon.com/pricing |
| **Supabase** | 2 projects, 500 MB DB, 5 GB egress, 50k MAU; **paused after 7 days of low DB activity**; **no backups** | **Pro $25/month** (includes $10 compute credit, enough for one Micro), 8 GB disk, **daily backups kept 7 d**; PITR add-on **$100/month per 7 d** | **Mumbai ap-south-1** and Singapore | Daily (Pro), PITR is a costly add-on | [S] https://supabase.com/pricing , https://supabase.com/docs/guides/platform/regions , https://supabase.com/docs/guides/platform/free-project-pausing |
| **Turso** (libSQL) | 100 DBs, 5 GB, 500M reads, 10M writes | Developer $4.99/month | [?] Region list not checked | [?] PITR days not checked | [S] https://turso.tech/pricing |
| **Xata** | **No free tier any more** (trial with $100 credit for 14 days) | about $0.012/h plus $0.28/GB-month | [?] | Copy-on-write branches | [S, secondary] https://layerbase.com/blog/xata-alternatives |

**ORM**
- [S] **Drizzle** runs natively on Workers with D1 and with Postgres (Neon or `pg` through Hyperdrive). **1.0 is still at release candidate** (rc.1 on 2026-04-30, rc.2 on 2026-05-05; final not out as of late September). https://orm.drizzle.team/roadmap , https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- [S] **Prisma 7** reaches D1 through `@prisma/adapter-d1`, a Rust-free driver adapter. **The D1 adapter is still labelled Preview.** https://www.prisma.io/docs/guides/v7/deployment/cloudflare-d1
- [I] **Pick Drizzle.** It's lighter, has no codegen step, and supports both SQLite and Postgres. Migrating from D1 to Postgres later still means porting the schema dialect (types, defaults, JSON); moderate work, not free.
- [I] Store money as **integer paise/cents**, keep the GST split (CGST+SGST vs IGST, plus zero-rated exports under LUT) in a tested pure-function package, and make invoices immutable once issued: snapshot the line items and store the PDF in R2 with a hash.

---

## 4. Auth

- [S] **Better Auth.** 1.5 (2026-02-28) added **native D1 support** (pass `env.DB` directly), 2FA improvements and organisation features. **1.7 (Aug 2026)** added OTP or TOTP 2FA, better passkeys, and OIDC SSO that works on Workers. The 1.7 notes say **SCIM isn't supported on D1** because D1 lacks the transactions it needs. https://better-auth.com/blog/1-5 , https://better-auth.com/blog/1-7 . Docs (via Context7) show `betterAuth({ database: env.DB })` and running programmatic migrations from a Worker endpoint. A community package also exists: https://www.npmjs.com/package/better-auth-cloudflare
- [S] **CPU problem:** one Better Auth scrypt `hashPassword()` takes about **73–170 ms of CPU on Workers**, which doesn't fit the free plan's 10 ms. Using native `node:crypto` scrypt helps but still needs Workers Paid. https://github.com/better-auth/better-auth/issues/8860 , https://github.com/SailorDave17/madcowsailing.com/pull/245
- [S] **Auth.js** has been maintained by the Better Auth team since 2025-09-22. They recommend Better Auth for new projects. https://better-auth.com/blog/authjs-joins-better-auth
- [S] **Lucia** was deprecated in March 2025 and is now a learning resource. https://github.com/lucia-auth/lucia/discussions/1714
- [S] **Clerk:** Hobby is free up to 50k MRU per app but has **no MFA**. Pro costs $25/month ($20/month billed annually). https://clerk.com/pricing
- [S] **Kinde:** free up to 10,500 MAU; paid plans from $25/month. https://www.kinde.com/pricing/ (secondary)
- [S] **Supabase Auth:** 50k MAU free; Pro includes 100k MAU. https://supabase.com/pricing
- [I] **Pick Better Auth on D1 with Drizzle.** Plugins to use: 2FA with TOTP and backup codes, passkeys, organization with roles (owner/admin/staff/client), and admin. Users live in your own DB with no per-MAU fees. For portal clients, offer **email OTP or magic link** so most clients never need a password. Add **Cloudflare Access** in front of the staff admin as a second layer.

---

## 5. PDF generation (branded invoices with ₹ and custom fonts)

| Option | Runs on Workers? | Fidelity / DX | Cost | Notes |
|---|---|---|---|---|
| **Browser Run (HTML/CSS to PDF)** | Yes, through the binding or `/pdf` [S] | Best: full CSS, print media, same templates as web/email [I] | Covered by the $5 plan at our volume [S/I] | Embed fonts with `@font-face` (base64 or URL) per Cloudflare's custom-fonts docs [S] https://developers.cloudflare.com/browser-rendering/features/custom-fonts ; needs a paid plan for reliability (free is 10 min/day) |
| **pdf-lib** (+ @pdf-lib/fontkit) | Yes, pure JS [S] https://github.com/Hopding/pdf-lib , https://pdf4.dev/blog/pdf-generation-cloudflare-workers | You position every element yourself; tedious for complex layouts [S] | Free | **You must embed a TTF that contains U+20B9 (₹).** The standard 14 fonts can't render it [I]. Good fallback for simple receipts. `pdfme` adds a template layer [S] |
| **@react-pdf/renderer** | **Not out of the box.** yoga-layout WASM fails with "Wasm code generation disallowed" on workerd. Issue #2757 is **open**; the workaround patches it to `yoga-layout/asmjs-sync` [S] https://github.com/diegomura/react-pdf/issues/2757 | Nice JSX DX | Free | Officially supported only on Node [S] https://react-pdf.org/compatibility . [I] Avoid on Workers unless you accept maintaining a patch |
| **pdfmake** | [?] Not checked on workerd; pure JS, so it probably works [I] | Declarative JSON | Free | Fonts are embedded through a VFS [I] |
| **Typst (WASM)** | [?] The compiler WASM is about **27 MiB** uncompressed [S] https://github.com/nstarman/nstarman.github.io/pull/196 . That fits the new 64 MiB limit, but cold start, the 128 MB memory cap and CPU time make it risky [I] | Excellent typography | Free plus paid CPU | Experimental on Workers [I] |
| **Gotenberg** (self-host) | No; it's a Docker container [S] | Chromium + LibreOffice | VPS RAM: 500 MB+ idle, image over 1 GB [S] https://dev.to/iterationlayer/best-document-generation-apis-in-2026-492n | Good fit for Option C |
| **DocRaptor / PDFShift** | Called over HTTP | Prince engine (DocRaptor), Chromium (PDFShift) [S] | DocRaptor from $15/month for 125 docs; PDFShift from $9/month, free 50/month [S] https://orshot.com/blog/best-pdf-generation-apis | Extra vendor and data processor (relevant to DPDP) [I] |

**[I] Recommendation:**
- Write invoices, estimates and proposals as **HTML templates** in `packages/pdf`, using a self-hosted font with ₹ (Noto Sans, Inter, or the brand font if it has U+20B9).
- Render with **Browser Run** in a Queue or Workflow step, store the result in R2, and reuse the stored file.
- These templates are portable. They'd work unchanged with Gotenberg or Playwright on a VPS, which is your lock-in escape hatch.

---

## 6. Transactional email

| Provider | Free | Paid | India angle | Inbound | Source |
|---|---|---|---|---|---|
| **Cloudflare Email Service** | Not for arbitrary recipients on Free | Workers Paid: 3,000/month included, then $0.35 per 1,000; **beta** | Global | Email Routing unlimited (free) | [S] §1 |
| **Resend** | **3,000/month, 100/day**, 3 domains | Pro $20/month for 50k | Global | Included on all tiers | [S] https://resend.com/pricing |
| **Amazon SES** | **The SES-only free tier ended for new customers on 2026-07-21**; new AWS accounts get $200 in credits for 6 months | about $0.10 per 1,000; new Essentials/Pro/Enterprise plans | **Mumbai ap-south-1** (sending and receiving) | Yes, receiving supported in ap-south-1 | [S] https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/ , https://repost.aws/questions/QUgAnbrqjjTP-Ygt1PC73vPg/clarification-on-ses-inbound-email-support-s3-delivery-in-ap-south-1-region |
| **Zoho ZeptoMail** (now listed as Zoho CPaaS email) | First credit free (10k emails) | 1 credit = 10k emails, valid 6 months; historically about $2.50 per credit | Indian company, INR billing | n/a | [S] https://www.zoho.com/zeptomail/pricing.html . [?] **New pricing for sign-ups from 2026-07-01 isn't clearly published** |
| **Postmark** | 100/month | $15/month for 10k | Best deliverability reputation [I] | Yes [I] | [S] https://postmarkapp.com/pricing |

**[I] Advice:**
- Send from a subdomain such as `mail.techaust.com` or `notify.techaust.com`.
- Publish SPF and DKIM records from the provider.
- Start DMARC at `p=none` with reporting, then move to `quarantine` and `reject`.
- Keep your normal mailbox provider (e.g. Zoho Mail or Google Workspace) for the root domain's MX.
- Put sending behind an `EmailSender` interface so you can swap Cloudflare, Resend or SES.
- **Start with Cloudflare Email Service** (already covered by the $5 plan). Keep **Resend free** as the fallback. Use **SES Mumbai** if you want India-region processing.

---

## 7. Alternatives to all-Cloudflare

| Platform | Key facts | Fit [I] |
|---|---|---|
| **Vercel** | **Hobby is limited to "non-commercial personal use only"**, which explicitly includes "Advertising the sale of a product or service". A studio site therefore needs **Pro** (per-seat pricing; about $20 per member per month according to secondary sources) [S] https://vercel.com/docs/limits/fair-use-guidelines (updated 2026-09-14) | Poor value for a 2–5 person team |
| **Netlify** | Free plan (300 credits/month, hard stop) allows commercial use; Personal $9/month; Pro $20/month [S, secondary] https://costbench.com/software/cloud-infrastructure/netlify/ | OK for the static site; weak for the admin backend |
| **Railway** | Hobby $5/month includes $5 of usage [S] https://docs.railway.com/pricing | Easy Node + Postgres; [?] no India region checked |
| **Render** | Free web services sleep after 15 min (about 1 min cold start) [S] https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026 | Paid services from about $7/month [S, secondary] |
| **Fly.io** | Mumbai (`bom`) region; shared 256 MB VM from about $1.94/month; **India egress $0.12/GB** [S, secondary] https://getdeploying.com/flyio | Workable, but billing is fiddly |
| **AWS Lightsail Mumbai** | $5 (0.5 GB), $7 (1 GB), **$12 (2 GB)**, $24 (4 GB); **Mumbai gets half the transfer allowance**; managed DB from $15 [S] https://aws.amazon.com/lightsail/pricing/ | Good **India-residency** VPS |
| **DigitalOcean** | Basic droplet $6 (1 GB); managed Postgres from about $15.15 [S, secondary] https://costbench.com/software/cloud-infrastructure/digitalocean/ | Bangalore (BLR1) region [I] |
| **Hetzner** | **Three price rises in 2026** (April, June…); CX/CAX are EU-only; Singapore exists; **no India**; shared plans shown as "not available" as of 2026-09-04 [S, secondary] https://northflank.com/blog/hetzner-cloud-server-price-increases , https://webhosting.today/2026/05/29/hetzner-has-now-raised-prices-three-times-in-2026-this-one-is-different/ | No longer the obvious cheap pick |

---

## 8. Data protection (DPDP) and residency

- [S] The **DPDP Rules 2025 are Gazette-dated 13 November 2025 (PIB announced them on 14 November)** and phase in: Rule 4 (consent managers) from 2026-11-13; **core obligations (notice, security safeguards, breach reporting, retention and so on) from 2027-05-13** (aligned to [08-B §1](../08-research-appendix/B-dpdp-legal.md)). **VERIFY WITH CA/LEGAL**; the SPDI Rules apply now. https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap , https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf
- [S] **Cross-border transfers use a negative list.** Transfers are allowed unless the government restricts a country. There's **no general localisation requirement**, though sector rules and Significant Data Fiduciaries can have extra duties. **VERIFY WITH CA/LEGAL** (see [08-B §1](../08-research-appendix/B-dpdp-legal.md): SPDI Rules apply now; cross-border detail in 08-B §7). https://www.mondaq.com/india/data-protection/1844060/
- [S] Cloudflare's **Data Localization Suite** has an **India region** (TLS decrypted only in Indian data centres; R2 is compatible with Regional Services). https://developers.cloudflare.com/data-localization/region-support/ . [I] **DLS is an Enterprise add-on**, out of budget.
- [I] What to do before May 2027:
  - Keep a privacy notice and consent records for forms.
  - Write a data inventory: leads, clients, invoices, files.
  - Encrypt sensitive fields (PAN/GSTIN are fine in plain text; bank details are not).
  - Keep an audit log and set retention schedules.
  - Have a written breach-response procedure. Rules require notifying the Board and affected people, with a 72-hour detailed report.
  - Sign processor agreements (DPAs) with Cloudflare, the email provider and so on.
  - D1 in `apac` plus R2 is **legally fine under DPDP today**. Choose Option B2 or C only if clients contractually demand India residency. **VERIFY WITH CA/LEGAL**; see [08-B §1](../08-research-appendix/B-dpdp-legal.md) (the SPDI Rules apply now).

---

## 9. Three full-stack options

### Option A: all-Cloudflare (recommended)
Astro 6 (site) + React Router on Workers (admin and portal) + D1/Drizzle + R2 + Better Auth (+ Cloudflare Access on admin) + Browser Run PDFs + Cloudflare Email Service (Resend as fallback) + Cron/Queues/Workflows + Turnstile + Rate Limiting binding + Workers Logs. Payment-gateway webhooks (Razorpay/Stripe) go to a Worker route and are verified by HMAC [I].

### Option B: Cloudflare edge + managed Postgres
Same as A, but the database is **Postgres through Hyperdrive**:
- **B1: Neon Launch, Singapore.** Cheap and scale-to-zero, 7-day PITR. No India region.
- **B2: Supabase Pro, Mumbai.** India residency, daily backups. PITR costs an extra $100/month.

Drizzle stays; `pg` connects through Hyperdrive. Run a nightly `pg_dump` to R2 from a GitHub Actions cron (free) [I].

### Option C: VPS (Lightsail Mumbai or DigitalOcean Bangalore) with Docker
Astro static site on Cloudflare (free) or Netlify. The admin is Node (React Router or Hono) + Postgres in Docker + Gotenberg for PDFs + SES Mumbai for email + Caddy, all behind the Cloudflare free proxy. Backups are `pg_dump` plus restic to R2 or S3, plus provider snapshots.

### Monthly cost at our scale
| Line item | A: all-CF | B1: CF + Neon SG | B2: CF + Supabase Mumbai | C: VPS Mumbai/BLR |
|---|---|---|---|---|
| Hosting/compute | Workers Paid $5 | $5 | $5 | VPS 2–4 GB: $12–24 |
| Database | $0 (in plan) | about $3–6 (0.25 CU, scale-to-zero, about 1 GB, 7 d history) [I] | $25 (Pro, Micro covered by credit) | $0 (self-hosted) |
| File storage | R2 $0 (<10 GB) | $0 | $0 | R2 or local: $0–1 |
| PDFs | Browser Run $0 (<10 h) | $0 | $0 | Gotenberg (needs the larger VPS) |
| Email (~2k/month) | $0 (3k included) | $0 | $0 | SES about $0.20 |
| Auth / 2FA | $0 (Better Auth) | $0 | $0 | $0 |
| Backups | $0 (Time Travel + R2 export) | $0 (R2) | $0 (daily, 7 d) | Snapshots about $1–5 |
| WAF/Access/Turnstile | $0 | $0 | $0 | $0 (CF free in front) |
| **Total US$/month** | **about $5–8** | **about $8–12** | **about $30** | **about $15–30** |
| **Total ₹/month** | **about ₹450–720** | **about ₹720–1,100** | **about ₹2,700** | **about ₹1,350–2,700** |

### Comparison
| | A | B1 | B2 | C |
|---|---|---|---|---|
| Complexity [I] | Low: one vendor, one deploy tool (wrangler) | Low–medium: two vendors, Hyperdrive | Low–medium | **High:** OS patching, Docker, TLS, backups, monitoring |
| Scalability [I] | Very high; D1 caps at 10 GB per DB (fine for years) | High | High | Vertical; you manage it |
| Maintainability [I] | Best: no servers; workerd in dev (Astro 6, CF Vite plugin) | Good | Good | Depends on discipline; about 2–4 h/month of ops |
| Lock-in [I] | **Medium–high** (D1, bindings, Browser Run, Email Service). Reduced by Drizzle, Better Auth, HTML templates and an email interface | Medium (DB portable) | Medium (Supabase is open source Postgres) | **Low** |
| Data residency | D1 `apac` / R2 global. **Not India** [S] | **Singapore** [S] | **Mumbai** [S] | **India** (Mumbai/Bangalore) |
| Backups/PITR | 7-day (Free) / 30-day (Paid) minute-level Time Travel + R2 exports [S] | 7 d instant restore [S] | Daily, 7 d (PITR $100) [S] | DIY |
| Dev/prod parity | Excellent (workerd everywhere) [S] | Good | Good | Excellent (Docker) |

### Recommendation [I]
1. **Go with Option A** on Workers Paid ($5). It costs the least and has the lowest ops burden. Cloudflare now owns Astro and puts its weight behind Workers (Pages is being absorbed). You're already on Cloudflare, so the migration cost is near zero.
2. **Build for portability from day one:**
   - Drizzle schema in `packages/db`.
   - Better Auth, so users stay in your own DB.
   - HTML/CSS PDF templates, so the renderer can be swapped.
   - An `EmailSender` interface.
   - Nightly D1 export to R2 (and a copy outside Cloudflare, e.g. Backblaze/S3 or a Google Drive sync, for the 6-year GST retention; **superseded:** ≥ 8 years from FY end, default 10, [08 §6](../08-security-compliance.md), [08-A #13](../08-research-appendix/A-gst-invoicing.md); VERIFY WITH CA).
3. **Escape hatch:** if an enterprise or government client requires India residency, move only the DB to **Supabase Mumbai through Hyperdrive** (B2), or the whole admin to **Lightsail Mumbai** (C). The site stays on Workers either way.
4. **Admin hardening:**
   - Cloudflare Access (free, up to 50 users) on `admin.`.
   - Better Auth with TOTP 2FA required for staff, plus passkeys.
   - Rate Limiting binding on auth routes; Turnstile on public forms.
   - Append-only audit-log table.
   - Webhook HMAC verification with idempotency keys.
5. **Re-check before committing (flagged [?]):**
   - TanStack Start stable vs RC.
   - Workflows step-billing start date.
   - Workers Logs move to Observability pricing on 2026-12-01 (resolved in [05-A #13](../05-research-appendix/A-stack-verification.md)).
   - Email Service beta pricing.
   - ZeptoMail post-July 2026 pricing.
   - Exact Zero Trust free-plan terms.
   - Which city D1 `apac` maps to.
