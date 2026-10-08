# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-08** (IST)._

## Done
- **Phases 1–5:** approved 2026-10-06 ([09-roadmap.md](09-roadmap.md)).
- **M1.1:** design tokens, fonts and the "Patina" brand ([PR #3](https://github.com/techaust/techaust_platform/pull/3)). **M1.2:** the core library ([PR #5](https://github.com/techaust/techaust_platform/pull/5)). **M1.3:** the D1 schema, triggers and seed; staging D1 is migrated and seeded on every merge ([PR #6](https://github.com/techaust/techaust_platform/pull/6)). All approved.
- **Working rules** ([PR #8](https://github.com/techaust/techaust_platform/pull/8)) and the **documentation quality pass** ([PR #9](https://github.com/techaust/techaust_platform/pull/9), [PR #10](https://github.com/techaust/techaust_platform/pull/10)), 2026-10-07; details in [runs/docs-quality-pass.md](runs/docs-quality-pass.md).
- **Models and usage plan** ([PR #11](https://github.com/techaust/techaust_platform/pull/11), owner-approved 2026-10-08):
  - [14-models-and-usage.md](14-models-and-usage.md): tiers A/B/C per milestone, model and effort per tier, the budget gate, habits, measuring
  - agents: `builder` (fixed tool list, Tier A early check), `reviewer` (severity triage, re-check mode), new Haiku agents `code-finder`, `test-runner`, `doc-clerk`
  - `tools/heavy.sh --log <name>`; the start-session and end-session skills read and report usage; run files gain `Tier:`, `Usage:`, Early check and Handover
  - **verified:** the `--log` option; headless checks that all three new agents load, `code-finder` skips CLAUDE.md, `test-runner` ran a core suite through the queue (14 passed), and `builder` sees only its fixed tools and reaches Context7. `doc-clerk` was first used for this session's CHANGELOG lines.

## In progress
- **M1.4: the auth CPU spike, a gate** ([PR #7](https://github.com/techaust/techaust_platform/pull/7)).
  - **Built and tested locally:** the staff login API, the sign-in and invite screens, the benchmark workflow.
  - **Local result:** Argon2id in the browser took 86–92 ms on the owner's PC.
  - **Held:** no auto-merge, and no merge before the owner says **"Access is on"**.
  - **Needs updating with `main`:** it has merge conflicts (see the follow-ups below).

## Next
1. When the owner says **"Access is on"** (lead on **Opus 5.5, high** for the PR #7 update, per [14 §3](14-models-and-usage.md); medium for the rest):
   1. check that every staging URL shows the Access sign-in
   2. bring PR #7 up to date with `main` (see the follow-ups)
      - bind PR #7 to that session and turn on Auto-fix (no auto-merge: it stays held until this list is done)
   3. merge it
2. The owner runs **GitHub → Actions → Auth CPU benchmark (staging) → Run workflow**.
3. I read the CPU times from Workers Logs (read-only), fill in `docs/runbooks/cpu-baseline.md`, and run the gate check: login p99 ≤ 5 ms, every route ≤ 7 ms. If it fails, I stop and ask.
4. Then M1.5 (Tier A; the brief is written with the lead on high).

**Usage at the end of 2026-10-08:** weekly 67 %, pace about 42 % → over the pace: **one agent at a time** until the reset on Monday 12 Oct, 15:30 IST. The first full measuring week starts then ([14 §7](14-models-and-usage.md)).

## Waits on the owner
- **Blocking M1.4:** Parts 1–3 of `docs/runbooks/access-staging.md` (in PR #7):
  - turn on Access for the four staging Workers
  - create the benchmark service token and run its two `gh secret set` commands
  - run the four `wrangler secret put … --env staging` login secrets
- **Time-sensitive compliance** ([08 §0](08-security-compliance.md); all VERIFY WITH CA):
  - **U-3 UPI MDR from 15 Oct 2026:** check the Razorpay pricing.
  - **U-1:** the LUT for zero-rated exports.
  - **U-2:** how your AD bank wants the monthly FEMA EDF filed.
  - **U-9:** re-check the GST rules after the 57th GST Council (7/8 Oct 2026).
- **Not blocking:**
  - install or decline the **Renovate** app (dependency updates)
  - **U-5:** the Zoho aliases, including `grievance@`
  - trademark search (VERIFY WITH LEGAL)
  - printed brand proof and Pantone match
  - phone number for the business card
  - headshot and bio (for M2)
  - optional: Argon2id timing on a phone
  - U-6 (private repo later?) and U-7 (billing), as listed in 08 §0

## Open follow-ups
- **PR #7 update.**
  - **Remove** the first draft of the working rules: `slice-builder` / `slice-reviewer`, `scripts/heavy.mjs`, `start-the-day`, and the status lines and work-split section in its CLAUDE.md. **Keep `main`'s CLAUDE.md "How work is split" section** (the 2026-10-08 models and usage rules).
  - **Keep** in CLAUDE.md:
    - the `pnpm dev:secrets` / `pnpm invite` commands
    - the Staff-login bullet
    - the `__new_` migration rule
    - the `wrangler types --env staging` note
  - **In `access-staging.md`:**
    - webhook paths → `/razorpay`, `/stripe`, `/paypal`, `/ses`
    - add a full `cd` path and label the code blocks `powershell`
    - check for a trailing newline when piping secrets
    - wording: say that this PR already sets `preview_urls: false` and adds the benchmark workflow
  - **After the merge:** reword session-key rotation in 08 §3.2.
- **Models and usage:**
  - measure after the first Tier A build and the first two Tier B reviews; propose at most two adjustments ([14 §7](14-models-and-usage.md))
  - switch the Haiku agents from the `haiku` alias (Haiku 4.5) to Haiku 5.5 once Claude Code recognises it
- **Code follow-ups (from the 2026-10-07 decisions):**
  - a migration narrowing `issue_guard` to `draft` only (before issuing is built, M3/M5)
  - `smallJobThreshold` in `packages/core/src/schemas/settings.ts` → a single INR value applied to every currency; plus a `{{terms:…}}` renderer
  - the G-11 `annualReturnFiledAt` input (M4/M5)
  - enforce "first character not `0`" in `numbering.ts`
- **Content:**
  - confirm the variable names in the new 07 §8 email rows when the templates are built
  - check the other "100 %" mentions in 04 against the content lint
  - add `/accessibility` to the sitemap and footer when M2 builds them
- **Re-measure:** the old site's TTFB from India (the audit measured it through Marseille), if it still matters before cut-over.
