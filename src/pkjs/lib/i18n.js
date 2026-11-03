// UI languages for the phone side and the settings page. English is built in; the other
// languages come from src/pkjs/generated/strings.js (gzip+base64 of src/pkjs/lang/*.js,
// made by tools/build-strings.js) and are loaded with loadPacked().
// The watch has its own table in src/c/i18n.c and the same language rule (resolve()).
'use strict';

var inflate = require('./inflate');
var EN = require('../lang/en');

// Keep the order in sync with src/c/i18n.c (it is also the bit order of the HELLO mask).
var LANGS = ['en', 'fr', 'ar', 'tr', 'de', 'nl', 'es', 'id'];
var NAMES = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
  tr: 'Türkçe',
  de: 'Deutsch',
  nl: 'Nederlands',
  es: 'Español',
  id: 'Bahasa Indonesia',
};
var RTL = { ar: true };

var tables = { en: EN };
var current = 'en';

// Language code of a locale such as "fr_FR", "fr-FR" or "fr"; null if not supported.
function fromLocale(locale) {
  var m = /^([a-z]{2,3})(?:[_-]|$)/i.exec(String(locale || ''));
  if (!m) return null;
  var code = m[1].toLowerCase();
  if (code === 'in') code = 'id'; // older code for Indonesian (Java, some Android versions)
  return LANGS.indexOf(code) >= 0 ? code : null;
}

// A saved language setting: 'auto' or one of LANGS.
function setting(value) {
  var v = String(value || '').toLowerCase();
  return LANGS.indexOf(v) >= 0 ? v : 'auto';
}

// The language to show: the setting, else the locale's language, else English.
// `shown` lists the languages the screen can draw (null = all); others fall back to English.
// The watch can't draw Arabic without firmware 4.20+ and an Arabic language pack.
function resolve(value, locale, shown) {
  var s = setting(value);
  var code = s === 'auto' ? fromLocale(locale) || 'en' : s;
  if (shown && shown.indexOf(code) < 0) code = 'en';
  return code;
}

// The watch reports the languages its font can draw as a bit mask (bit i = LANGS[i]).
function maskToCodes(mask) {
  return LANGS.filter(function (code, i) { return (mask >> i) & 1; });
}

function codesToMask(codes) {
  return LANGS.reduce(function (m, code, i) { return codes.indexOf(code) >= 0 ? m | (1 << i) : m; }, 0);
}

function addTables(obj) {
  Object.keys(obj || {}).forEach(function (code) {
    if (code !== 'en') tables[code] = obj[code];
  });
}

function loadPacked(b64) {
  if (b64) addTables(JSON.parse(inflate.gunzipBase64ToString(b64)));
}

function has(code) {
  return !!tables[code];
}

function setLang(code) {
  current = tables[code] ? code : 'en';
  return current;
}

function getLang() {
  return current;
}

// Replaces {name} with vars.name; unknown names are left as they are.
function format(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, function (m, k) {
    return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
  });
}

function lookup(section, key, code) {
  var tb = tables[code || current];
  var s = tb && tb[section] ? tb[section][key] : undefined;
  if (s === undefined || s === null || s === '') s = EN[section][key];
  return s === undefined ? key : s;
}

// Phone-side messages (toasts on the watch, config warnings on the settings page).
function t(key, vars) {
  return format(lookup('phone', key), vars);
}

// Settings page texts.
function tp(key, vars) {
  return format(lookup('page', key), vars);
}

module.exports = {
  LANGS: LANGS,
  NAMES: NAMES,
  RTL: RTL,
  fromLocale: fromLocale,
  setting: setting,
  resolve: resolve,
  maskToCodes: maskToCodes,
  codesToMask: codesToMask,
  addTables: addTables,
  loadPacked: loadPacked,
  has: has,
  setLang: setLang,
  getLang: getLang,
  format: format,
  t: t,
  tp: tp,
};
