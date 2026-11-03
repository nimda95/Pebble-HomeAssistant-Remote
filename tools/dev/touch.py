#!/usr/bin/env python3
"""Drives the emulator touchscreen through QEMU's VNC server (start the emulator with --vnc).

The QEMU monitor's mouse_move only sends relative motion, which the absolute touch device
ignores, so this speaks just enough of the VNC protocol to send absolute pointer events.

usage: touch.py tap X Y | hold X Y MS | double X Y [GAP_MS] | swipe X0 Y0 X1 Y1 [STEPS] [HOLD_MS]
       touch.py seq '[["down",x,y],["move",x,y],["sleep",ms],["up",x,y]]'
Coordinates are watch pixels. Set PEBBLE_PLATFORM=gabbro for the round watch.
"""
import json
import os
import socket
import struct
import sys
import time

SW, SH = {'gabbro': (260, 260)}.get(os.environ.get('PEBBLE_PLATFORM', 'emery'), (200, 228))


def recv_exact(s, n):
    data = b''
    while len(data) < n:
        d = s.recv(n - len(data))
        if not d:
            raise EOFError('vnc closed')
        data += d
    return data


s = socket.create_connection(('localhost', 5901))
recv_exact(s, 12)
s.sendall(b'RFB 003.008\n')
types = recv_exact(s, recv_exact(s, 1)[0])
if 1 not in types:
    raise SystemExit('VNC needs auth: %r' % types)
s.sendall(b'\x01')
if struct.unpack('>I', recv_exact(s, 4))[0] != 0:
    raise SystemExit('VNC security failed')
s.sendall(b'\x01')
w, h = struct.unpack('>HH', recv_exact(s, 4))
recv_exact(s, 16)
recv_exact(s, struct.unpack('>I', recv_exact(s, 4))[0])
# SetEncodings: Raw + QEMU pointer-type-change, so QEMU sends absolute pointer events.
s.sendall(struct.pack('>BBHii', 2, 0, 2, 0, -257))
time.sleep(0.1)


def ptr(x, y, buttons):
    # The VNC framebuffer can be a little bigger than the watch screen; scale to it.
    x = max(0, min(w - 1, int(round(x * (w - 1) / (SW - 1)))))
    y = max(0, min(h - 1, int(round(y * (h - 1) / (SH - 1)))))
    s.sendall(struct.pack('>BBHH', 5, buttons, x, y))


def down(x, y):
    ptr(x, y, 0)
    time.sleep(0.02)
    ptr(x, y, 1)


def up(x, y):
    ptr(x, y, 0)


def run(a, args):
    if a == 'tap':
        down(args[0], args[1]); time.sleep(0.08); up(args[0], args[1])
    elif a == 'hold':
        down(args[0], args[1]); time.sleep(args[2] / 1000.0); up(args[0], args[1])
    elif a == 'double':
        gap = args[2] if len(args) > 2 else 90
        for i in range(2):
            down(args[0], args[1]); time.sleep(0.06); up(args[0], args[1])
            if i == 0:
                time.sleep(gap / 1000.0)
    elif a == 'swipe':
        x0, y0, x1, y1 = args[:4]
        steps = int(args[4]) if len(args) > 4 else 8
        hold = args[5] if len(args) > 5 else 0
        down(x0, y0)
        for i in range(1, steps + 1):
            time.sleep(0.04)
            ptr(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, 1)
        time.sleep(hold / 1000.0 if hold else 0.04)
        up(x1, y1)
    elif a == 'down':
        down(args[0], args[1])
    elif a == 'move':
        ptr(args[0], args[1], 1)
    elif a == 'up':
        # A new connection starts with no button down: press, then release.
        ptr(args[0], args[1], 1); time.sleep(0.03); up(args[0], args[1])
    elif a == 'sleep':
        time.sleep(args[0] / 1000.0)


if sys.argv[1] == 'seq':
    for step in json.loads(sys.argv[2]):
        run(step[0], step[1:])
else:
    run(sys.argv[1], [float(v) for v in sys.argv[2:]])
time.sleep(0.15)
s.close()
