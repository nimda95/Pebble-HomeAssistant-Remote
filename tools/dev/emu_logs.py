#!/usr/bin/env python3
"""Streams watch and PebbleKit JS logs from a running emulator for SECONDS.

Unlike `pebble logs`, it doesn't hold the connection in a way that blocks other tools.
Run it with the pebble-tool environment's Python:
  ~/.local/share/uv/tools/pebble-tool/bin/python tools/dev/emu_logs.py emery 10
"""
import json
import sys
import time

from libpebble2.communication import PebbleConnection
from libpebble2.communication.transports.websocket import WebsocketTransport, MessageTargetPhone
from libpebble2.communication.transports.websocket.protocol import WebSocketPhoneAppLog
from libpebble2.protocol.logs import AppLogMessage, AppLogShippingControl

plat = sys.argv[1]
seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 10
info = list(json.load(open('/tmp/pb-emulator.json'))[plat].values())[0]
pebble = PebbleConnection(WebsocketTransport('ws://localhost:%d/' % info['pypkjs']['port']))
pebble.connect()
pebble.run_async()


def watch_log(packet):
    m = getattr(packet, 'message', packet)
    print('[watch] %s:%s> %s' % (getattr(m, 'filename', '?'), getattr(m, 'line_number', '?'), getattr(m, 'message', m)), flush=True)


def phone_log(packet):
    text = packet.payload.decode('utf-8', 'replace') if isinstance(packet.payload, bytes) else packet.payload
    if 'QemuInboundPacket' not in text:
        print('[pkjs] ' + text, flush=True)


pebble.send_packet(AppLogShippingControl(enable=True))
pebble.register_endpoint(AppLogMessage, watch_log)
pebble.register_transport_endpoint(MessageTargetPhone, WebSocketPhoneAppLog, phone_log)
time.sleep(seconds)
