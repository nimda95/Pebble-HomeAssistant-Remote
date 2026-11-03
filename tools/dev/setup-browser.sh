#!/bin/bash
# Installs a headless Chromium (playwright-core) into .dev/browser for tools/dev/page-test.js,
# plus the shared libraries it needs into .dev/emu-libs (no system-wide install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
B="$ROOT/.dev/browser"
mkdir -p "$B" "$ROOT/.dev/emu-libs/debs"
cd "$B"
[ -f package.json ] || npm init -y >/dev/null
npm install --no-save playwright-core@1.56.1 >/dev/null
PLAYWRIGHT_BROWSERS_PATH="$B/browsers" npx playwright-core install chromium-headless-shell >/dev/null 2>&1 || true
cd "$ROOT/.dev/emu-libs/debs"
apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libnspr4 libnss3 libxcomposite1 libxdamage1 \
  libpixman-1-0 libglib2.0-0t64 libdbus-1-3 libxkbcommon0 libxrandr2 libxfixes3 libdrm2 libgbm1 libx11-6 libxcb1 \
  libxext6 libxau6 libxdmcp6 libbsd0 libmd0 libasound2t64 libwayland-server0 >/dev/null
for f in *.deb; do dpkg-deb -x "$f" "$ROOT/.dev/emu-libs/root"; done
find "$B/browsers" -name headless_shell -type f
