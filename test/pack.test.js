'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { getAssets, loadYaml, yaml } = require('./helpers');
const modelLib = require('../src/pkjs/lib/model');
const packLib = require('../src/pkjs/lib/pack');
const { unpack } = require('../src/pkjs/lib/unpack');
const layoutLib = require('../src/pkjs/lib/layout');
const raster = require('../src/pkjs/lib/raster');
const inflate = require('../src/pkjs/lib/inflate');

const SCREENS = layoutLib.SCREENS;

function compile(cfg) {
  const m = modelLib.compile(cfg, getAssets());
  assert.deepStrictEqual(m.errors, []);
  return m;
}

function insideCircle(x, y, s) {
  const r = s.w / 2;
  return (x - r) ** 2 + (y - r) ** 2 <= r * r + 1;
}

test('packed layouts unpack to the same structure on both watches', () => {
  for (const f of ['examples/default.yaml', 'examples/showcase.yaml']) {
    const m = compile(loadYaml(f));
    for (const name of Object.keys(SCREENS)) {
      const screen = SCREENS[name];
      const r = packLib.pack(m, screen, {});
      assert.deepStrictEqual(r.missingIcons, [], `${f} ${name}`);
      const L = unpack(r.bytes);
      assert.strictEqual(L.numPages, m.pages.length);
      assert.strictEqual(L.startPage, 255);
      L.pages.forEach((pg, i) => {
        assert.strictEqual(pg.name, m.pages[i].name);
        for (const el of pg.elems) {
          const src = m.pages[i].elements[el.id];
          assert.ok(src && src.type !== 'spacer');
          assert.ok(el.x >= 0 && el.y >= 0 && el.x + el.w <= screen.w && el.y + el.h <= screen.h, `${f} ${name} ${src.name} in bounds`);
          if (screen.round && src.type !== 'circlepad') {
            // corners of rectangular elements stay inside the round display (1px slack for rounding)
            for (const [x, y] of [[el.x + 2, el.y + 2], [el.x + el.w - 2, el.y + 2], [el.x + 2, el.y + el.h - 2], [el.x + el.w - 2, el.y + el.h - 2]]) {
              assert.ok(insideCircle(x, y, screen), `${f} ${src.name} corner ${x},${y}`);
            }
          }
          for (const ic of el.icon) assert.ok(ic === 255 || ic < L.numIcons);
        }
      });
      // elements on a page never overlap
      L.pages.forEach((pg) => {
        for (let a = 0; a < pg.elems.length; a++) {
          for (let b = a + 1; b < pg.elems.length; b++) {
            const A = pg.elems[a], B = pg.elems[b];
            const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
            assert.ok(!overlap, `overlap on ${pg.name}`);
          }
        }
      });
    }
  }
});

test('part flags encode tap/hold/repeat/double and local page switching', () => {
  const m = compile(yaml.load(`
remote_id: remote.tv
rows: [[volume_up, x, touchpad]]
custom_actions:
  - name: x
    tap_action: {action: page, page: next}
    double_tap_action: {action: key, key: HOME}
`));
  const F = packLib.FLAGS;
  const L = unpack(packLib.pack(m, SCREENS.emery, {}).bytes);
  const [vol, x, pad] = L.pages[0].elems;
  assert.strictEqual(vol.pf[0], F.PF_TAP | F.PF_HOLD | F.PF_REPEAT);
  assert.strictEqual(x.pf[0], F.PF_LOCAL_NEXT | F.PF_DOUBLE);
  assert.strictEqual(pad.pf[1], F.PF_TAP | F.PF_HOLD | F.PF_REPEAT);
  // up/down buttons switch pages locally by default; select = center key
  assert.deepStrictEqual(L.pages[0].buttons, [F.PF_TAP | F.PF_HOLD, F.PF_LOCAL_PREV, F.PF_LOCAL_NEXT]);
});

test('identical configs give identical hashes; changes change them', () => {
  const cfg = loadYaml('examples/default.yaml');
  const a = packLib.pack(compile(cfg), SCREENS.emery, {});
  const b = packLib.pack(compile(cfg), SCREENS.emery, {});
  assert.strictEqual(a.hash, b.hash);
  cfg[0].name = 'Changed';
  assert.notStrictEqual(packLib.pack(compile(cfg), SCREENS.emery, {}).hash, a.hash);
});

test('colors map to the nearest Pebble color', () => {
  assert.strictEqual(packLib.color8('#ff0000'), 0xf0);
  assert.strictEqual(packLib.color8('white'), 0xff);
  assert.strictEqual(packLib.color8('rgb(0, 170, 255)'), 0xcb);
  assert.strictEqual(packLib.color8('#0af'), 0xcb);
  assert.strictEqual(packLib.color8('var(--x)'), 0);
});

test('icons rasterize into the 2-bit format and every bundled icon parses', () => {
  const assets = getAssets();
  const ic = raster.renderIcon(assets.mdi.power, 24);
  assert.strictEqual(ic.data.length, 6 * 24);
  let solid = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (raster.iconPixel(ic, x, y) === 3) solid++;
  assert.ok(solid > 40 && solid < 300, 'power icon has a plausible amount of ink: ' + solid);
  for (const [name, p] of Object.entries(Object.assign({}, assets.mdi, assets.brand))) {
    assert.doesNotThrow(() => raster.renderIcon(p, 16), name);
  }
});

test('the embedded settings page inflates and has the injection marker once', () => {
  const html = inflate.gunzipBase64ToString(require('../src/pkjs/generated/config_page'));
  assert.strictEqual(html.split('"__PEBBLE_INIT__"').length, 2);
  assert.ok(html.indexOf('/*__SCRIPT__*/') < 0 && html.indexOf('/*__STYLE__*/') < 0);
  assert.ok(zlib.gzipSync(Buffer.from(html)).length < 60 * 1024, 'page stays small');
});

test('pages carry their own colors, flags and timings; sliders their range', () => {
  const m = compile(yaml.load(`
- name: Dark
  remote_id: remote.tv
  style: {accent: '#ff0000', show_title: false}
  haptics: false
  rows: [[home]]
- name: Light
  entity_id: climate.ac
  style: {theme: light, background: '#0000ff', text: black}
  hold_time: 700
  rows: [[t, v]]
  custom_actions:
    - {name: t, type: slider, range: [16, 30], step: 0.5, unit_of_measurement: '°C', tap_action: {action: none}}
    - {name: v, type: slider, tap_action: {action: none}}
`));
  const F = packLib.FLAGS;
  const L = unpack(packLib.pack(m, SCREENS.emery, {}).bytes);
  const [dark, light] = L.pages;
  assert.strictEqual(dark.flags, 0);
  assert.strictEqual(dark.colors.accent, 0xf0);
  assert.strictEqual(dark.colors.bg, packLib.THEMES.dark[0]);
  assert.strictEqual(light.flags, F.PG_HAPTICS | F.PG_TITLE);
  assert.strictEqual(light.colors.bg, 0xc3);
  assert.strictEqual(light.colors.btnFg, 0xc0);
  assert.strictEqual(light.colors.btnBg, packLib.THEMES.light[1]);
  assert.strictEqual(light.holdMs, 700);
  // title bar off on the first page: content starts higher
  assert.ok(dark.elems[0].y < light.elems[0].y);
  const [t, v] = light.elems;
  assert.deepStrictEqual([t.min, t.max, t.step, t.decimals, t.unit], [16, 30, 0.5, 1, '°C']);
  assert.strictEqual(require('../src/pkjs/lib/unpack').sliderText(t, 128), '23.0°C');
  assert.ok(v.flags & F.EL_PERCENT);
  assert.strictEqual(require('../src/pkjs/lib/unpack').sliderText(v, 191), '75%');
});

test('start page: `start: true` or the older start_page', () => {
  const L = unpack(packLib.pack(compile(yaml.load('- {name: A, rows: []}\n- {name: B, start: true, rows: []}')), SCREENS.emery, {}).bytes);
  assert.strictEqual(L.startPage, 1);
});
