# Cost report, 2026-10-23 (docs/14 §8)

**Why:** docs/14 §8 asks the lead to report the cost of each kind of agent run against the pace once the first Tier A build, the first designer task and the first two Tier B reviews are done. All three are done: Tier A in M1.6 and M2.4b, designers since M2.1, and the Tier B reviews in M2.4 and the two CPU-tuning tasks.

**How measured:**
- The weekly and 5-hour percentages come from the `Usage:` lines in `docs/runs/*.md`, read at each run's start and end.
- From M2.5 on, the run files also record each agent's own tokens and minutes, from the app's completion notice.
- Weekly figures are whole percentages, so a run that cost under half a point reads as "+0".
- The model and effort of every run come from `node tools/model-audit.mjs`, which flagged nothing outside the plan.

## This week (reset Mon 19 Oct, 15:30 IST)
- **Weekly: 39 % used at 20:20 IST Friday, against a pace of about 59 %:** 20 points under the pace.
- **The 5-hour window** was the tighter limit. It reached 41 % on the Tier A and Tier B tasks, and never crossed 50 %, so no agent was held back.

## Cost by task (whole task: brief or preview, build, design, review, fixes, re-check)

| Task | Tier | Agent runs | Weekly | 5-hour window |
|---|---|---|---|---|
| M2.4b sign-in emails | A | 8 (analyst ×2, builder, designer, reviewer, fix builder, re-check) | +5 points (31 → 36 %) | +32 (9 → 41 %) |
| M2.4 forms, leads, email | B | 5 | +3 (27 → 30 %) | +26 (15 → 41 %) |
| CPU tuning (form posts) | B | 3 | +1 (30 → 31 %) | window reset mid-task |
| CPU tuning (emails) | B | 3 | +0 (31 → 31 %) | +3 (5 → 8 %) |
| M2.2 home and services | C, with a preview | 7 | +4 (19 → 23 %) | +21 (3 → 24 %) |
| M2.3 other pages | C | 6 | +3 (23 → 26 %) | n/a |
| M2.5 SEO, performance, accessibility | C | 5 | +3 (36 → 39 %) | +21 (2 → 23 %) |

## Cost by kind of run

| Run | Model / effort | Typical cost | Evidence |
|---|---|---|---|
| **Builder** | Sonnet 5.5 / medium (Tier A: high) | **About +1 weekly point per task.** The largest by tokens, but Sonnet is the cheapest per token. | M2.5 build: 388k tokens, 64 min. M2.2 and M2.3 builds: +0–1 point, +1–2 on the 5-hour window. |
| **Designer** | Opus 5.5 / high | **+1–2 weekly points per task, the most expensive single run** (Opus, high, screenshots). | M2.2 preview: +2 weekly, +8 on the 5-hour window. M2.2 build: +1, +6. M2.5: 292k tokens, 36 min. |
| **Analyst** | Opus 5.5 / high | About +1 per brief or early check (Tier A only). | M1.5 brief: +1, +3. M1.4 plan: 167k tokens, 10 min. |
| **Reviewer** | Opus 5.5 / high | **Under 1 weekly point per review**, about +4 on the 5-hour window. Its `code-review` helper adds a little. | M2.2: +0, +4. M2.5: 209k tokens, 25 min. |
| **Fix round** | Sonnet / medium, or Opus / medium for screens | Small: +0–1 point. | M2.5 fix: 133k tokens, 25 min. M2.2 fixes: +0, +1. |
| **Re-check** | Opus 5.5 / medium | Small: +0 point. | M2.5: 102k tokens, 11 min. |
| **Lead** | Opus 5.5 / medium | **Spread across the day.** Integration, triage and the owner's questions; it grows with long conversations. | Not measured per step. |

## What this means
- **A Tier C page task costs about 3–4 weekly points**, a Tier B task about 1–3, and a Tier A task about 5. At that rate a full week of work (two or three tasks a day) stays under the pace with room to spare.
- **The designer and the Tier A analyst are where the money goes.** Both run at the levels the plan protects: screens and Tier A work never go down in effort.
- **The 5-hour window, not the week, is what limits a day.** A Tier A or B task fills about 40 % of one window. This already follows docs/14 §5: the expensive work goes at the start of a window, and it's why "continue" opens a fresh conversation for each step.
- **Quality held at these levels.** No Tier B or C task was sent back twice or had a critical finding, so the quality guard in §8 never raised an effort level.

## Recommendation (the owner decides; nothing changes without approval)
**Keep every model and effort level as it is.** The week is 20 points under the pace. Lowering effort would save little, and is barred for Tier A work, screens and reviews anyway. Raising it (for example, the Tier B builder from medium to high) isn't justified by any finding so far.

The next report comes after M3.1, the first admin screens.
