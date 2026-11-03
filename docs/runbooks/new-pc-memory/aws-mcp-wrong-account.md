---
name: aws-mcp-wrong-account
description: "The AWS MCP server's credentials belong to a different AWS account, not TecHaust's SES account; don't use it for TecHaust checks"
metadata:
  node_type: memory
  type: reference
  originSessionId: 55333dc0-2261-4c86-98b7-b526405470fe
  modified: 2026-10-22T19:55:27.852Z
---

On 2026-10-23 the AWS MCP (`mcp__aws-mcp__*`) was signed in as an IAM user of a different AWS account (not TecHaust's; its number is kept out of this public copy). TecHaust's `techaust.com` SES identity (ap-south-1, MAIL FROM `noreply.techaust.com`) lives in a different account the lead can't see.

**Why:** reading the wrong account gave a false "identity does not exist".
**How to apply:** for TecHaust's AWS state, check public DNS (DoH) or ask the owner for screenshots; don't query or change anything through the AWS MCP unless the owner confirms it's been pointed at the TecHaust account. Related: [[techaust-rebuild-project]].

**2026-10-26:** owner chose to turn the AWS MCP off for this project only (`disabledMcpServers` in ~/.claude.json, with supabase and upstash). Re-enable only after the owner signs it in to the TecHaust account (Phase 7). Plugins are now declared in `.claude/settings.json` (Team plan move).
