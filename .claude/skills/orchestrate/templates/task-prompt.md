# Task prompt template

One prompt per cloud session: the shared rules (`shared-rules.md`, filled in) followed by one block like the one below. Write it so it stands on its own: the session knows nothing but this prompt and the repository. Good examples: the five prompts in [runs/cloud-parallel-2026-10-31](../../../../docs/runs/cloud-parallel-2026-10-31.md) and the four in [runs/cloud-parallel-2026-11-01](../../../../docs/runs/cloud-parallel-2026-11-01.md).

```text
<SHARED RULES, filled in>

YOUR TASK: <one line: what and why, with the record's basis (docs/13 row date, docs/12 item, 08-C ID)>.
- Session name: <name>. Branch: <prefix>/<name>. Run file: docs/runs/<name>.md. Copy file: <docs/07-content-appendix/<letter>-<name>.md (new) | none (no user-facing wording) | <file> (approved; any line it lacks is a question)>.
- The owner's decisions that bind this task (quote them; never make the session re-ask): <…>.
- Read first: <the exact files and record rows>.
- Do: <the items, numbered; "check each still exists on main first; drop any already fixed, saying so" for follow-up sweeps>.
- Tier <A|B|C>. Agents: <e.g. "one builder, then the analyst's early check, then one designer, then one reviewer">.
- Other work nearby: <files the PC or the other cloud session is editing; "avoid those files; if an item needs one, list it as a follow-up">.
- Merge order: this branch merges <first | after <name>>; when the main session says so, take origin/main in<, renumbering unapplied migrations from <NNNN>>.
- Done means: <the task's own finish line, if it differs from the shared rules' FINISH>.
```

Checklist before sending:
- The session name is short, lower case, `[a-z0-9.-]`, and unique in the run; the branch and run file use it (the watcher's run list is built from these three).
- Every owner decision the task depends on is quoted with its date.
- Files another session edits are named, so the two never touch the same file.
- Migration numbers: "after main's newest" plus the merge order, or "no migrations in this run".
- The copy file letter is the next free one in `docs/07-content-appendix/` (two sessions never share a letter).
