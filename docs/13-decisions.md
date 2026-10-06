# Decisions

One row per decision. A decided question is never asked again; to change one, add a new row that says what it replaces.
Who: **Owner** (Rupak Sarkar) or **Lead** (Claude, the lead conversation). Backfilled 2026-10-07 from the documents named in "Applied in"; nothing was added that isn't recorded there.

| Date | Decision | Who | Applied in |
|---|---|---|---|
| 2026-10-06 | Phases 1–3 (audit, services strategy, plan) approved | Owner | [01](01-audit.md), [02](02-services-strategy.md), [03](03-plan.md) |
| 2026-10-06 | Phase 4 product decisions Q-P3-1 … Q-P3-8, Q-B12 … Q-B16, contact, identity, blog, SLAs, team, numbering (one row each in that table) | Owner | [04 §0](04-prd.md) |
| 2026-10-06 | Phase 4 documentation (04–09) approved | Owner | [04](04-prd.md), [09](09-roadmap.md) |
| 2026-10-06 | Phase 5 (setup and tooling) approved | Owner | [09 Phase 5](09-roadmap.md), [10 §6](10-tooling.md) |
| 2026-10-06 | R2, Turnstile and Access deferred at setup (Access since decided below) | Owner | [runbooks/environments.md](runbooks/environments.md) |
| 2026-10-06 | Renovate: app not installed yet; **open**, needs the owner's approve/decline | Owner | [09 Phase 5](09-roadmap.md), [12-status](12-status.md) |
| 2026-10-06 | All-Cloudflare on the Workers Free plan | Owner | [ADR 0001](adr/0001-cloudflare-free-plan.md) |
| 2026-10-06 | Static Astro site + hand-written `/api` Worker | Owner | [ADR 0002](adr/0002-static-astro-site.md) |
| 2026-10-06 | React SPA + Hono per realm (admin, portal) | Owner | [ADR 0003](adr/0003-spa-plus-hono.md) |
| 2026-10-06 | In-house auth instead of Better Auth | Owner | [ADR 0004](adr/0004-in-house-auth.md) |
| 2026-10-06 | D1 + Drizzle, integer money, triggers for immutability | Owner | [ADR 0005](adr/0005-d1-drizzle-integers.md) |
| 2026-10-06 | PDFs via Browser Run | Owner | [ADR 0006](adr/0006-pdf-browser-run.md) |
| 2026-10-06 | Email via Amazon SES (ap-south-1) + aws4fetch | Owner | [ADR 0007](adr/0007-ses-aws4fetch.md) |
| 2026-10-06 | Payment provider interface; verified webhooks only | Owner | [ADR 0008](adr/0008-payment-provider-interface.md) |
| 2026-10-06 | Production deploys owner-only, manual | Owner | [ADR 0009](adr/0009-owner-only-prod-deploy.md) |
| 2026-10-06 | Tax and legal rules are settings | Owner | [ADR 0010](adr/0010-tax-legal-as-settings.md) |
| 2026-10-06 | New Worker names (`techaust-platform-*`); `techaust-web` untouched | Owner | [ADR 0011](adr/0011-worker-names.md) |
| 2026-10-06 | Repository public, `main` protected, fork-safe workflows | Owner | [ADR 0012](adr/0012-public-repository.md) |
| 2026-10-06 | Phase 5 tools T1–T12 approved | Owner | [10-tooling.md](10-tooling.md) |
| 2026-10-06 | New brand identity "Patina" replaces the supplied logo | Owner | [ADR 0013](adr/0013-new-brand-identity.md), [11](11-brand-audit.md) |
| 2026-10-06 | Amount in words: "Rupees … and … Paise Only" / "US Dollars … and … Cents Only"; negatives shown with a minus sign (−₹1,000.00) | Owner | `packages/core`, [09 M1.2](09-roadmap.md) |
| 2026-10-06 | fast-check and coverage-v8 approved as dev tools | Owner | [09 M1.2](09-roadmap.md) |
| 2026-10-06 | Staging D1 migrated and seeded automatically on every merge | Owner | `.github/workflows/deploy-staging.yml` |
| 2026-10-06 | Seed prices taken from docs/02 | Owner | `packages/db/src/seed/` |
| 2026-10-06 | `issue_guard` view added so document numbering can't leave gaps | Lead | `packages/db/src/triggers.ts` |
| 2026-10-06 | Cloudflare Access on staging for admin@techaust.com only | Owner | `docs/runbooks/access-staging.md` (in PR #7) |
| 2026-10-06 | Jobs Worker: Access plus a webhook bypass (added in M6) | Owner | `docs/runbooks/access-staging.md` (in PR #7) |
| 2026-10-06 | Auth benchmark runs from an owner-only GitHub workflow with an Access service token | Owner | `.github/workflows/bench-auth.yml`, `docs/runbooks/cpu-baseline.md` (in PR #7) |
| 2026-10-06 | M1.1, M1.2, M1.3 approved | Owner | [12-status.md](12-status.md), [09](09-roadmap.md) |
| 2026-10-07 | Lead runs on Opus 5.5 at medium effort (picked in the app, not pinned); builders on Sonnet; reviewer on Opus at high effort | Owner | [CLAUDE.md](../CLAUDE.md), `.claude/agents/` |
| 2026-10-07 | Two builders at once, each in its own worktree, on this 8 GB PC; heavy commands queued; low-memory alarm and queue pause at 512 MB free (the PC idles at about 1.1 GB free) | Owner | `tools/heavy.sh`, `tools/watch.sh` |
| 2026-10-07 | The reviewer checks every task before it merges | Owner | `.claude/agents/reviewer.md` |
| 2026-10-07 | Every PR merges itself when CI passes (GitHub auto-merge turned on). Milestones are approved by looking at staging; PR #7 still waits for "Access is on" | Owner | [CLAUDE.md](../CLAUDE.md) |
| 2026-10-07 | Names from the owner's standard setup (builder, reviewer, start-session, end-session, `tools/heavy.sh`) replace the first draft | Owner | `.claude/` |
| 2026-10-07 | Past decisions backfilled into this file from the existing documents | Owner | this file |
| 2026-10-07 | The status lives in `docs/12-status.md` (CLAUDE.md holds rules only); `docs/09-roadmap.md` stays the plan | Lead | [12-status.md](12-status.md) |
| 2026-10-07 | Documentation naming: numbered `NN-name.md` + `NN-name-appendix/`; `STATUS.md` → `12-status.md`, `DECISIONS.md` → `13-decisions.md` (replaces the names from the owner's other project) | Owner | [CLAUDE.md](../CLAUDE.md) |
| 2026-10-07 | S16 "first month included at launch" dropped | Owner | [02](02-services-strategy.md) |
| 2026-10-07 | S12 model usage billed at cost | Owner | [02](02-services-strategy.md), [07](07-content.md) |
| 2026-10-07 | Annual care-plan prepayment discount: 10 % | Owner | [02](02-services-strategy.md), [07](07-content.md) |
| 2026-10-07 | Small-job (100 % upfront) threshold is INR-led (under ₹1 L, any currency) and an editable setting `small_job_threshold` | Owner | [04 ADM-SET-05](04-prd.md), [07](07-content.md) |
| 2026-10-07 | Long-term (10-year) monthly backups hold finance/GST tables only; leads and contacts only in rolling 35–90-day backups (VERIFY WITH CA/LEGAL) | Owner | [08 §6.1](08-security-compliance.md), [07-A](07-content-appendix/A-legal-pages.md) |
| 2026-10-07 | Newsletter proof of consent kept 3 years after unsubscribe (VERIFY WITH CA/LEGAL) | Owner | [07-A](07-content-appendix/A-legal-pages.md) |
| 2026-10-07 | EU/UK privacy section; controller "TecHaust Technologies (Rupak Sarkar, proprietor)" (VERIFY WITH LEGAL) | Owner | [07-A](07-content-appendix/A-legal-pages.md) |
| 2026-10-07 | G-11 credit-note cut-off also stops at the annual-return filing date if earlier (VERIFY WITH CA) | Owner | [08 G-11](08-security-compliance.md) |
| 2026-10-07 | Exact reproduction steps for live-site weaknesses redacted from the public audit appendix | Owner | [01-A](01-audit-appendix/A-code-build-security.md) |
| 2026-10-07 | Founder's personal social handles replaced by a description in the audit appendices | Owner | [01-B](01-audit-appendix/B-content-design.md), [01-C](01-audit-appendix/C-live-perf-seo-a11y.md) |
| 2026-10-07 | A document waiting for approval can't be issued; issue = drafts only (DB guard narrowed in a later migration) | Owner | [05 §5.4](05-architecture.md) |
| 2026-10-07 | Public price snapshot includes catalogue default-line names and prices (care-plan tiers, S11 setup/monthly) | Owner | [04 ADM-CAT-05](04-prd.md) |
| 2026-10-07 | Audit summary corrected: git history was not scanned (the appendix said so) | Lead | [01](01-audit.md) |
| 2026-10-07 | Documentation quality pass: six read-only reviewers + two builders; meaning changes asked, the rest fixed | Lead | [runs/docs-quality-pass.md](runs/docs-quality-pass.md) |
| 2026-10-07 | `/accessibility` added as its own legal page, per 08 L-15 | Lead | [04 WEB-LEGAL](04-prd.md), [07-A §8](07-content-appendix/A-legal-pages.md) |
| 2026-10-07 | 04 §12 owner-inputs table folded into 07 §9 (single list) | Lead | [04 §12](04-prd.md), [07 §9](07-content.md) |
| 2026-10-07 | Credit/debit notes and statements are sent from `billing@` (same family as invoices and receipts, Q-P3-5) | Lead | [06](06-design-system.md) PDF footer and supplier note |
