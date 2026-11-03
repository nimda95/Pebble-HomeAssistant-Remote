// Computes absolute pixel rectangles for a compiled page on a given watch screen.
// Rows split their width between children by weight, columns split their height, and
// nesting alternates exactly like universal-remote-card's rows/columns.
// On round screens each top-level row is narrowed to fit inside the circle.
'use strict';

var SCREENS = {
  emery: { w: 200, h: 228, round: false },
  gabbro: { w: 260, h: 260, round: true },
};

// Default size weights per element type: [width, height].
var WEIGHTS = {
  spacer: [1, 1],
  button: [1, 1],
  touchpad: [3, 3],
  circlepad: [3, 3],
  slider: [3, 1],
  vslider: [1, 3],
};

function elWeights(el) {
  var key = el.type === 'slider' && el.vertical ? 'vslider' : el.type;
  var w = WEIGHTS[key] || WEIGHTS.button;
  return [el.width > 0 ? el.width : w[0], el.height > 0 ? el.height : w[1]];
}

function measure(node, page) {
  if (node.k === 'el') {
    var w = elWeights(page.elements[node.i]);
    node.ww = w[0];
    node.hh = w[1];
    return node;
  }
  var ww = 0, hh = 0;
  node.c.forEach(function (ch) {
    measure(ch, page);
    if (node.k === 'row') {
      ww += ch.ww;
      hh = Math.max(hh, ch.hh);
    } else {
      ww = Math.max(ww, ch.ww);
      hh += ch.hh;
    }
  });
  node.ww = ww || 1;
  node.hh = hh || 1;
  return node;
}

// Splits `total` pixels between weights with `gap` pixels between parts.
function split(total, weights, gap) {
  var n = weights.length;
  if (!n) return [];
  var avail = Math.max(0, total - gap * (n - 1));
  var sum = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
  var sizes = [], fracs = [], used = 0;
  for (var i = 0; i < n; i++) {
    var exact = (avail * weights[i]) / sum;
    sizes.push(Math.floor(exact));
    fracs.push({ i: i, f: exact - Math.floor(exact) });
    used += sizes[i];
  }
  fracs.sort(function (a, b) { return b.f - a.f; });
  for (var k = 0; used < avail && k < n; k++, used++) sizes[fracs[k].i]++;
  return sizes;
}

function place(node, x, y, w, h, gap, out) {
  if (node.k === 'el') {
    out.push({ i: node.i, x: x, y: y, w: Math.max(1, w), h: Math.max(1, h) });
    return;
  }
  var horiz = node.k === 'row';
  var sizes = split(horiz ? w : h, node.c.map(function (c) { return horiz ? c.ww : c.hh; }), gap);
  var off = 0;
  node.c.forEach(function (ch, idx) {
    if (horiz) place(ch, x + off, y, sizes[idx], h, gap, out);
    else place(ch, x, y + off, w, sizes[idx], gap, out);
    off += sizes[idx] + gap;
  });
}

// screen: { w, h, round }; opts: { title: bool }
// Returns { items: [{i,x,y,w,h}], titleH, footerH, content: {x,y,w,h} }
function layoutPage(page, screen, opts) {
  opts = opts || {};
  var showTitle = opts.title !== false;
  var gap = screen.w >= 200 ? 4 : 3;
  var margin = 3;
  var root = measure(JSON.parse(JSON.stringify(page.layout)), page);
  var items = [];
  var titleH, footerH, top, bottom;

  if (!screen.round) {
    titleH = showTitle ? 20 : 0;
    footerH = 0;
    top = titleH + (showTitle ? 2 : margin);
    bottom = screen.h - margin;
    place(root, margin, top, screen.w - 2 * margin, bottom - top, gap, items);
  } else {
    titleH = showTitle ? 34 : 0;
    footerH = 20;
    top = showTitle ? titleH : 18;
    bottom = screen.h - footerH;
    var R = screen.w / 2 - 3;
    var cx = screen.w / 2, cy = screen.h / 2;
    var rows = root.c;
    var heights = split(bottom - top, rows.map(function (r) { return r.hh; }), gap);
    var y = top;
    rows.forEach(function (row, idx) {
      var h = heights[idx];
      var dy = Math.max(Math.abs(y - cy), Math.abs(y + h - cy));
      var half = dy >= R ? 0 : Math.sqrt(R * R - dy * dy);
      // A lone round element (circlepad) only needs its inscribed circle to fit.
      var x0 = Math.ceil(cx - half), x1 = Math.floor(cx + half);
      if (x1 - x0 < h && row.c.length === 1) {
        x0 = Math.round(cx - h / 2);
        x1 = x0 + h;
      }
      place(row, x0, y, Math.max(1, x1 - x0), h, gap, items);
      y += h + gap;
    });
  }
  return {
    items: items,
    titleH: titleH,
    footerH: footerH,
    content: { x: margin, y: top, w: screen.w - 2 * margin, h: bottom - top },
  };
}

module.exports = { layoutPage: layoutPage, split: split, SCREENS: SCREENS, elWeights: elWeights };
