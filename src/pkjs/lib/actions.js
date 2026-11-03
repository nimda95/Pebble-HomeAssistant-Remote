// Turns a watch gesture into concrete steps (Home Assistant service calls, page changes,
// dictation requests), following universal-remote-card's action semantics.
'use strict';

var modelLib = require('./model');
var template = require('./template');
var tr = require('./i18n').t;

// Watch gesture codes (keep in sync with src/c/protocol.h).
var G = { TAP: 0, HOLD: 1, DOUBLE: 2, REPEAT: 3, SLIDE: 4, DRAG: 5, ROTATE: 6, TEXT: 7 };
var PART_NAMES = ['center', 'up', 'down', 'left', 'right'];

var REMOTE_KEY_PLATFORMS = ['android_tv', 'bravia', 'fire_tv', 'apple_tv', 'roku', 'samsung_tv', 'philips_tv', 'jellyfin', 'yamaha_ynca', 'generic_remote'];

function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

// Picks the action config for a gesture. Returns { action, holdFallback, vars } or null.
function resolve(target, partIndex, gesture, value) {
  if (!target) return null;
  var partName = PART_NAMES[partIndex] || 'center';
  var part = target.parts && target.parts[partName];
  var vars = {};
  var action;
  var holdFallback = false;

  if (gesture === G.ROTATE) {
    vars.clockwise = !!value;
    return target.drag ? { action: target.drag, vars: vars } : null;
  }
  if (gesture === G.DRAG) {
    var step = 24;
    vars.deltaX = partName === 'left' ? -step : partName === 'right' ? step : 0;
    vars.deltaY = partName === 'up' ? -step : partName === 'down' ? step : 0;
    if (part && modelLib.hasAction(part.tap)) return { action: part.tap, vars: vars };
    return target.drag ? { action: target.drag, vars: vars } : null;
  }
  if (!part) return null;

  switch (gesture) {
    case G.TAP:
    case G.REPEAT:
      action = part.tap;
      break;
    case G.SLIDE:
      action = part.tap;
      vars.value = value;
      break;
    case G.DOUBLE:
      action = modelLib.hasAction(part.double) ? part.double : part.tap;
      break;
    case G.HOLD:
      if (modelLib.hasAction(part.hold)) {
        action = part.hold;
      } else {
        action = part.tap;
        holdFallback = true;
      }
      break;
    default:
      return null;
  }
  if (!action) return null;
  return { action: action, holdFallback: holdFallback, vars: vars };
}

function entityOf(target, ctx) {
  return (target && target.entity_id) || ctx.entity_id || ctx.remote_id || ctx.media_player_id || ctx.keyboard_id || '';
}

// Platform for key/source/keyboard actions: the action's, else the page's. A page without a
// platform (an AC, lights, ...) has none, unless it has a remote or media player.
// `msgKey`: the message for a page without a platform.
function platformOf(action, ctx, msgKey) {
  var name = action.platform || ctx.platform;
  if (!name && !ctx.remote_id && !ctx.media_player_id && !ctx.keyboard_id) {
    throw new Error(tr(msgKey));
  }
  return modelLib.platformId(name) || 'android_tv';
}

function templateVars(target, ctx, vars) {
  var cfg = Object.assign({}, (target && target.config) || {});
  cfg.entity = entityOf(target, ctx);
  cfg.attribute = (target && target.value_attribute) || 'state';
  cfg.card = ctx;
  var v = Object.assign({ config: cfg, hold_secs: 0 }, vars);
  if (v.value === undefined) v.value = undefined;
  return v;
}

function svc(domain, service, data) {
  return { type: 'service', domain: domain, service: service, data: data };
}

function need(value, what, platformName) {
  if (!value) throw new Error(tr('needSetFor', { what: what, platform: platformName }));
  return value;
}

function pick(action, ctx, key) {
  return action[key] !== undefined && action[key] !== null && action[key] !== '' ? action[key] : ctx[key];
}

function keySteps(action, ctx, holdFallback) {
  var pid = platformOf(action, ctx, 'needPlatformKey');
  var pname = modelLib.PLATFORM_NAMES[pid];
  var key = action.key;
  if (key === undefined || key === null || key === '') throw new Error(tr('keyWithoutKey'));
  var remote = pick(action, ctx, 'remote_id');
  var mp = pick(action, ctx, 'media_player_id');
  switch (pid) {
    case 'kodi':
      return [svc('kodi', 'call_method', { entity_id: need(mp, 'media_player_id', pname), method: key })];
    case 'webos':
      return [svc('webostv', 'button', { entity_id: need(mp, 'media_player_id', pname), button: key })];
    case 'denon_avr':
      return [svc('denonavr', 'get_command', { entity_id: need(mp, 'media_player_id', pname), command: '/goform/formiPhoneAppDirect.xml?' + key })];
    case 'unfolded_circle':
      return [svc('unfoldedcircle', 'send_button_command', { entity_id: need(remote, 'remote_id', pname), button: key })];
    case 'unified_remote':
      throw new Error(tr('unifiedNoKey'));
    default: {
      var data = { entity_id: need(remote, 'remote_id', pname), command: key };
      if (holdFallback) data.hold_secs = 1;
      if (action.device) data.device = action.device;
      return [svc('remote', 'send_command', data)];
    }
  }
}

function sourceSteps(action, ctx) {
  var pid = platformOf(action, ctx, 'needPlatformSource');
  var pname = modelLib.PLATFORM_NAMES[pid];
  var src = action.source;
  if (src === undefined || src === null || src === '') throw new Error(tr('sourceWithoutSource'));
  var remote = pick(action, ctx, 'remote_id');
  var mp = pick(action, ctx, 'media_player_id');
  switch (pid) {
    case 'fire_tv':
    case 'roku':
    case 'apple_tv':
    case 'samsung_tv':
    case 'webos':
      return [svc('media_player', 'select_source', { entity_id: need(mp, 'media_player_id', pname), source: src })];
    case 'bravia':
      return [svc('media_player', 'play_media', { entity_id: need(mp, 'media_player_id', pname), media_content_id: src, media_content_type: 'app' })];
    case 'yamaha_ynca':
      return [svc('media_player', 'play_media', { entity_id: need(mp, 'media_player_id', pname), media_content_id: src, media_content_type: 'music' })];
    case 'kodi':
      return [svc('kodi', 'call_method', { entity_id: need(mp, 'media_player_id', pname), method: 'Addons.ExecuteAddon', addonid: src })];
    case 'unified_remote':
    case 'unfolded_circle':
    case 'generic_remote':
    case 'jellyfin':
    case 'philips_tv':
    case 'denon_avr':
      throw new Error(tr('noSourceAction', { platform: pname }));
    default:
      return [svc('remote', 'turn_on', { entity_id: need(remote, 'remote_id', pname), activity: src })];
  }
}

var TARGET_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];
var MP_DOMAINS = ['media_player', 'androidtv', 'kodi', 'denonavr', 'webostv'];

function performSteps(action, ctx) {
  var name = action.perform_action || action.service;
  if (!name || String(name).indexOf('.') < 1) throw new Error(tr('performNeedsName'));
  var parts = String(name).split('.');
  var domain = parts[0], service = parts.slice(1).join('.');
  var data = action.data === undefined || action.data === null ? {} : action.data;
  var target = action.target === undefined || action.target === null ? {} : action.target;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { throw new Error(tr('dataMapping')); }
  }
  if (typeof target === 'string') {
    try { target = JSON.parse(target); } catch (e) { throw new Error(tr('targetMapping')); }
  }
  data = Object.assign({}, data);
  target = Object.assign({}, target);
  var hasTarget = TARGET_KEYS.some(function (k) { return target[k] !== undefined || data[k] !== undefined; });
  if (!hasTarget) {
    var pageDomain = ctx.entity_id ? String(ctx.entity_id).split('.')[0] : '';
    if (domain === 'remote' && ctx.remote_id) target.entity_id = ctx.remote_id;
    else if (MP_DOMAINS.indexOf(domain) >= 0 && ctx.media_player_id) target.entity_id = ctx.media_player_id;
    // The page's own entity, e.g. climate.set_temperature on an AC page.
    else if (ctx.entity_id && (domain === pageDomain || domain === 'homeassistant')) target.entity_id = ctx.entity_id;
  }
  if (domain === 'unified_remote' && data.target === undefined && ctx.device) data.target = ctx.device;
  if (domain === 'apple_tv' && data.config_entry_id === undefined && ctx.config_entry_id) data.config_entry_id = ctx.config_entry_id;
  if (domain === 'wake_on_lan' && data.mac === undefined && ctx.mac) data.mac = ctx.mac;
  return [svc(domain, service, Object.assign(data, target))];
}

function toggleSteps(action, ctx, target) {
  var t = Object.assign({}, action.data || {}, action.target || {});
  var ids = t.entity_id;
  if (!ids && !TARGET_KEYS.some(function (k) { return t[k] !== undefined; })) {
    ids = (target && target.entity_id) || ctx.entity_id;
    if (!ids) throw new Error(tr('toggleNeedsTarget'));
  }
  if (!ids) return [svc('homeassistant', 'toggle', t)];
  if (!Array.isArray(ids)) ids = String(ids).split(',').map(function (s) { return s.trim(); });
  return ids.map(function (id) {
    var domain = id.split('.')[0];
    if (domain === 'button' || domain === 'input_button') return svc(domain, 'press', { entity_id: id });
    if (domain === 'scene') return svc('scene', 'turn_on', { entity_id: id });
    if (domain === 'cover') return svc('cover', 'toggle', { entity_id: id });
    if (domain === 'valve') return svc('valve', 'toggle', { entity_id: id });
    if (domain === 'lock') return { type: 'lock_toggle', entity_id: id };
    return svc('homeassistant', 'toggle', { entity_id: id });
  });
}

function shellQuote(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function adbStep(entityId, command) {
  if (/^media_player\./.test(entityId)) return svc('androidtv', 'adb_command', { entity_id: entityId, command: command });
  return svc('remote', 'send_command', { entity_id: entityId, command: command });
}

function keyboardSteps(action, ctx, text) {
  var kind = action.action; // keyboard | textbox | search
  var pid = platformOf(action, ctx, 'needPlatformKeyboard');
  var pname = modelLib.PLATFORM_NAMES[pid];
  var remote = pick(action, ctx, 'remote_id');
  var mp = pick(action, ctx, 'media_player_id');
  var kb = pick(action, ctx, 'keyboard_id');
  var searchCmd = 'am start -a "android.search.action.GLOBAL_SEARCH" --es query "' + shellQuote(text) + '"';
  switch (pid) {
    case 'android_tv':
      if (kind === 'search') return [adbStep(need(kb, 'keyboard_id (ADB entity)', pname), searchCmd)];
      return [svc('remote', 'send_command', { entity_id: need(remote, 'remote_id', pname), command: 'text:' + text })];
    case 'fire_tv':
    case 'bravia':
      if (kind === 'search') return [adbStep(need(kb, 'keyboard_id (ADB entity)', pname), searchCmd)];
      return [adbStep(need(kb, 'keyboard_id (ADB entity)', pname), 'input text "' + shellQuote(text) + '"')];
    case 'roku':
      if (kind === 'search') return [svc('roku', 'search', { entity_id: need(mp, 'media_player_id', pname), keyword: text })];
      return [svc('remote', 'send_command', {
        entity_id: need(remote, 'remote_id', pname),
        command: String(text).split('').map(function (ch) { return 'Lit_' + ch; }),
      })];
    case 'apple_tv':
      if (kind === 'search') throw new Error(tr('noSearchAction', { platform: pname }));
      return [svc('apple_tv', 'set_keyboard_text', { config_entry_id: need(ctx.config_entry_id, 'config_entry_id', pname), text: text })];
    case 'webos':
      return [svc('webostv', 'command', { entity_id: need(mp, 'media_player_id', pname), command: 'com.webos.service.ime/insertText', payload: { text: text, replace: true } })];
    case 'samsung_tv':
      return [svc('media_player', 'play_media', { entity_id: need(mp, 'media_player_id', pname), media_content_type: 'send_text', media_content_id: text })];
    case 'kodi': {
      var steps = [];
      if (kind === 'search') steps.push(svc('kodi', 'call_method', { entity_id: need(mp, 'media_player_id', pname), method: 'Addons.ExecuteAddon', addonid: 'script.globalsearch' }));
      steps.push(svc('kodi', 'call_method', { entity_id: need(mp, 'media_player_id', pname), method: 'Input.SendText', text: text, done: true }));
      return steps;
    }
    case 'unified_remote':
      return [svc('unified_remote', 'call', { target: ctx.device, remote_id: 'Core.Input', action: 'Text', extras: { Values: [{ Value: text }] } })];
    default:
      throw new Error(tr('noKeyboard', { platform: pname }));
  }
}

var UNSUPPORTED = { 'more-info': 1, navigate: 1, url: 1, assist: 1, 'fire-dom-event': 1, eval: 1 };

// Expands one action config into steps. `text` is the dictation result for keyboard actions.
function planAction(action, ctx, target, vars, holdFallback) {
  if (Array.isArray(action)) {
    var all = [];
    action.forEach(function (a) { all = all.concat(planAction(a, ctx, target, vars, holdFallback)); });
    return all;
  }
  if (!isObj(action)) return [];
  var a = template.render(action, templateVars(target, ctx, vars));
  var kind = a.action;
  switch (kind) {
    case 'key':
      return keySteps(a, ctx, holdFallback);
    case 'source':
      return sourceSteps(a, ctx);
    case 'perform-action':
    case 'call-service':
      return performSteps(a, ctx);
    case 'toggle':
      return toggleSteps(a, ctx, target);
    case 'keyboard':
    case 'textbox':
    case 'search':
      if (vars.text === undefined) return [{ type: 'dictate', action: action, prompt: a.keyboard_prompt }];
      return keyboardSteps(a, ctx, vars.text);
    case 'page':
      return [{ type: 'page', page: a.page === undefined ? 'next' : a.page }];
    case 'none':
    case 'repeat':
    case undefined:
      return [];
    default:
      if (UNSUPPORTED[kind]) throw new Error(tr('notOnWatch', { action: kind }));
      throw new Error(tr('unknownAction', { action: kind }));
  }
}

// Templates can read Home Assistant state with states(), state_attr(), is_state() and
// is_state_attr(), like the card. Rendering is synchronous, so a first pass records which
// entities a template reads, getState(id, cb) fetches them, and the action is rendered again.
// cb(err, steps)
function planWithStates(action, ctx, target, vars, holdFallback, getState, cb) {
  var cache = {};
  function attempt(round) {
    var missing = [];
    var need = function (id) {
      id = String(id);
      if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
      if (missing.indexOf(id) < 0) missing.push(id);
      return null;
    };
    var fns = {
      states: function (id) { var st = need(id); return st ? st.state : 'unknown'; },
      state_attr: function (id, attr) {
        var st = need(id);
        var v = st && st.attributes ? st.attributes[attr] : null;
        return v === undefined ? null : v;
      },
      is_state: function (id, value) {
        var st = need(id);
        if (!st) return false;
        return Array.isArray(value) ? value.indexOf(st.state) >= 0 : st.state === String(value);
      },
      is_state_attr: function (id, attr, value) {
        var st = need(id);
        return !!(st && st.attributes && st.attributes[attr] == value); // eslint-disable-line eqeqeq
      },
    };
    var steps = null, err = null;
    try {
      steps = planAction(action, ctx, target, Object.assign({}, vars, fns), holdFallback);
    } catch (e) {
      err = e;
    }
    if (!missing.length || round >= 3) {
      if (err) cb(err);
      else cb(null, steps);
      return;
    }
    var left = missing.length, failed = null;
    missing.forEach(function (id) {
      getState(id, function (e, st) {
        if (e && !failed) failed = e;
        cache[id] = st || null;
        if (--left === 0) {
          if (failed) cb(failed);
          else attempt(round + 1);
        }
      });
    });
  }
  attempt(0);
}

module.exports = {
  G: G,
  planWithStates: planWithStates,
  PART_NAMES: PART_NAMES,
  resolve: resolve,
  planAction: planAction,
  REMOTE_KEY_PLATFORMS: REMOTE_KEY_PLATFORMS,
};
