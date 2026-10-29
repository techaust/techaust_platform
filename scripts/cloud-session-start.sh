#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json, "startup|resume"; CLOUD-1). It does something ONLY in a Claude Code cloud session:
# Claude Code sets CLAUDE_CODE_REMOTE=true there and never on this PC, so here it exits at once and changes nothing.
#
# In a cloud session (after scripts/cloud-setup.sh provisioned the VM) it prepares the project, then prints one summary line:
#   - the model check: the hook's input (stdin JSON) may carry the session's `model`; if it does and it isn't Opus 5.5
#     (claude-opus-5-5…), the summary line starts with "MODEL IS <x>, NOT Opus 5.5: stop and tell the owner" (SessionStart stdout
#     reaches Claude as context). No `model` field, empty input or a terminal: no check, never a wait.
#   - Node 24 (/opt/node24) first on PATH, PLAYWRIGHT_BROWSERS_PATH and WRANGLER_SEND_METRICS=false (no wrangler telemetry), for
#     this script and for every later Bash command (written to CLAUDE_ENV_FILE)
#   - `pnpm install --frozen-lockfile`, skipped while a sha256 of pnpm-lock.yaml, pnpm-workspace.yaml (allowBuilds, overrides…),
#     every package.json and this script is unchanged
#   - `pnpm dev:secrets` (local random values only; an existing .dev.vars keeps its values), `pnpm db:migrate:local`,
#     `pnpm db:seed:local` (both safe to repeat)
# `wrangler types` is not run: every package's `typecheck` runs it first. Full output: .logs/cloud-session-start.log. A failed step
# is named in the summary and the session still starts (exit 0).
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

set -u
START=$(date +%s)
# The hook's input, read at once (at most 2 s) and never from a terminal.
HOOK_INPUT=""
[ -t 0 ] || HOOK_INPUT="$(timeout 2 cat 2>/dev/null || true)"
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || {
  echo "cloud session start: project folder $ROOT not found"
  exit 0
}
mkdir -p .logs
LOG=.logs/cloud-session-start.log
: >"$LOG"

NODE_BIN=/opt/node24/bin
BROWSERS=/opt/ms-playwright
[ -x "$NODE_BIN/node" ] && export PATH="$NODE_BIN:$PATH"
[ -d "$BROWSERS" ] && export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export WRANGLER_SEND_METRICS=false
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    [ -x "$NODE_BIN/node" ] && echo "export PATH=\"$NODE_BIN:\$PATH\""
    [ -d "$BROWSERS" ] && echo "export PLAYWRIGHT_BROWSERS_PATH=$BROWSERS"
    echo "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
    echo "export WRANGLER_SEND_METRICS=false"
  } >>"$CLAUDE_ENV_FILE"
fi

# The session's model, if the hook was told it (Opus 5.5 only, docs/14). Node reads the JSON; anything unreadable means no check.
MODEL="$(printf '%s' "$HOOK_INPUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const m=JSON.parse(s).model;if(typeof m==="string")process.stdout.write(m)}catch{}})' 2>/dev/null || true)"
MODEL_WARNING=""
case "$MODEL" in
  "" | claude-opus-5-5*) ;;
  *) MODEL_WARNING="MODEL IS $MODEL, NOT Opus 5.5: stop and tell the owner; " ;;
esac

DONE=()
FAILED=()
step() { # name, command…  (status: the command's)
  local name="$1"
  shift
  echo "== $name: $*" >>"$LOG"
  if "$@" >>"$LOG" 2>&1; then
    DONE+=("$name")
  else
    FAILED+=("$name")
    return 1
  fi
}

# The install is skipped while nothing it depends on changed (the hash is kept inside node_modules, so a fresh clone installs).
STAMP=node_modules/.techaust-cloud-install.sha256
hash_inputs() {
  { git ls-files -z -- pnpm-lock.yaml pnpm-workspace.yaml 'package.json' '*/package.json' | xargs -0 sha256sum; sha256sum scripts/cloud-session-start.sh; } |
    sha256sum | cut -d' ' -f1
}
WANT="$(hash_inputs)"
if [ -d node_modules ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$WANT" ]; then
  DONE+=("install (unchanged, skipped)")
else
  step install pnpm install --frozen-lockfile && printf '%s\n' "$WANT" >"$STAMP"
fi
step "dev secrets" pnpm dev:secrets
step "local database" pnpm db:migrate:local
step "seed" pnpm db:seed:local

join() { # items… → "a, b, c"
  local out="" item
  for item in "$@"; do out="${out:+$out, }$item"; done
  echo "${out:-none}"
}
line="${MODEL_WARNING}cloud session start ($(($(date +%s) - START)) s): node $(node -v 2>/dev/null || echo missing), pnpm $(pnpm -v 2>/dev/null || echo missing); done: $(join "${DONE[@]}")"
[ "${#FAILED[@]}" -gt 0 ] && line="$line; FAILED: $(join "${FAILED[@]}") (see $LOG)"
echo "$line"
exit 0
