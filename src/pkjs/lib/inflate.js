// Small DEFLATE (RFC 1951) decoder with a gzip (RFC 1952) wrapper.
// Written for PebbleKit JS, which has no zlib, DecompressionStream, atob or TextDecoder.
'use strict';

var LENGTH_BITS = new Uint8Array(30);
var LENGTH_BASE = new Uint16Array(30);
var DIST_BITS = new Uint8Array(30);
var DIST_BASE = new Uint16Array(30);
var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildBitsBase(bits, base, delta, first) {
  var i, sum;
  for (i = 0; i < delta; ++i) bits[i] = 0;
  for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
  for (sum = first, i = 0; i < 30; ++i) {
    base[i] = sum;
    sum += 1 << bits[i];
  }
}
buildBitsBase(LENGTH_BITS, LENGTH_BASE, 4, 3);
buildBitsBase(DIST_BITS, DIST_BASE, 2, 1);
LENGTH_BITS[28] = 0;
LENGTH_BASE[28] = 258;

function Tree() {
  this.table = new Uint16Array(16); // number of codes of each length
  this.trans = new Uint16Array(288); // code -> symbol translation
}

function buildTree(t, lengths, off, num) {
  var offs = new Uint16Array(16);
  var i, sum;
  for (i = 0; i < 16; ++i) t.table[i] = 0;
  for (i = 0; i < num; ++i) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (sum = 0, i = 0; i < 16; ++i) {
    offs[i] = sum;
    sum += t.table[i];
  }
  for (i = 0; i < num; ++i) {
    if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
  }
}

var FIXED_LT = new Tree();
var FIXED_DT = new Tree();
(function () {
  var i;
  for (i = 0; i < 7; ++i) FIXED_LT.table[i] = 0;
  FIXED_LT.table[7] = 24;
  FIXED_LT.table[8] = 152;
  FIXED_LT.table[9] = 112;
  for (i = 0; i < 24; ++i) FIXED_LT.trans[i] = 256 + i;
  for (i = 0; i < 144; ++i) FIXED_LT.trans[24 + i] = i;
  for (i = 0; i < 8; ++i) FIXED_LT.trans[24 + 144 + i] = 280 + i;
  for (i = 0; i < 112; ++i) FIXED_LT.trans[24 + 144 + 8 + i] = 144 + i;
  for (i = 0; i < 5; ++i) FIXED_DT.table[i] = 0;
  FIXED_DT.table[5] = 32;
  for (i = 0; i < 32; ++i) FIXED_DT.trans[i] = i;
})();

function Out(size) {
  this.buf = new Uint8Array(size > 0 ? size : 1024);
  this.len = 0;
}
Out.prototype.ensure = function (extra) {
  if (this.len + extra <= this.buf.length) return;
  var n = this.buf.length * 2;
  while (n < this.len + extra) n *= 2;
  var b = new Uint8Array(n);
  b.set(this.buf.subarray(0, this.len));
  this.buf = b;
};

function Reader(src, pos, end) {
  this.src = src;
  this.pos = pos;
  this.end = end;
  this.tag = 0;
  this.bits = 0;
}
Reader.prototype.refill = function () {
  while (this.bits < 24) {
    var b = this.pos < this.end ? this.src[this.pos] : 0;
    this.pos++;
    this.tag |= b << this.bits;
    this.bits += 8;
  }
};
Reader.prototype.read = function (num, base) {
  if (!num) return base;
  this.refill();
  var val = this.tag & (0xffff >>> (16 - num));
  this.tag >>>= num;
  this.bits -= num;
  return val + base;
};
Reader.prototype.symbol = function (t) {
  this.refill();
  var sum = 0, cur = 0, len = 0, tag = this.tag;
  do {
    cur = 2 * cur + (tag & 1);
    tag >>>= 1;
    ++len;
    if (len > 15) throw new Error('inflate: bad code');
    sum += t.table[len];
    cur -= t.table[len];
  } while (cur >= 0);
  this.tag = tag;
  this.bits -= len;
  return t.trans[sum + cur];
};
// Drop the partially consumed byte and give back any whole bytes we prefetched.
Reader.prototype.alignToByte = function () {
  var drop = this.bits & 7;
  this.tag >>>= drop;
  this.bits -= drop;
  while (this.bits >= 8) {
    this.pos--;
    this.bits -= 8;
  }
  this.tag = 0;
  this.bits = 0;
};

function decodeTrees(r, lt, dt) {
  var lengths = new Uint8Array(288 + 32);
  var codeTree = new Tree();
  var hlit = r.read(5, 257);
  var hdist = r.read(5, 1);
  var hclen = r.read(4, 4);
  var i, num, sym, prev, len;
  for (i = 0; i < 19; ++i) lengths[i] = 0;
  for (i = 0; i < hclen; ++i) lengths[CL_ORDER[i]] = r.read(3, 0);
  buildTree(codeTree, lengths, 0, 19);
  for (num = 0; num < hlit + hdist;) {
    sym = r.symbol(codeTree);
    if (sym === 16) {
      if (num === 0) throw new Error('inflate: bad repeat');
      prev = lengths[num - 1];
      for (len = r.read(2, 3); len; --len) lengths[num++] = prev;
    } else if (sym === 17) {
      for (len = r.read(3, 3); len; --len) lengths[num++] = 0;
    } else if (sym === 18) {
      for (len = r.read(7, 11); len; --len) lengths[num++] = 0;
    } else {
      lengths[num++] = sym;
    }
  }
  buildTree(lt, lengths, 0, hlit);
  buildTree(dt, lengths, hlit, hdist);
}

function inflateBlock(r, out, lt, dt) {
  for (;;) {
    var sym = r.symbol(lt);
    if (sym === 256) return;
    if (sym < 256) {
      out.ensure(1);
      out.buf[out.len++] = sym;
    } else {
      sym -= 257;
      if (sym >= 29) throw new Error('inflate: bad length symbol');
      var length = r.read(LENGTH_BITS[sym], LENGTH_BASE[sym]);
      var dsym = r.symbol(dt);
      if (dsym >= 30) throw new Error('inflate: bad distance symbol');
      var from = out.len - r.read(DIST_BITS[dsym], DIST_BASE[dsym]);
      if (from < 0) throw new Error('inflate: distance too far');
      out.ensure(length);
      var buf = out.buf;
      for (var i = 0; i < length; ++i) buf[out.len++] = buf[from + i];
    }
  }
}

function inflateStored(r, out) {
  r.alignToByte();
  var s = r.src, p = r.pos;
  if (p + 4 > r.end) throw new Error('inflate: truncated stored block');
  var len = s[p] | (s[p + 1] << 8);
  var nlen = s[p + 2] | (s[p + 3] << 8);
  if (len !== (~nlen & 0xffff)) throw new Error('inflate: stored length mismatch');
  p += 4;
  if (p + len > r.end) throw new Error('inflate: truncated stored block');
  out.ensure(len);
  out.buf.set(s.subarray(p, p + len), out.len);
  out.len += len;
  r.pos = p + len;
}

// Raw DEFLATE stream -> Uint8Array.
function inflateRaw(src, start, end, sizeHint) {
  var r = new Reader(src, start || 0, end === undefined ? src.length : end);
  var out = new Out(sizeHint || src.length * 4);
  var last;
  do {
    last = r.read(1, 0);
    var type = r.read(2, 0);
    if (type === 0) {
      inflateStored(r, out);
    } else if (type === 1) {
      inflateBlock(r, out, FIXED_LT, FIXED_DT);
    } else if (type === 2) {
      var lt = new Tree(), dt = new Tree();
      decodeTrees(r, lt, dt);
      inflateBlock(r, out, lt, dt);
    } else {
      throw new Error('inflate: bad block type');
    }
  } while (!last);
  return out.buf.subarray(0, out.len);
}

var CRC_TABLE = null;
function crc32(data) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  var crc = -1;
  for (var i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// gzip member -> Uint8Array. Verifies the CRC32 and size trailer.
function gunzip(src) {
  if (src.length < 18 || src[0] !== 0x1f || src[1] !== 0x8b || src[2] !== 8) {
    throw new Error('gunzip: not a gzip stream');
  }
  var flg = src[3];
  var p = 10;
  if (flg & 4) p += 2 + (src[p] | (src[p + 1] << 8)); // FEXTRA
  if (flg & 8) { while (src[p++] !== 0); } // FNAME
  if (flg & 16) { while (src[p++] !== 0); } // FCOMMENT
  if (flg & 2) p += 2; // FHCRC
  var n = src.length;
  var expectCrc = (src[n - 8] | (src[n - 7] << 8) | (src[n - 6] << 16) | (src[n - 5] << 24)) >>> 0;
  var expectLen = (src[n - 4] | (src[n - 3] << 8) | (src[n - 2] << 16) | (src[n - 1] << 24)) >>> 0;
  var out = inflateRaw(src, p, n - 8, expectLen);
  if (out.length !== expectLen) throw new Error('gunzip: size mismatch');
  if (crc32(out) !== expectCrc) throw new Error('gunzip: CRC mismatch');
  return out;
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var B64_LOOKUP = null;

function base64Decode(str) {
  if (!B64_LOOKUP) {
    B64_LOOKUP = new Int16Array(256);
    for (var j = 0; j < 256; j++) B64_LOOKUP[j] = -1;
    for (j = 0; j < 64; j++) B64_LOOKUP[B64.charCodeAt(j)] = j;
    B64_LOOKUP[45] = 62; // '-' (url-safe)
    B64_LOOKUP[95] = 63; // '_'
  }
  var out = new Uint8Array(Math.floor((str.length * 3) / 4) + 3);
  var o = 0, acc = 0, bits = 0;
  for (var i = 0; i < str.length; i++) {
    var v = B64_LOOKUP[str.charCodeAt(i) & 0xff];
    if (v < 0) continue; // skips '=', whitespace
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function base64Encode(bytes) {
  var s = '';
  var i;
  for (i = 0; i + 2 < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  var rem = bytes.length - i;
  if (rem === 1) {
    var a = bytes[i] << 16;
    s += B64[(a >> 18) & 63] + B64[(a >> 12) & 63] + '==';
  } else if (rem === 2) {
    var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '=';
  }
  return s;
}

function utf8Decode(bytes) {
  var parts = [];
  var chunk = [];
  for (var i = 0; i < bytes.length;) {
    var c = bytes[i++];
    var cp;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    if (cp > 0xffff) {
      cp -= 0x10000;
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      chunk.push(cp);
    }
    if (chunk.length >= 8192) {
      parts.push(String.fromCharCode.apply(null, chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode.apply(null, chunk));
  return parts.join('');
}

function utf8Encode(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      var d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

// base64(gzip(utf8 text)) -> text
function gunzipBase64ToString(b64) {
  return utf8Decode(gunzip(base64Decode(b64)));
}

module.exports = {
  inflateRaw: inflateRaw,
  gunzip: gunzip,
  crc32: crc32,
  base64Decode: base64Decode,
  base64Encode: base64Encode,
  utf8Decode: utf8Decode,
  utf8Encode: utf8Encode,
  gunzipBase64ToString: gunzipBase64ToString,
};
