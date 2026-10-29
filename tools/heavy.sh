#!/usr/bin/env bash
# Shared queue for heavy commands (full lint, typecheck, build, database tests, end-to-end tests) when
# builders share this PC. Usage: bash tools/heavy.sh [--log <name>] <command...>
# With --log, the full output goes to .logs/<name>.log (git-ignored) and only the last 40 lines and
# the exit code are printed, so agents read the tail and grep the log instead of the whole output.
# One lock per PC (a folder in the home directory, so every worktree shares it). The lock holds the PID of the
# run that owns it, and the PID of the command it runs (`child`; the command runs in the background): a lock is
# stale, and removed at once, only when both are gone (a crashed run no longer blocks the queue for 90 minutes, and
# a wrapper killed hard while its command still runs does not let a second heavy command start). A lock with no
# PID file (being created, or from the old script) is stale after 90 minutes; any lock is stale after 6 hours.
# Stale removal is serialised by a second folder (<lock>.reaper), so only one waiter removes it and a live lock
# can't be removed by mistake. Waits while free memory is under HEAVY_MIN_FREE_MB (0 turns the check off). Runs on this PC (Git
# Bash) and on Linux (a cloud session): the PID checks use `kill -0`, which works on both, and free memory is read per OS.
# HEAVY_LOCK overrides the lock path (used by tools/heavy.selftest.sh). Exit code = the command's.
set -u
LOCK="${HEAVY_LOCK:-$HOME/.techaust-heavy.lock}"
REAPER="$LOCK.reaper"
STALE_MIN=90
CEILING_MIN="${HEAVY_CEILING_MIN:-360}" # absolute ceiling: 6 hours (overridable only for the self-test)
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

# Free memory in MB, or nothing if it can't be read. Windows (this PC, Git Bash): PowerShell, as before. Linux (a cloud session,
# CLOUD-1): MemAvailable from /proc/meminfo. HEAVY_MEMINFO names another meminfo file (used only by tools/heavy.selftest.sh).
free_mb() {
  [ "$MIN_FREE_MB" -gt 0 ] || return 0
  if [ -z "${HEAVY_MEMINFO:-}" ] && command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r'
  elif [ -r "${HEAVY_MEMINFO:-/proc/meminfo}" ]; then
    awk '/^MemAvailable:/ { print int($2 / 1024); exit }' "${HEAVY_MEMINFO:-/proc/meminfo}"
  fi
}

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Why the lock is stale, or nothing (and status 1) if it is not. The lock holds two PIDs: `pid` (this wrapper) and
# `child` (the command it runs, in the background). A hard-killed wrapper leaves the child running, so the lock is
# stale only when BOTH are gone. A lock with no PID is stale after STALE_MIN minutes (being created, or the old
# script). Whatever the PIDs say, a lock older than CEILING_MIN minutes is stale (PIDs get reused; nothing here
# runs that long).
stale_reason() {
  local pid child
  pid="$(cat "$LOCK/pid" 2>/dev/null)"
  child="$(cat "$LOCK/child" 2>/dev/null)"
  if [ -n "$pid" ] && [ -n "$(find "$LOCK/pid" -maxdepth 0 -mmin +$CEILING_MIN 2>/dev/null)" ]; then
    echo "older than the $CEILING_MIN-minute ceiling"
  elif [ -z "$pid" ]; then
    [ -n "$(find "$LOCK" -maxdepth 0 -mmin +$STALE_MIN 2>/dev/null)" ] || return 1
    echo "no PID, older than $STALE_MIN min"
  elif pid_alive "$pid" || pid_alive "$child"; then
    return 1
  else
    echo "its owner, PID $pid, and its command are gone"
  fi
}

# Removes the lock if it is stale. Only the waiter that holds the reaper folder may do it, and under that folder it
# decides again (PIDs, age) from a fresh read, so a lock that was replaced in the meantime is left alone.
reap_if_stale() {
  [ -d "$LOCK" ] || return 0
  stale_reason >/dev/null || return 0
  # A reaper that died leaves its folder behind; give it a few minutes, then clear it.
  if [ -d "$REAPER" ] && [ -n "$(find "$REAPER" -maxdepth 0 -mmin +5 2>/dev/null)" ]; then rm -rf "$REAPER"; fi
  mkdir "$REAPER" 2>/dev/null || return 0 # another waiter is already doing it
  local why
  if [ -d "$LOCK" ] && why="$(stale_reason)"; then
    echo "[heavy] removing a stale lock ($why)" >&2
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
child=""
# On Ctrl-C or a polite kill, stop the command too, then leave (the EXIT trap releases the lock).
stop() { [ -n "$child" ] && kill "$child" 2>/dev/null; exit 143; }
trap release EXIT
trap stop INT TERM
printf '%s\n' "$$" > "$LOCK/pid"
printf '%s\n' "$PWD: $*" > "$LOCK/cmd"
# The command runs in the background and its PID goes into the lock, so a wrapper that is killed hard (no trap
# runs) cannot free the queue while the command is still running. Standard input is passed on explicitly,
# because a background job otherwise reads /dev/null.
if [ -n "$LOG" ]; then
  mkdir -p .logs
  "$@" <&0 > "$LOG" 2>&1 &
else
  "$@" <&0 &
fi
child=$!
printf '%s\n' "$child" > "$LOCK/child"
wait "$child"
rc=$?
if [ -n "$LOG" ]; then
  tail -n 40 "$LOG"
  echo "[heavy] exit $rc; full log: $LOG" >&2
fi
exit "$rc"
