// Home Assistant REST client for PebbleKit JS.
// Uses XMLHttpRequest only: iOS PKJS has no fetch, its XHR has no `timeout` property and
// sends string bodies as application/octet-stream unless Content-Type is set.
'use strict';

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
    cb(new Error('Set the Home Assistant URL and token in the app settings'));
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
      finish(new Error('Cannot reach Home Assistant'), null, 0);
      return;
    }
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (status === 401) finish(new Error('Home Assistant rejected the token (401)'), json, status);
    else if (status === 404) finish(new Error('Not found (404): ' + path), json, status);
    else if (status === 400) finish(new Error('Bad request (400)' + (json && json.message ? ': ' + json.message : '')), json, status);
    else if (status >= 300) finish(new Error('Home Assistant error ' + status + (json && json.message ? ': ' + json.message : '')), json, status);
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
    xhr.onerror = function () { finish(new Error('Cannot reach Home Assistant'), null, 0); };
    timer = setTimeout(function () {
      try { xhr.abort(); } catch (e) { /* ignore */ }
      finish(new Error('Home Assistant timed out'), null, 0);
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

// Plain GET without auth (icons from a CDN). cb(err, text)
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

module.exports = { HA: HA, httpGet: httpGet, normalizeUrl: normalizeUrl };
