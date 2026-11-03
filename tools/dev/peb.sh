#!/bin/bash
# Runs the pebble tool with the emulator libraries from tools/dev/setup-emulator-libs.sh.
# Always pass --vnc to emulator commands: mixing VNC and non-VNC restarts the emulator.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
L="$ROOT/.dev/emu-libs/root/usr/lib/x86_64-linux-gnu"
export LD_LIBRARY_PATH="$L:$L/pulseaudio${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$HOME/.local/bin:$PATH"
export PYTHONWARNINGS=ignore
cd "$ROOT"
exec pebble "$@"
