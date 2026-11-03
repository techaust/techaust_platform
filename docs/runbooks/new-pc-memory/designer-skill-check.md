---
name: designer-skill-check
description: Skills are mandatory for the lead and every agent (owner rule 2026-10-22); map in docs/14 §9; audit flags runs with none
metadata:
  node_type: memory
  type: feedback
  originSessionId: ca4d351d-0eb8-4c70-947d-96f9caa29313
  modified: 2026-10-22T10:29:15.175Z
---

Every run (the lead and every agent) loads every skill that fits its task before starting, without the owner asking. Map: `docs/14-models-and-usage.md` §9 (designer → frontend-design, dataviz; builder/analyst → cloudflare:workers-best-practices, cloudflare:wrangler, workers-profiling; web → cloudflare:web-perf; reviewer → code-review + security-review for Tier A/public; SES/IAM → aws-core skills).

**Why:** the owner said 2026-10-22 "this should be mandatory, I should not have to tell you every time". An audit showed every builder, analyst and reviewer run had loaded no skill; designers did load frontend-design (my first answer wrongly said M1.5/M1.6 designers didn't — the task .output grep missed it; the subagent .jsonl files are the reliable source).

**How to apply:** put the relevant skills in every agent prompt; run `node tools/model-audit.mjs <date>` (lists skills per run, flags agent runs with none) before every review and record skills in the run file's Usage line. See [[owner-visual-taste]], [[model-effort-rule]].

The review skills (`code-review`, `security-review`) start their own read-only `general-purpose` helper when an agent loads them; the owner allowed this on 2026-10-22 (allowed models only, read-only). Never start a built-in agent yourself.
