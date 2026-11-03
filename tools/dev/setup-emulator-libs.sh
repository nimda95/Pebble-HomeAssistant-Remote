#!/bin/bash
# Downloads the shared libraries the Pebble emulator (qemu-pebble) needs into .dev/emu-libs,
# without installing anything system-wide (Debian/Ubuntu: uses `apt-get download`).
# Afterwards run the pebble tool through tools/dev/peb.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/.dev/emu-libs"
mkdir -p "$DEST/debs"
cd "$DEST/debs"
PKGS="libpixman-1-0 libsdl2-2.0-0 libglib2.0-0t64 libasound2t64 libpulse0 libsamplerate0 libxcursor1
libxi6 libxfixes3 libxrandr2 libxss1 libdrm2 libgbm1 libwayland-egl1 libwayland-client0 libwayland-cursor0
libxkbcommon0 libdecor-0-0 libdbus-1-3 libwayland-server0 libxrender1 libxext6 libx11-6 libxcb1 libxau6
libxdmcp6 libbsd0 libmd0 libsndfile1 libx11-xcb1 libasyncns0 libflac12t64 libvorbisenc2 libvorbis0a libogg0
libopus0 libmpg123-0t64 libmp3lame0 libsystemd0 libapparmor1 libxkbcommon-x11-0 libxcb-xkb1"
apt-get download $PKGS
for f in *.deb; do dpkg-deb -x "$f" "$DEST/root"; done
echo "libraries extracted to $DEST/root"
