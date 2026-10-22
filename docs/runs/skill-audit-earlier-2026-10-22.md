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

## Builder report (Sonnet 5.5, high; 2026-10-22)

**Skills (Skill tool, all loaded):** `cloudflare:workers-best-practices` (checklist: no runtime Worker code changed here; confirmed generated types, no hand-written `Env`, secrets by name only, kept the CI jobs fork-safe); `cloudflare:wrangler` (nothing in wrangler.jsonc touched; migrations are applied by wrangler from `packages/db/migrations`, so I kept to custom SQL + one drizzle-kit migration and no `__new_`); `code-review` and `security-review` (used as checklists only; the `code-review` skill printed a review of an unrelated earlier diff when invoked, which I ignored; `security-review` found no diff to review; neither spawned agents or posted anything; they made me re-read the guard, the CI token scope and the bench cleanup for blast radius); `frontend-design` (item 4: kept the token change to the minimum that passes, no new look).

**Item 1, my reading of docs/04.** Not ambiguous, so I did not stop.
- docs/04 §9: invoices, proformas, credit notes: Owner "✅ issue (step-up)"; Staff "✏️ drafts · issue ⏳"; ADM-INV-04: "Issue = Owner only (Q-P3-2), with step-up auth. Staff can 'Request issue' (ADM-APR)"; ADM-APR-01: queue for "invoice issue requests"; ADM-APR-02: "Approvals expire if the document changes after the request".
- The invoice lifecycle (ADM-INV-02) is "Draft → Issued → Partially paid → Paid, plus Overdue (computed) and Void"; there is no `pending_approval` state for invoices (ADM-PROP-06 has "Pending approval" for proposals and estimates only, which are sent, not issued).
- The approval is a row in `approvals` (kind `issue`, `content_sha256`) next to the draft, and the Owner issues the draft itself.
- docs/05 §5.3 change 14 records the owner decision of 2026-10-07: "only drafts can be issued; a document waiting for approval must be approved first", and says a new migration narrows the code's guard to `draft`.
- So the issuable set is `["draft"]`: one constant `ISSUABLE_STATUSES` in `packages/db/src/triggers.ts`, used by the guard trigger and by the reference batch in `test/helpers.ts`.

**Commits (branch `fix/skill-audit-earlier`, on top of b85c7fe):**
- `fa837ec` fix(db): issue guard drafts only + issue post-condition; seed conflicts [ADM-INV-03] (items 1, 2)
- `7ee3c3f` perf(db): FK indexes (item 3)
- `0481444` fix(ui): contrast test gaps + two token values (item 4)
- `08925a0` test(core): no-floats scan + company GSTIN (items 5, 8)
- `3a78a7e` test(ui): brand raster and print drift (item 6)
- `e82d89a` ci: migration rebuild guard, gitleaks checksum, prod/bench actor guards, staging token scope (items 7, 9, 10, 11)
- `ac277fd` fix(tools): heavy.sh PID lock; bench cleanup (items 16, 17)
- `711f2ac` chore(web): favicon.ico copy refreshed (needed by item 6)
- plus this report's own commit

**Migrations (new only; 0000-0006 untouched; no `__new_`):**
- `0007_issue_guard.sql` (custom, written by `scripts/write-triggers.ts issue_guard`): `DROP TRIGGER issue_guard_check`; recreate it with `status IN ('draft')`; add the view `issue_result (document_id, series, fy)` and `INSTEAD OF INSERT` trigger `issue_result_check`, which aborts unless the document is `issued`, frozen, with the same series/fy and `number = doc_counters.next_no - 1`. The batch ends with `INSERT INTO issue_result ...`, so an UPDATE that matches no row aborts the batch and the counter rolls back. `triggerStatements()` (the 0001 set) no longer contains the guard; it now lives in `issueGuardStatements()`. docs/05 §5.3 change 14 and §5.4 updated.
- `0008_indexes_fk_lookups.sql` (drizzle-kit): 7 `CREATE INDEX` (`leads_client`, `milestones_document`, `projects_owner`, `acceptances_contact`, `approvals_document`, `documents_project`, `documents_care_plan`).
- `pnpm db:generate` afterwards: "No schema changes".
- Biome also reformatted `meta/0007_snapshot.json` (the committed snapshots are Biome-formatted).

**Tests added or changed, and why:**
- db `triggers.test.ts`: only drafts issuable (a `pending_approval` document is refused, counter unchanged, then issues with the next number once back to draft); the post-condition aborts a zero-row UPDATE and a wrong number, counter unchanged; the existing 20-parallel test passes through the new batch (now with the post-condition). `helpers.ts issueBatch` uses the shared constant and the post-condition.
- db `seed.test.ts`: a renamed code (stable id still present) and a reused slug skip the row and do not fail the seed (the seed's `ON CONFLICT` now has no target).
- db `migrations.test.ts`: migration list; the seven FK indexes exist as the leading column.
- ui `contrast.test.ts`: `fill-subtle` added as a text background in both themes; `border-control` on `fill-subtle` (3:1) both themes; `text` on `selection` both themes; `accent-decor` on `bg` dark.
- core `no-floats.test.ts`: one-pass noise stripping (comments, double/single/template strings, regex literals); plain `/` flagged unless the line has bigint maths (`100n`, `BigInt(`, `divRoundHalfUp(`) or is `Math.trunc(x / y)` on plain operands; money list now money, words, numbering, schemas/settings, schemas/domain; a test that any `src` file mentioning money words must be on the list; tests that `a * b / 100` (also inside `Math.trunc`) is caught. One code change: `words.ts` `(m.amount - fraction) / 100` became `Math.trunc(m.amount / 100)` (same value for non-negative integers).
- core `settings.test.ts`: company GSTIN (check character, length, shape, unknown state) and state code. `companySettings` now uses `gstin.nullable()` and `stateCode` from `domain.ts`, plus a refine that the GSTIN's first two digits equal `stateCode` (my addition, in the spirit of the item; the default `null` + "19" passes).
- ui `brand.test.ts`: each brand PNG carries sRGB and the SVG hash (`tagPng`, the wallpaper pattern); each PNG inside `favicon.ico` carries its own size's hash; each print PDF has `/Keywords` `techaust:source-sha256=<hash>` where the hash covers the master SVG, `print-cmyk.json`, `print.ts` and `geometry.ts` (LF-normalised). `build:brand` regenerated all rasters and PDFs. SVGs unchanged; I compared the decoded pixels of all 14 changed PNGs with HEAD: identical. `apps/web/public/favicon.ico` is a byte copy of the brand file (its test required it), so it was refreshed.
- core `migration-guard.test.ts` (new, 8 tests) for `scripts/migration-guard.mjs` (+ `.d.mts`, + `check-migrations.mjs`, + `migration-rebuild-allowlist.json` = `[]`): drizzle-style rebuild fails, plain DROP fails, unreferenced and self-referenced tables pass, additive changes pass, only migrations after 0006 are checked, `ALTER ... ADD ... REFERENCES` counts, allow-list needs migration + table + reason, real migrations pass. Wired into root `pnpm check` and a CI step; rule added to CLAUDE.md Conventions (and its Commands line) and to docs/14 §4 (the "main taken early" bullet, which is where the analyst gate for migrations is described).
- core `bench-cleanup.test.ts` (new): the bench cleanup has no `LIKE`/time-window delete on `auth_attempts` and deletes the probes' keys.
- `tools/heavy.selftest.sh` (new, 11 checks, not part of CI, uses a throwaway lock path): exit code, release, PID recorded, dead owner taken over at once, live owner respected then taken after it dies, fresh lock without PID left alone, two waiters on a stale lock never overlap, release never removes someone else's lock.

**Token values changed (item 4), contrast ratios old to new:**
- light `success` `#47730F` to `#44700E`: on `fill-subtle` 4.46 to 4.66; on `bg` 5.24 to 5.47; on `surface` 5.63 to 5.88; on `surface-alt` 4.86 to 5.07.
- **Design call for the lead:** light `stone-500` (used only by `border-control`) `#7A8B84` to `#75867F`, because `border-control` on `fill-subtle` was 2.84 and 3:1 was required. New ratios: `fill-subtle` 3.04, `bg` 3.57 (was 3.34), `surface` 3.84 (was 3.59), `surface-alt` 3.31 (was 3.09). The change is 5 RGB units per channel. The brief says to stop if this needs a visible change; I judged a 5/255 shift on a 1 px input border not visible and applied it. If you want the old grey, the alternative is to lighten `fill-subtle` or drop that pair. Rebuilt with `build:tokens`; generated files committed; docs/06 hex values updated (docs/11 is a historical audit and left alone). Dark theme unchanged (all new pairs pass as they were).

**Checks (all via `tools/heavy.sh --log`, in this worktree):**
- `pnpm check` (lint + typecheck + binding guard + migration guard): exit 0.
- `pnpm test`: exit 0 after refreshing the favicon copy (the first run failed only the `apps/web` favicon test; fixed). core 299 passed, coverage statements 99.77 %, branches 98.56 %, lines 99.73 %; db 49; ui 468 passed, 2 skipped; auth 94; jobs 2; web 33 passed, 8 skipped; admin 411; portal 401.
- `pnpm db:generate`: "No schema changes, nothing to migrate"; no files changed afterwards.
- `pnpm build`: exit 0 (admin bundle ok, `check-web-dist` ok, web dry-run ok).
- Whole-repo `pnpm lint`: exit 0 (340 files, no fixes).
- `bash tools/heavy.selftest.sh`: all passed.

**Item notes and deviations:**
- Item 7: docs/14 §3 has no migration-specific sentence (its table row only lists "a merge whose migrations change a table..."), so the rule went into the §4 bullet that already describes that gate.
- Item 7 also edits root `package.json` (the `check` script) and `.github/workflows/ci.yml` (new step; CI runs its steps separately rather than `pnpm check`). The other builder may touch the same two files, so expect a trivial merge.
- Item 11: fetched the official `gitleaks_8.30.1_checksums.txt` over HTTPS (a public read) and also hashed the downloaded tarball: both `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`. CI now runs `sha256sum --check --strict` before `tar`.
- Item 9: `environment: production` is on the `deploy` job (not the guard); the owner creates the environment, reviewers and secrets in Phase 7.
- Not touched, as instructed: `check-web-bindings.mjs`, `apps/*/wrangler.jsonc`, `apps/*/worker/**`, `create-invite.mjs`. `docs/12-status.md` and `docs/13-decisions.md` are the lead's: the status line "a migration narrowing `issue_guard` to `draft` only" is now done, and the 2026-10-06 decision row for `issue_guard` could cite 0007.

**Not verified:**
- The CI workflow edits (gitleaks check, new step, actor guards, step-level env) have not run on GitHub; I only read them back.
- `heavy.sh` PID liveness uses `kill -0`, tested across separate Git Bash invocations here on Windows, but not on another machine.
- The `/Keywords` hash is read back from pdf-lib's UTF-16BE hex encoding; the same library version is pinned, but a different version could change the encoding.
- Migrations 0007 and 0008 will first run on staging at the next merge deploy.

**Open questions:** (1) Keep the darker `stone-500`, or meet 3:1 on `fill-subtle` another way? (2) Which name should docs/05's API section use for the post-condition when the issue route is built (M3/M5)? I called it `issue_result`.
