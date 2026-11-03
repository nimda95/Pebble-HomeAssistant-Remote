#!/usr/bin/env python3
"""Writes HA Remote settings into the emulator's PebbleKit JS localStorage.

pebble-tool 5.0.40's pypkjs can't deliver a settings page's response (it passes bytes to its
JSON bridge, so `webviewclosed` never fires), so emulator tests seed the storage directly.
Stop the emulator first (`tools/dev/peb.sh kill`).

usage: seed_settings.py <platform> <yaml file> [ha url] [token]
       seed_settings.py <platform> -          (clear)
"""
import dbm.dumb
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UUID = json.load(open(os.path.join(ROOT, 'package.json')))['pebble']['uuid']
plat, yaml_file = sys.argv[1], sys.argv[2]
url = sys.argv[3] if len(sys.argv) > 3 else 'http://127.0.0.1:8123'
token = sys.argv[4] if len(sys.argv) > 4 else 'test-token'

sdk_dirs = sorted(glob.glob(os.path.expanduser('~/.local/share/pebble-sdk/*/%s' % plat)))
if not sdk_dirs:
    raise SystemExit('run the app in the %s emulator once first' % plat)
store = os.path.join(sdk_dirs[-1], 'localstorage')
os.makedirs(store, exist_ok=True)
db = dbm.dumb.open(os.path.join(store, UUID), 'c')
if yaml_file == '-':
    for k in list(db.keys()):
        del db[k]
else:
    yaml_text = open(yaml_file).read()
    config = json.loads(subprocess.check_output([
        'node', '-e',
        'const y=require(process.argv[2]);'
        'process.stdout.write(JSON.stringify(y.load(require("fs").readFileSync(process.argv[1],"utf8"))))',
        yaml_file, os.path.join(ROOT, 'node_modules', 'js-yaml')]))
    db['settings'] = json.dumps({'url': url, 'token': token})
    db['yaml'] = json.dumps(yaml_text)
    db['config'] = json.dumps(config)
print('localStorage keys:', sorted(k.decode() if isinstance(k, bytes) else k for k in db.keys()))
db.close()
