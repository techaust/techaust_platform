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
