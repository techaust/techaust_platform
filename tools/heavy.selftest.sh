#!/usr/bin/env bash
# Self-test for tools/heavy.sh (the lock and its stale handling). Run: bash tools/heavy.selftest.sh
# Uses a throwaway lock path (HEAVY_LOCK), no memory check and a 1 s poll, so it never touches the real queue.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEAVY="$HERE/heavy.sh"
WORK="$(mktemp -d)"
export HEAVY_LOCK="$WORK/lock" HEAVY_MIN_FREE_MB=0 HEAVY_POLL_S=1
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
cleanup() { [ -n "${BG:-}" ] && kill "$BG" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

dead_pid() { bash -c 'echo $$' ; }

# 1. A normal run passes the exit code through and releases the lock.
bash "$HEAVY" bash -c 'exit 7' >/dev/null 2>&1; rc=$?
check "exit code is passed through" "[ $rc -eq 7 ]"
check "the lock is released afterwards" "[ ! -e '$HEAVY_LOCK' ]"

# 2. The lock records the owner's PID while a command runs.
bash "$HEAVY" bash -c "cat '$HEAVY_LOCK/pid' > '$WORK/pid-seen'" >/dev/null 2>&1
check "the lock holds the owner's PID" "[ -s '$WORK/pid-seen' ]"

# 3. A lock whose owner is gone is removed at once (not after 90 minutes).
mkdir "$HEAVY_LOCK"; dead_pid > "$HEAVY_LOCK/pid"; echo "crashed: pnpm test" > "$HEAVY_LOCK/cmd"
out="$(timeout 20 bash "$HEAVY" echo ran 2>&1)"
check "a lock with a dead owner is taken over" "[[ \"$out\" == *'removing a stale lock'* && \"$out\" == *ran* ]]"
check "…and released afterwards" "[ ! -e '$HEAVY_LOCK' ]"

# 4. A lock whose owner is alive is respected; once the owner is gone the waiter proceeds.
sleep 600 & BG=$!
mkdir "$HEAVY_LOCK"; echo "$BG" > "$HEAVY_LOCK/pid"; echo "someone: pnpm build" > "$HEAVY_LOCK/cmd"
timeout 4 bash "$HEAVY" echo should-not-run > "$WORK/live.out" 2>&1; rc=$?
check "a live owner's lock is not taken" "[ $rc -eq 124 ] && ! grep -q should-not-run '$WORK/live.out' && [ -d '$HEAVY_LOCK' ]"
kill "$BG" 2>/dev/null; wait "$BG" 2>/dev/null; BG=""
out="$(timeout 20 bash "$HEAVY" echo ran-after 2>&1)"
check "…and is taken once the owner is gone" "[[ \"$out\" == *ran-after* ]]"

# 5. A lock with no PID file that is not old is left alone (it may be mid-creation).
mkdir "$HEAVY_LOCK"
timeout 4 bash "$HEAVY" echo should-not-run > "$WORK/nopid.out" 2>&1; rc=$?
check "a fresh lock without a PID is not taken" "[ $rc -eq 124 ] && ! grep -q should-not-run '$WORK/nopid.out'"
rm -rf "$HEAVY_LOCK"

# 6. Two waiters on one stale lock: exactly one removes it, and they then run one after the other, never together.
mkdir "$HEAVY_LOCK"; dead_pid > "$HEAVY_LOCK/pid"
log="$WORK/order.log"; : > "$log"
job="echo start >> '$log'; sleep 2; echo end >> '$log'"
bash "$HEAVY" bash -c "$job" >/dev/null 2>&1 &
p1=$!
bash "$HEAVY" bash -c "$job" >/dev/null 2>&1 &
p2=$!
wait "$p1" "$p2"
check "two waiters on a stale lock never overlap" "[ \"\$(tr '\n' ' ' < '$log')\" = 'start end start end ' ]"
check "…and the lock ends up released" "[ ! -e '$HEAVY_LOCK' ] && [ ! -e '$HEAVY_LOCK.reaper' ]"

# 7. A holder never removes a lock that is no longer its own.
bash "$HEAVY" bash -c "echo 1 > '$HEAVY_LOCK/pid'" >/dev/null 2>&1
check "release leaves a lock that belongs to someone else" "[ -d '$HEAVY_LOCK' ] && [ \"\$(cat '$HEAVY_LOCK/pid')\" = 1 ]"
rm -rf "$HEAVY_LOCK"

# 8. The lock also records the PID of the command, and the command's own exit code still comes through.
bash "$HEAVY" bash -c "cat '$HEAVY_LOCK/child' > '$WORK/child-seen'; echo \$\$ > '$WORK/real-pid'; exit 3" >/dev/null 2>&1; rc=$?
check "the lock holds the command's PID and the exit code is kept" "[ -s '$WORK/child-seen' ] && [ $rc -eq 3 ]"

# 9. A wrapper killed hard (no trap runs) while its command still runs must NOT free the queue; once the command
#    is gone too, the lock is taken over at once.
bash "$HEAVY" sleep 600 >/dev/null 2>&1 &
W=$!
for _ in $(seq 1 50); do [ -s "$HEAVY_LOCK/child" ] && break; sleep 0.2; done
CH="$(cat "$HEAVY_LOCK/child" 2>/dev/null)"
check "the running command's PID is in the lock" "[ -n '$CH' ] && kill -0 '$CH' 2>/dev/null"
kill -9 "$W" 2>/dev/null; wait "$W" 2>/dev/null
check "the wrapper is gone but its command still runs" "! kill -0 '$W' 2>/dev/null && kill -0 '$CH' 2>/dev/null"
timeout 4 bash "$HEAVY" echo should-not-run > "$WORK/orphan.out" 2>&1; rc=$?
check "a live command keeps the lock after its wrapper was killed" "[ $rc -eq 124 ] && ! grep -q should-not-run '$WORK/orphan.out' && [ -d '$HEAVY_LOCK' ]"
kill "$CH" 2>/dev/null
for _ in $(seq 1 25); do kill -0 "$CH" 2>/dev/null || break; sleep 0.2; done
out="$(timeout 20 bash "$HEAVY" echo ran-orphan 2>&1)"
check "…and the lock is taken over once the command is gone too" "[[ \"$out\" == *'removing a stale lock'* && \"$out\" == *ran-orphan* ]]"

# 10. A lock older than the absolute ceiling is stale even if its PIDs look alive (PIDs get reused).
sleep 600 & BG=$!
mkdir "$HEAVY_LOCK"; echo "$BG" > "$HEAVY_LOCK/pid"; echo "$BG" > "$HEAVY_LOCK/child"
touch -d '8 hours ago' "$HEAVY_LOCK/pid"
out="$(timeout 20 bash "$HEAVY" echo ran-ceiling 2>&1)"
check "a lock past the 6 hour ceiling is taken over" "[[ \"$out\" == *ceiling* && \"$out\" == *ran-ceiling* ]]"
kill "$BG" 2>/dev/null; wait "$BG" 2>/dev/null; BG=""

# 11. Under the reaper the decision is made again: a lock that became live again is left alone.
sleep 600 & BG=$!
mkdir "$HEAVY_LOCK"; echo "$BG" > "$HEAVY_LOCK/pid"; echo "$BG" > "$HEAVY_LOCK/child"
mkdir "$HEAVY_LOCK.reaper" # as if another waiter holds it
timeout 4 bash "$HEAVY" echo should-not-run > "$WORK/reaper.out" 2>&1; rc=$?
check "a live lock survives a waiter (and a held reaper is not broken early)" "[ $rc -eq 124 ] && [ -d '$HEAVY_LOCK' ] && [ -d '$HEAVY_LOCK.reaper' ]"
kill "$BG" 2>/dev/null; wait "$BG" 2>/dev/null; BG=""
rm -rf "$HEAVY_LOCK" "$HEAVY_LOCK.reaper"

# 12. Linux (a cloud session, CLOUD-1): free memory comes from MemAvailable in /proc/meminfo (here a stand-in file). Low memory
#     makes the command wait; enough lets it run.
printf 'MemTotal:       16384000 kB\nMemFree:          90000 kB\nMemAvailable:     102400 kB\n' > "$WORK/meminfo-low"
printf 'MemTotal:       16384000 kB\nMemFree:        1000000 kB\nMemAvailable:    2097152 kB\n' > "$WORK/meminfo-ok"
HEAVY_MEMINFO="$WORK/meminfo-low" HEAVY_MIN_FREE_MB=512 timeout 4 bash "$HEAVY" echo should-not-run > "$WORK/mem.out" 2>&1; rc=$?
check "Linux: under the floor it waits (MemAvailable 100 MB)" "[ $rc -eq 124 ] && grep -q 'low memory (100 MB free)' '$WORK/mem.out' && ! grep -q should-not-run '$WORK/mem.out'"
out="$(HEAVY_MEMINFO="$WORK/meminfo-ok" HEAVY_MIN_FREE_MB=512 timeout 20 bash "$HEAVY" echo ran-mem 2>&1)"
check "Linux: with 2048 MB available it runs" "[[ \"$out\" == *ran-mem* && \"$out\" != *'low memory'* ]]"
rm -rf "$HEAVY_LOCK"

# 13. On a real Linux machine (a cloud session), the real /proc/meminfo gives a number.
if [ -r /proc/meminfo ] && ! command -v powershell.exe >/dev/null 2>&1; then
  mb="$(awk '/^MemAvailable:/ { print int($2 / 1024); exit }' /proc/meminfo)"
  check "Linux: /proc/meminfo has MemAvailable (${mb:-none} MB)" "[ -n '$mb' ] && [ '$mb' -gt 0 ]"
else
  echo "skip - not Linux: the real /proc/meminfo check runs in a cloud session"
fi

echo
if [ "$fails" -eq 0 ]; then echo "heavy.sh self-test: all passed"; else echo "heavy.sh self-test: $fails failed"; exit 1; fi
