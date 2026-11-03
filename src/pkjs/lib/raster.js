// SVG path -> anti-aliased alpha mask, in plain JS (no canvas in PebbleKit JS).
// Icons use a 24x24 viewBox (Material Design Icons and the universal-remote-card brand icons).
// Output is packed 2 bits per pixel, most significant pixel first, rows padded to whole bytes,
// which is the layout of a Pebble GBitmapFormat2BitPalette bitmap.
'use strict';

function isDigitStart(ch) {
  return (ch >= '0' && ch <= '9') || ch === '.' || ch === '-' || ch === '+';
}

// Returns an array of [cmd, args[]] with implicit repeats expanded.
function parsePath(d) {
  var out = [];
  var i = 0, n = d.length;
  var cmd = null;

  function skipSep() {
    while (i < n) {
      var c = d[i];
      if (c === ' ' || c === ',' || c === '\n' || c === '\t' || c === '\r') i++;
      else break;
    }
  }
  function readNumber() {
    skipSep();
    var start = i;
    if (d[i] === '+' || d[i] === '-') i++;
    var sawDot = false, sawDigit = false;
    while (i < n) {
      var c = d[i];
      if (c >= '0' && c <= '9') { sawDigit = true; i++; }
      else if (c === '.' && !sawDot) { sawDot = true; i++; }
      else break;
    }
    if (sawDigit && (d[i] === 'e' || d[i] === 'E')) {
      var save = i;
      i++;
      if (d[i] === '+' || d[i] === '-') i++;
      if (d[i] >= '0' && d[i] <= '9') { while (d[i] >= '0' && d[i] <= '9') i++; }
      else i = save;
    }
    if (!sawDigit) throw new Error('bad number in path at ' + start);
    return parseFloat(d.slice(start, i));
  }
  function readFlag() {
    skipSep();
    var c = d[i];
    if (c !== '0' && c !== '1') throw new Error('bad arc flag at ' + i);
    i++;
    return c === '1' ? 1 : 0;
  }
  var ARGC = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  while (true) {
    skipSep();
    if (i >= n) break;
    var c = d[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      cmd = c;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        out.push([cmd, []]);
        continue;
      }
    } else if (!isDigitStart(c) || cmd === null) {
      throw new Error('unexpected "' + c + '" in path at ' + i);
    }
    var up = cmd.toUpperCase();
    if (up === 'Z') throw new Error('number after Z');
    var args = [];
    if (up === 'A') {
      args.push(readNumber(), readNumber(), readNumber(), readFlag(), readFlag(), readNumber(), readNumber());
    } else {
      for (var k = 0; k < ARGC[up]; k++) args.push(readNumber());
    }
    out.push([cmd, args]);
    // After a moveto, extra coordinate pairs are implicit linetos.
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  return out;
}

// Converts the path to closed polygons (arrays of [x0,y0,x1,y1,...]) in path units.
function flatten(cmds, tolerance) {
  var polys = [];
  var cur = null;
  var x = 0, y = 0, sx = 0, sy = 0;
  var lcx = 0, lcy = 0, lastCmd = '';
  var tol = tolerance || 0.1;

  function moveTo(nx, ny) {
    if (cur && cur.length > 2) polys.push(cur);
    cur = [nx, ny];
    sx = nx; sy = ny;
  }
  function lineTo(nx, ny) {
    if (!cur) cur = [x, y];
    cur.push(nx, ny);
  }
  function segs(len) {
    return Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
  }
  function cubic(x1, y1, x2, y2, x3, y3) {
    var len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    var nseg = segs(len);
    for (var s = 1; s <= nseg; s++) {
      var t = s / nseg, mt = 1 - t;
      var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
      lineTo(a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3);
    }
  }
  function quad(x1, y1, x2, y2) {
    var len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1);
    var nseg = segs(len);
    for (var s = 1; s <= nseg; s++) {
      var t = s / nseg, mt = 1 - t;
      lineTo(mt * mt * x + 2 * mt * t * x1 + t * t * x2, mt * mt * y + 2 * mt * t * y1 + t * t * y2);
    }
  }
  // SVG arc, endpoint parameterization -> center parameterization (SVG 1.1 F.6.5).
  function arc(rx, ry, phiDeg, large, sweep, x2, y2) {
    if (x2 === x && y2 === y) return;
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) { lineTo(x2, y2); return; }
    var phi = (phiDeg * Math.PI) / 180;
    var cos = Math.cos(phi), sin = Math.sin(phi);
    var dx = (x - x2) / 2, dy = (y - y2) / 2;
    var x1p = cos * dx + sin * dy;
    var y1p = -sin * dx + cos * dy;
    var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { var sl = Math.sqrt(lambda); rx *= sl; ry *= sl; }
    var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    var coef = Math.sqrt(Math.max(0, num / den)) * (large === sweep ? -1 : 1);
    var cxp = (coef * rx * y1p) / ry;
    var cyp = (-coef * ry * x1p) / rx;
    var cx = cos * cxp - sin * cyp + (x + x2) / 2;
    var cy = sin * cxp + cos * cyp + (y + y2) / 2;
    function ang(ux, uy, vx, vy) {
      var a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    }
    var t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    var nseg = segs(Math.abs(dt) * Math.max(rx, ry));
    for (var s = 1; s <= nseg; s++) {
      var t = t1 + (dt * s) / nseg;
      var ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      lineTo(cos * ex - sin * ey + cx, sin * ex + cos * ey + cy);
    }
  }

  for (var idx = 0; idx < cmds.length; idx++) {
    var c = cmds[idx][0], a = cmds[idx][1];
    var rel = c === c.toLowerCase();
    var C = c.toUpperCase();
    var ox = rel ? x : 0, oy = rel ? y : 0;
    var nx, ny, x1, y1, x2, y2;
    switch (C) {
      case 'M':
        nx = a[0] + ox; ny = a[1] + oy;
        moveTo(nx, ny);
        x = nx; y = ny;
        break;
      case 'L':
        nx = a[0] + ox; ny = a[1] + oy;
        lineTo(nx, ny);
        x = nx; y = ny;
        break;
      case 'H':
        nx = a[0] + ox;
        lineTo(nx, y);
        x = nx;
        break;
      case 'V':
        ny = a[0] + (rel ? y : 0);
        lineTo(x, ny);
        y = ny;
        break;
      case 'C':
        x1 = a[0] + ox; y1 = a[1] + oy; x2 = a[2] + ox; y2 = a[3] + oy;
        nx = a[4] + ox; ny = a[5] + oy;
        cubic(x1, y1, x2, y2, nx, ny);
        lcx = x2; lcy = y2;
        x = nx; y = ny;
        break;
      case 'S':
        if (lastCmd === 'C' || lastCmd === 'S') { x1 = 2 * x - lcx; y1 = 2 * y - lcy; }
        else { x1 = x; y1 = y; }
        x2 = a[0] + ox; y2 = a[1] + oy;
        nx = a[2] + ox; ny = a[3] + oy;
        cubic(x1, y1, x2, y2, nx, ny);
        lcx = x2; lcy = y2;
        x = nx; y = ny;
        break;
      case 'Q':
        x1 = a[0] + ox; y1 = a[1] + oy;
        nx = a[2] + ox; ny = a[3] + oy;
        quad(x1, y1, nx, ny);
        lcx = x1; lcy = y1;
        x = nx; y = ny;
        break;
      case 'T':
        if (lastCmd === 'Q' || lastCmd === 'T') { x1 = 2 * x - lcx; y1 = 2 * y - lcy; }
        else { x1 = x; y1 = y; }
        nx = a[0] + ox; ny = a[1] + oy;
        quad(x1, y1, nx, ny);
        lcx = x1; lcy = y1;
        x = nx; y = ny;
        break;
      case 'A':
        nx = a[5] + ox; ny = a[6] + oy;
        arc(a[0], a[1], a[2], a[3], a[4], nx, ny);
        x = nx; y = ny;
        break;
      case 'Z':
        if (cur && cur.length > 2) {
          polys.push(cur);
        }
        cur = null;
        x = sx; y = sy;
        break;
    }
    lastCmd = C;
  }
  if (cur && cur.length > 2) polys.push(cur);
  return polys;
}

// Rasterizes polygons with the non-zero winding rule. Returns Float32Array coverage (0..1).
// SS x SS samples per pixel.
function rasterize(polys, size, scale, offX, offY, SS) {
  SS = SS || 4;
  var W = size, H = size;
  var cov = new Float32Array(W * H);
  var edges = [];
  for (var p = 0; p < polys.length; p++) {
    var poly = polys[p];
    var m = poly.length;
    for (var i = 0; i < m; i += 2) {
      var j = (i + 2) % m;
      var ax = poly[i] * scale + offX, ay = poly[i + 1] * scale + offY;
      var bx = poly[j] * scale + offX, by = poly[j + 1] * scale + offY;
      if (ay === by) continue;
      var dir = 1;
      if (ay > by) {
        var t = ax; ax = bx; bx = t;
        t = ay; ay = by; by = t;
        dir = -1;
      }
      edges.push({ y0: ay, y1: by, x0: ax, slope: (bx - ax) / (by - ay), dir: dir });
    }
  }
  var weight = 1 / (SS * SS);
  var xs = [];
  for (var row = 0; row < H * SS; row++) {
    var sy = (row + 0.5) / SS;
    xs.length = 0;
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      if (sy >= ed.y0 && sy < ed.y1) xs.push({ x: ed.x0 + (sy - ed.y0) * ed.slope, d: ed.dir });
    }
    if (!xs.length) continue;
    xs.sort(function (a, b) { return a.x - b.x; });
    var wind = 0;
    var py = Math.floor(sy);
    var rowBase = py * W;
    for (var k = 0; k < xs.length - 1; k++) {
      wind += xs[k].d;
      if (wind === 0) continue;
      // fill sample columns whose centers fall in [xs[k].x, xs[k+1].x)
      var xa = xs[k].x, xb = xs[k + 1].x;
      var c0 = Math.max(0, Math.ceil(xa * SS - 0.5));
      var c1 = Math.min(W * SS - 1, Math.ceil(xb * SS - 0.5) - 1);
      for (var col = c0; col <= c1; col++) {
        cov[rowBase + ((col / SS) | 0)] += weight;
      }
    }
  }
  return cov;
}

// Renders an icon path into a size x size alpha mask packed at 2 bits per pixel.
// Returns { size, stride, data: Uint8Array }.
function renderIcon(pathData, size, opts) {
  opts = opts || {};
  var viewBox = opts.viewBox || 24;
  var cmds = parsePath(pathData);
  var polys = flatten(cmds, 0.05);
  var scale = size / viewBox;
  var cov = rasterize(polys, size, scale, 0, 0, opts.ss || 4);
  var stride = Math.ceil(size / 4);
  var data = new Uint8Array(stride * size);
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var a = Math.min(1, cov[y * size + x]);
      // Bias toward solid pixels: thin strokes stay visible on a small screen.
      var lvl = a >= 0.8 ? 3 : a >= 0.45 ? 2 : a >= 0.15 ? 1 : 0;
      data[y * stride + (x >> 2)] |= lvl << (6 - 2 * (x & 3));
    }
  }
  return { size: size, stride: stride, data: data };
}

// Reads the alpha level (0..3) of pixel x,y from a renderIcon() result.
function iconPixel(icon, x, y) {
  return (icon.data[y * icon.stride + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
}

module.exports = {
  parsePath: parsePath,
  flatten: flatten,
  rasterize: rasterize,
  renderIcon: renderIcon,
  iconPixel: iconPixel,
};
