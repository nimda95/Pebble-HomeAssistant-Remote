// Canvas preview of the watch screen. Mirrors src/c/render.c, drawing from the same packed bytes.
'use strict';

var unpackLib = require('../src/pkjs/lib/unpack');

var EL_BUTTON = 1, EL_TOUCHPAD = 2, EL_CIRCLEPAD = 3, EL_SLIDER = 4;
var ELF_VERTICAL = 1, ELF_DRAG = 2, ELF_LABEL = 4;
var PG_TITLE = 2, HDR_ROUND = 4;
var NO_ICON = 255;
var FONT = '"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
var css = unpackLib.cssColor;
var sliderText = unpackLib.sliderText;

function c8(argb, fallback) { return argb ? css(argb) : css(fallback); }

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function Preview(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.iconCache = {};
  this.layout = null;
  this.page = 0;
  this.screen = { w: 200, h: 228, round: false };
  this.highlight = -1;
}

Preview.prototype.setLayout = function (bytes, screen) {
  this.layout = unpackLib.unpack(bytes);
  this.screen = screen;
  this.iconCache = {};
  if (this.canvas.width !== screen.w || this.canvas.height !== screen.h) {
    this.canvas.width = screen.w;
    this.canvas.height = screen.h;
  }
  if (this.page >= this.layout.numPages) this.page = 0;
};

Preview.prototype.iconCanvas = function (index, argb) {
  var key = index + ':' + argb;
  if (this.iconCache[key]) return this.iconCache[key];
  var ic = this.layout.icons[index];
  if (!ic) return null;
  var c = document.createElement('canvas');
  c.width = c.height = ic.size;
  var cx = c.getContext('2d');
  var img = cx.createImageData(ic.size, ic.size);
  var r = ((argb >> 4) & 3) * 85, g = ((argb >> 2) & 3) * 85, b = (argb & 3) * 85;
  for (var y = 0; y < ic.size; y++) {
    for (var x = 0; x < ic.size; x++) {
      var lvl = (ic.data[y * ic.stride + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
      var o = (y * ic.size + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
      img.data[o + 3] = lvl * 85;
    }
  }
  cx.putImageData(img, 0, 0);
  this.iconCache[key] = c;
  return c;
};

Preview.prototype.iconSize = function (index) {
  var ic = index !== NO_ICON && this.layout.icons[index];
  return ic ? ic.size : 0;
};

Preview.prototype.drawIcon = function (index, x, y, argb) {
  var c = this.iconCanvas(index, argb);
  if (!c) return;
  this.ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
};

Preview.prototype.text = function (str, px, x, y, color, align, maxW) {
  var ctx = this.ctx;
  ctx.font = 'bold ' + px + 'px ' + FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  var s = str;
  if (maxW && ctx.measureText(s).width > maxW) {
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    s += '…';
  }
  ctx.fillText(s, x, y + 1);
};

Preview.prototype.fitFont = function (str, w, h) {
  var ctx = this.ctx;
  var sizes = [24, 18, 14];
  for (var i = 0; i < sizes.length; i++) {
    ctx.font = 'bold ' + sizes[i] + 'px ' + FONT;
    if (sizes[i] + 4 <= h && ctx.measureText(str).width <= w - 4) return sizes[i];
  }
  return 14;
};

Preview.prototype.chevron = function (x, y, dir, s, color) {
  var ctx = this.ctx, h = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (dir === 1) { ctx.moveTo(x - s, y + h); ctx.lineTo(x, y - h); ctx.lineTo(x + s, y + h); }
  if (dir === 2) { ctx.moveTo(x - s, y - h); ctx.lineTo(x, y + h); ctx.lineTo(x + s, y - h); }
  if (dir === 3) { ctx.moveTo(x + h, y - s); ctx.lineTo(x - h, y); ctx.lineTo(x + h, y + s); }
  if (dir === 4) { ctx.moveTo(x - h, y - s); ctx.lineTo(x + h, y); ctx.lineTo(x - h, y + s); }
  ctx.stroke();
};

Preview.prototype.drawButton = function (el, pressed) {
  var C = this.layout.pages[this.page].colors, ctx = this.ctx;
  ctx.fillStyle = pressed ? css(C.accent) : c8(el.bg, C.btnBg);
  roundRect(ctx, el.x, el.y, el.w, el.h, Math.min(8, Math.floor(Math.min(el.w, el.h) / 4)));
  var fg = el.fg || C.btnFg;
  var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  var is = this.iconSize(el.icon[0]);
  var label = (el.flags & ELF_LABEL) && el.label;
  if (is && label) {
    var top = el.y + Math.floor((el.h - (is + 16)) / 2);
    this.drawIcon(el.icon[0], cx, top + is / 2, fg);
    this.text(el.label, 14, cx, top + is + 8, css(fg), 'center', el.w - 2);
  } else if (is) {
    this.drawIcon(el.icon[0], cx, cy, fg);
  } else if (label) {
    this.text(el.label, this.fitFont(el.label, el.w, el.h), cx, cy, css(fg), 'center', el.w - 2);
  }
};

Preview.prototype.drawTouchpad = function (el) {
  var C = this.layout.pages[this.page].colors, ctx = this.ctx;
  ctx.fillStyle = c8(el.bg, C.padBg);
  roundRect(ctx, el.x, el.y, el.w, el.h, Math.min(12, Math.floor(Math.min(el.w, el.h) / 4)));
  var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  var chev = Math.max(3, Math.min(7, Math.floor(Math.min(el.w, el.h) / 14)));
  var pts = {
    1: function (i) { return [cx, el.y + i]; },
    2: function (i) { return [cx, el.y + el.h - i]; },
    3: function (i) { return [el.x + i, cy]; },
    4: function (i) { return [el.x + el.w - i, cy]; },
  };
  for (var d = 1; d <= 4; d++) {
    if (el.icon[d] !== NO_ICON) {
      var s = this.iconSize(el.icon[d]);
      var p = pts[d](s / 2 + 4);
      this.drawIcon(el.icon[d], p[0], p[1], C.titleFg);
    } else if (!(el.flags & ELF_DRAG)) {
      var q = pts[d](chev + 5);
      this.chevron(q[0], q[1], d, chev, css(C.titleFg));
    }
  }
  if (el.icon[0] !== NO_ICON) {
    this.drawIcon(el.icon[0], cx, cy, C.titleFg);
  } else {
    ctx.fillStyle = css(C.titleFg);
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
  if ((el.flags & ELF_LABEL) && el.label) this.text(el.label, 14, cx, el.y + el.h - 12, css(C.titleFg), 'center', el.w);
};

Preview.prototype.drawCirclepad = function (el, hl) {
  var C = this.layout.pages[this.page].colors, ctx = this.ctx;
  var d = Math.min(el.w, el.h);
  var cx = el.x + Math.floor(el.w / 2), cy = el.y + Math.floor(el.h / 2);
  var R = Math.floor(d / 2), inner = Math.floor(d / 5);
  ctx.fillStyle = c8(el.bg, C.padBg);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fill();
  if (hl >= 1 && hl <= 4) {
    var mid = [0, -90, 90, 180, 0][hl] * Math.PI / 180;
    ctx.fillStyle = css(C.accent);
    ctx.beginPath();
    ctx.arc(cx, cy, R, mid - Math.PI / 4, mid + Math.PI / 4);
    ctx.arc(cx, cy, inner, mid + Math.PI / 4, mid - Math.PI / 4, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = hl === 0 ? css(C.accent) : css(C.btnBg);
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
  ctx.fill();
  var fg = el.fg || C.btnFg;
  var ring = (R + inner) / 2;
  var chev = Math.max(3, Math.min(7, Math.floor(R / 10)));
  var pos = [[cx, cy], [cx, cy - ring], [cx, cy + ring], [cx - ring, cy], [cx + ring, cy]];
  for (var k = 1; k <= 4; k++) {
    if (el.icon[k] !== NO_ICON) this.drawIcon(el.icon[k], pos[k][0], pos[k][1], fg);
    else if (el.pf[k]) this.chevron(pos[k][0], pos[k][1], k, chev, css(fg));
  }
  if (el.icon[0] !== NO_ICON) this.drawIcon(el.icon[0], cx, cy, fg);
  else if ((el.flags & ELF_LABEL) && el.label) {
    this.text(el.label, this.fitFont(el.label, 2 * inner - 4, 2 * inner), cx, cy, css(fg), 'center', 2 * inner - 4);
  }
};

Preview.prototype.drawSlider = function (el) {
  var C = this.layout.pages[this.page].colors, ctx = this.ctx;
  var vertical = el.flags & ELF_VERTICAL;
  var value = el.previewValue !== undefined ? el.previewValue : 128;
  var radius = Math.min(8, Math.floor(Math.min(el.w, el.h) / 3));
  ctx.fillStyle = c8(el.bg, C.btnBg);
  roundRect(ctx, el.x, el.y, el.w, el.h, radius);
  ctx.fillStyle = css(C.accent);
  if (vertical) {
    var h = Math.floor((el.h * value) / 255);
    if (h > 0) roundRect(ctx, el.x, el.y + el.h - h, el.w, h, radius);
  } else {
    var w = Math.floor((el.w * value) / 255);
    if (w > 0) roundRect(ctx, el.x, el.y, w, el.h, radius);
  }
  var fg = el.fg || C.btnFg;
  var is = this.iconSize(el.icon[0]);
  if (is) {
    if (vertical) this.drawIcon(el.icon[0], el.x + el.w / 2, el.y + el.h - is / 2 - 6, fg);
    else this.drawIcon(el.icon[0], el.x + is / 2 + 6, el.y + el.h / 2, fg);
  }
  // The watch shows the label until it knows the value; the preview shows a sample value
  // when there is no label, so the format (unit, decimals) is visible.
  var px = el.h >= 22 ? 18 : 14;
  var text = (el.flags & ELF_LABEL) && el.label ? el.label : sliderText(el, value);
  if (vertical) this.text(text, px, el.x + el.w / 2, el.y + 14, css(fg), 'center', el.w - 4);
  else this.text(text, px, el.x + is + 8 + (el.w - is - 12) / 2, el.y + el.h / 2, css(fg), 'center', el.w - is - 12);
};

Preview.prototype.drawTitle = function (pg) {
  var L = this.layout, C = pg.colors, S = this.screen, ctx = this.ctx;
  var n = L.numPages;
  var round = L.flags & HDR_ROUND, title = pg.flags & PG_TITLE;
  var counter = n > 10 ? (this.page + 1) + '/' + n : null;
  var i;
  if (!round) {
    if (!title) return;
    var dotsW = n > 1 ? (counter ? 34 : n * 9) : 0;
    this.text(pg.name, 18, 5, 9, css(C.titleFg), 'left', S.w - 12 - dotsW);
    if (n > 1) {
      if (counter) this.text(counter, 14, S.w - 4, 9, css(C.titleFg), 'right');
      else for (i = 0; i < n; i++) {
        ctx.fillStyle = i === this.page ? css(C.accent) : css(C.titleFg);
        ctx.beginPath();
        ctx.arc(S.w - 8 - (n - 1 - i) * 9, 10, i === this.page ? 3 : 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  } else {
    if (title) this.text(pg.name, 18, S.w / 2, 18, css(C.titleFg), 'center', S.w - 100);
    if (n > 1) {
      var y = S.h - 11;
      if (counter) this.text(counter, 14, S.w / 2, y, css(C.titleFg));
      else {
        var x0 = S.w / 2 - ((n - 1) * 9) / 2;
        for (i = 0; i < n; i++) {
          ctx.fillStyle = i === this.page ? css(C.accent) : css(C.titleFg);
          ctx.beginPath();
          ctx.arc(x0 + i * 9, y, i === this.page ? 3 : 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }
  }
};

Preview.prototype.render = function () {
  var ctx = this.ctx, S = this.screen, L = this.layout;
  ctx.save();
  ctx.clearRect(0, 0, S.w, S.h);
  if (S.round) {
    ctx.beginPath();
    ctx.arc(S.w / 2, S.h / 2, S.w / 2, 0, 2 * Math.PI);
    ctx.clip();
  }
  var pg = L ? L.pages[this.page] : null;
  ctx.fillStyle = pg ? css(pg.colors.bg) : '#000';
  ctx.fillRect(0, 0, S.w, S.h);
  if (!L) { ctx.restore(); return; }
  this.drawTitle(pg);
  for (var i = 0; i < pg.elems.length; i++) {
    var el = pg.elems[i];
    var hl = this.highlight === i;
    if (el.type === EL_BUTTON) this.drawButton(el, hl);
    else if (el.type === EL_TOUCHPAD) this.drawTouchpad(el);
    else if (el.type === EL_CIRCLEPAD) this.drawCirclepad(el, hl ? 0 : -1);
    else if (el.type === EL_SLIDER) this.drawSlider(el);
    if (hl && el.type !== EL_BUTTON) {
      ctx.strokeStyle = css(pg.colors.accent);
      ctx.lineWidth = 2;
      ctx.strokeRect(el.x + 1, el.y + 1, el.w - 2, el.h - 2);
    }
  }
  ctx.restore();
};

// Returns the element index at canvas coordinates, or -1.
Preview.prototype.hitTest = function (x, y) {
  if (!this.layout) return -1;
  var pg = this.layout.pages[this.page];
  for (var i = 0; i < pg.elems.length; i++) {
    var el = pg.elems[i];
    if (x >= el.x && x < el.x + el.w && y >= el.y && y < el.y + el.h) return i;
  }
  return -1;
};

module.exports = Preview;
