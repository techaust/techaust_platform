#!/usr/bin/env bash
# Setup script of the claude.ai cloud environment "techaust_platform" (CLOUD-1; docs/runbooks/cloud-sessions.md). The owner pastes this
# whole file into the environment's "Setup script" box; it is kept here only for review and history: editing this file changes
# nothing in the cloud until it is pasted again.
#
# It runs as root on the Ubuntu 24.04 VM before Claude Code starts, must exit 0 (else the session does not start) and should finish
# within about 5 minutes (else the environment is not cached). It provisions the machine only; the project's own setup (pnpm install,
# dev secrets, the local database) is the SessionStart hook, scripts/cloud-session-start.sh.
#   - Node 24 (the repo's .nvmrc and `engines`), checksum-verified, linked as /opt/techaust-node (a name of our own: the image may
#     bring its own Node in /opt/node24) and first on PATH through /usr/local/bin
#   - pnpm 12.9.1 (`packageManager`) through corepack
#   - Chromium for @playwright/test 1.64.1 (with its system libraries) and for the Playwright MCP server in .mcp.json, both in
#     /opt/ms-playwright (PLAYWRIGHT_BROWSERS_PATH; the SessionStart hook exports it for the session)
# Critical steps (Node, pnpm) stop the script with an error; the browsers are not critical (a session without them still builds and
# tests), so their failure is reported and the script carries on. Network: the environment's Custom list must allow
# cdn.playwright.dev and playwright.download.prss.microsoft.com (the runbook); npm and nodejs.org are in the default list.
set -u

# Pins. A test (apps/web/test/cloud-setup.test.ts) keeps them equal to the repository's own: .nvmrc and `engines` (Node),
# `packageManager` (pnpm), the @playwright/test pin of the apps (PLAYWRIGHT_VERSION) and .mcp.json (PLAYWRIGHT_MCP_VERSION).
NODE_VERSION=24.22.2
NODE_SHA256_X64=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
NODE_SHA256_ARM64=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8
PNPM_VERSION=12.9.1
PLAYWRIGHT_VERSION=1.64.1
PLAYWRIGHT_MCP_VERSION=0.0.83
export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export npm_config_update_notifier=false

START=$(date +%s)
LOGDIR=/var/log/techaust-setup
mkdir -p "$LOGDIR" "$PLAYWRIGHT_BROWSERS_PATH"
SUMMARY=()
note() { SUMMARY+=("$1"); echo "[setup] $1"; }
die() { echo "[setup] FAILED: $1" >&2; exit 1; }

# 1. Node 24, verified against the checksum pinned above, unpacked to /opt and linked into /usr/local/bin.
case "$(uname -m)" in
  x86_64) ARCH=x64; SUM=$NODE_SHA256_X64 ;;
  aarch64 | arm64) ARCH=arm64; SUM=$NODE_SHA256_ARM64 ;;
  *) die "unsupported machine $(uname -m)" ;;
esac
NODE_NAME="node-v${NODE_VERSION}-linux-${ARCH}"
if [ ! -x "/opt/${NODE_NAME}/bin/node" ]; then
  curl -fsSL --retry 3 -o "/tmp/${NODE_NAME}.tar.xz" "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_NAME}.tar.xz" ||
    die "download of Node ${NODE_VERSION}"
  echo "${SUM}  /tmp/${NODE_NAME}.tar.xz" | sha256sum -c --status || die "Node ${NODE_VERSION}: checksum mismatch"
  # tar needs xz for a .tar.xz; an image without it gets xz-utils from Ubuntu's archive (in the default network list).
  if ! command -v xz >/dev/null 2>&1; then
    { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xz-utils; } >"$LOGDIR/xz.log" 2>&1 ||
      die "installing xz-utils (see $LOGDIR/xz.log)"
    note "xz-utils installed (tar needs it for Node's .tar.xz)"
  fi
  tar -xJf "/tmp/${NODE_NAME}.tar.xz" -C /opt || die "unpacking Node ${NODE_VERSION}"
  rm -f "/tmp/${NODE_NAME}.tar.xz"
fi
# -T: the link replaces /opt/techaust-node itself, never lands inside a real folder of that name (ln -sfn onto an existing
# directory puts the link inside it, which kept an image's own Node first; 2026-10-31).
[ -L /opt/techaust-node ] || [ ! -e /opt/techaust-node ] || rm -rf /opt/techaust-node
ln -sfnT "/opt/${NODE_NAME}" /opt/techaust-node || die "linking /opt/techaust-node"
for bin in node npm npx corepack; do ln -sf "/opt/techaust-node/bin/${bin}" "/usr/local/bin/${bin}"; done
export PATH="/opt/techaust-node/bin:/usr/local/bin:$PATH"
hash -r
[ "$(node -v)" = "v${NODE_VERSION}" ] ||
  die "node -v says $(node -v), not v${NODE_VERSION} (node is $(readlink -f "$(command -v node)"); ls /opt: $(ls /opt | tr '\n' ' '))"
note "Node $(node -v) (/opt/techaust-node, linked into /usr/local/bin)"

# 2. pnpm through corepack (the version in package.json `packageManager`): the shims go next to Node 24's own binaries (first on
#    PATH in a session) and are linked into /usr/local/bin, replacing any pnpm the image brought.
corepack enable pnpm || die "corepack enable"
for bin in pnpm pnpx; do [ -e "/opt/techaust-node/bin/${bin}" ] && ln -sf "/opt/techaust-node/bin/${bin}" "/usr/local/bin/${bin}"; done
corepack prepare "pnpm@${PNPM_VERSION}" --activate >"$LOGDIR/pnpm.log" 2>&1 || die "corepack prepare pnpm@${PNPM_VERSION} (see $LOGDIR/pnpm.log)"
[ "$(pnpm -v 2>/dev/null)" = "${PNPM_VERSION}" ] || die "pnpm -v says $(pnpm -v 2>/dev/null), not ${PNPM_VERSION}"
note "pnpm $(pnpm -v)"

# 3. The browsers, both at once (not critical). @playwright/test's Chromium with the system libraries (apt), and the Chromium
#    ("Chrome for Testing") of the Playwright MCP server's own Playwright build, which may be a different revision. The npx cache
#    then holds the MCP server, so its first start in a session is quick.
(npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium >"$LOGDIR/playwright.log" 2>&1) &
PW_PID=$!
(npx -y "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" install-browser --no-shell chromium >"$LOGDIR/playwright-mcp.log" 2>&1 &&
  npx -y "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" --version >>"$LOGDIR/playwright-mcp.log" 2>&1) &
MCP_PID=$!
if wait "$PW_PID"; then note "Chromium for @playwright/test ${PLAYWRIGHT_VERSION} (with system libraries)"; else
  note "WARNING: Chromium for @playwright/test ${PLAYWRIGHT_VERSION} not installed (see $LOGDIR/playwright.log)"
fi
if wait "$MCP_PID"; then note "Chromium for @playwright/mcp ${PLAYWRIGHT_MCP_VERSION}"; else
  note "WARNING: Chromium for @playwright/mcp ${PLAYWRIGHT_MCP_VERSION} not installed (see $LOGDIR/playwright-mcp.log)"
fi
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH" || true

echo
echo "[setup] done in $(($(date +%s) - START)) s:"
for line in "${SUMMARY[@]}"; do echo "  - $line"; done
exit 0
