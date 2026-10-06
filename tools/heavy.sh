#!/usr/bin/env bash
# Shared queue for heavy commands (full lint, typecheck, build, database tests, end-to-end tests) when
# builders share this PC. Usage: bash tools/heavy.sh <command...>
# One lock per PC (a folder in the home directory, so every worktree shares it). A lock older than
# 90 minutes is treated as stale (a crashed run). Waits while free memory is under HEAVY_MIN_FREE_MB.
# Exit code = the command's.
set -u
LOCK="$HOME/.techaust-heavy.lock"
STALE_MIN=90
MIN_FREE_MB="${HEAVY_MIN_FREE_MB:-512}"
[ $# -gt 0 ] || { echo "Usage: bash tools/heavy.sh <command...>" >&2; exit 2; }

free_mb() {
  powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r'
}

told=""
while :; do
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +$STALE_MIN 2>/dev/null)" ]; then
    echo "[heavy] removing a stale lock (older than $STALE_MIN min)" >&2
    rm -rf "$LOCK"
  fi
  mb="$(free_mb)"
  if [ -n "$mb" ] && [ "$mb" -lt "$MIN_FREE_MB" ]; then
    [ "$told" = mem ] || echo "[heavy] waiting: low memory (${mb} MB free)" >&2
    told=mem
  elif mkdir "$LOCK" 2>/dev/null; then
    break
  else
    [ "$told" = lock ] || echo "[heavy] waiting for another heavy command: $(cat "$LOCK/cmd" 2>/dev/null)" >&2
    told=lock
  fi
  sleep 5
done

trap 'rm -rf "$LOCK"' EXIT INT TERM
printf '%s\n' "$PWD: $*" > "$LOCK/cmd"
"$@"
