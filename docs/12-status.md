# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-12** (IST)._

## Done
- **Phases 1–5:** approved 2026-10-06 ([09-roadmap.md](09-roadmap.md)).
- **M1.1:** design tokens, fonts and the "Patina" brand ([PR #3](https://github.com/techaust/techaust_platform/pull/3)). **M1.2:** the core library ([PR #5](https://github.com/techaust/techaust_platform/pull/5)). **M1.3:** the D1 schema, triggers and seed; staging D1 is migrated and seeded on every merge ([PR #6](https://github.com/techaust/techaust_platform/pull/6)). All approved.
- **Working rules** ([PR #8](https://github.com/techaust/techaust_platform/pull/8)) and the **documentation quality pass** ([PR #9](https://github.com/techaust/techaust_platform/pull/9), [PR #10](https://github.com/techaust/techaust_platform/pull/10)), 2026-10-07; details in [runs/docs-quality-pass.md](runs/docs-quality-pass.md).
- **Models and usage plan** ([PR #11](https://github.com/techaust/techaust_platform/pull/11), 2026-10-08): tiers A/B/C, the budget gate, `tools/heavy.sh --log`, the Haiku helper agents, run-file `Tier:` / `Usage:` / Handover. Its model split is replaced by the plan below.
- **The three-model plan** ([PR #13](https://github.com/techaust/techaust_platform/pull/13), owner-approved and merged 2026-10-12; [14-models-and-usage.md](14-models-and-usage.md)):
  - **only Opus 5.5, Sonnet 5.5 and Haiku 5.5**; the lead is always Opus 5.5 at medium
  - new `analyst` (Opus 5.5 high, read-only: Tier A briefs, early checks, risky merges, failure diagnosis, phase plans) and `designer` (Opus 5.5 high: designs **and builds** every screen, checks its own screenshots); `builder` (Sonnet 5.5) does data, logic and API; `reviewer` (Opus 5.5 high, every tier) adds a visual review
  - previews of M2.1, M2.2, M3.1 and M4.5 are approved by the owner before they're built
  - enforced by `.claude/settings.json` (alias pins, `availableModels`, effort medium), the `tools/model-guard.mjs` hook and the `tools/model-audit.mjs` end-of-day check
  - **verified** on Claude Code 2.1.295: a Fable request ran on Opus 5.5 with the allowlist (on Fable 5.1 without it); the Explore agent, a `fable` agent and a `max`-effort agent were refused; `code-finder` ran on Haiku 5.5 at low; per-agent effort applies; the lead is told its effort; all agents load; an agent took and read Playwright screenshots. CI green; staging deploy green.
  - the command-line copy of Claude Code was updated from 2.1.288 to 2.1.295 (owner-approved)
- **Smart App Control turned off** by the owner (2026-10-12): it had started blocking unsigned developer tools (pnpm 12's native binary, Biome). Afterwards `pnpm check` passed locally.
- **Company wallpapers** ([PR #15](https://github.com/techaust/techaust_platform/pull/15), owner-approved and merged 2026-10-12; [runs/brand-wallpapers.md](runs/brand-wallpapers.md)): Monolith, Cut and Construction, each 3840×2160 (PC) and 2160×4680 (phone), flat ink and verdigris, Cut and Construction with a brand-built node network. Generated from `geometry.ts` + `tokens.json` (`pnpm --filter @techaust/ui build:wallpapers`), in `packages/ui/brand/wallpapers/`. Seven preview rounds; reviewer APPROVE; `pnpm check` + `pnpm test` green; CI green.
- **End-of-day doc check ([PR #14](https://github.com/techaust/techaust_platform/pull/14)):** CLAUDE.md, 06, 09, 10, the end-session routine and `tools/watch.sh` now name the designer and analyst where they still said only "builder".

## In progress
- **M1.4: the auth CPU spike, a gate** ([PR #7](https://github.com/techaust/techaust_platform/pull/7)).
  - **Built and tested locally:** the staff login API, the sign-in and invite screens, the benchmark workflow.
  - **Local result:** Argon2id in the browser took 86–92 ms on the owner's PC.
  - **Held:** no auto-merge, and no merge before the owner says **"Access is on"**.
  - **Needs updating with `main`:** it has merge conflicts (see the follow-ups below).

## Next
1. When the owner says **"Access is on"** (the lead stays on Opus 5.5 medium; the `analyst` plans the PR #7 update first, per [14 §3](14-models-and-usage.md)):
   1. check that every staging URL shows the Access sign-in
   2. bring PR #7 up to date with `main` (see the follow-ups)
      - bind PR #7 to that session and turn on Auto-fix (no auto-merge: it stays held until this list is done)
   3. merge it
2. The owner runs **GitHub → Actions → Auth CPU benchmark (staging) → Run workflow**.
3. I read the CPU times from Workers Logs (read-only), fill in `docs/runbooks/cpu-baseline.md`, and run the gate check: login p99 ≤ 5 ms, every route ≤ 7 ms. If it fails, I stop and ask.
4. Then M1.5 (Tier A; the `analyst` drafts the brief).

**Usage at the end of 2026-10-12 (second session):** weekly 7 % (reset today, 15:30 IST), 5-hour window 16 %. The first full measuring week runs to Monday 19 Oct ([14 §8](14-models-and-usage.md)).

## Waits on the owner
- **Model menu:** open it once and confirm Fable is no longer offered (the one part of the three-model plan not yet confirmed inside the app), and pick **Opus 5.5, medium** for every conversation.
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
  - install the new wallpapers on the company PCs and phones (sent 2026-10-12) and say if anything looks off on a real screen
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
- **Wallpapers (low, test strength; [runs/brand-wallpapers.md](runs/brand-wallpapers.md)):** check network anchors against the real channel/mark geometry; compare wire coordinates, not just counts; optional slow pixel re-render test; build the fitted-mark expectation from `MARK_PARAMS`. Remove the designer worktree `.claude/worktrees/agent-a62f60a92c395a3e9`.
- **Models and usage:**
  - the cost report after the first Tier A build, the first designer task and the first two Tier B reviews ([14 §8](14-models-and-usage.md))
  - the 2026-10-12 model audit flagged only the deliberate headless test (Sonnet at low, 10:49); the wallpapers session ran Opus 5.5 at medium, its designer at high (fixes at medium) and its reviewer at high, as the plan says
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
