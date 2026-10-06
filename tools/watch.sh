#!/usr/bin/env bash
# Event watch for the lead while builders run (used with the Monitor tool). Prints ONE line and exits when:
#   - a builder worktree has had no new commit for 20 minutes while the heavy lock is free (a stall), or
#   - free memory drops under 512 MB.
# Builder completion itself arrives as a task notification, so it isn't watched here.
# Usage: bash tools/watch.sh <worktree> [<worktree>...]
set -u
LOCK="$HOME/.techaust-heavy.lock"
STALL_S=1200
while :; do
  mb="$(powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r')"
  if [ -n "$mb" ] && [ "$mb" -lt 512 ]; then echo "EVENT low-memory ${mb}MB"; exit 0; fi
  if [ ! -d "$LOCK" ]; then
    now=$(date +%s)
    for wt in "$@"; do
      last=$(git -C "$wt" log -1 --format=%ct 2>/dev/null || echo 0)
      started=$(stat -c %Y "$wt" 2>/dev/null || echo "$now")
      [ "$last" -gt "$started" ] || last=$started
      if [ $((now - last)) -ge $STALL_S ]; then echo "EVENT stall $wt (no commit for $(((now - last) / 60)) min, lock free)"; exit 0; fi
    done
  fi
  sleep 60
done
