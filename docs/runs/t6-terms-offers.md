# Run: T6, the offer wording, proposal terms v4 and website Terms 0.2

Status: MCIA check running (step 1)
Tier: B
Usage: lead claude-opus-5-5/high (cloud session t6-terms)

**Source:** [settle-08c](settle-08c.md) task T6; wording [07-ZE](../07-content-appendix/ZE-terms-offers-deed.md) (approved by the owner, 2026-10-31: 20 lines, Q1–Q4). Cloud session `t6-terms`, branch `feat/t6-terms-offers`, controlled by the main session on the owner's PC. Merge order today: T12, **T6**, proforma withdraw, T7, M6.1.

## Step 1: the MCIA check (07-ZE Q2, 08-C RB-38(c))
_Pending._

## Brief
_Written after step 1._

## Questions for the owner
_None yet._

## Lead decisions (for 13)
_None yet._

## Follow-ups (for 12)
- **Cloud setup script (lead, 2026-10-31):** the environment's setup script failed (`node -v says v24.22.1, not v24.22.2`): the image now ships `/opt/node24` as a real directory, so `ln -sfn /opt/node-v24.22.2-linux-x64 /opt/node24` makes a link inside it and Node stays 24.22.1; the browser step never ran. Fixed by hand in this session (moved the image's directory aside, linked 24.22.2, installed both Chromiums). Fix for `scripts/cloud-setup.sh` and the pasted environment script: before the `ln -sfn` line, add `[ -d /opt/node24 ] && [ ! -L /opt/node24 ] && mv /opt/node24 "/opt/node24.image.$(date +%s)"`. The owner pastes the corrected script into the environment's settings.
