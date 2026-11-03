'use strict';
// Translations: every language has every string (watch, phone and settings page), and the
// language choice follows the same rule on the phone, the page and the watch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/pkjs/lib/i18n');
const inflate = require('../src/pkjs/lib/inflate');
const modelLib = require('../src/pkjs/lib/model');
const { getAssets, yaml } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lang = (code) => require(path.join(ROOT, 'src/pkjs/lang', code + '.js'));
const EN = lang('en');

const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort();
// Parts that must stay untranslated: <code>, <b> and `backtick` spans.
const codeParts = (s) => (s.match(/<(code|b)>[\s\S]*?<\/\1>|`[^`]*`/g) || []).sort();
const codepoints = (s) => Array.from(s).length;

test('every language has every phone and page string', () => {
  for (const code of i18n.LANGS) {
    const L = lang(code);
    for (const section of ['phone', 'page']) {
      assert.deepStrictEqual(Object.keys(L[section]).sort(), Object.keys(EN[section]).sort(), code + '.' + section);
      for (const k of Object.keys(EN[section])) {
        const s = L[section][k], en = EN[section][k];
        const where = code + '.' + section + '.' + k;
        assert.ok(typeof s === 'string' && s.trim(), where + ' is empty');
        assert.deepStrictEqual(placeholders(s), placeholders(en), where + ' placeholders');
        assert.deepStrictEqual(codeParts(s), codeParts(en), where + ' code parts');
        assert.ok(!/<(?!\/?(code|b)>)/.test(s), where + ' has unexpected markup');
      }
    }
  }
});

test('every string key used in the code exists, and every key is used', () => {
  const used = (files, re) => {
    const keys = new Set();
    for (const f of files) for (const m of read(f).matchAll(re)) keys.add(m[1]);
    return keys;
  };
  const phoneFiles = ['src/pkjs/index.js', ...fs.readdirSync(path.join(ROOT, 'src/pkjs/lib')).map((f) => 'src/pkjs/lib/' + f)];
  const phoneUsed = used(phoneFiles, /\btr\('(\w+)'/g);
  for (const k of used(['src/pkjs/index.js'], /guard\('(\w+)'/g)) phoneUsed.add(k);
  for (const k of used(['src/pkjs/lib/actions.js'], /platformOf\(\w+, \w+, '(\w+)'\)/g)) phoneUsed.add(k);
  for (const k of phoneUsed) assert.ok(k in EN.phone, 'phone string missing: ' + k);
  assert.deepStrictEqual(Object.keys(EN.phone).filter((k) => !phoneUsed.has(k)), [], 'unused phone strings');

  const html = read('config/index.html');
  const pageUsed = used(['config/index.html'], /data-i18n(?:-html|-ph|-aria)?="(\w+)"/g);
  for (const k of used(['config/app.js'], /'(\w+)'/g)) if (k in EN.page) pageUsed.add(k);
  for (const k of used(['config/index.html'], /data-i18n(?:-html|-ph|-aria)?="(\w+)"/g)) assert.ok(k in EN.page, 'page string missing: ' + k);
  for (const k of used(['config/app.js'], /\bT\('(\w+)'/g)) assert.ok(k in EN.page, 'page string missing: ' + k);
  assert.deepStrictEqual(Object.keys(EN.page).filter((k) => !pageUsed.has(k)), [], 'unused page strings');
  assert.ok(html.indexOf('id="langSel"') > 0);
});

// The watch table: src/c/i18n.h ids, src/c/i18n.c languages.
function watchTable() {
  const h = read('src/c/i18n.h');
  const c = read('src/c/i18n.c');
  const ids = /typedef enum \{([\s\S]*?)\} StrId;/.exec(h)[1].match(/STR_\w+/g).filter((x) => x !== 'STR_COUNT');
  const enumLangs = /enum \{ ([^}]*) \};/.exec(c)[1].split(',').map((s) => s.trim()).filter((s) => s !== 'L_COUNT');
  const codes = /LANG_CODES\[L_COUNT\]\[3\] = \{([^}]*)\}/.exec(c)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
  const table = {};
  const re = /\[(L_\w+)\] = \{([\s\S]*?)\n  \},/g;
  for (const m of c.matchAll(re)) {
    const code = codes[enumLangs.indexOf(m[1])];
    table[code] = {};
    for (const s of m[2].matchAll(/\[(STR_\w+)\] = "((?:[^"\\]|\\.)*)"/g)) table[code][s[1]] = s[2];
  }
  return { ids, enumLangs, codes, table };
}

test('the watch has every string in every language, in the same language order', () => {
  const w = watchTable();
  assert.deepStrictEqual(w.codes, i18n.LANGS, 'LANG_CODES in src/c/i18n.c');
  assert.deepStrictEqual(w.enumLangs, i18n.LANGS.map((c) => 'L_' + c.toUpperCase()));
  assert.deepStrictEqual(Object.keys(w.table).sort(), i18n.LANGS.slice().sort());
  for (const code of i18n.LANGS) {
    assert.deepStrictEqual(Object.keys(w.table[code]).sort(), w.ids.slice().sort(), 'watch strings for ' + code);
    for (const id of w.ids) assert.ok(w.table[code][id].trim(), code + ' ' + id);
  }
  // The firmware cuts right-to-left lines after about 30 letters.
  for (const id of w.ids) assert.ok(codepoints(w.table.ar[id]) <= 30, 'Arabic ' + id + ' is too long');
});

test('Arabic messages the phone shows on the watch stay short', () => {
  const ar = lang('ar').phone;
  const toasts = ['openSettings', 'badSettings', 'connected', 'needUrlToken', 'unreachable', 'badToken', 'timedOut', 'unknownEntity', 'noPage'];
  for (const k of toasts) {
    assert.ok(codepoints(ar[k].replace(/\{\w+\}/g, '')) <= 30, 'Arabic ' + k + ' is too long: ' + ar[k]);
  }
});

test('language choice: automatic from the locale, explicit setting, fallbacks', () => {
  // automatic: the system locale (watch: i18n_get_system_locale, page: navigator.language)
  assert.strictEqual(i18n.resolve('auto', 'fr_FR'), 'fr');
  assert.strictEqual(i18n.resolve(undefined, 'de-DE'), 'de');
  assert.strictEqual(i18n.resolve('', 'nl'), 'nl');
  assert.strictEqual(i18n.resolve('auto', 'TR_tr'), 'tr');
  assert.strictEqual(i18n.resolve('auto', 'in_ID'), 'id');
  assert.strictEqual(i18n.resolve('auto', 'es-419'), 'es');
  assert.strictEqual(i18n.resolve('auto', 'pt_BR'), 'en');
  assert.strictEqual(i18n.resolve('auto', 'fil_PH'), 'en');
  assert.strictEqual(i18n.resolve('auto', ''), 'en');
  assert.strictEqual(i18n.resolve('auto', null), 'en');
  // explicit setting wins; anything unknown means automatic
  assert.strictEqual(i18n.resolve('es', 'fr_FR'), 'es');
  assert.strictEqual(i18n.resolve('en', 'fr_FR'), 'en');
  assert.strictEqual(i18n.resolve('xx', 'fr_FR'), 'fr');
  assert.strictEqual(i18n.setting('FR'), 'fr');
  assert.strictEqual(i18n.setting('fr_FR'), 'auto');
  assert.strictEqual(i18n.setting(null), 'auto');
  // the settings page can always show Arabic
  assert.strictEqual(i18n.resolve('auto', 'ar-MA'), 'ar');
  assert.strictEqual(i18n.resolve('ar', 'en-US'), 'ar');
});

test('the watch falls back to English when its font cannot draw the language', () => {
  const all = i18n.codesToMask(i18n.LANGS);
  assert.strictEqual(all, 0xff);
  const noArabic = i18n.maskToCodes(all & ~(1 << i18n.LANGS.indexOf('ar')));
  assert.ok(noArabic.indexOf('ar') < 0 && noArabic.indexOf('fr') >= 0);
  assert.strictEqual(i18n.resolve('ar', 'fr_FR', noArabic), 'en');
  assert.strictEqual(i18n.resolve('auto', 'ar_SA', noArabic), 'en');
  assert.strictEqual(i18n.resolve('auto', 'fr_FR', noArabic), 'fr');
  assert.strictEqual(i18n.resolve('ar', 'fr_FR', i18n.maskToCodes(all)), 'ar');
  const noTurkish = i18n.maskToCodes(all & ~(1 << i18n.LANGS.indexOf('tr')));
  assert.strictEqual(i18n.resolve('tr', '', noTurkish), 'en');
  // HELLO: bit 0 is "has backup", the language mask starts at bit 1
  const value = 1 | (i18n.codesToMask(noArabic) << 1);
  assert.deepStrictEqual(i18n.maskToCodes(value >> 1), noArabic);
});

test('the packed translations are up to date (run npm run gen)', () => {
  const packed = JSON.parse(inflate.gunzipBase64ToString(require('../src/pkjs/generated/strings')));
  const expected = {};
  for (const code of i18n.LANGS) if (code !== 'en') expected[code] = lang(code);
  assert.deepStrictEqual(packed, expected);
});

test('messages follow the chosen language and fall back to English', () => {
  i18n.loadPacked(require('../src/pkjs/generated/strings'));
  try {
    for (const code of i18n.LANGS) {
      assert.strictEqual(i18n.setLang(code), code);
      const m = modelLib.compile(yaml.load('- name: A\n  platform: Roku\n  rows: [[nope]]'), getAssets());
      assert.strictEqual(m.warnings.length, 1);
      assert.strictEqual(m.warnings[0], i18n.format(lang(code).phone.unknownElement, { page: 'A', name: 'nope' }));
      assert.strictEqual(i18n.tp('save'), lang(code).page.save);
    }
    assert.strictEqual(i18n.setLang('xx'), 'en');
    assert.strictEqual(i18n.t('unreachable'), 'Cannot reach Home Assistant');
    assert.strictEqual(i18n.format('{a} {b}', { a: 1 }), '1 {b}');
  } finally {
    i18n.setLang('en');
  }
});
