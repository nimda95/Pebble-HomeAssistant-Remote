// Turns a parsed YAML config (universal-remote-card style, plus `pages`) into a normalized
// remote model: pages with a layout tree of elements, resolved actions, and hardware buttons.
// Shared by the phone-side app and the config page preview.
'use strict';

var tr = require('./i18n').t;

// Display names as used by universal-remote-card's `platform` option.
var PLATFORM_NAMES = {
  android_tv: 'Android TV',
  bravia: 'Sony BRAVIA',
  fire_tv: 'Fire TV',
  apple_tv: 'Apple TV',
  roku: 'Roku',
  webos: 'LG webOS',
  samsung_tv: 'Samsung TV',
  kodi: 'Kodi',
  unified_remote: 'Unified Remote',
  philips_tv: 'Philips TV',
  denon_avr: 'Denon AVR',
  yamaha_ynca: 'Yamaha YNCA',
  jellyfin: 'Jellyfin',
  unfolded_circle: 'Unfolded Circle',
  generic_remote: 'Generic Remote',
};

var PLATFORM_IDS = {};
Object.keys(PLATFORM_NAMES).forEach(function (id) {
  PLATFORM_IDS[PLATFORM_NAMES[id].toLowerCase()] = id;
});

var DIRS = ['up', 'down', 'left', 'right'];
var PARTS = ['center', 'up', 'down', 'left', 'right'];

var CONTEXT_KEYS = ['platform', 'remote_id', 'media_player_id', 'keyboard_id', 'config_entry_id', 'device', 'mac'];

var DEFAULTS = {
  hold_time: 500,
  repeat_delay: 100,
  double_tap_window: 200,
};

function platformId(name) {
  if (!name) return 'android_tv';
  var s = String(name).trim().toLowerCase();
  if (PLATFORM_IDS[s]) return PLATFORM_IDS[s];
  var compact = s.replace(/[\s_-]/g, '');
  for (var k in PLATFORM_IDS) {
    if (k.replace(/\s/g, '') === compact || PLATFORM_IDS[k].replace(/_/g, '') === compact) return PLATFORM_IDS[k];
  }
  return null;
}

function clone(o) {
  return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}

function isObj(o) {
  return o !== null && typeof o === 'object' && !Array.isArray(o);
}

function prettyName(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
}

// Default element library for a platform, by name. The Generic Remote platform has no list of
// its own: like the card, it offers every other platform's key names as plain `key` actions.
function platformLibrary(assets, pid) {
  if (!pid) return {};
  var cacheKey = '_lib_' + pid;
  if (assets[cacheKey]) return assets[cacheKey];
  var lib = {};
  var plat = assets.platforms[pid] || { keys: [], sources: [] };
  var add = function (list) {
    (list || []).forEach(function (e) {
      if (e && e.name && !lib[e.name]) lib[e.name] = e;
    });
  };
  if (pid === 'generic_remote') {
    add(plat.keys);
    Object.keys(assets.platforms).forEach(function (other) {
      if (other === 'generic_remote') return;
      var p = assets.platforms[other];
      (p.keys || []).concat(p.sources || []).forEach(function (e) {
        if (!e || !e.name || lib[e.name]) return;
        var g = { name: e.name, icon: e.icon, tap_action: { action: 'key', key: e.name } };
        if (e.type) g.type = e.type;
        if (e.hold_action) g.hold_action = e.hold_action;
        lib[e.name] = g;
      });
    });
  } else {
    add(plat.keys);
    add(plat.sources);
  }
  assets[cacheKey] = lib;
  return lib;
}

function warn(model, msg) {
  if (model.warnings.indexOf(msg) < 0) model.warnings.push(msg);
}

// --- element normalization -------------------------------------------------

function normPart(src) {
  if (!isObj(src)) return null;
  var p = {
    tap: src.tap_action,
    hold: src.hold_action,
    double: src.double_tap_action,
    icon: src.icon,
    label: src.label,
  };
  return p;
}

function hasAction(a) {
  if (a === undefined || a === null) return false;
  if (Array.isArray(a)) return a.length > 0;
  return isObj(a) && a.action !== 'none';
}

function timing(page, cfg) {
  var hold = isObj(cfg.hold_action) ? cfg.hold_action : {};
  var dbl = isObj(cfg.double_tap_action) ? cfg.double_tap_action : {};
  return {
    hold_time: num(hold.hold_time, page.options.hold_time),
    repeat_delay: num(hold.repeat_delay, page.options.repeat_delay),
    double_tap_window: num(dbl.double_tap_window, page.options.double_tap_window),
  };
}

function num(v, d) {
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : d;
}

function normalizeElement(model, page, name, cfg) {
  var type = (cfg.type || 'button').toLowerCase();
  if (['button', 'touchpad', 'circlepad', 'slider'].indexOf(type) < 0) {
    warn(model, tr('unknownType', { type: cfg.type, name: name }));
    type = 'button';
  }
  var ctx = page.ctx;
  var el = {
    name: name,
    type: type,
    icon: cfg.icon,
    label: cfg.label !== undefined && cfg.label !== null ? String(cfg.label) : undefined,
    color: cfg.color,
    background: cfg.background || cfg.background_color,
    width: num(cfg.width, undefined),
    height: num(cfg.height, undefined),
    entity_id: cfg.entity_id,
    value_attribute: cfg.value_attribute,
    timing: timing(page, cfg),
    parts: { center: normPart(cfg) },
    drag: cfg.drag_action,
    config: cfg,
  };
  if (type === 'touchpad' || type === 'circlepad') {
    DIRS.forEach(function (d) {
      if (isObj(cfg[d])) el.parts[d] = normPart(cfg[d]);
    });
  }
  if (type === 'slider') {
    var range = Array.isArray(cfg.range) ? cfg.range : [0, 1];
    var lo = num(range[0], 0), hi = num(range[1], 1);
    if (typeof range[0] === 'string' || typeof range[1] === 'string') {
      if (!isFinite(parseFloat(range[0])) || !isFinite(parseFloat(range[1]))) {
        warn(model, tr('templatedRange', { name: name, lo: lo, hi: hi }));
      }
    }
    el.range = [lo, hi];
    el.step = num(cfg.step, (hi - lo) / 100);
    el.vertical = !!cfg.vertical;
    el.value_attribute = cfg.value_attribute || 'state';
    el.unit = cfg.unit_of_measurement !== undefined ? String(cfg.unit_of_measurement) : cfg.unit !== undefined ? String(cfg.unit) : '';
    if (!el.entity_id) {
      el.entity_id = (name === 'slider' && ctx.media_player_id) || ctx.entity_id || ctx.media_player_id || ctx.remote_id || ctx.keyboard_id;
    }
  }
  return el;
}

// --- name resolution ---------------------------------------------------------

function lookup(model, page, name) {
  if (page.custom[name]) return clone(page.custom[name]);
  if (model.custom[name]) return clone(model.custom[name]);
  var lib = platformLibrary(model.assets, page.ctx.platformId);
  if (lib[name]) return clone(lib[name]);
  return null;
}

var PADS = {
  dpad: ['', 'up', '', 'left', 'center', 'right', '', 'down', ''],
  numpad: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'],
  dialpad: ['n7', 'n8', 'n9', 'n4', 'n5', 'n6', 'n1', 'n2', 'n3'],
  xpad: ['', 'y', '', 'x', '', 'b', '', 'a', ''],
  npad: ['', 'x', '', 'y', '', 'a', '', 'b', ''],
};

function addElement(model, page, name, cfg) {
  var el = normalizeElement(model, page, name, cfg);
  el.index = page.elements.length;
  page.elements.push(el);
  return { k: 'el', i: el.index };
}

function spacer(page) {
  var el = { name: '', type: 'spacer', parts: {}, index: page.elements.length };
  page.elements.push(el);
  return { k: 'el', i: el.index };
}

function leaf(model, page, item) {
  if (item === null || item === undefined || item === '' || item === '_') return spacer(page);
  if (isObj(item)) {
    // Inline element definition (an extension to the card's syntax).
    var name = item.name || 'inline_' + page.elements.length;
    var base = item.name ? lookup(model, page, item.name) : null;
    var cfg = base ? Object.assign(base, item) : item;
    return addElement(model, page, name, cfg);
  }
  var nm = String(item);
  var cfg2 = lookup(model, page, nm);
  if (!cfg2) {
    warn(model, tr('unknownElement', { page: page.name, name: nm }));
    return spacer(page);
  }
  if (!cfg2.tap_action && !cfg2.hold_action && !cfg2.double_tap_action && cfg2.type !== 'slider' &&
      cfg2.type !== 'touchpad' && cfg2.type !== 'circlepad' && !cfg2.icon && cfg2.label === undefined) {
    return spacer(page);
  }
  return addElement(model, page, nm, cfg2);
}

// Mirrors universal-remote-card buildElements(): nesting alternates row/column.
function build(model, page, items, isColumn) {
  if (!Array.isArray(items)) items = [items];
  var children = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (Array.isArray(it)) {
      children.push(build(model, page, it, !isColumn));
      continue;
    }
    if (typeof it === 'string' && !lookupOverrides(model, page, it)) {
      if (it === 'volume_buttons') {
        var vb = ['volume_down', 'volume_mute', 'volume_up'];
        if (isColumn) vb.reverse();
        vb.forEach(function (n) { children.push(leaf(model, page, n)); });
        continue;
      }
      if (it === 'navigation_buttons') {
        children.push({
          k: 'col',
          c: [
            { k: 'row', c: [leaf(model, page, 'up')] },
            { k: 'row', c: [leaf(model, page, 'left'), leaf(model, page, 'center'), leaf(model, page, 'right')] },
            { k: 'row', c: [leaf(model, page, 'down')] },
          ],
        });
        continue;
      }
      if (PADS[it]) {
        var names = PADS[it];
        var rows = [];
        for (var r = 0; r < 3; r++) {
          rows.push({ k: 'row', c: names.slice(r * 3, r * 3 + 3).map(function (n) { return leaf(model, page, n); }) });
        }
        children.push({ k: 'col', c: rows, pad: true });
        continue;
      }
    }
    children.push(leaf(model, page, it));
  }
  return { k: isColumn ? 'col' : 'row', c: children };
}

// The card resolves shorthands before custom actions, so they can't be overridden by name.
// We follow that, except for an explicit custom action of the same name on this remote.
function lookupOverrides(model, page, name) {
  return !!(page.custom[name] || model.custom[name]);
}

// --- hardware buttons ----------------------------------------------------------

// `ok: center` | `ok: { tap_action, hold_action, double_tap_action }` | `ok: none`
function hwButton(model, page, spec, fallback) {
  if (spec === undefined) spec = fallback;
  if (spec === undefined || spec === null || spec === 'none' || spec === false) return null;
  var cfg;
  if (typeof spec === 'string') {
    cfg = lookup(model, page, spec);
    if (!cfg) {
      warn(model, tr('unknownButton', { page: page.name, name: spec }));
      return null;
    }
    if (cfg.type === 'touchpad' || cfg.type === 'circlepad' || cfg.type === 'slider') {
      cfg = { tap_action: cfg.tap_action, hold_action: cfg.hold_action, double_tap_action: cfg.double_tap_action };
    }
  } else if (isObj(spec)) {
    cfg = spec;
    if (spec.action && !spec.tap_action) cfg = { tap_action: spec }; // `ok: {action: key, key: X}`
  } else {
    return null;
  }
  return {
    name: typeof spec === 'string' ? spec : 'button',
    parts: { center: normPart(cfg) },
    timing: timing(page, cfg),
    config: cfg,
  };
}

// --- top level ------------------------------------------------------------------

function toObjList(list, model, where) {
  var out = {};
  if (list === undefined || list === null) return out;
  if (!Array.isArray(list)) {
    warn(model, tr('customList', { where: where }));
    return out;
  }
  list.forEach(function (c) {
    if (isObj(c) && c.name) out[c.name] = c;
    else warn(model, tr('customNoName', { where: where }));
  });
  return out;
}

var STYLE_KEYS = ['theme', 'accent', 'background', 'button', 'text', 'pad', 'title', 'show_title'];
var STYLE_ALIASES = { accent_color: 'accent', button_background: 'button', button_color: 'text', color: 'text', title_color: 'title', pad_background: 'pad' };

// Style from the older flat keys (theme, accent_color, show_title) plus a `style:` mapping.
function readStyle(model, src, where) {
  var out = {};
  if (!isObj(src)) return out;
  if (src.theme !== undefined) out.theme = src.theme;
  if (src.accent_color !== undefined) out.accent = src.accent_color;
  if (src.show_title !== undefined) out.show_title = src.show_title;
  if (src.style !== undefined) {
    if (!isObj(src.style)) {
      warn(model, tr('styleMapping', { where: where }));
    } else {
      Object.keys(src.style).forEach(function (k) {
        var key = STYLE_ALIASES[k] || k;
        if (STYLE_KEYS.indexOf(key) < 0) warn(model, tr('unknownStyle', { where: where, name: k }));
        else out[key] = src.style[k];
      });
    }
  }
  return out;
}

function finishStyle(model, s, where) {
  var theme = s.theme === undefined ? 'dark' : String(s.theme).toLowerCase();
  if (theme !== 'dark' && theme !== 'light') {
    warn(model, tr('badTheme', { where: where }));
    theme = 'dark';
  }
  return {
    theme: theme,
    accent: s.accent,
    background: s.background,
    button: s.button,
    text: s.text,
    pad: s.pad,
    title: s.title,
    show_title: s.show_title !== false,
  };
}

function entityDomain(id) {
  return typeof id === 'string' && id.indexOf('.') > 0 ? id.split('.')[0] : '';
}

// assets: { platforms, mdi, brand } (decoded assets bundle)
// The config is a list of pages. Each page is a self-contained remote: its own platform and
// entities, rows, buttons, custom actions and style. For compatibility a mapping with
// `pages:` (top-level keys become defaults for every page) and a plain universal-remote-card
// config (one page) are accepted too.
function compile(config, assets) {
  var model = {
    warnings: [],
    errors: [],
    pages: [],
    assets: assets,
    options: {},
    custom: {},
    customIcons: {},
  };
  var defaults = {};
  var pageCfgs;
  if (Array.isArray(config)) {
    pageCfgs = config;
  } else if (isObj(config)) {
    defaults = config;
    if (Array.isArray(config.pages)) {
      pageCfgs = config.pages;
    } else if (config.pages !== undefined) {
      model.errors.push(tr('pagesList'));
      return model;
    } else if (config.rows !== undefined) {
      pageCfgs = [{ name: config.title || 'Remote', rows: config.rows }];
    } else {
      model.errors.push(tr('notPages'));
      return model;
    }
  } else {
    model.errors.push(tr('notPages'));
    return model;
  }

  model.options.start_page = defaults.start_page;
  model.custom = toObjList(defaults.custom_actions, model, tr('whereTop'));
  var addIcons = function (list) {
    (Array.isArray(list) ? list : []).forEach(function (ci) {
      if (isObj(ci) && ci.name && ci.path) model.customIcons[ci.name] = ci.path;
    });
  };
  addIcons(defaults.custom_icons);
  var baseStyle = readStyle(model, defaults, tr('whereTop'));

  pageCfgs.forEach(function (pc, idx) {
    if (!isObj(pc)) {
      model.errors.push(tr('pageMapping', { n: idx + 1 }));
      return;
    }
    var where = tr('wherePage', { name: String(pc.name || pc.title || idx + 1) });
    var pick = function (key) { return pc[key] !== undefined ? pc[key] : defaults[key]; };
    var page = {
      index: model.pages.length,
      name: String(pc.name || pc.title || 'Page ' + (idx + 1)),
      ctx: {},
      custom: toObjList(pc.custom_actions, model, where),
      elements: [],
    };
    addIcons(pc.custom_icons);

    // Entities: `entity_id` is the page's main entity. It also fills remote_id /
    // media_player_id when it is a remote or media player.
    CONTEXT_KEYS.concat(['entity_id']).forEach(function (k) { page.ctx[k] = pick(k); });
    var explicitDevice = !!(page.ctx.remote_id || page.ctx.media_player_id || page.ctx.keyboard_id);
    var dom = entityDomain(page.ctx.entity_id);
    if (dom === 'remote' && !page.ctx.remote_id) page.ctx.remote_id = page.ctx.entity_id;
    if (dom === 'media_player' && !page.ctx.media_player_id) page.ctx.media_player_id = page.ctx.entity_id;

    // Platform: as in the card it defaults to Android TV for a TV/box page. A page without a
    // platform and without remote/media player (an AC, lights, ...) gets no built-in keys.
    var pid = null;
    if (page.ctx.platform !== undefined && page.ctx.platform !== null && page.ctx.platform !== '') {
      pid = platformId(page.ctx.platform);
      if (!pid) {
        warn(model, tr('unknownPlatform', { where: where, name: page.ctx.platform }));
        pid = 'android_tv';
      }
    } else if (explicitDevice) {
      pid = 'android_tv'; // the card's default platform
    }
    page.ctx.platformId = pid;
    page.ctx.platform = pid ? PLATFORM_NAMES[pid] : null;

    page.options = {
      hold_time: num(pick('hold_time'), DEFAULTS.hold_time),
      repeat_delay: num(pick('repeat_delay'), DEFAULTS.repeat_delay),
      double_tap_window: num(pick('double_tap_window'), DEFAULTS.double_tap_window),
      haptics: pick('haptics') !== false,
    };
    page.start = pc.start === true;
    page.style = finishStyle(model, Object.assign({}, baseStyle, readStyle(model, pc, where)), where);

    var rows = pc.rows;
    if (rows === undefined || rows === null) rows = [];
    if (!Array.isArray(rows)) {
      model.errors.push(tr('rowsList', { where: where }));
      rows = [];
    }
    // Top level: each entry is a row (a bare string is a one-element row).
    page.layout = {
      k: 'col',
      c: rows.map(function (r) { return build(model, page, Array.isArray(r) ? r : [r], false); }),
    };

    var lib = platformLibrary(assets, pid);
    var okDefault = (page.custom.center || model.custom.center || lib.center) ? 'center' : undefined;
    page.buttons = {
      select: hwButton(model, page, pick('ok'), okDefault),
      up: hwButton(model, page, pick('up'), { tap_action: { action: 'page', page: 'previous' } }),
      down: hwButton(model, page, pick('down'), { tap_action: { action: 'page', page: 'next' } }),
    };
    if (page.buttons.up && !page.buttons.up.parts.center.tap) {
      page.buttons.up.parts.center.tap = { action: 'page', page: 'previous' };
    }
    if (page.buttons.down && !page.buttons.down.parts.center.tap) {
      page.buttons.down.parts.center.tap = { action: 'page', page: 'next' };
    }
    model.pages.push(page);
  });

  if (!model.pages.length && !model.errors.length) model.errors.push(tr('noPages'));
  return model;
}

// Returns the element (or hardware button) a watch event refers to.
var BUTTON_IDS = { 240: 'select', 241: 'up', 242: 'down' };
function target(model, pageIndex, elemIndex) {
  var page = model.pages[pageIndex];
  if (!page) return null;
  if (BUTTON_IDS[elemIndex]) return page.buttons[BUTTON_IDS[elemIndex]];
  return page.elements[elemIndex] || null;
}

module.exports = {
  compile: compile,
  platformId: platformId,
  platformLibrary: platformLibrary,
  PLATFORM_NAMES: PLATFORM_NAMES,
  PARTS: PARTS,
  DIRS: DIRS,
  hasAction: hasAction,
  prettyName: prettyName,
  target: target,
  BUTTON_IDS: BUTTON_IDS,
};
