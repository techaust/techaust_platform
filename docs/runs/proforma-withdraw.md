Status: lead reading; analyst brief next (session restarted 2026-10-31 13:05 IST, main 8d5b958 merged in)
Tier: A
Usage: _(one entry per agent run, from `node tools/model-audit.mjs`)_

# Withdraw a proforma the client has seen (cloud session "proforma-withdraw")

Branch `feat/proforma-withdraw` (from `origin/main` a5f9f92). Copy file [07-ZF](../07-content-appendix/ZF-proforma-withdraw.md). Merge order of today's parallel tasks (owner, 2026-10-31): T12, T6, **proforma withdraw**, T7, M6.1.

**The rule (owner, 2026-10-30, docs/13):** staff may take back a delivered proforma that has no payment and no invoice made from it, with a reason; it stays in the records (never deleted); the client sees it as withdrawn. It replaces "a delivered proforma stays until converted". The separate rule stays: a tax or export invoice the client has viewed is never voided (08-C RA-10, trigger 0053); withdrawing is for proformas only.

## Brief
_(the analyst drafts it; the lead writes the final version here)_

## Questions for the owner
_(none yet)_

## Lead decisions (for 13)
_(none yet)_

## Migrations added
_(none yet)_

## Worker bytes
Main (a5f9f92): admin API 618,422 (plan line 650,000), jobs 984,266 of 1,000,000.

## Early check

## Builder report

## Designer report

## Review

## Integration notes

## Follow-ups (for 12)
- **Fixed by #126.** ~~Cloud setup script (found 2026-10-31 at this session's start):~~ the setup script stopped with "node -v says v24.22.1, not v24.22.2". Cause: the cloud image now ships `/opt/node24` as a real folder (Node 24.22.1), so `ln -sfn "/opt/${NODE_NAME}" /opt/node24` in `scripts/cloud-setup.sh` (line 57) puts the link inside that folder instead of replacing it, and the version check fails before the browser step. Fix: add `[ -L /opt/node24 ] || rm -rf /opt/node24` on the line before it, then paste the script into the environment's "Setup script" box again (owner). This session ran on the image's Node 24.22.1 (inside `engines` >= 24.19.0) and the lead installed the two Chromium builds by hand (`pnpm exec playwright install --with-deps chromium` from `apps/web`, and `npx @playwright/mcp@0.0.83 install-browser --no-shell chromium`, both into `/opt/ms-playwright`); `bash scripts/cloud-check.sh` then: all passed. Note: `npx -y playwright@1.64.1 install` picked up the image's own Playwright and installed revision 1243, not 1248; the repository's own binary is the reliable path.

## Handover
