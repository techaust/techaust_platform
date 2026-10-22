# Skill-guided audit of earlier work (M1.1–M1.4, brand scripts) and fixes (2026-10-22)

```
Status: open: fixes
Tier: A (gap-free numbering trigger and migration; money tests)
Usage: reviewer claude-opus-5-5/high (audit; loaded workers-best-practices, wrangler, security-review, code-review, frontend-design with the Skill tool); builder and analyst: filled in when they run
```

## Audit result
1 high, 7 medium, 8 low. core 279/279 (99.77 %), db 44/44 green at audit time. Permission matrix, money maths, dates/FY, GSTIN check character, numbering formats, trigger coverage, CI fork-safety and supply-chain config: nothing to fix.

## Fix now (builder, Sonnet high; then the analyst's check because a trigger/migration changes, then the reviewer)
1. **HIGH: gap-free numbering can burn a number** (`packages/db/src/triggers.ts:94` guard allows `draft`/`pending_approval`; the reference batch in `packages/db/test/helpers.ts:86` and docs/05 §5.4 freezes only `status = 'draft'`, so a `pending_approval` issue advances `doc_counters` while the UPDATE matches 0 rows). The status page also has an older follow-up "narrow `issue_guard` to `draft` only (before M3/M5)". **Do:** one shared constant for the issuable statuses used by the guard and the reference batch, chosen to match docs/04 §9's approval flow (read it; if docs/04 means "approved documents are issued from `pending_approval`", keep both statuses in both places; if not, narrow to `draft`) — state your reading and stop to ask the lead if docs/04 is ambiguous; **plus a post-condition** in the same batch that aborts unless the document is now frozen with `number = next_no - 1` (an INSTEAD OF view like `issue_guard`, in a new custom migration via `scripts/write-triggers.ts`; never edit 0000–0006); update docs/05 §5.4. Tests: issuing a `pending_approval` document and a zero-row UPDATE both leave the counter unchanged; the normal issue still yields consecutive numbers (the 20-concurrent test).
2. **Seed conflict** (`packages/db/src/seed/index.ts:29`): `ON CONFLICT DO NOTHING` (no target), with a test that a changed code or reused slug doesn't fail the seed.
3. **Missing indexes**: `documents.project_id`, `documents.care_plan_id`, `approvals.document_id`, `acceptances.contact_id`, `leads.client_id`, `projects.owner_id`, `milestones.document_id` — new drizzle migration (indexes only, no rebuild; if drizzle-kit emits `__new_`, stop).
4. **Contrast test gaps** (`packages/ui/tokens/contrast.test.ts`): add `fill-subtle` (both themes) to the text backgrounds, `border-control` on `fill-subtle` (≥ 3:1), `selection`, `accent-decor` dark. Darken the light-theme `success` token just enough to pass 4.5:1 on `fill-subtle` (and keep every other pair passing), rebuild with `pnpm --filter @techaust/ui build:tokens`, commit the outputs; if `border-control` on `fill-subtle` can't reach 3:1 without a visible change, stop and report (design call).
5. **No-floats test** (`packages/core/test/no-floats.test.ts`): flag plain `/` in money files unless bigint or a named helper, strip single-quoted strings, add `schemas/settings.ts` and `numbering.ts` (and any other money module) to the list, and a test that `a * b / 100` is caught.
6. **Brand raster/PDF drift**: apply the wallpaper source-hash pattern (`src/brand/png.ts` `tagPng`/`sourceHash`) to the brand PNGs/ICO and a metadata hash to the print PDFs, with drift tests; regenerate with `build:brand` only if the outputs must gain the tag (outputs stay byte-identical otherwise).
7. **Referenced-table rebuild guard**: a CI check (in `pnpm check`) that fails any migration after 0006 containing `DROP TABLE` / `__new_` for a table that other tables reference, unless allow-listed; add the rule to CLAUDE.md Conventions (Migrations) and docs/14 §3's analyst gate wording.
8. **Company GSTIN setting** (`packages/core/src/schemas/settings.ts:14-15`): use the `gstin` schema with the check character and `isStateCode`; tests.
9. **Prod deploy guard** (`deploy-prod.yml`, `bench-auth.yml`): also require `github.triggering_actor == 'techaust'`; add `environment: production` to the prod job (the environment's reviewers/secrets are set by the owner in Phase 7 — note it).
10. **Staging token scope** (`deploy-staging.yml`): move `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from job env to the steps that need them.
11. **gitleaks checksum** (`ci.yml`): pin and verify the release tarball's SHA-256 (get it from the official release checksums file; if you can't fetch it, stop and report).
16. **heavy.sh lock**: write the PID into the lock, treat a lock whose PID is gone as stale, and make stale removal atomic (only one waiter wins).
17. **bench cleanup** (`scripts/bench-auth.mjs:206`): delete only the benchmark's own keys (bench users' accounts), never real accounts' counters.

## Deferred (follow-ups in 12-status)
- 12 (more binding types in `check-web-bindings.mjs`): after `fix/skill-audit-findings` merges (it may touch the same guard).
- 13 `documents.parent_id` FK and 14 issued-status transitions: with the M3/M5 document state machine.
- 15 retire catalogue items by deactivating, never deleting (document in 05/06 runbook when the catalogue editor lands, M4.1).
- 18 GSTIN format for TDS/UIN/NRTP registrations: VERIFY WITH CA/LEGAL before M5.

## Rules
Branch `fix/skill-audit-earlier` (this file is its first commit), own worktree. **Load the skills first** (Skill tool): `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `code-review` (checklist only), `security-review` (checklist only), `frontend-design` (for item 4) — list them in the report. Don't touch `scripts/check-web-bindings.mjs`, `apps/*/wrangler.jsonc`, `apps/*/worker/**` or `scripts/create-invite.mjs` (another builder is changing them). No hosted services, no new packages. Heavy commands via `bash tools/heavy.sh --log <name> <command>`; final `pnpm check`, `pnpm test`, `pnpm db:generate` (no diff after your migration), `pnpm build`, one whole-repo lint. Commit as you go; append "Builder report"; do not push.
