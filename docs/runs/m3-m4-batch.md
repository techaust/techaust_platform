# M3.4 to M4.5 batch

Status: open: groundwork (analyst phase plan and the M4.2 brief)

## Owner's answers (2026-10-25)
- Review all seven at the end; each milestone still has its own review, re-check and PR to staging (one-time exception to hard rule 2; docs/13).
- Keep the M4.5 portal preview: the designer makes it early; only M4.5's build waits for the owner's yes.
- Copy: drafted up front (07-K onwards), built marked pending, approved word for word before the final approval.
- Usage: the normal gates (no new build or design at ≥ 85 % weekly; docs/14 §5).

## Order (two tracks, at most two agents, never two browser agents)
| Wave | Track 1 | Track 2 |
|---|---|---|
| 0 | Analyst: phase plan (admin Worker size, migrations across the batch, M3.4 brief draft) | Analyst: M4.2 tax engine brief (Tier A) |
| 1 | M3.4 builder | M4.2 builder → analyst early check |
| 2 | M3.4 designer | M4.1 builder |
| 3 | M3.5 builder (Tier A) | M4.5 portal preview (designer) → owner |
| 4 | M3.5 then M4.1 designer | M4.3 builder (Tier A) |
| 5 | M4.4 builder → designer | M4.3 designer |
| 6 | M4.5 builder → designer | |

Each milestone: its own task branch and run file (`docs/runs/m3.4-projects.md` …), reviewer + fixes + re-check, PR with auto-merge and Auto-fix. Migration numbers are reserved per milestone in the phase plan so the tracks never clash.
