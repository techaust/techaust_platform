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

echo
if [ "$fails" -eq 0 ]; then echo "heavy.sh self-test: all passed"; else echo "heavy.sh self-test: $fails failed"; exit 1; fi
