// Settings page for HA Remote. Opened by PebbleKit JS as a data: URL, so it has no
// localStorage and can't reach Home Assistant (CORS); everything it needs is injected into
// window.__PEBBLE_INIT__ and the result goes back through pebblejs://close#.
'use strict';

var yaml = require('js-yaml');
var inflate = require('../src/pkjs/lib/inflate');
var modelLib = require('../src/pkjs/lib/model');
var packLib = require('../src/pkjs/lib/pack');
var layoutLib = require('../src/pkjs/lib/layout');
var i18n = require('../src/pkjs/lib/i18n');
var Preview = require('./preview');
var templates = require('./templates');

var init = window.__PEBBLE_INIT__;
if (!init || typeof init !== 'object') init = window.__PEBBLE_DEV_INIT__ || {};

// Translations other than English come from the phone (src/pkjs/generated/strings.js).
try {
  i18n.loadPacked(init.strings);
} catch (e) {
  console.log('translations not loaded: ' + e);
}
var T = i18n.tp;

var assets = JSON.parse(inflate.gunzipBase64ToString(init.assets));
// Icons that aren't bundled come from the phone, which loads them from Home
// Assistant itself (this page cannot reach HA, and makes no other connection).
var iconCache = init.iconCache || {};

var $ = function (id) { return document.getElementById(id); };

var state = {
  screen: null,
  model: null,
  packed: null,
  page: 0,
  selected: -1,
  config: null,
  valid: false,
};

// ---------------------------------------------------------------------------- watch model

function pickScreen() {
  if (init.screen && init.screen.w) return { w: init.screen.w, h: init.screen.h, round: !!init.screen.round };
  if (init.platform && layoutLib.SCREENS[init.platform]) return layoutLib.SCREENS[init.platform];
  return layoutLib.SCREENS.emery;
}

// ---------------------------------------------------------------------------- helpers

function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}

function svgIcon(path) {
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  if (path) {
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
  }
  return svg;
}

function iconPath(icon) {
  if (!icon) return null;
  var m = /^(mdi|hass):(.+)$/.exec(icon);
  if (m) return assets.mdi[m[2]] || iconCache[m[2]] || null;
  return assets.brand[icon] || null;
}

function each(selector, fn) {
  Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
}

function debounce(fn, ms) {
  var t;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// ---------------------------------------------------------------------------- problems

function lineOfError(e) {
  return e && e.mark && typeof e.mark.line === 'number' ? e.mark.line + 1 : null;
}

function showProblems(errors, warnings) {
  var box = $('problems');
  box.innerHTML = '';
  errors.forEach(function (p) { box.appendChild(problem(p, 'error')); });
  warnings.forEach(function (p) { box.appendChild(problem(p, 'warn')); });
  box.hidden = !errors.length && !warnings.length;
}

function problem(p, kind) {
  var msg = typeof p === 'string' ? p : p.message;
  var row = el('div', { className: 'problem ' + kind }, [
    el('span', { className: 'badge', text: T(kind === 'error' ? 'error' : 'note') }),
    el('span', { className: 'msg', text: msg }),
  ]);
  if (p && p.line) {
    row.appendChild(el('button', { className: 'link', text: T('line', { n: p.line }), onclick: function () { gotoLine(p.line); } }));
  }
  return row;
}

function gotoLine(line) {
  var ta = $('yaml');
  var lines = ta.value.split('\n');
  var start = 0;
  for (var i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  var end = start + (lines[line - 1] || '').length;
  ta.focus();
  ta.setSelectionRange(start, end);
  var lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollIntoView({ block: 'center' });
  ta.scrollTop = Math.max(0, (line - 4) * lh);
}

// ---------------------------------------------------------------------------- update cycle

var preview = null;

function update() {
  var text = $('yaml').value;
  var errors = [], warnings = [];
  var config = null;
  try {
    config = yaml.load(text);
  } catch (e) {
    var msg = (e.reason || e.message || String(e)).replace(/\s+/g, ' ');
    errors.push({ message: 'YAML: ' + msg, line: lineOfError(e) });
  }
  var model = null;
  if (!errors.length) {
    model = modelLib.compile(config, assets);
    model.errors.forEach(function (m) { errors.push(m); });
    model.warnings.forEach(function (m) { warnings.push(m); });
  }
  var packed = null;
  if (model && !errors.length) {
    try {
      packed = packLib.pack(model, state.screen, iconCache);
      if (packed.missingIcons.length) {
        var unknown = [], later = [];
        packed.missingIcons.forEach(function (k) {
          var m = /^(mdi|hass):(.+)$/.exec(k);
          if (m && iconCache[m[2]] === undefined) later.push(k);
          else unknown.push(k);
        });
        if (later.length) warnings.push(T('iconsLater', { icons: later.join(', ') }));
        if (unknown.length) warnings.push(T('iconsUnknown', { icons: unknown.join(', ') }));
      }
      if (packed.bytes.length > 150000) errors.push(T('tooBig', { kb: Math.round(packed.bytes.length / 1024) }));
    } catch (e) {
      errors.push(T('layoutProblem', { msg: e.message }));
    }
  }
  state.valid = !errors.length && !!packed;
  state.config = config;
  showProblems(errors, warnings);
  $('save').disabled = !state.valid;
  $('saveHint').textContent = state.valid ? '' : T('fixErrors');
  if (state.valid) {
    state.model = model;
    state.packed = packed;
    preview.setLayout(packed.bytes, state.screen);
    if (state.page >= model.pages.length) state.page = 0;
    renderTabs();
    showPage(state.page);
  } else {
    $('screenWrap').classList.add('stale');
  }
}

function renderTabs() {
  var tabs = $('pageTabs');
  tabs.innerHTML = '';
  state.model.pages.forEach(function (p, i) {
    tabs.appendChild(el('button', {
      className: 'tab' + (i === state.page ? ' active' : ''),
      text: p.name,
      onclick: function () { showPage(i); },
    }));
  });
}

function showPage(i) {
  state.page = i;
  state.selected = -1;
  preview.page = i;
  preview.highlight = -1;
  preview.render();
  $('screenWrap').classList.remove('stale');
  Array.prototype.forEach.call($('pageTabs').children, function (t, k) {
    t.classList.toggle('active', k === i);
  });
  var pg = state.model.pages[i];
  var ents = [pg.ctx.entity_id, pg.ctx.remote_id, pg.ctx.media_player_id].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  $('pageInfo').textContent = [pg.ctx.platform || T('noPlatform')].concat(ents).join(' · ');
  inspectButtons(pg);
  if ($('platformSel').dataset.touched !== '1' && pg.ctx.platformId) {
    $('platformSel').value = pg.ctx.platformId;
    renderKeys();
  }
}

// ---------------------------------------------------------------------------- inspector

function describeAction(a) {
  if (a === undefined || a === null) return null;
  if (Array.isArray(a)) return a.map(describeAction).join(' → ');
  if (typeof a !== 'object') return String(a);
  switch (a.action) {
    case 'key': return T('actKey', { key: a.key });
    case 'source': return T('actOpen', { source: a.source });
    case 'perform-action':
    case 'call-service': return (a.perform_action || a.service) + (a.data ? ' ' + JSON.stringify(a.data) : '');
    case 'page': {
      var pg = a.page === undefined ? 'next' : String(a.page);
      if (pg === 'next') return T('actNextPage');
      if (pg === 'previous' || pg === 'prev') return T('actPrevPage');
      return T('actGotoPage', { page: pg });
    }
    case 'repeat': return T('actRepeat');
    case 'toggle': {
      var t = (a.target && a.target.entity_id) || (a.data && a.data.entity_id);
      return T('actToggle', { target: t ? [].concat(t).join(', ') : T('actPageEntity') });
    }
    case 'keyboard':
    case 'textbox':
    case 'search': return T('actDictate', { action: a.action });
    default: return a.action || JSON.stringify(a);
  }
}

// The `action` of a single action, or of the first/last one of a list.
function kindOf(a, last) {
  if (Array.isArray(a)) a = a[last ? a.length - 1 : 0];
  return a && typeof a === 'object' ? a.action : undefined;
}

var ROW_KEYS = {
  center: ['tap', 'hold', 'doubleTap'],
  up: ['swipeUp', 'holdUp', 'doubleUp'],
  down: ['swipeDown', 'holdDown', 'doubleDown'],
  left: ['swipeLeft', 'holdLeft', 'doubleLeft'],
  right: ['swipeRight', 'holdRight', 'doubleRight'],
};

function actionRows(parts) {
  var rows = [];
  Object.keys(parts).forEach(function (k) {
    var p = parts[k];
    if (!p) return;
    var names = ROW_KEYS[k] || ROW_KEYS.center;
    var t = describeAction(p.tap), h = describeAction(p.hold), d = describeAction(p.double);
    var hold = T(names[1]);
    var isPage = kindOf(p.tap) === 'page' || kindOf(p.tap, true) === 'page';
    if (t) rows.push([T(names[0]), t]);
    if (h) rows.push([hold, h]);
    else if (t && !isPage) rows.push([hold, kindOf(p.tap) === 'key' ? T('longPress', { action: t }) : t]);
    if (d) rows.push([T(names[2]), d]);
  });
  return rows;
}

function table(rows) {
  var tb = el('table', { className: 'acts' });
  rows.forEach(function (r) {
    tb.appendChild(el('tr', null, [el('th', { text: r[0] }), el('td', { text: r[1] })]));
  });
  return tb;
}

function inspectButtons(pg) {
  var box = $('inspect');
  box.innerHTML = '';
  box.appendChild(el('div', { className: 'insp-title', text: T('watchButtons') }));
  var rows = [];
  [
    [pg.buttons.select, 'btnSelect', 'btnSelectHold', 'btnSelectDouble'],
    [pg.buttons.up, 'btnUp', 'btnUpHold', 'btnUpDouble'],
    [pg.buttons.down, 'btnDown', 'btnDownHold', 'btnDownDouble'],
  ].forEach(function (b) {
    if (!b[0]) { rows.push([T(b[1]), T('nothing')]); return; }
    var p = b[0].parts.center;
    rows.push([T(b[1]), describeAction(p.tap) || T('nothing')]);
    if (p.hold) rows.push([T(b[2]), describeAction(p.hold)]);
    if (p.double) rows.push([T(b[3]), describeAction(p.double)]);
  });
  box.appendChild(table(rows));
  box.appendChild(el('div', { className: 'hint', text: T('inspectHint') }));
}

function inspectElement(index) {
  var pg = state.model.pages[state.page];
  var placed = preview.layout.pages[state.page].elems[index];
  var m = pg.elements[placed.id];
  var box = $('inspect');
  box.innerHTML = '';
  var title = el('div', { className: 'insp-title' }, [
    svgIcon(iconPath(m.icon)),
    el('span', { text: m.name || T('inline') }),
    el('span', { className: 'type', text: m.type }),
  ]);
  box.appendChild(title);
  var rows;
  if (m.type === 'slider') {
    rows = [
      [T('value'), (m.entity_id || '?') + ' · ' + m.value_attribute + ' · ' + m.range[0] + '–' + m.range[1] + (m.unit || '')],
      [T('release'), describeAction(m.parts.center && m.parts.center.tap) || T('nothing')],
    ];
  } else {
    rows = actionRows(m.parts);
  }
  if (m.drag) rows.push([T(m.type === 'circlepad' ? 'spinRing' : 'drag'), describeAction(m.drag)]);
  if (!rows.length) rows.push(['', T('noActions')]);
  box.appendChild(table(rows));
  box.appendChild(el('div', { className: 'hint', text: placed.w + '×' + placed.h + ' px' }));
}

function onCanvasClick(ev) {
  var c = $('screen');
  var rect = c.getBoundingClientRect();
  var x = ((ev.clientX - rect.left) / rect.width) * c.width;
  var y = ((ev.clientY - rect.top) / rect.height) * c.height;
  var i = preview.hitTest(x, y);
  preview.highlight = i;
  preview.render();
  if (i >= 0) inspectElement(i);
  else inspectButtons(state.model.pages[state.page]);
}

// ---------------------------------------------------------------------------- keys & apps

function renderPlatformSelect() {
  var sel = $('platformSel');
  Object.keys(modelLib.PLATFORM_NAMES).forEach(function (id) {
    sel.appendChild(el('option', { value: id, text: modelLib.PLATFORM_NAMES[id] }));
  });
  sel.addEventListener('change', function () {
    sel.dataset.touched = '1';
    renderKeys();
  });
  $('keySearch').addEventListener('input', debounce(renderKeys, 150));
}

function insertAtCursor(text) {
  var ta = $('yaml');
  var s = ta.selectionStart, e = ta.selectionEnd;
  var before = ta.value.slice(0, s);
  var sep = /[\[,]\s*$|^\s*$|-\s*$|\s$/.test(before.split('\n').pop()) ? '' : ', ';
  ta.value = before + sep + text + ta.value.slice(e);
  var pos = s + sep.length + text.length;
  ta.setSelectionRange(pos, pos);
  flashMsg(T('inserted', { text: text }));
  update();
}

var flashTimer;
function flashMsg(text) {
  var f = $('flash');
  f.textContent = text;
  f.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function () { f.classList.remove('show'); }, 1400);
}

function renderKeys() {
  var pid = $('platformSel').value;
  var q = $('keySearch').value.trim().toLowerCase();
  var plat = assets.platforms[pid] || { keys: [], sources: [] };
  var lib = modelLib.platformLibrary(assets, pid);
  var shorthands = ['volume_buttons', 'navigation_buttons', 'dpad', 'numpad', 'dialpad', 'xpad', 'npad'];
  var groups = [
    ['keys', pid === 'generic_remote' ? Object.keys(lib).map(function (k) { return lib[k]; }) : plat.keys],
    ['apps', plat.sources],
  ];
  var box = $('keys');
  box.innerHTML = '';
  var shown = 0;
  groups.forEach(function (g) {
    var items = (g[1] || []).filter(function (e) {
      if (!e || !e.name || shorthands.indexOf(e.name) >= 0 && g[0] === 'apps') return false;
      return !q || e.name.toLowerCase().indexOf(q) >= 0 || describeAction(e.tap_action || '') && String(describeAction(e.tap_action)).toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) return;
    box.appendChild(el('div', { className: 'group', text: T(g[0]) + ' (' + items.length + ')' }));
    var wrap = el('div', { className: 'chips' });
    items.forEach(function (e) {
      var isShort = shorthands.indexOf(e.name) >= 0;
      var desc = isShort ? T('layoutShortcut') : e.type && e.type !== 'button' ? e.type : describeAction(e.tap_action) || '';
      wrap.appendChild(el('button', {
        className: 'chip',
        title: desc,
        onclick: function () { insertAtCursor(e.name); },
      }, [svgIcon(iconPath(e.icon)), el('span', { text: e.name })]));
      shown++;
    });
    box.appendChild(wrap);
  });
  var ents = (init.entities || []).filter(function (e) {
    return !q || e.id.toLowerCase().indexOf(q) >= 0 || (e.name || '').toLowerCase().indexOf(q) >= 0;
  });
  if (ents.length) {
    box.appendChild(el('div', { className: 'group', text: T('yourEntities') + ' (' + ents.length + ')' }));
    var ew = el('div', { className: 'chips' });
    ents.slice(0, 200).forEach(function (e) {
      ew.appendChild(el('button', { className: 'chip ent', title: e.name, onclick: function () { insertAtCursor(e.id); } }, [el('span', { text: e.id })]));
    });
    box.appendChild(ew);
  }
  if (!shown && !ents.length) box.appendChild(el('div', { className: 'hint', text: T('nothingMatches') }));
}

// ---------------------------------------------------------------------------- templates

function templateLabel(t) {
  if (t.id === 'climate') return T('tplClimate');
  if (t.id === 'speaker') return T('tplSpeaker');
  return T('tplPlatform', { name: modelLib.PLATFORM_NAMES[t.id] || t.id });
}

// (Re)fills the template menu in the page language.
function templateOptions() {
  var sel = $('templateSel');
  var value = sel.value;
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '', text: T('templatesMenu') }));
  sel.appendChild(el('option', { value: '__default', text: T('tplExample') }));
  templates.list().forEach(function (t) { sel.appendChild(el('option', { value: t.id, text: templateLabel(t) })); });
  sel.value = value;
}

function renderTemplates() {
  var sel = $('templateSel');
  var items = templates.list();
  templateOptions();
  var chosen = null;
  var yamlFor = function (id) {
    if (id === '__default') return init.defaultYaml || '';
    var t = items.filter(function (x) { return x.id === id; })[0];
    return t ? t.yaml(assets) : '';
  };
  sel.addEventListener('change', function () {
    chosen = sel.value || null;
    $('templateBar').hidden = !chosen;
    // Pages can only be appended when the YAML is a list of pages.
    var root = null;
    try { root = yaml.load($('yaml').value); } catch (e) { root = undefined; }
    var canAdd = Array.isArray(root) || root === null || root === undefined && !$('yaml').value.trim();
    $('templateAdd').disabled = !canAdd || chosen === '__default';
    $('templateHint').textContent = canAdd || chosen === '__default' ? '' : T('tplNeedsList');
  });
  function apply(replace) {
    if (!chosen) return;
    var text = yamlFor(chosen);
    var ta = $('yaml');
    var before = state.model ? state.model.pages.length : 0;
    ta.value = replace ? text : templates.appendPages(ta.value, text);
    sel.value = '';
    chosen = null;
    $('templateBar').hidden = true;
    $('platformSel').dataset.touched = '';
    autosize();
    update();
    if (state.model) showPage(replace ? 0 : Math.min(before, state.model.pages.length - 1));
    flashMsg(T(replace ? 'tplLoaded' : 'tplAdded'));
  }
  $('templateAdd').addEventListener('click', function () { apply(false); });
  $('templateReplace').addEventListener('click', function () { apply(true); });
}

// ---------------------------------------------------------------------------- editor

function autosize() {
  var ta = $('yaml');
  ta.style.height = 'auto';
  ta.style.height = Math.max(240, ta.scrollHeight + 4) + 'px';
}

function setupEditor() {
  var ta = $('yaml');
  ta.value = init.yaml || init.defaultYaml || '';
  ta.addEventListener('input', debounce(function () { autosize(); update(); }, 250));
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.setSelectionRange(s + 2, s + 2);
    } else if (e.key === 'Enter') {
      // keep the indentation of the current line
      var s2 = ta.selectionStart;
      var line = ta.value.slice(0, s2).split('\n').pop();
      var indent = /^\s*/.exec(line)[0];
      if (/:\s*$/.test(line)) indent += '  ';
      e.preventDefault();
      ta.value = ta.value.slice(0, s2) + '\n' + indent + ta.value.slice(ta.selectionEnd);
      ta.setSelectionRange(s2 + 1 + indent.length, s2 + 1 + indent.length);
      autosize();
      update();
    }
  });
  autosize();
}

// ---------------------------------------------------------------------------- save

function returnUrl() {
  var m = /[?&]return_to=([^&]*)/.exec(location.search || '');
  return m ? decodeURIComponent(m[1]) : 'pebblejs://close#';
}

function save() {
  update();
  if (!state.valid) return;
  var payload = {
    settings: { url: $('url').value.trim(), token: $('token').value.trim(), lang: $('langSel').value },
    yaml: $('yaml').value,
    config: state.config,
  };
  location.href = returnUrl() + encodeURIComponent(JSON.stringify(payload));
}

function cancel() {
  location.href = returnUrl();
}

// ---------------------------------------------------------------------------- language

// Puts every static text of the page in the current language.
function applyStatic() {
  var code = i18n.getLang();
  document.documentElement.lang = code;
  document.documentElement.dir = i18n.RTL[code] ? 'rtl' : 'ltr';
  document.title = T('pageTitle');
  each('[data-i18n]', function (e) { e.textContent = T(e.getAttribute('data-i18n')); });
  each('[data-i18n-html]', function (e) { e.innerHTML = T(e.getAttribute('data-i18n-html')); });
  each('[data-i18n-ph]', function (e) { e.placeholder = T(e.getAttribute('data-i18n-ph')); });
  each('[data-i18n-aria]', function (e) { e.setAttribute('aria-label', T(e.getAttribute('data-i18n-aria'))); });
  $('showToken').textContent = T($('token').type === 'password' ? 'show' : 'hide');
  var auto = $('langSel').options[0];
  if (auto) auto.textContent = T('langAuto');
}

// Tells when the watch will show English instead of the chosen language.
function langNote() {
  var v = $('langSel').value;
  var w = init.watch || {};
  var wanted = v === 'auto' ? i18n.fromLocale(w.locale) : v;
  var text = '';
  if (wanted && w.shown && w.shown.indexOf(wanted) < 0) text = T('langMissing', { lang: i18n.NAMES[wanted] });
  else if (wanted === 'ar' && !w.shown) text = T('langArabic');
  $('langNote').textContent = text;
  $('langNote').hidden = !text;
}

// The page follows the Language setting, or the phone's language when it is Automatic.
function setPageLang() {
  i18n.setLang(i18n.resolve($('langSel').value, navigator.language));
  applyStatic();
  langNote();
}

function setupLang(value) {
  var sel = $('langSel');
  sel.appendChild(el('option', { value: 'auto', text: '' }));
  i18n.LANGS.forEach(function (c) { sel.appendChild(el('option', { value: c, lang: c, text: i18n.NAMES[c] })); });
  sel.value = i18n.setting(value);
  sel.addEventListener('change', function () {
    setPageLang();
    templateOptions();
    update();
    renderKeys();
  });
  setPageLang();
}

// ---------------------------------------------------------------------------- boot

function boot() {
  state.screen = pickScreen();
  var settings = init.settings || {};
  $('url').value = settings.url || '';
  $('token').value = settings.token || '';
  setupLang(settings.lang);
  $('showToken').addEventListener('click', function () {
    var t = $('token');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('showToken').textContent = T(t.type === 'password' ? 'show' : 'hide');
  });
  $('version').textContent = 'v' + (init.version || 'dev');

  var watchSel = $('watchSel');
  watchSel.value = state.screen.round ? 'gabbro' : 'emery';
  if (init.screen || init.platform) watchSel.disabled = !!init.screen;
  watchSel.addEventListener('change', function () {
    state.screen = layoutLib.SCREENS[watchSel.value];
    $('screenWrap').classList.toggle('round', state.screen.round);
    update();
  });
  $('screenWrap').classList.toggle('round', state.screen.round);

  preview = new Preview($('screen'));
  $('screen').addEventListener('click', onCanvasClick);
  $('prevPage').addEventListener('click', function () {
    if (state.model) showPage((state.page - 1 + state.model.pages.length) % state.model.pages.length);
  });
  $('nextPage').addEventListener('click', function () {
    if (state.model) showPage((state.page + 1) % state.model.pages.length);
  });
  $('save').addEventListener('click', save);
  $('cancel').addEventListener('click', cancel);

  renderPlatformSelect();
  renderTemplates();
  setupEditor();
  update();
  renderKeys();
  if (!settings.url) $('url').focus();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
