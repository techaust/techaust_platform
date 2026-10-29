# Usage reading for cloud sessions

A cloud session that can't read the 5-hour bar itself reads this file before starting any agent (docs/14 §5, owner 2026-10-29):
- **No reading for today (IST):** nothing new starts.
- **A reading over 2 hours old:** one agent at a time.
- **A reading over 95 %:** nothing new starts.

The local lead (or the owner) updates the line below on the cloud session's branch. Keep the format: `node tools/agent-slots.mjs --cloud --reading <pct> --reading-at <time>` takes these two values.

Reading: none yet
