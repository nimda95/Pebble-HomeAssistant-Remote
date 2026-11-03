#!/usr/bin/env node
// Renders resources/images/menu_icon.png (25x25, app launcher icon) from an MDI icon.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mdi = require('@mdi/js');
const raster = require('../src/pkjs/lib/raster');

const SIZE = 25;
const polys = raster.flatten(raster.parsePath(mdi.mdiRemoteTv), 0.02);
const cov = raster.rasterize(polys, SIZE, SIZE / 24, 0, 0, 8);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Black glyph with alpha, like the system launcher icons.
const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  for (let x = 0; x < SIZE; x++) {
    const a = Math.round(Math.min(1, cov[y * SIZE + x]) * 255);
    row.writeUInt32BE(a, 1 + x * 4); // r=g=b=0, alpha=a
  }
  rows.push(row);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]);
const dest = path.join(__dirname, '..', 'resources/images/menu_icon.png');
fs.writeFileSync(dest, png);
console.log('wrote', dest, png.length, 'bytes');
