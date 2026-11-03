// PebbleKit JS side of HA Remote. Runs inside the Pebble phone app (no companion app needed):
//  - keeps the YAML config + Home Assistant connection settings
//  - compiles the config into a packed layout for the watch's screen and sends it over
//  - turns watch gestures into Home Assistant service calls
//  - opens the built-in settings page (gzipped HTML shipped inside this bundle)
'use strict';

var inflate = require('./lib/inflate');
var modelLib = require('./lib/model');
var packLib = require('./lib/pack');
var unpackLib = require('./lib/unpack');
var actions = require('./lib/actions');
var haLib = require('./lib/ha');
var P = require('./lib/protocol');
var ASSETS_B64 = require('./generated/assets');
var CONFIG_PAGE_B64 = require('./generated/config_page');
var DEFAULTS = require('./generated/default_config');

var VERSION = '1.1.0';
var ENTITY_DOMAINS = ['remote', 'media_player', 'script', 'scene', 'button', 'input_button', 'switch', 'light', 'fan', 'input_boolean', 'automation', 'cover'];

// ---------------------------------------------------------------------------- storage

function load(key, fallback) {
  try {
    var v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.log('localStorage write failed for ' + key + ': ' + e);
  }
}

var state = {
  settings: load('settings', {}),
  yaml: load('yaml', null),
  config: load('config', null),
  iconCache: load('iconCache', {}),
  screen: null,
  inbox: 2026,
  watchHash: 0,
  watchPage: 0,
  model: null,
  assets: null,
  layoutGen: 0,
  pending: {},
  restoring: false,
  backup: null,
};

function hasLocalConfig() {
  return !!(state.config || (state.settings && state.settings.url));
}

function ha() {
  return new haLib.HA(state.settings);
}

function getAssets() {
  if (!state.assets) state.assets = JSON.parse(inflate.gunzipBase64ToString(ASSETS_B64));
  return state.assets;
}

function getModel() {
  if (state.model) return state.model;
  var cfg = state.config || DEFAULTS.config;
  var m = modelLib.compile(cfg, getAssets());
  if (m.errors.length) {
    console.log('config errors: ' + m.errors.join('; ') + ' - falling back to the default config');
    toast('Config error: ' + m.errors[0], P.TOAST_ERROR);
    m = modelLib.compile(DEFAULTS.config, getAssets());
  }
  state.model = m;
  return m;
}

// ---------------------------------------------------------------------------- messaging

var queue = [];
var sending = false;

function send(msg, cb, tag) {
  queue.push({ msg: msg, cb: cb, tries: 0, tag: tag });
  pump();
}

function dropQueued(tag) {
  queue = queue.filter(function (item, idx) { return idx === 0 && sending ? true : item.tag !== tag; });
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var item = queue[0];
  Pebble.sendAppMessage(item.msg, function () {
    queue.shift();
    sending = false;
    if (item.cb) item.cb(null);
    pump();
  }, function (e) {
    sending = false;
    item.tries++;
    if (item.tries >= 4) {
      queue.shift();
      console.log('AppMessage failed: ' + JSON.stringify(item.msg.cmd));
      if (item.cb) item.cb(new Error('send failed'));
    }
    setTimeout(pump, 250 * item.tries);
  });
}

function toast(text, kind) {
  send({ cmd: P.CMD_TOAST, text: String(text).slice(0, 120), value: kind || P.TOAST_INFO });
}

function toBytes(u8, start, end) {
  var out = [];
  for (var i = start; i < end; i++) out.push(u8[i]);
  return out;
}

function chunkSize() {
  // Dictionary header + tuple headers for cmd/offset/data take ~30 bytes.
  return Math.max(100, Math.min(state.inbox, 8200) - 64);
}

// ---------------------------------------------------------------------------- icons

// Loads Material Design Icons that aren't bundled from Home Assistant's own
// frontend files (one at a time, so its icon index is fetched once), then calls cb().
function ensureIcons(model, screen, cb) {
  var assets = getAssets();
  var needed = packLib.neededIcons(model, screen).filter(function (k) {
    var m = /^(mdi|hass):(.+)$/.exec(k);
    return m && !assets.mdi[m[2]] && state.iconCache[m[2]] === undefined;
  }).map(function (k) { return k.replace(/^(mdi|hass):/, ''); });
  if (!needed.length || !ha().url) { cb(); return; }
  var changed = false;
  var next = function (i) {
    if (i >= needed.length) {
      if (changed) save('iconCache', state.iconCache);
      cb();
      return;
    }
    ha().mdiPath(needed[i], function (err, pathData) {
      if (!err) {
        state.iconCache[needed[i]] = pathData;   // '' = HA has no such icon; don't ask again
        changed = true;
      }
      next(i + 1);                               // on errors, try again with the next layout
    });
  };
  next(0);
}

// ---------------------------------------------------------------------------- layout sync

function pushLayout(force) {
  if (!state.screen) return;
  var model = getModel();
  var screen = state.screen;
  ensureIcons(model, screen, function () {
    var packed;
    try {
      packed = packLib.pack(model, screen, state.iconCache);
    } catch (e) {
      console.log('pack failed: ' + e.stack);
      toast('Layout error: ' + e.message, P.TOAST_ERROR);
      return;
    }
    if (packed.missingIcons.length) console.log('icons not found: ' + packed.missingIcons.join(', '));
    if (!force && packed.hash === state.watchHash) {
      // The watch already shows this layout; fill in its sliders. (After a new layout the
      // watch reports the page it shows, which does the same.)
      onPageShown({ page: state.watchPage });
      return;
    }
    var gen = ++state.layoutGen;
    dropQueued('layout');
    var bytes = packed.bytes;
    var size = chunkSize();
    send({ cmd: P.CMD_LAYOUT_BEGIN, total: bytes.length, hash: packed.hash | 0 }, null, 'layout');
    for (var off = 0; off < bytes.length; off += size) {
      send({ cmd: P.CMD_LAYOUT_CHUNK, offset: off, data: toBytes(bytes, off, Math.min(bytes.length, off + size)) }, null, 'layout');
    }
    send({ cmd: P.CMD_LAYOUT_END, hash: packed.hash | 0 }, function (err) {
      if (!err && gen === state.layoutGen) state.watchHash = packed.hash;
    }, 'layout');
    console.log('layout sent: ' + bytes.length + ' bytes, ' + model.pages.length + ' pages');
  });
}

// ---------------------------------------------------------------------------- watch backup
// Android can lose PKJS localStorage when the phone app is killed, so the watch keeps a copy of
// the settings and config (it has 1 MB of storage per app) and hands it back when needed.

function backupPayload() {
  return JSON.stringify({ v: 1, settings: state.settings, yaml: state.yaml, config: state.config });
}

function backupBytes() {
  return inflate.utf8Encode(backupPayload());
}

function sendBackup() {
  var bytes = backupBytes();
  var size = chunkSize();
  dropQueued('backup');
  send({ cmd: P.CMD_BACKUP_BEGIN, total: bytes.length, hash: packLib.fnv1a(bytes) | 0 }, null, 'backup');
  for (var off = 0; off < bytes.length; off += size) {
    send({ cmd: P.CMD_BACKUP_CHUNK, offset: off, data: toBytes(bytes, off, Math.min(bytes.length, off + size)) }, null, 'backup');
  }
  send({ cmd: P.CMD_BACKUP_END }, null, 'backup');
}

function onBackupData(msg) {
  var total = msg.total | 0;
  if (!total) {
    state.restoring = false;
    pushLayout(false);
    return;
  }
  if (!state.backup || state.backup.length !== total) state.backup = new Uint8Array(total);
  var data = msg.data || [];
  var off = msg.offset | 0;
  for (var i = 0; i < data.length && off + i < total; i++) state.backup[off + i] = data[i];
  if (off + data.length < total) return;
  try {
    var b = JSON.parse(inflate.utf8Decode(state.backup));
    state.settings = b.settings || {};
    state.yaml = b.yaml || null;
    state.config = b.config || null;
    save('settings', state.settings);
    save('yaml', state.yaml);
    save('config', state.config);
    state.model = null;
    console.log('restored settings from the watch backup');
  } catch (e) {
    console.log('backup restore failed: ' + e);
  }
  state.backup = null;
  state.restoring = false;
  pushLayout(false);
}

// ---------------------------------------------------------------------------- events

function pageIndex(model, current, spec) {
  var n = model.pages.length;
  if (!n) return 0;
  if (spec === undefined || spec === null || spec === 'next') return (current + 1) % n;
  if (spec === 'previous' || spec === 'prev') return (current - 1 + n) % n;
  if (typeof spec === 'number') return Math.max(0, Math.min(n - 1, spec - 1));
  var s = String(spec).toLowerCase();
  if (/^\d+$/.test(s)) return Math.max(0, Math.min(n - 1, parseInt(s, 10) - 1));
  for (var i = 0; i < n; i++) if (model.pages[i].name.toLowerCase() === s) return i;
  throw new Error('No page named "' + spec + '"');
}

// Actions run one after another, in the order the watch sent them. Planning is part of the
// queue because templates that read Home Assistant state fetch it first.
var running = Promise.resolve();
var inFlight = 0;

function enqueue(plan, ev) {
  inFlight++;
  running = running.then(function () {
    return new Promise(function (resolve, reject) {
      plan(function (err, steps) {
        if (err) reject(err);
        else resolve(steps || []);
      });
    });
  }).then(function (steps) {
    return steps.reduce(function (p, step) {
      return p.then(function () { return runStep(step, ev); });
    }, Promise.resolve()).then(function () {
      if (steps.length) scheduleSliderRefresh(ev.page);
    });
  }).catch(function (e) {
    toast(e.message || String(e), P.TOAST_ERROR);
  }).then(function () {
    inFlight--;
  });
}

function getEntityState(id, cb) {
  ha().getState(id, function (err, st) {
    if (err && /\(404\)/.test(err.message)) err = new Error('Unknown entity ' + id);
    cb(err, st);
  });
}

function runStep(step, ev) {
  return new Promise(function (resolve, reject) {
    var model = getModel();
    if (step.type === 'service') {
      ha().callService(step.domain, step.service, step.data, function (err) {
        if (err) reject(err); else resolve();
      });
    } else if (step.type === 'page') {
      try {
        send({ cmd: P.CMD_GOTO, page: pageIndex(model, ev.page, step.page) });
        resolve();
      } catch (e) { reject(e); }
    } else if (step.type === 'dictate') {
      var key = ev.page + ':' + ev.elem + ':' + ev.part;
      state.pending[key] = { action: step.action };
      send({ cmd: P.CMD_DICTATE, page: ev.page, elem: ev.elem, part: ev.part, text: step.prompt || '' });
      resolve();
    } else if (step.type === 'lock_toggle') {
      ha().getState(step.entity_id, function (err, st) {
        if (err) { reject(err); return; }
        var service = st && st.state === 'locked' ? 'unlock' : 'lock';
        ha().callService('lock', service, { entity_id: step.entity_id }, function (e2) {
          if (e2) reject(e2); else resolve();
        });
      });
    } else {
      resolve();
    }
  });
}

function sliderValue(el, pos) {
  var milli = unpackLib.sliderMilli(el.range[0], el.range[1], el.step, pos);
  var decimals = Math.min(3, (String(el.step).split('.')[1] || '').length);
  return parseFloat((milli / 1000).toFixed(decimals));
}

function onEvent(msg) {
  var model = getModel();
  var ev = { page: msg.page | 0, elem: msg.elem | 0, part: msg.part | 0, gesture: msg.gesture | 0, value: msg.value | 0 };
  var page = model.pages[ev.page];
  var target = modelLib.target(model, ev.page, ev.elem);
  if (!page || !target) {
    console.log('event for unknown element ' + JSON.stringify(ev));
    return;
  }
  // Repeats arriving faster than Home Assistant answers are dropped instead of queued.
  if (ev.gesture === actions.G.REPEAT && inFlight > 2) return;

  if (!ha().configured()) {
    toast('Open the app settings on your phone to connect Home Assistant', P.TOAST_ERROR);
    return;
  }
  var action, vars, holdFallback = false;
  if (ev.gesture === actions.G.TEXT) {
    var key = ev.page + ':' + ev.elem + ':' + ev.part;
    var pend = state.pending[key];
    delete state.pending[key];
    if (!pend) return;
    action = pend.action;
    vars = { text: msg.text || '' };
  } else {
    var value = ev.value;
    if (ev.gesture === actions.G.SLIDE && target.range) value = sliderValue(target, ev.value);
    var r = actions.resolve(target, ev.part, ev.gesture, value);
    if (!r) return;
    action = r.action;
    vars = r.vars;
    holdFallback = r.holdFallback;
  }
  enqueue(function (cb) {
    actions.planWithStates(action, page.ctx, target, vars, holdFallback, getEntityState, cb);
  }, ev);
}

// After an action, re-read slider values (an AC's setpoint after +/-) once HA has caught up.
var sliderRefreshTimer = null;
function scheduleSliderRefresh(pageIndex) {
  var page = getModel().pages[pageIndex];
  if (!page || !page.elements.some(function (e) { return e.type === 'slider' && e.entity_id; })) return;
  if (sliderRefreshTimer) clearTimeout(sliderRefreshTimer);
  sliderRefreshTimer = setTimeout(function () {
    sliderRefreshTimer = null;
    onPageShown({ page: pageIndex });
  }, 1200);
}

// Reads slider entity states so sliders on the visible page show the current value.
function onPageShown(msg) {
  var model = getModel();
  var pi = msg.page | 0;
  var page = model.pages[pi];
  if (!page || !ha().configured()) return;
  page.elements.forEach(function (el) {
    if (el.type !== 'slider' || !el.entity_id) return;
    ha().getState(el.entity_id, function (err, st) {
      if (err || !st) return;
      var raw = el.value_attribute === 'state' ? st.state : st.attributes && st.attributes[el.value_attribute];
      var v = parseFloat(raw);
      if (!isFinite(v)) return;
      if (el.value_attribute === 'brightness') v = (v / 255) * 100;
      var lo = el.range[0], hi = el.range[1];
      var pos = hi === lo ? 0 : Math.round(((v - lo) / (hi - lo)) * 255);
      send({ cmd: P.CMD_VALUE, page: pi, elem: el.index, value: Math.max(0, Math.min(255, pos)) });
    });
  });
}

function onHello(msg) {
  state.screen = { w: msg.screen_w | 0, h: msg.screen_h | 0, round: (msg.shape | 0) === 1 };
  state.inbox = msg.inbox_size | 0 || 2026;
  state.watchHash = (msg.hash | 0) >>> 0;
  state.watchPage = msg.page | 0;
  var watchHasBackup = (msg.value | 0) === 1;
  if (!hasLocalConfig() && watchHasBackup && !state.restoring) {
    state.restoring = true;
    send({ cmd: P.CMD_BACKUP_REQUEST });
    return;
  }
  if (state.restoring) return;
  pushLayout(false);
  if (!ha().configured()) {
    toast('Open the app settings on your phone to connect Home Assistant', P.TOAST_INFO);
  } else if (hasLocalConfig() && ((msg.backup_hash | 0) >>> 0) !== packLib.fnv1a(backupBytes())) {
    sendBackup(); // the watch has no backup, or an older one
  }
}

// Reports unexpected exceptions on the watch instead of failing silently.
function guard(name, fn) {
  return function (e) {
    try {
      fn(e);
    } catch (err) {
      console.log(name + ' failed: ' + (err && err.stack ? err.stack : err));
      toast(name + ' failed: ' + (err && err.message ? err.message : err), P.TOAST_ERROR);
    }
  };
}

Pebble.addEventListener('appmessage', guard('Message', function (e) {
  var msg = e.payload || {};
  switch (msg.cmd) {
    case P.CMD_HELLO: onHello(msg); break;
    case P.CMD_EVENT: onEvent(msg); break;
    case P.CMD_PAGE_SHOWN: onPageShown(msg); break;
    case P.CMD_BACKUP_DATA: onBackupData(msg); break;
    default: console.log('unknown message ' + JSON.stringify(msg));
  }
}));

Pebble.addEventListener('ready', guard('Startup', function () {
  console.log('HA Remote ' + VERSION + ' ready');
  send({ cmd: P.CMD_PHONE_READY, hash: 0 });
  setTimeout(refreshEntities, 3000);
}));

// ---------------------------------------------------------------------------- entities

// Keeps a small list of useful entities for the settings page (it can't call HA itself).
function refreshEntities() {
  if (!ha().configured()) return;
  var cached = load('entities', null);
  if (cached && Date.now() - cached.t < 5 * 60 * 1000) return;
  ha().getStates(function (err, states) {
    if (err || !Array.isArray(states)) return;
    var list = [];
    states.forEach(function (s) {
      var d = s.entity_id.split('.')[0];
      if (ENTITY_DOMAINS.indexOf(d) < 0) return;
      list.push({ id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || '' });
    });
    list.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    save('entities', { t: Date.now(), list: list.slice(0, 600) });
  });
}

// ---------------------------------------------------------------------------- settings page

var LS = new RegExp(String.fromCharCode(0x2028), 'g');
var PS = new RegExp(String.fromCharCode(0x2029), 'g');

// JSON that is safe to embed inside a <script> tag.
function safeJson(o) {
  return JSON.stringify(o)
    .replace(/</g, '\\u003c')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}

function watchPlatform() {
  try {
    var info = Pebble.getActiveWatchInfo && Pebble.getActiveWatchInfo();
    if (info && info.platform) return info.platform;
  } catch (e) { /* ignore */ }
  return null;
}

Pebble.addEventListener('showConfiguration', guard('Settings page', function () {
  var html = inflate.gunzipBase64ToString(CONFIG_PAGE_B64);
  var ents = load('entities', null);
  var init = {
    version: VERSION,
    settings: state.settings,
    yaml: state.yaml || DEFAULTS.yaml,
    defaultYaml: DEFAULTS.yaml,
    platform: watchPlatform(),
    screen: state.screen,
    entities: ents ? ents.list : [],
    iconCache: state.iconCache,
    assets: ASSETS_B64,
  };
  var initJson = safeJson(init);
  // A replacer function, so `$&`-style patterns in the user's YAML aren't expanded.
  html = html.replace('"__PEBBLE_INIT__"', function () { return initJson; });
  Pebble.openURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}));

Pebble.addEventListener('webviewclosed', guard('Saving settings', function (e) {
  if (!e || !e.response) return;
  var data;
  try {
    var r = e.response;
    data = JSON.parse(/^\s*\{/.test(r) ? r : decodeURIComponent(r));
  } catch (err) {
    toast('Could not read the settings', P.TOAST_ERROR);
    return;
  }
  if (data.settings) {
    state.settings = { url: haLib.normalizeUrl(data.settings.url), token: String(data.settings.token || '').trim() };
    save('settings', state.settings);
  }
  if (data.yaml !== undefined && data.config) {
    state.yaml = data.yaml;
    state.config = data.config;
    save('yaml', state.yaml);
    save('config', state.config);
  }
  if (data.iconCache) {
    Object.keys(data.iconCache).forEach(function (k) { state.iconCache[k] = data.iconCache[k]; });
    save('iconCache', state.iconCache);
  }
  state.model = null;
  pushLayout(false);
  sendBackup();
  if (ha().configured()) {
    ha().ping(function (err) {
      if (err) toast(err.message, P.TOAST_ERROR);
      else toast('Connected to Home Assistant', P.TOAST_OK);
    });
    save('entities', null);
    refreshEntities();
  }
}));
