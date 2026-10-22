#!/usr/bin/env bash
# Shared queue for heavy commands (full lint, typecheck, build, database tests, end-to-end tests) when
# builders share this PC. Usage: bash tools/heavy.sh [--log <name>] <command...>
# With --log, the full output goes to .logs/<name>.log (git-ignored) and only the last 40 lines and
# the exit code are printed, so agents read the tail and grep the log instead of the whole output.
# One lock per PC (a folder in the home directory, so every worktree shares it). The lock holds the PID of the
# run that owns it: a lock whose PID is gone is stale and is removed at once (a crashed run no longer blocks the
# queue for 90 minutes). A lock with no PID file (being created, or from the old script) is stale after 90 minutes.
# Stale removal is serialised by a second folder (<lock>.reaper), so only one waiter removes it and a live lock
# can't be removed by mistake. Waits while free memory is under HEAVY_MIN_FREE_MB (0 turns the check off).
# HEAVY_LOCK overrides the lock path (used by tools/heavy.selftest.sh). Exit code = the command's.
set -u
LOCK="${HEAVY_LOCK:-$HOME/.techaust-heavy.lock}"
REAPER="$LOCK.reaper"
STALE_MIN=90
MIN_FREE_MB="${HEAVY_MIN_FREE_MB:-512}"
usage() { echo "Usage: bash tools/heavy.sh [--log <name>] <command...>" >&2; exit 2; }
LOG=""
if [ "${1:-}" = "--log" ]; then
  [ $# -ge 3 ] || usage
  case "$2" in *[!A-Za-z0-9._-]*|"") echo "[heavy] log name: letters, digits, . _ - only" >&2; exit 2 ;; esac
  LOG=".logs/$2.log"
  shift 2
fi
[ $# -gt 0 ] || usage

free_mb() {
  [ "$MIN_FREE_MB" -gt 0 ] || return 0
  powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r'
}

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Removes the lock if it is stale. Only the waiter that holds the reaper folder may do it, and it re-reads the PID
# under that folder, so a lock that was replaced in the meantime is left alone.
reap_if_stale() {
  [ -d "$LOCK" ] || return 0
  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$pid" ]; then
    pid_alive "$pid" && return 0
  elif [ -z "$(find "$LOCK" -maxdepth 0 -mmin +$STALE_MIN 2>/dev/null)" ]; then
    return 0
  fi
  # A reaper that died leaves its folder behind; give it a few minutes, then clear it.
  if [ -d "$REAPER" ] && [ -n "$(find "$REAPER" -maxdepth 0 -mmin +5 2>/dev/null)" ]; then rm -rf "$REAPER"; fi
  mkdir "$REAPER" 2>/dev/null || return 0 # another waiter is already doing it
  local again
  again="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -d "$LOCK" ] && [ "$again" = "$pid" ] && ! pid_alive "$pid"; then
    if [ -n "$pid" ]; then
      echo "[heavy] removing a stale lock (its owner, PID $pid, is gone)" >&2
    else
      echo "[heavy] removing a stale lock (no PID, older than $STALE_MIN min)" >&2
    fi
    rm -rf "$LOCK"
  fi
  rmdir "$REAPER" 2>/dev/null
  return 0
}

told=""
while :; do
  reap_if_stale
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
  sleep "${HEAVY_POLL_S:-5}"
done

# Release only our own lock (if it was ever taken from us, never remove somebody else's).
release() { [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"; }
trap release EXIT INT TERM
printf '%s\n' "$$" > "$LOCK/pid"
printf '%s\n' "$PWD: $*" > "$LOCK/cmd"
if [ -n "$LOG" ]; then
  mkdir -p .logs
  "$@" > "$LOG" 2>&1
  rc=$?
  tail -n 40 "$LOG"
  echo "[heavy] exit $rc; full log: $LOG" >&2
  exit "$rc"
fi
"$@"
