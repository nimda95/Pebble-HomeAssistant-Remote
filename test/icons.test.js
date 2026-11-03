'use strict';
// Icons that aren't bundled are loaded from Home Assistant's own /static/mdi/ files.
const test = require('node:test');
const assert = require('node:assert');

// A fake Home Assistant: iconMetadata.json plus two chunks, like the HA frontend build.
const FILES = {
  '/static/mdi/iconMetadata.json': { version: '7.4.47', parts: [{ file: 'aaa' }, { start: 'm', file: 'bbb' }] },
  '/static/mdi/aaa.json': { 'air-conditioner': 'M1 1', 'fan': 'M2 2' },
  '/static/mdi/bbb.json': { 'power': 'M3 3', 'television': 'M4 4' },
};
let requests = [];
global.XMLHttpRequest = function () {
  this.readyState = 0;
  this.open = (method, url) => { this.url = url; };
  this.send = () => {
    const path = this.url.replace(/^https?:\/\/[^/]+/, '');
    requests.push(path);
    setTimeout(() => {
      this.readyState = 4;
      if (FILES[path]) { this.status = 200; this.responseText = JSON.stringify(FILES[path]); }
      else { this.status = 404; this.responseText = ''; }
      this.onreadystatechange();
    }, 1);
  };
  this.abort = () => {};
};

const { HA, chunkFor } = require('../src/pkjs/lib/ha');

test('chunkFor picks the last chunk whose start is <= the name', () => {
  const index = FILES['/static/mdi/iconMetadata.json'];
  assert.strictEqual(chunkFor(index, 'air-conditioner'), 'aaa');
  assert.strictEqual(chunkFor(index, 'lightbulb'), 'aaa');
  assert.strictEqual(chunkFor(index, 'm'), 'bbb');
  assert.strictEqual(chunkFor(index, 'television'), 'bbb');
});

function path(ha, name) {
  return new Promise((resolve, reject) => ha.mdiPath(name, (err, p) => (err ? reject(err) : resolve(p))));
}

test('mdiPath loads the index once and only the chunk it needs', async () => {
  requests = [];
  const ha = new HA({ url: 'http://homeassistant.local:8123', token: 'x' });
  assert.strictEqual(await path(ha, 'power'), 'M3 3');
  assert.strictEqual(await path(ha, 'television'), 'M4 4');       // same chunk: no new request
  assert.strictEqual(await path(ha, 'fan'), 'M2 2');
  assert.deepStrictEqual(requests, ['/static/mdi/iconMetadata.json', '/static/mdi/bbb.json', '/static/mdi/aaa.json']);
});

test('mdiPath returns an empty path for icons HA does not have', async () => {
  const ha = new HA({ url: 'http://homeassistant.local:8123', token: 'x' });
  assert.strictEqual(await path(ha, 'not-an-icon'), '');
});

test('mdiPath reports errors (so the icon is retried later)', async () => {
  const ha = new HA({ url: 'http://other-host:8123', token: 'x' });
  const saved = FILES['/static/mdi/iconMetadata.json'];
  delete FILES['/static/mdi/iconMetadata.json'];
  await assert.rejects(path(ha, 'power'));
  FILES['/static/mdi/iconMetadata.json'] = saved;
});

test('only the Home Assistant server is contacted', async () => {
  requests = [];
  const ha = new HA({ url: 'homeassistant.local:8123', token: 'x' });
  let urls = [];
  const orig = global.XMLHttpRequest;
  global.XMLHttpRequest = function () { orig.call(this); const open = this.open; this.open = (m, u) => { urls.push(u); open(m, u); }; };
  await path(ha, 'fan');
  global.XMLHttpRequest = orig;
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('http://homeassistant.local:8123/static/mdi/')), urls.join(' '));
});
