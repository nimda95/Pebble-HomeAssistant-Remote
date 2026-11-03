// Home Assistant REST client for PebbleKit JS.
// Uses XMLHttpRequest only: iOS PKJS has no fetch, its XHR has no `timeout` property and
// sends string bodies as application/octet-stream unless Content-Type is set.
'use strict';

var tr = require('./i18n').t;

function normalizeUrl(url) {
  var u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

function HA(settings) {
  this.url = normalizeUrl(settings && settings.url);
  this.token = settings && settings.token ? String(settings.token).trim() : '';
  this.timeoutMs = 10000;
}

HA.prototype.configured = function () {
  return !!(this.url && this.token);
};

// cb(err, json, status)
HA.prototype.request = function (method, path, body, cb) {
  if (!this.configured()) {
    cb(new Error(tr('needUrlToken')));
    return;
  }
  var xhr = new XMLHttpRequest();
  var done = false;
  var timer = null;
  function finish(err, json, status) {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    cb(err, json, status);
  }
  function onDone() {
    // Read everything from the xhr object: iOS events only carry `type`.
    var status = xhr.status;
    var text = xhr.responseText;
    if (!status) {
      finish(new Error(tr('unreachable')), null, 0);
      return;
    }
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (status === 401) finish(new Error(tr('badToken')), json, status);
    else if (status === 404) finish(new Error(tr('notFound', { path: path })), json, status);
    else if (status === 400) finish(new Error(tr('badRequest') + (json && json.message ? ': ' + json.message : '')), json, status);
    else if (status >= 300) finish(new Error(tr('haError', { status: status }) + (json && json.message ? ': ' + json.message : '')), json, status);
    else finish(null, json, status);
  }
  try {
    xhr.open(method, this.url + path, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) onDone();
    };
    xhr.onload = onDone;
    xhr.onerror = function () { finish(new Error(tr('unreachable')), null, 0); };
    timer = setTimeout(function () {
      try { xhr.abort(); } catch (e) { /* ignore */ }
      finish(new Error(tr('timedOut')), null, 0);
    }, this.timeoutMs);
    xhr.send(body === undefined || body === null ? null : JSON.stringify(body));
  } catch (e) {
    finish(e, null, 0);
  }
};

HA.prototype.callService = function (domain, service, data, cb) {
  this.request('POST', '/api/services/' + encodeURIComponent(domain) + '/' + encodeURIComponent(service), data || {}, cb);
};

HA.prototype.getState = function (entityId, cb) {
  this.request('GET', '/api/states/' + encodeURIComponent(entityId), null, cb);
};

HA.prototype.getStates = function (cb) {
  this.request('GET', '/api/states', null, cb);
};

HA.prototype.ping = function (cb) {
  this.request('GET', '/api/', null, cb);
};

// ---- Material Design Icons from Home Assistant itself ----
// The HA frontend ships every MDI icon under /static/mdi/ (public, no login):
// iconMetadata.json lists chunks by their first icon name, and each chunk file
// maps icon names to SVG path data. So no request ever leaves the user's server.
var mdiIndex = null, mdiIndexUrl = null, mdiChunk = null, mdiChunkFile = null;

function chunkFor(index, name) {
  var file = null;
  for (var i = 0; i < index.parts.length; i++) {
    var p = index.parts[i];
    if (p.start !== undefined && p.start !== null && name < p.start) break;
    file = p.file;
  }
  return file;
}

HA.prototype.staticJson = function (path, cb) {
  if (!this.url) { cb(new Error('Set the Home Assistant URL in the app settings')); return; }
  httpGet(this.url + path, function (err, text) {
    if (err) { cb(err); return; }
    var json = null;
    try { json = JSON.parse(text); } catch (e) { cb(new Error('bad JSON from ' + path)); return; }
    cb(null, json);
  }, 8000);
};

// cb(err, pathData): pathData is '' when HA has no such icon.
HA.prototype.mdiPath = function (name, cb) {
  var self = this;
  function fromIndex(index) {
    var file = chunkFor(index, name);
    if (!file) { cb(null, ''); return; }
    if (mdiChunkFile === file && mdiChunk) { cb(null, mdiChunk[name] || ''); return; }
    self.staticJson('/static/mdi/' + encodeURIComponent(file) + '.json', function (err, json) {
      if (err) { cb(err); return; }
      mdiChunk = json || {};                 // one chunk (~50 KB) is kept for the next icon
      mdiChunkFile = file;
      cb(null, mdiChunk[name] || '');
    });
  }
  if (mdiIndex && mdiIndexUrl === this.url) { fromIndex(mdiIndex); return; }
  this.staticJson('/static/mdi/iconMetadata.json', function (err, json) {
    if (err) { cb(err); return; }
    if (!json || !Array.isArray(json.parts)) { cb(new Error('Home Assistant icon index not found')); return; }
    mdiIndex = json;
    mdiIndexUrl = self.url;
    mdiChunk = null;
    mdiChunkFile = null;
    fromIndex(json);
  });
};

// Plain GET without auth (Home Assistant's public static files). cb(err, text)
function httpGet(url, cb, timeoutMs) {
  var xhr = new XMLHttpRequest();
  var done = false;
  function finish(err, text) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb(err, text);
  }
  var timer = setTimeout(function () {
    try { xhr.abort(); } catch (e) { /* ignore */ }
    finish(new Error('timeout'));
  }, timeoutMs || 8000);
  try {
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) finish(null, xhr.responseText);
        else finish(new Error('HTTP ' + xhr.status));
      }
    };
    xhr.onerror = function () { finish(new Error('network error')); };
    xhr.send(null);
  } catch (e) {
    finish(e);
  }
}

module.exports = { HA: HA, httpGet: httpGet, normalizeUrl: normalizeUrl, chunkFor: chunkFor };
