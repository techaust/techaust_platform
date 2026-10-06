# Decisions

One row per decision. A decided question is never asked again; to change one, add a new row that says what it replaces.
Who: **Owner** (Rupak Sarkar) or **Lead** (Claude, the lead conversation). Backfilled 2026-10-07 from the documents named in "Applied in"; nothing was added that isn't recorded there.

| Date | Decision | Who | Applied in |
|---|---|---|---|
| 2026-10-06 | Phases 1–3 (audit, services strategy, plan) approved | Owner | [01](01-audit.md), [02](02-services-strategy.md), [03](03-plan.md) |
| 2026-10-06 | Phase 4 product decisions Q-P3-1 … Q-P3-8, Q-B12 … Q-B16, contact, identity, blog, SLAs, team, numbering (one row each in that table) | Owner | [04 §0](04-prd.md) |
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
| 2026-10-06 | M1.1, M1.2, M1.3 approved | Owner | [STATUS.md](STATUS.md) |
| 2026-10-07 | Lead runs on Opus 5.5 at medium effort (picked in the app, not pinned); builders on Sonnet; reviewer on Opus at high effort | Owner | [CLAUDE.md](../CLAUDE.md), `.claude/agents/` |
| 2026-10-07 | Two builders at once, each in its own worktree, on this 8 GB PC; heavy commands queued; low-memory alarm and queue pause at 512 MB free (the PC idles at about 1.1 GB free) | Owner | `tools/heavy.sh`, `tools/watch.sh` |
| 2026-10-07 | The reviewer checks every task before it merges | Owner | `.claude/agents/reviewer.md` |
| 2026-10-07 | Every PR merges itself when CI passes (GitHub auto-merge turned on). Milestones are approved by looking at staging; PR #7 still waits for "Access is on" | Owner | [CLAUDE.md](../CLAUDE.md) |
| 2026-10-07 | Names from the owner's standard setup (builder, reviewer, start-session, end-session, `tools/heavy.sh`) replace the first draft | Owner | `.claude/` |
| 2026-10-07 | Past decisions backfilled into this file from the existing documents | Owner | this file |
| 2026-10-07 | The status lives in `docs/STATUS.md` (CLAUDE.md holds rules only); `docs/09-roadmap.md` stays the plan | Lead | [STATUS.md](STATUS.md) |
