#!/usr/bin/env bash
# "check cloud setup" (CLOUD-1; docs/runbooks/cloud-sessions.md): one report on whether a cloud session is ready. Run from the
# repository root: bash scripts/cloud-check.sh
# Each line is "ok", "FAIL" or "info"; the exit code is 1 if any line failed. It changes nothing except the test run's coverage
# output and its log (.logs/cloud-check-core.log). Works on this PC too, where it reports what differs (not a cloud session, no
# /opt browsers) as info.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
info() { echo "info - $1"; }
REMOTE="${CLAUDE_CODE_REMOTE:-}"
cloud() { [ "$REMOTE" = "true" ]; }
NODE_WANT="$(tr -d ' \r\n' <.nvmrc)"
PNPM_WANT="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"

# 1. Where we are
if cloud; then ok "cloud session (CLAUDE_CODE_REMOTE=true)"; else info "not a cloud session (CLAUDE_CODE_REMOTE=${REMOTE:-unset})"; fi

# 2. Node and pnpm
node_v="$(node -v 2>/dev/null)"
case "$node_v" in
  "v${NODE_WANT}".*) ok "node ${node_v} ($(command -v node))" ;;
  *) bad "node ${node_v:-missing}: the repository needs ${NODE_WANT}.x (.nvmrc); the setup script installs it in /opt/node24" ;;
esac
pnpm_v="$(pnpm -v 2>/dev/null)"
if [ "$pnpm_v" = "$PNPM_WANT" ]; then ok "pnpm ${pnpm_v}"; else bad "pnpm ${pnpm_v:-missing}: package.json pins ${PNPM_WANT}"; fi

# 3. Machine: memory, processors, load (agent limits in docs/14 §5 read these)
if [ -r /proc/meminfo ] && ! command -v powershell.exe >/dev/null 2>&1; then
  avail="$(awk '/^MemAvailable:/ { print int($2 / 1024); exit }' /proc/meminfo)"
  total="$(awk '/^MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo)"
  info "memory ${avail} MB free of ${total} MB; $(nproc) processors; load $(cut -d' ' -f1-3 /proc/loadavg)"
else
  info "memory and load: read on Linux only (this PC: tools/heavy.sh reads PowerShell)"
fi

# 4. The agent-start rule for this machine (exit 1 there only means "no agent may start now")
info "agent slots: $(node tools/agent-slots.mjs --cloud --running 0 --browsers 0 2>&1)"

# 5. One quick test package, through the heavy queue
if bash tools/heavy.sh --log cloud-check-core pnpm --filter @techaust/core test >/dev/null 2>&1; then
  ok "pnpm --filter @techaust/core test passed"
else
  bad "pnpm --filter @techaust/core test failed (grep .logs/cloud-check-core.log)"
fi

# 6. The Playwright MCP server (.mcp.json): declared, and known to Claude Code in this session
mcp_ver="$(sed -n 's/.*"@playwright\/mcp@\([0-9.]*\)".*/\1/p' .mcp.json)"
if [ -n "$mcp_ver" ]; then ok ".mcp.json declares playwright (@playwright/mcp@${mcp_ver})"; else bad ".mcp.json has no @playwright/mcp server"; fi
if command -v claude >/dev/null 2>&1; then
  listed="$(timeout 120 claude mcp list 2>&1 | grep -E '^playwright:' | head -1)"
  if [ -n "$listed" ]; then
    if cloud; then ok "claude mcp list: ${listed}"; else info "claude mcp list: ${listed}"; fi
  elif cloud; then
    bad "claude mcp list does not show the playwright server"
  else
    info "claude mcp list: the project playwright server is off here (this PC uses the plugin)"
  fi
else
  info "the claude command is not on PATH; the server list was not read"
fi

# 7. Chromium launches headless: @playwright/test's (the browser tests) and the MCP server's (the agents' browser)
browsers="${PLAYWRIGHT_BROWSERS_PATH:-}"
if out="$(cd apps/web && node --input-type=module -e '
  const { chromium } = await import("@playwright/test");
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent("<h1>ready</h1>");
  console.log(`${await p.textContent("h1")} (Chromium ${b.version()})`);
  await b.close();' 2>&1)"; then
  ok "@playwright/test Chromium launches headless: ${out}"
else
  bad "@playwright/test Chromium did not launch: $(echo "$out" | tail -n 3 | tr '\n' ' ')"
fi
if cloud; then
  if [ -n "$browsers" ] && [ -d "$browsers" ]; then
    info "browsers in ${browsers}: $(ls "$browsers" | tr '\n' ' ')"
    # where the MCP server's own Playwright build looks for its Chromium (a dry run installs nothing)
    loc="$(timeout 120 npx -y "@playwright/mcp@${mcp_ver}" install-browser --dry-run --no-shell chromium 2>/dev/null |
      sed -n 's/^ *Install location: *//p' | head -1)"
    if [ -n "$loc" ] && [ -d "$loc" ]; then ok "the MCP server's Chromium is installed (${loc})"; else
      bad "the MCP server's Chromium is missing (${loc:-location unknown}); rerun the setup script's browser step"
    fi
  else
    bad "PLAYWRIGHT_BROWSERS_PATH is not set or missing (the SessionStart hook sets /opt/ms-playwright)"
  fi
else
  info "the MCP server's Chromium is checked in a cloud session only (this PC uses the Playwright plugin)"
fi

echo
if [ "$fails" -eq 0 ]; then echo "cloud check: all passed"; else echo "cloud check: $fails failed"; exit 1; fi
