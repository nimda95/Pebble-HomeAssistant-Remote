// Minimal Jinja/nunjucks-style templates, enough for universal-remote-card configs:
//   '{{ value | float }}', '{{ value / 100 }}', 'VOLUME_{{ "UP" if clockwise else "DOWN" }}',
//   '{{ not value }}', '{{ (value * 100) | round(0) }}'.
// A string that is exactly one {{ expression }} keeps the expression's type (number/bool).
// Unsupported syntax throws, and the caller reports the error on the watch.
'use strict';

var tr = require('./i18n').t;

function tokenize(src) {
  var toks = [];
  var i = 0;
  while (i < src.length) {
    var c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      var m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      toks.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      var j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; }
        else s += src[j++];
      }
      if (j >= src.length) throw new Error(tr('tplUnterminated'));
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      var w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))[0];
      toks.push({ t: 'id', v: w });
      i += w.length;
      continue;
    }
    var two = src.substr(i, 2);
    if (['==', '!=', '<=', '>=', '//', '**'].indexOf(two) >= 0) {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>()|,.[]~'.indexOf(c) >= 0) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(tr('tplUnexpected', { tok: c }));
  }
  return toks;
}

var FILTERS = {
  float: function (v, d) { var n = parseFloat(v); return isNaN(n) ? (d === undefined ? 0 : d) : n; },
  int: function (v, d) { var n = parseInt(v, 10); return isNaN(n) ? (d === undefined ? 0 : d) : n; },
  abs: function (v) { return Math.abs(v); },
  round: function (v, p, method) {
    var f = Math.pow(10, p || 0);
    var fn = method === 'floor' ? Math.floor : method === 'ceil' ? Math.ceil : Math.round;
    return fn(v * f) / f;
  },
  string: function (v) { return String(v); },
  lower: function (v) { return String(v).toLowerCase(); },
  upper: function (v) { return String(v).toUpperCase(); },
  default: function (v, d) { return v === undefined || v === null ? d : v; },
  bool: function (v) { return !!v && v !== 'false' && v !== 'off' && v !== '0'; },
  min: function (v) { return Math.min.apply(null, v); },
  max: function (v) { return Math.max.apply(null, v); },
};

function Parser(toks, vars) {
  this.toks = toks;
  this.i = 0;
  this.vars = vars || {};
}
Parser.prototype.peek = function () { return this.toks[this.i]; };
Parser.prototype.isOp = function (v) { var t = this.peek(); return t && t.t === 'op' && t.v === v; };
Parser.prototype.isId = function (v) { var t = this.peek(); return t && t.t === 'id' && t.v === v; };
Parser.prototype.expect = function (v) {
  if (!this.isOp(v)) throw new Error(tr('tplExpected', { tok: v }));
  this.i++;
};
// expr := or ('if' or 'else' expr)?
Parser.prototype.expr = function () {
  var a = this.or();
  if (this.isId('if')) {
    this.i++;
    var cond = this.or();
    var b = '';
    if (this.isId('else')) { this.i++; b = this.expr(); }
    return cond ? a : b;
  }
  return a;
};
Parser.prototype.or = function () {
  var a = this.and();
  while (this.isId('or')) { this.i++; var b = this.and(); a = a || b; }
  return a;
};
Parser.prototype.and = function () {
  var a = this.not();
  while (this.isId('and')) { this.i++; var b = this.not(); a = a && b; }
  return a;
};
Parser.prototype.not = function () {
  if (this.isId('not')) { this.i++; return !this.not(); }
  return this.cmp();
};
Parser.prototype.cmp = function () {
  var a = this.add();
  for (;;) {
    var t = this.peek();
    if (t && t.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].indexOf(t.v) >= 0) {
      this.i++;
      var b = this.add();
      switch (t.v) {
        case '==': a = a == b; break; // eslint-disable-line eqeqeq
        case '!=': a = a != b; break; // eslint-disable-line eqeqeq
        case '<': a = a < b; break;
        case '>': a = a > b; break;
        case '<=': a = a <= b; break;
        case '>=': a = a >= b; break;
      }
    } else if (this.isId('in')) {
      this.i++;
      var coll = this.add();
      a = coll != null && coll.indexOf(a) >= 0;
    } else {
      return a;
    }
  }
};
Parser.prototype.add = function () {
  var a = this.mul();
  for (;;) {
    if (this.isOp('+')) { this.i++; var b = this.mul(); a = typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : a + b; }
    else if (this.isOp('-')) { this.i++; a = a - this.mul(); }
    else if (this.isOp('~')) { this.i++; a = String(a) + String(this.mul()); }
    else return a;
  }
};
Parser.prototype.mul = function () {
  var a = this.unary();
  for (;;) {
    if (this.isOp('*')) { this.i++; a = a * this.unary(); }
    else if (this.isOp('/')) { this.i++; a = a / this.unary(); }
    else if (this.isOp('//')) { this.i++; a = Math.floor(a / this.unary()); }
    else if (this.isOp('%')) { this.i++; a = a % this.unary(); }
    else if (this.isOp('**')) { this.i++; a = Math.pow(a, this.unary()); }
    else return a;
  }
};
Parser.prototype.unary = function () {
  if (this.isOp('-')) { this.i++; return -this.unary(); }
  if (this.isOp('+')) { this.i++; return +this.unary(); }
  return this.filtered();
};
Parser.prototype.filtered = function () {
  var v = this.postfix();
  while (this.isOp('|')) {
    this.i++;
    var t = this.peek();
    if (!t || t.t !== 'id') throw new Error(tr('tplFilterName'));
    this.i++;
    var fn = FILTERS[t.v];
    if (!fn) throw new Error(tr('tplBadFilter', { name: t.v }));
    var args = [v];
    if (this.isOp('(')) args = args.concat(this.args());
    v = fn.apply(null, args);
  }
  return v;
};
Parser.prototype.args = function () {
  var out = [];
  this.expect('(');
  if (!this.isOp(')')) {
    out.push(this.expr());
    while (this.isOp(',')) { this.i++; out.push(this.expr()); }
  }
  this.expect(')');
  return out;
};
Parser.prototype.postfix = function () {
  var v = this.primary();
  for (;;) {
    if (this.isOp('.')) {
      this.i++;
      var t = this.peek();
      if (!t || t.t !== 'id') throw new Error(tr('tplAttrName'));
      this.i++;
      v = v == null ? undefined : v[t.v];
    } else if (this.isOp('[')) {
      this.i++;
      var k = this.expr();
      this.expect(']');
      v = v == null ? undefined : v[k];
    } else {
      return v;
    }
  }
};
Parser.prototype.primary = function () {
  var t = this.peek();
  if (!t) throw new Error(tr('tplEnd'));
  this.i++;
  if (t.t === 'num' || t.t === 'str') return t.v;
  if (t.t === 'op' && t.v === '(') {
    var v = this.expr();
    this.expect(')');
    return v;
  }
  if (t.t === 'op' && t.v === '[') {
    var arr = [];
    if (!this.isOp(']')) {
      arr.push(this.expr());
      while (this.isOp(',')) { this.i++; arr.push(this.expr()); }
    }
    this.expect(']');
    return arr;
  }
  if (t.t === 'id') {
    if (t.v === 'true' || t.v === 'True') return true;
    if (t.v === 'false' || t.v === 'False') return false;
    if (t.v === 'none' || t.v === 'None') return null;
    if (this.isOp('(')) {
      var fn = this.vars[t.v];
      if (typeof fn !== 'function') throw new Error(tr('tplBadFunction', { name: t.v }));
      return fn.apply(null, this.args());
    }
    if (!Object.prototype.hasOwnProperty.call(this.vars, t.v)) {
      throw new Error(tr('tplUnknownVar', { name: t.v }));
    }
    return this.vars[t.v];
  }
  throw new Error(tr('tplUnexpected', { tok: t.v }));
};

function evalExpr(src, vars) {
  var p = new Parser(tokenize(src), vars);
  var v = p.expr();
  if (p.i < p.toks.length) throw new Error(tr('tplUnexpected', { tok: p.toks[p.i].v }));
  return v;
}

var TPL_RE = /\{\{([\s\S]*?)\}\}/g;
var SINGLE_RE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;

function hasTemplate(s) {
  return typeof s === 'string' && (s.indexOf('{{') >= 0 || s.indexOf('{%') >= 0);
}

function renderString(s, vars) {
  if (!hasTemplate(s)) return s;
  if (s.indexOf('{%') >= 0) throw new Error(tr('tplStatements'));
  var single = SINGLE_RE.exec(s);
  if (single && single[1].indexOf('}}') < 0) return evalExpr(single[1], vars);
  return s.replace(TPL_RE, function (_, e) {
    var v = evalExpr(e, vars);
    return v === null || v === undefined ? '' : String(v);
  });
}

// Renders every string inside a JSON-like value.
function render(value, vars) {
  if (typeof value === 'string') return renderString(value, vars);
  if (Array.isArray(value)) return value.map(function (v) { return render(v, vars); });
  if (value && typeof value === 'object') {
    var out = {};
    for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = render(value[k], vars);
    return out;
  }
  return value;
}

module.exports = { render: render, renderString: renderString, evalExpr: evalExpr, hasTemplate: hasTemplate };
