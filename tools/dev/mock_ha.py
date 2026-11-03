#!/usr/bin/env python3
"""Tiny mock of the Home Assistant REST API for emulator tests.

usage: mock_ha.py [PORT] [LOG]    (defaults: 8123, .dev/calls.jsonl)
Token: test-token. Every request is appended to LOG as one JSON line.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
LOG = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, '.dev', 'calls.jsonl')
TOKEN = 'test-token'
STATES = {
    'media_player.living_room_tv': {'state': 'on', 'attributes': {'friendly_name': 'Living Room TV', 'volume_level': 0.3}},
    'remote.living_room_tv': {'state': 'on', 'attributes': {'friendly_name': 'Living Room TV'}},
    'remote.tv_box': {'state': 'on', 'attributes': {'friendly_name': 'TV box'}},
    'media_player.tv_box': {'state': 'playing', 'attributes': {'friendly_name': 'TV box', 'volume_level': 0.5}},
    'climate.living_room_ac': {'state': 'cool', 'attributes': {'friendly_name': 'AC', 'temperature': 22.5,
                                                               'current_temperature': 25}},
    'lock.front_door': {'state': 'locked', 'attributes': {}},
}
for k, v in STATES.items():
    v['entity_id'] = k


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def record(self, body):
        with open(LOG, 'a') as f:
            f.write(json.dumps({'method': self.command, 'path': self.path, 'body': body,
                                'auth_ok': self.headers.get('Authorization') == 'Bearer ' + TOKEN,
                                'content_type': self.headers.get('Content-Type')}) + '\n')

    def authed(self):
        if self.headers.get('Authorization') != 'Bearer ' + TOKEN:
            self.reply(401, {'message': 'Invalid token'})
            return False
        return True

    def do_GET(self):
        self.record(None)
        if not self.authed():
            return
        if self.path == '/api/':
            return self.reply(200, {'message': 'API running.'})
        if self.path == '/api/states':
            return self.reply(200, list(STATES.values()))
        if self.path.startswith('/api/states/'):
            eid = self.path[len('/api/states/'):]
            if eid in STATES:
                return self.reply(200, STATES[eid])
            return self.reply(404, {'message': 'Entity not found.'})
        self.reply(404, {'message': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode() if n else ''
        try:
            body = json.loads(raw) if raw else None
        except ValueError:
            body = raw
        self.record(body)
        if not self.authed():
            return
        if self.path == '/api/services/climate/set_temperature' and isinstance(body, dict):
            STATES['climate.living_room_ac']['attributes']['temperature'] = body.get('temperature')
        if self.path.startswith('/api/services/'):
            return self.reply(200, [])
        self.reply(404, {'message': 'not found'})


if __name__ == '__main__':
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    open(LOG, 'w').close()
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
