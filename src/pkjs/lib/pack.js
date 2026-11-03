// Serializes a compiled model into the binary layout the watch draws from.
// Format (little endian), version 2. Mirrored by src/c/layout.c and lib/unpack.js.
//   header (8 bytes): 'H' 'R' version flags(4 = round) pages icons start_page(255 = last used) 0
//   per page:
//     u8 element_count, str name, u8 page_flags (1 haptics, 2 title bar),
//     u8 colors[6]: bg button_bg button_fg accent title_fg pad_bg (GColor8),
//     u8 hold10, repeat10, double10 (page defaults, x10 ms), u8 button_flags[3] (select, up, down)
//     per element (spacers are skipped):
//       u8 id (model element index), u8 type, u8 flags, u16 x, y, w, h, u8 fg, u8 bg, u8 value,
//       u8 hold10, repeat10, double10, u8 part_flags[5], u8 icons[5] (255 = none), str label
//       (part flags: 1 tap, 2 hold, 4 hold repeats tap, 8 double tap, 16 local next page, 32 local previous page)
//       sliders only: i32 min, max, step (x1000), u8 decimals, str unit
//   per icon: u8 size, then ceil(size/4) * size bytes of 2-bit alpha (MSB = leftmost pixel)
// str = u8 length including the NUL, the UTF-8 bytes, NUL.
'use strict';

var layoutLib = require('./layout');
var raster = require('./raster');
var modelLib = require('./model');

var VERSION = 2;
var TYPE = { button: 1, touchpad: 2, circlepad: 3, slider: 4 };
var EL_VERTICAL = 1, EL_DRAG = 2, EL_LABEL = 4, EL_VALUE = 8, EL_PERCENT = 16;
var PF_TAP = 1, PF_HOLD = 2, PF_REPEAT = 4, PF_DOUBLE = 8, PF_LOCAL_NEXT = 16, PF_LOCAL_PREV = 32;
var PG_HAPTICS = 1, PG_TITLE = 2, HDR_ROUND = 4;
var NO_ICON = 255;

var NAMED = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '00aa00', lime: '00ff00', blue: '0000ff',
  yellow: 'ffff00', orange: 'ff5500', purple: 'aa00aa', violet: 'aa55ff', magenta: 'ff00ff',
  fuchsia: 'ff00ff', pink: 'ffaaaa', cyan: '00ffff', aqua: '00ffff', teal: '005555', navy: '000055',
  maroon: '550000', olive: '555500', gray: 'aaaaaa', grey: 'aaaaaa', darkgray: '555555',
  darkgrey: '555555', lightgray: 'aaaaaa', lightgrey: 'aaaaaa', silver: 'aaaaaa', brown: 'aa5500',
  gold: 'ffaa00', indigo: '5500aa', crimson: 'aa0000', turquoise: '00ffaa', skyblue: '55aaff',
};

// CSS-ish color -> Pebble GColor8 byte (0b11rrggbb). Returns 0 (= "use default") if unknown.
function color8(c) {
  if (c === undefined || c === null || c === '') return 0;
  var s = String(c).trim().toLowerCase();
  var r, g, b, m;
  if (NAMED[s]) s = '#' + NAMED[s];
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s))) {
    r = parseInt(m[1] + m[1], 16); g = parseInt(m[2] + m[2], 16); b = parseInt(m[3] + m[3], 16);
  } else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(s))) {
    r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16);
  } else if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s))) {
    r = +m[1]; g = +m[2]; b = +m[3];
  } else {
    return 0;
  }
  var q = function (v) { return Math.max(0, Math.min(3, Math.round(v / 85))); };
  return 0xc0 | (q(r) << 4) | (q(g) << 2) | q(b);
}

var THEMES = {
  //        bg    btnBg btnFg accent titleFg padBg
  dark: [0xc0, 0xd5, 0xff, 0xcb, 0xea, 0xc5],
  light: [0xff, 0xea, 0xc0, 0xcb, 0xc0, 0xeb],
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Normalizes an icon reference: 'mdi:power' / 'hass:power' / brand name / raw SVG path.
function iconKey(icon) {
  if (icon === undefined || icon === null || icon === '' || icon === false) return null;
  return String(icon).trim();
}

// `{action: page, page: next|previous}` runs on the watch without a phone round trip.
function localPage(action) {
  if (!action || Array.isArray(action) || action.action !== 'page') return 0;
  var p = action.page === undefined ? 'next' : String(action.page).toLowerCase();
  if (p === 'next') return PF_LOCAL_NEXT;
  if (p === 'previous' || p === 'prev') return PF_LOCAL_PREV;
  return 0;
}

function partFlags(part) {
  if (!part) return 0;
  var f = 0;
  var tap = modelLib.hasAction(part.tap);
  var hold = modelLib.hasAction(part.hold);
  var local = localPage(part.tap);
  if (local) f |= local;
  else if (tap) f |= PF_TAP;
  if (hold || (tap && !local)) f |= PF_HOLD;
  if (part.hold && !Array.isArray(part.hold) && part.hold.action === 'repeat') f |= PF_REPEAT;
  if (modelLib.hasAction(part.double)) f |= PF_DOUBLE;
  return f;
}

// Decides what each element shows and at which icon sizes. Returns per-page placements.
function plan(model, screen) {
  var pages = [];
  model.pages.forEach(function (page) {
    var lay = layoutLib.layoutPage(page, screen, { title: page.style.show_title });
    var els = [];
    lay.items.forEach(function (it) {
      var el = page.elements[it.i];
      if (!el || el.type === 'spacer') return;
      var p = { el: el, x: it.x, y: it.y, w: it.w, h: it.h, icons: [null, null, null, null, null], label: '', flags: 0 };
      var minSide = Math.min(it.w, it.h);
      var icon = iconKey(el.icon);
      var label = el.label;
      if (el.type === 'button') {
        if (!icon && (label === undefined || label === '')) label = modelLib.prettyName(el.name);
        if (icon) {
          var s = clamp(Math.round(minSide * 0.6), 8, 40);
          if (label && it.h >= 16 + 18 && it.w >= 24) {
            s = clamp(Math.min(s, it.h - 20), 8, 32);
            p.flags |= EL_LABEL;
          } else {
            label = '';
          }
          p.icons[0] = { key: icon, size: s };
        } else if (label) {
          p.flags |= EL_LABEL;
        }
      } else if (el.type === 'touchpad') {
        if (icon) p.icons[0] = { key: icon, size: clamp(Math.round(minSide * 0.35), 10, 48) };
        modelLib.DIRS.forEach(function (d, k) {
          var part = el.parts[d];
          var di = part && iconKey(part.icon);
          if (di) p.icons[k + 1] = { key: di, size: clamp(Math.round(minSide * 0.16), 8, 20) };
        });
        if (label) p.flags |= EL_LABEL;
        if (modelLib.hasAction(el.drag)) p.flags |= EL_DRAG;
      } else if (el.type === 'circlepad') {
        var d0 = minSide;
        var inner = Math.round(d0 * 0.4);
        if (icon) p.icons[0] = { key: icon, size: clamp(Math.round(inner * 0.5), 8, 32) };
        else if (label) p.flags |= EL_LABEL;
        modelLib.DIRS.forEach(function (d, k) {
          var part = el.parts[d];
          var di = part && iconKey(part.icon);
          if (di) p.icons[k + 1] = { key: di, size: clamp(Math.round(d0 * 0.15), 8, 24) };
        });
        if (modelLib.hasAction(el.drag)) p.flags |= EL_DRAG;
      } else if (el.type === 'slider') {
        if (el.vertical) p.flags |= EL_VERTICAL;
        if (el.range[0] === 0 && el.range[1] === 1 && !el.unit) p.flags |= EL_PERCENT;
        if (icon) p.icons[0] = { key: icon, size: clamp(Math.round((el.vertical ? it.w : it.h) * 0.55), 8, 28) };
        if (label) p.flags |= EL_LABEL;
      }
      p.label = label ? String(label).slice(0, 24) : '';
      els.push(p);
    });
    pages.push({ page: page, layout: lay, els: els });
  });
  return pages;
}

// Lists the icon references a model needs (so the caller can fetch missing SVG paths first).
function neededIcons(model, screen) {
  var seen = {};
  plan(model, screen).forEach(function (pg) {
    pg.els.forEach(function (p) {
      p.icons.forEach(function (ic) { if (ic) seen[ic.key] = true; });
    });
  });
  return Object.keys(seen);
}

// Resolves an icon reference to SVG path data using the bundled assets, custom_icons and an
// optional cache of fetched MDI icons. Returns null when unknown.
function resolveIconPath(key, model, fetched) {
  if (!key) return null;
  var assets = model.assets;
  var m = /^(mdi|hass):(.+)$/.exec(key);
  if (m) {
    var nm = m[2];
    return (assets.mdi && assets.mdi[nm]) || (fetched && fetched[nm]) || null;
  }
  if (model.customIcons && model.customIcons[key]) return model.customIcons[key];
  if (assets.brand && assets.brand[key]) return assets.brand[key];
  if (/^[Mm][\s\d.+-]/.test(key)) return key; // raw SVG path data
  return null;
}

function writer() {
  var buf = [];
  return {
    u8: function (v) { buf.push(v & 0xff); },
    u16: function (v) { v = Math.max(0, Math.min(0xffff, Math.round(v))); buf.push(v & 0xff, (v >> 8) & 0xff); },
    str: function (s) {
      var bytes = require('./inflate').utf8Encode(s || '');
      var n = Math.min(bytes.length, 62);
      // don't cut a UTF-8 sequence in half
      while (n > 0 && n < bytes.length && (bytes[n] & 0xc0) === 0x80) n--;
      buf.push(n + 1);
      for (var i = 0; i < n; i++) buf.push(bytes[i]);
      buf.push(0);
    },
    bytes: function (arr) { for (var i = 0; i < arr.length; i++) buf.push(arr[i]); },
    out: function () { return new Uint8Array(buf); },
  };
}

function fnv1a(bytes) {
  var h = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function to10(ms) { return clamp(Math.round(ms / 10), 1, 255); }

function i32(w, v) {
  v = Math.max(-2147483648, Math.min(2147483647, Math.round(v))) | 0;
  w.u8(v & 0xff); w.u8((v >> 8) & 0xff); w.u8((v >> 16) & 0xff); w.u8((v >> 24) & 0xff);
}

function decimalsOf(step) {
  var s = String(step);
  if (/e-/i.test(s)) return 3;
  return Math.min(3, (s.split('.')[1] || '').length);
}

// Page colors: the theme's palette with the page's style overrides.
function pageColors(style) {
  var c = (THEMES[style.theme] || THEMES.dark).slice();
  var over = [style.background, style.button, style.text, style.accent, style.title, style.pad];
  over.forEach(function (v, i) {
    var g = color8(v);
    if (g) c[i] = g;
  });
  return c;
}

function startPageIndex(model) {
  var idx = 255; // unset: the watch reopens the last page used
  model.pages.forEach(function (p, i) { if (p.start && idx === 255) idx = i; });
  var sp = model.options.start_page;
  if (typeof sp === 'number') idx = clamp(sp - 1, 0, Math.max(0, model.pages.length - 1));
  else if (typeof sp === 'string') model.pages.forEach(function (p, i) { if (p.name === sp) idx = i; });
  return idx;
}

// fetched: { mdiName: path } for icons downloaded at runtime.
// Returns { bytes, hash, missingIcons, pages (placements, for the preview) }.
function pack(model, screen, fetched) {
  var pages = plan(model, screen);
  var iconIndex = {};
  var iconList = [];
  var missing = {};

  function iconId(ic) {
    if (!ic) return NO_ICON;
    var id = ic.key + '@' + ic.size;
    if (iconIndex[id] !== undefined) return iconIndex[id];
    var path = resolveIconPath(ic.key, model, fetched);
    if (!path) { missing[ic.key] = true; return NO_ICON; }
    if (iconList.length >= 254) return NO_ICON;
    var rendered;
    try {
      rendered = raster.renderIcon(path, ic.size);
    } catch (e) {
      missing[ic.key] = true;
      return NO_ICON;
    }
    iconIndex[id] = iconList.length;
    iconList.push(rendered);
    return iconIndex[id];
  }

  // Element records reference icons by index, so build them first and the header last.
  var body = writer();
  pages.forEach(function (pg) {
    var page = pg.page;
    body.u8(pg.els.length);
    body.str(page.name);
    body.u8((page.options.haptics ? PG_HAPTICS : 0) | (page.style.show_title ? PG_TITLE : 0));
    pageColors(page.style).forEach(function (c) { body.u8(c); });
    body.u8(to10(page.options.hold_time));
    body.u8(to10(page.options.repeat_delay));
    body.u8(to10(page.options.double_tap_window));
    ['select', 'up', 'down'].forEach(function (b) {
      var btn = page.buttons[b];
      body.u8(btn ? partFlags(btn.parts.center) : 0);
    });
    pg.els.forEach(function (p) {
      var el = p.el;
      body.u8(el.index);
      body.u8(TYPE[el.type]);
      body.u8(p.flags);
      body.u16(p.x); body.u16(p.y); body.u16(p.w); body.u16(p.h);
      body.u8(color8(el.color));
      body.u8(color8(el.background));
      body.u8(0);
      body.u8(to10(el.timing.hold_time));
      body.u8(to10(el.timing.repeat_delay));
      body.u8(to10(el.timing.double_tap_window));
      modelLib.PARTS.forEach(function (part) {
        var pf = partFlags(el.parts[part]);
        // Drag elements fire their drag action for each step in any direction.
        if (part !== 'center' && (p.flags & EL_DRAG) && !pf) pf = PF_TAP;
        body.u8(pf);
      });
      p.icons.forEach(function (ic) { body.u8(iconId(ic)); });
      body.str(p.label);
      if (el.type === 'slider') {
        i32(body, el.range[0] * 1000);
        i32(body, el.range[1] * 1000);
        i32(body, el.step * 1000);
        body.u8(decimalsOf(el.step));
        body.str(el.unit || '');
      }
    });
  });

  var w = writer();
  w.u8(0x48); w.u8(0x52); w.u8(VERSION); w.u8(screen.round ? HDR_ROUND : 0);
  w.u8(pages.length); w.u8(iconList.length);
  w.u8(startPageIndex(model));
  w.u8(0);
  w.bytes(body.out());
  iconList.forEach(function (ic) {
    w.u8(ic.size);
    w.bytes(ic.data);
  });
  var bytes = w.out();
  return { bytes: bytes, hash: fnv1a(bytes), missingIcons: Object.keys(missing), pages: pages };
}

module.exports = {
  pack: pack,
  plan: plan,
  neededIcons: neededIcons,
  resolveIconPath: resolveIconPath,
  color8: color8,
  fnv1a: fnv1a,
  THEMES: THEMES,
  TYPE: TYPE,
  FLAGS: {
    EL_VERTICAL: EL_VERTICAL, EL_DRAG: EL_DRAG, EL_LABEL: EL_LABEL, EL_VALUE: EL_VALUE, EL_PERCENT: EL_PERCENT,
    PF_TAP: PF_TAP, PF_HOLD: PF_HOLD, PF_REPEAT: PF_REPEAT, PF_DOUBLE: PF_DOUBLE, PF_LOCAL_NEXT: PF_LOCAL_NEXT, PF_LOCAL_PREV: PF_LOCAL_PREV,
    PG_HAPTICS: PG_HAPTICS, PG_TITLE: PG_TITLE, HDR_ROUND: HDR_ROUND,
  },
  pageColors: pageColors,
  NO_ICON: NO_ICON,
};
