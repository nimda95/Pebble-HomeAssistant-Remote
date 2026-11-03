// Decodes the packed layout (mirror of src/c/layout.c layout_parse). Used by the settings page
// preview, so it draws from exactly the bytes the watch receives, and by the tests.
'use strict';

var inflate = require('./inflate');

function unpack(bytes) {
  var p = 0;
  function u8() {
    if (p >= bytes.length) throw new Error('layout truncated at ' + p);
    return bytes[p++];
  }
  function u16() { var lo = u8(); return lo | (u8() << 8); }
  function str() {
    var n = u8();
    if (n === 0 || p + n > bytes.length || bytes[p + n - 1] !== 0) throw new Error('bad string at ' + p);
    var s = inflate.utf8Decode(bytes.subarray(p, p + n - 1));
    p += n;
    return s;
  }
  function i32() { var v = u8() | (u8() << 8) | (u8() << 16) | (u8() << 24); return v | 0; }
  if (u8() !== 0x48 || u8() !== 0x52) throw new Error('bad magic');
  var version = u8();
  if (version !== 2) throw new Error('unsupported version ' + version);
  var L = {
    flags: u8(),
    numPages: u8(),
    numIcons: u8(),
    startPage: u8(),
    pages: [],
    icons: [],
  };
  u8();
  for (var i = 0; i < L.numPages; i++) {
    var count = u8();
    var pg = { name: str(), flags: u8() };
    pg.colors = { bg: u8(), btnBg: u8(), btnFg: u8(), accent: u8(), titleFg: u8(), padBg: u8() };
    pg.holdMs = u8() * 10;
    pg.repeatMs = u8() * 10;
    pg.doubleMs = u8() * 10;
    pg.buttons = [u8(), u8(), u8()];
    pg.elems = [];
    for (var e = 0; e < count; e++) {
      var el = {
        id: u8(), type: u8(), flags: u8(),
        x: u16(), y: u16(), w: u16(), h: u16(),
        fg: u8(), bg: u8(), value: u8(),
        holdMs: u8() * 10, repeatMs: u8() * 10, doubleMs: u8() * 10,
        pf: [u8(), u8(), u8(), u8(), u8()],
        icon: [u8(), u8(), u8(), u8(), u8()],
      };
      el.label = str();
      if (el.type === 4) {
        el.min = i32() / 1000;
        el.max = i32() / 1000;
        el.step = i32() / 1000;
        el.decimals = u8();
        el.unit = str();
      }
      pg.elems.push(el);
    }
    L.pages.push(pg);
  }
  for (var k = 0; k < L.numIcons; k++) {
    var size = u8();
    var stride = Math.ceil(size / 4);
    if (p + stride * size > bytes.length) throw new Error('icon truncated');
    L.icons.push({ size: size, stride: stride, data: bytes.subarray(p, p + stride * size) });
    p += stride * size;
  }
  if (p !== bytes.length) throw new Error('trailing bytes: ' + (bytes.length - p));
  return L;
}

// Value (in thousandths) of a 0..255 slider position, snapped to the step. The watch
// (slider_text() in src/c/render.c) and the phone (sliderValue() in index.js) use this math.
function sliderMilli(min, max, step, pos) {
  var lo = Math.round(min * 1000), hi = Math.round(max * 1000), st = Math.round(step * 1000);
  pos = Math.max(0, Math.min(255, pos));
  var v = lo + Math.trunc(((hi - lo) * pos + 127) / 255);
  if (st > 0 && v >= lo) v = lo + Math.floor((2 * (v - lo) + st) / (2 * st)) * st;
  return v;
}

// Text a slider shows for a 0..255 position: mirrors slider_text() in src/c/render.c.
function sliderText(el, pos) {
  if (el.flags & 16) return Math.trunc((pos * 100 + 127) / 255) + '%';
  var v = sliderMilli(el.min, el.max, el.step, pos);
  var neg = v < 0;
  var a = Math.abs(v);
  var whole = Math.trunc(a / 1000);
  var frac = a % 1000;
  var s = (neg ? '-' : '') + whole;
  if (el.decimals > 0) {
    var div = [1, 100, 10, 1][el.decimals];
    var f = String(Math.trunc(frac / div));
    while (f.length < el.decimals) f = '0' + f;
    s += '.' + f.slice(0, el.decimals);
  }
  return s + (el.unit || '');
}

// GColor8 (0b11rrggbb) -> CSS color
function cssColor(argb) {
  var r = ((argb >> 4) & 3) * 85, g = ((argb >> 2) & 3) * 85, b = (argb & 3) * 85;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

module.exports = { unpack: unpack, cssColor: cssColor, sliderText: sliderText, sliderMilli: sliderMilli };
