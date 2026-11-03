'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const inf = require('../src/pkjs/lib/inflate');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sample(r, n, kind) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    if (kind === 'random') b[i] = Math.floor(r() * 256);
    else if (kind === 'text') b[i] = 'abcde fghij\n<>{}"'.charCodeAt(Math.floor(r() * 18));
    else b[i] = i % 7 === 0 ? Math.floor(r() * 4) : 65;
  }
  return b;
}

test('gunzip matches zlib for many inputs, levels and strategies', () => {
  const r = rng(42);
  const sizes = [0, 1, 2, 7, 100, 1000, 65535, 65536, 70000, 300000];
  for (const n of sizes) {
    for (const kind of ['random', 'text', 'runs']) {
      const data = sample(r, n, kind);
      for (const level of [0, 1, 6, 9]) {
        for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE]) {
          const gz = zlib.gzipSync(data, { level, strategy });
          const out = inf.gunzip(new Uint8Array(gz));
          assert.strictEqual(Buffer.compare(Buffer.from(out), data), 0, `n=${n} kind=${kind} level=${level} strategy=${strategy}`);
        }
      }
    }
  }
});

test('inflateRaw handles raw deflate', () => {
  const data = Buffer.from('hello hello hello hello world'.repeat(50));
  const raw = zlib.deflateRawSync(data);
  assert.strictEqual(Buffer.from(inf.inflateRaw(new Uint8Array(raw))).toString(), data.toString());
});

test('gunzip rejects corrupted data', () => {
  const gz = zlib.gzipSync(Buffer.from('some text that will be corrupted'.repeat(10)));
  gz[gz.length - 6] ^= 0xff; // CRC
  assert.throws(() => inf.gunzip(new Uint8Array(gz)));
});

test('base64 and utf8 round trip', () => {
  const text = 'héllo wörld — ✓ 📺 <script>"\'\n';
  const bytes = inf.utf8Encode(text);
  assert.deepStrictEqual(Buffer.from(bytes), Buffer.from(text, 'utf8'));
  assert.strictEqual(inf.utf8Decode(bytes), text);
  for (let n = 0; n < 20; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
    const enc = inf.base64Encode(b);
    assert.strictEqual(enc, Buffer.from(b).toString('base64'));
    assert.deepStrictEqual(Array.from(inf.base64Decode(enc)), Array.from(b));
  }
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64');
  assert.strictEqual(inf.gunzipBase64ToString(gz), text);
});
