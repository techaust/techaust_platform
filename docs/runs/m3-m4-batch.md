# M3.4 to M4.5 batch

Status: open: step 1 (M4.2 builder running; M3.4 builder next)

## Owner's answers (2026-10-25)
- Review all seven at the end; each milestone still has its own review, re-check and PR to staging (one-time exception to hard rule 2; docs/13).
- Keep the M4.5 portal preview: the designer makes it early; only M4.5's build waits for the owner's yes.
- Copy: drafted up front (07-K onwards), built marked pending, approved word for word before the final approval.
- Usage: the normal gates (no new build or design at ≥ 85 % weekly; docs/14 §5).

## Order (corrected by the analyst's phase plan; at most two agents, at most one browser agent)
| Step | Lane N (builders, analysts, code-only reviews) | Lane B (designers, visual reviews) |
|---|---|---|
| 0 | Lead PR: worker budget guard | — |
| 1 | M3.4 builder ‖ M4.2 builder | — |
| 2 | M4.2 analyst early check | M3.4 designer |
| 3 | M4.1 builder | M3.4 review |
| 4 | M4.2 review (no screens) | M4.5 portal preview → owner |
| 5 | M3.5 builder (Tier A) | M4.1 designer |
| 6 | M3.5 analyst early check | M4.1 review |
| 7 | M4.3 builder (Tier A) | M3.5 designer |
| 8 | M4.3 analyst early check | M3.5 review |
| 9 | M4.4 builder (from M4.3's task branch after GO) | M4.3 designer |
| 10 | M4.5 builder | M4.3 review |
| 11 | M4.5 accept and start-project analyst check | M4.4 designer |
| 12 | Fixes | M4.4 review |
| 13 | — | M4.5 designer, then review |

Merge order: M3.4, M4.2, M4.1, M3.5, M4.3, M4.4, M4.5. Migrations (analyst's plan): M3.4 0024–0025, M4.1 0026–0027, M3.5 0028–0029, M4.3 0030–0031 (every `documents` column the batch needs, and `documents_frozen_update` recreated in a new trigger set with the 0001 list pinned), M4.4 0032–0033, M4.5 none. A later branch merges `main`, deletes its unapplied migration, snapshot and journal entry, and regenerates.

## Hosted changes (owner)
- **H1, before the M3.4 merge:** R2 on; private buckets `techaust-staging-files` and `techaust-staging-docs` (APAC, Standard, public access off); `CF_API_TOKEN_STAGING` gains R2 if the deploy needs it.
- **H2, before the M4.4 merge:** Browser Run for the staging jobs Worker.

Each milestone: its own task branch and run file (`docs/runs/m3.4-projects.md` …), reviewer + fixes + re-check, PR with auto-merge and Auto-fix. Migration numbers are reserved per milestone in the phase plan so the tracks never clash.

## Handover (2026-10-25, end of day)
- **On staging:** M4.2 (#80), M3.4 (#81), M4.1 (#82). The M4.5 preview is approved by the owner.
- **M3.5** (`feat/m3.5-care-time` at acbd911, integrated with main; migrations 0028–0030): the review fixes are merged. **Re-run the re-check** (diff `6a92909..acbd911`, with a live look). It was stopped before reporting at the usage limit. Then the PR.
- **M4.3** (`feat/m4.3-builder` at de4bf28): stop 1 done. **Re-run the analyst early check.** Its main risk is CPU: local wall time is 25 ms for a 100-line save. Then items 8–10 after merging `main` with M3.5, the 07-O copy (including new template versions), the screens and the review.
- **M4.4:** no brief yet. Verify the Browser Run API first. Ask the owner's yes for Browser Run on the staging jobs Worker.
- **M4.5:** the build follows the approved preview (`feat/m4.5-send-accept`, with the preview merged).
- **Owner rules:**
  - stop after M4.5; M5 waits for the owner's word;
  - usage gates are lifted until Mon 26 Oct 15:30 IST, then the normal docs/14 §5 gates apply again;
  - at most two agents at once, and never two browser agents (8 GB RAM; free memory dipped to about 200–400 MB with a browser and tests running).
- **Usage today (`node tools/model-audit.mjs 2026-10-25`):** every run was within the plan. Weekly usage reached 83 % at the end of the day.
