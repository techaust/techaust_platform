# M5 batch (M5.1 to M5.5: invoices, GST, credit and debit notes, recurring, exports)

Status: open

## Owner's answers (2026-10-27)
- **Scope:** build M5.1 to M5.5 as one batch while the owner is away, like the M3.4 to M4.5 batch: each milestone still has its own brief, review, fixes, re-check and PR to staging; the owner reviews the whole batch at the end (a second exception to hard rule 2; docs/13). M5.0 (the admin Worker split, PR #95, on staging) is reviewed with the batch.
- **The owner's calls** (tax and invoicing rules, copy): use the researched default as a setting, mark it **VERIFY WITH CA/LEGAL**, show missing copy as `[Placeholder]`, and collect every question on one numbered page with a recommendation each for the batch review. Nothing waits on the owner mid-batch unless it is a hosted change or something only the owner can do.
- The usual gates: 5-hour window ≥ 80 % → no new agent; at most two agents at once, at most one browser agent.

## Known owner inputs (not blocking the build)
- The LUT ARN for FY 2026-27 (docs/08 U-1): the LUT guard (ADM-INV-18) blocks an LUT-mode export invoice until it is saved in Settings; that is the intended behaviour.
- The view on the tax defaults and an optional CA review (docs/09 §M5).

## Phase plan
(the analyst's draft, checked by the lead, goes here)

## Handover
(written at the end of each conversation)
