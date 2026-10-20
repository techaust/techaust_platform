# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-21** (IST)._

## Done
- **Phases 1–5:** approved 2026-10-06 ([09-roadmap.md](09-roadmap.md)).
- **M1.1:** design tokens, fonts and the "Patina" brand ([PR #3](https://github.com/techaust/techaust_platform/pull/3)). **M1.2:** the core library ([PR #5](https://github.com/techaust/techaust_platform/pull/5)). **M1.3:** the D1 schema, triggers and seed; staging D1 is migrated and seeded on every merge ([PR #6](https://github.com/techaust/techaust_platform/pull/6)). All approved.
- **Working rules and plans:** working rules ([PR #8](https://github.com/techaust/techaust_platform/pull/8)), documentation quality pass ([PR #9](https://github.com/techaust/techaust_platform/pull/9), [PR #10](https://github.com/techaust/techaust_platform/pull/10)), the models and usage plan ([PR #11](https://github.com/techaust/techaust_platform/pull/11)), replaced by the **three-model plan** ([PR #13](https://github.com/techaust/techaust_platform/pull/13), 2026-10-12; [14-models-and-usage.md](14-models-and-usage.md)): only Opus 5.5, Sonnet 5.5 and Haiku 5.5, the lead always Opus 5.5 at medium, enforced by `.claude/settings.json`, `tools/model-guard.mjs` and `tools/model-audit.mjs`.
- **Company wallpapers** ([PR #15](https://github.com/techaust/techaust_platform/pull/15), 2026-10-12; [runs/brand-wallpapers.md](runs/brand-wallpapers.md)).
- **Social media kit** ([PR #17](https://github.com/techaust/techaust_platform/pull/17), owner-approved and merged 2026-10-16; [runs/brand-social-kit.md](runs/brand-social-kit.md)):
  - profile pictures and covers for 12 platforms in `packages/ui/brand/social/<platform>/`: LinkedIn, X, Facebook, Instagram (with 4 highlight covers and 2 post templates), Threads, WhatsApp Business, Google Business Profile, YouTube, Upwork, Clutch, GoodFirms, GitHub
  - 45 files plus a README of which file goes where; `pnpm --filter @techaust/ui build:social` (add `-- --zip` for the owner's zip)
  - **bios and profile details** in [07-content-appendix/B-social-profiles.md](07-content-appendix/B-social-profiles.md); the claims "since 2019" and "a small senior team with 10+ years' experience" are owner-confirmed ([07 §1.4](07-content.md))
  - reviewer: SEND BACK (2 high, 7 low), then APPROVE after fixes; `pnpm check` + `pnpm test` green; CI green
  - the final zip was sent to the owner on 2026-10-16
- **Cloudflare Access on staging** (owner, 2026-10-17; [PR #18](https://github.com/techaust/techaust_platform/pull/18)): all four staging Workers, all traffic, the "Cloudflare account" policy (the owner is the only member), Preview URLs off. Checked by the lead: every staging URL answers 302 to the Access login.
- **M1.4: the auth CPU spike, a gate: accepted 2026-10-21** with an exception ([PR #7](https://github.com/techaust/techaust_platform/pull/7), tuning [PR #24](https://github.com/techaust/techaust_platform/pull/24); [runs/m1.4-auth-spike.md](runs/m1.4-auth-spike.md), [cpu-baseline.md](runbooks/cpu-baseline.md)).
  - The tuning cut D1 calls (totp 4 → 2, login 2 → 1) and made the lockout counter atomic; analyst GO, reviewer APPROVE.
  - Run 3 (15 min): totp p99 12 → 7 ms, salt 7, me 3 pass; login p99 6 ms vs 5 (one request in 380); nothing warm over 10 ms; cold starts 6–14 ms (2 of 8 over 10).
  - Owner: accept and move to M1.5; cold starts go into M1.5; the $5 plan is looked at again before real staff use.

## In progress
- Nothing.

## Next
1. **M1.5 brief** (Tier A; fresh conversation, "continue"): the `analyst` drafts it from docs/09 M1.5, adding:
   - stop Workers Logs keeping request headers (session cookie, Access token); the API on 2026-10-17 and 2026-10-21 shows `cookie` and `cf-access-jwt-assertion` as `REDACTED`, so first check what the dashboard and the stored logs really keep
   - the reviewer's pre-read lock finding: count the attempt atomically before verifying, so parallel guesses can't get past the lock
   - cold-start CPU of the admin Worker (bundle size)
   - the follow-up tests listed in the run file's last handover
2. Then the builder, the analyst's early check, the designer (screens), the review.

**Usage on 2026-10-21:** weekly 4 %, 5-hour 6 % after the M1.4 tuning (builder, analyst, builder fixes, reviewer); well under the pace. Weekly reset **Mon 26 Oct, 15:30 IST**.

## Waits on the owner
- **Time-sensitive compliance** ([08 §0](08-security-compliance.md); all VERIFY WITH CA):
  - **U-3 UPI MDR from 15 Oct 2026:** check the Razorpay pricing.
  - **U-1:** the LUT for zero-rated exports (send the ARN if filed).
  - **U-2:** how your AD bank wants the monthly FEMA EDF filed.
  - **U-9:** re-check the GST rules after the 57th GST Council (7/8 Oct 2026).
- **For the website (M2):** LinkedIn URLs (company + personal), WhatsApp Business number, full postal address, headshot and bio, Cal.com link, 2–3 case-study briefs, GA4 or not, one social handle for every platform.
- **Not blocking:**
  - upload the social kit (README in the zip); check the Upwork banner's "techaust.com" is readable and the Instagram/Threads/WhatsApp/YouTube images on a real phone
  - "since 2019" against the GST registration date if used in official listings (VERIFY WITH CA)
  - install the wallpapers; install or decline **Renovate**; **U-5** Zoho aliases incl. `grievance@`; trademark search (VERIFY WITH LEGAL); printed brand proof and Pantone match; phone number for the business card; optional Argon2id timing on a phone; U-6 and U-7 (08 §0)
- **Model menu:** confirm Fable is no longer offered; keep **Opus 5.5, medium** for every conversation.

## Open follow-ups
- **PR #7 update.**
  - **Remove** the first draft of the working rules: `slice-builder` / `slice-reviewer`, `scripts/heavy.mjs`, `start-the-day`, and the status lines and work-split section in its CLAUDE.md. **Keep `main`'s CLAUDE.md** "How work is split" section.
  - **Keep** in CLAUDE.md: the `pnpm dev:secrets` / `pnpm invite` commands, the Staff-login bullet, the `__new_` migration rule, the `wrangler types --env staging` note.
  - **In `access-staging.md`:** the new-dashboard Part 1 (above); webhook paths → `/razorpay`, `/stripe`, `/paypal`, `/ses`; a full `cd` path and `powershell` code blocks; check for a trailing newline when piping secrets; say that the PR already sets `preview_urls: false` and adds the benchmark workflow.
  - **After the merge:** reword session-key rotation in 08 §3.2.
- **Social kit:** Upwork banner domain line may need enlarging after a real-device check (review finding 8, low).
- **Wallpapers (low, test strength; [runs/brand-wallpapers.md](runs/brand-wallpapers.md)):** network anchors vs the real channel/mark geometry; compare wire coordinates, not just counts; optional pixel re-render test; build the fitted-mark expectation from `MARK_PARAMS`.
- **Models and usage:** the cost report after the first Tier A build (the M1.4 tuning will be the first), the first designer task and the first two Tier B reviews ([14 §8](14-models-and-usage.md)). Audits 2026-10-16 and 2026-10-17 (twice): all runs within the plan.
- **Code follow-ups (from 2026-10-07):** a migration narrowing `issue_guard` to `draft` only (before M3/M5); `smallJobThreshold` → a single INR value + a `{{terms:…}}` renderer; the G-11 `annualReturnFiledAt` input (M4/M5); "first character not `0`" in `numbering.ts`.
- **Content:** confirm the 07 §8 email variable names when templates are built; check the other "100 %" mentions in 04 against the content lint; add `/accessibility` to the sitemap and footer in M2; the site may now say "since 2019" (07 §1.4).
- **Re-measure:** the old site's TTFB from India, if it still matters before cut-over.
