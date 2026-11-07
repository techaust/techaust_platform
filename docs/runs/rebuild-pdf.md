Status: analyst drafting the brief
Tier: A
Usage: (filled per agent run from `node tools/model-audit.mjs`)

# Rebuild PDF (cloud session `rebuild-pdf`, branch `feat/rebuild-pdf`)

An Owner-only tool that re-creates a stored write-once PDF that is missing or damaged in R2 `DOCS`, from its sealed envelope, so a lost PDF can never block a client or an audit.

Basis: [13](../13-decisions.md) 2026-10-29 ("Rebuild PDF … its own Tier A task before production"); [m5-owner-fixes](m5-owner-fixes.md) F1; [m7.5-hardening](m7.5-hardening.md) L25; [full-audit-m6-m7](full-audit-m6-m7.md) follow-up; [phase7-production](phase7-production.md) A1.12.

Lead skills: none of docs/14 §9's Cloudflare skills load in a cloud session (no plugins there; CLAUDE.md "In a cloud session"); `code-review` and `security-review` are for the reviewer.

## Brief
(the analyst drafts it; the lead writes the final version here)

## Questions for the owner
(none yet)

## Lead decisions (for 13)

## Proposed CLAUDE.md text

## Follow-ups (for 12)

## Migrations

## Worker bytes

## Handover
- 2026-11-07 20:15 IST: branch made from `origin/main` (0ec9e8b); analyst drafting the Tier A brief.
