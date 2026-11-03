'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { getAssets, loadYaml, yaml } = require('./helpers');
const modelLib = require('../src/pkjs/lib/model');

const compile = (cfg) => modelLib.compile(typeof cfg === 'string' ? yaml.load(cfg) : cfg, getAssets());

test('example configs compile without errors or warnings', () => {
  for (const f of ['examples/default.yaml', 'examples/showcase.yaml']) {
    const m = compile(loadYaml(f));
    assert.deepStrictEqual(m.errors, [], f);
    assert.deepStrictEqual(m.warnings, [], f);
    assert.ok(m.pages.length >= 3);
  }
});

test('a plain universal-remote-card config becomes one page', () => {
  const m = compile(`
type: custom:universal-remote-card
remote_id: remote.apple_tv
platform: Apple TV
rows:
  - - power
    - menu
  - - touchpad
`);
  assert.deepStrictEqual(m.errors, []);
  assert.strictEqual(m.pages.length, 1);
  const p = m.pages[0];
  assert.strictEqual(p.ctx.platformId, 'apple_tv');
  assert.deepStrictEqual(p.elements.map((e) => e.name), ['power', 'menu', 'touchpad']);
  // Apple TV power: wakeup on tap, suspend on hold
  assert.strictEqual(p.elements[0].parts.center.tap.key, 'wakeup');
  assert.strictEqual(p.elements[0].parts.center.hold.key, 'suspend');
  // Select defaults to the platform's center key
  assert.strictEqual(p.buttons.select.parts.center.tap.key, 'select');
});

test('shorthands expand like the card (volume_buttons reverses inside a column)', () => {
  const m = compile(`
platform: Android TV
rows:
  - [volume_buttons]
  - [[volume_buttons], dpad]
`);
  const names = m.pages[0].elements.map((e) => e.name);
  assert.deepStrictEqual(names.slice(0, 3), ['volume_down', 'volume_mute', 'volume_up']);
  assert.deepStrictEqual(names.slice(3, 6), ['volume_up', 'volume_mute', 'volume_down']);
  // dpad: 9 cells, 4 of them spacers
  assert.strictEqual(names.slice(6).length, 9);
  assert.strictEqual(m.pages[0].elements.slice(6).filter((e) => e.type === 'spacer').length, 4);
});

test('custom actions override defaults; page-level beats top-level', () => {
  const m = compile(`
platform: Android TV
custom_actions:
  - name: home
    icon: mdi:home-variant
    tap_action: {action: key, key: TOP}
pages:
  - name: A
    rows: [[home]]
  - name: B
    custom_actions:
      - name: home
        tap_action: {action: key, key: PAGE}
    rows: [[home]]
`);
  assert.strictEqual(m.pages[0].elements[0].parts.center.tap.key, 'TOP');
  assert.strictEqual(m.pages[1].elements[0].parts.center.tap.key, 'PAGE');
});

test('inline elements merge with the named default', () => {
  const m = compile(`
platform: Android TV
rows:
  - - name: back
      double_tap_action: {action: key, key: HOME}
    - {name: lamp, icon: mdi:lamp, tap_action: {action: toggle, target: {entity_id: light.x}}}
`);
  const [back, lamp] = m.pages[0].elements;
  assert.strictEqual(back.parts.center.tap.key, 'BACK');
  assert.strictEqual(back.parts.center.double.key, 'HOME');
  assert.strictEqual(lamp.icon, 'mdi:lamp');
});

test('unknown elements warn and become spacers; bad structure errors', () => {
  const m = compile('platform: Android TV\nrows: [[nope]]');
  assert.strictEqual(m.pages[0].elements[0].type, 'spacer');
  assert.match(m.warnings[0], /unknown element "nope"/);
  assert.match(compile('pages: 3').errors[0], /must be a list/);
  assert.match(compile('foo: 1').errors[0], /list of pages/);
  assert.match(compile('just a string').errors[0], /list of pages/);
  assert.match(compile('- 3').errors[0], /must be a mapping/);
});

test('per-page platform and entity overrides; ok/up/down buttons', () => {
  const m = compile(`
platform: Android TV
remote_id: remote.tv
pages:
  - name: Kodi
    platform: Kodi
    media_player_id: media_player.kodi
    ok:
      tap_action: {action: key, key: Input.Select}
      hold_action: {action: key, key: Input.ContextMenu}
    up: {hold_action: {action: key, key: Input.Up}}
    down: none
    rows: [[home]]
`);
  const p = m.pages[0];
  assert.strictEqual(p.ctx.platformId, 'kodi');
  assert.strictEqual(p.ctx.remote_id, 'remote.tv');
  assert.strictEqual(p.ctx.media_player_id, 'media_player.kodi');
  assert.strictEqual(p.elements[0].parts.center.tap.key, 'Input.Home');
  assert.strictEqual(p.buttons.select.parts.center.hold.key, 'Input.ContextMenu');
  // up keeps page switching on tap, gains a hold action
  assert.deepStrictEqual(p.buttons.up.parts.center.tap, { action: 'page', page: 'previous' });
  assert.strictEqual(p.buttons.up.parts.center.hold.key, 'Input.Up');
  assert.strictEqual(p.buttons.down, null);
});

test('generic remote offers every platform key as a plain key action', () => {
  const lib = modelLib.platformLibrary(getAssets(), 'generic_remote');
  assert.deepStrictEqual(lib.netflix.tap_action, { action: 'key', key: 'netflix' });
  assert.strictEqual(lib.power.tap_action.key, 'power');
});

test('platform names are matched loosely', () => {
  assert.strictEqual(modelLib.platformId('LG webOS'), 'webos');
  assert.strictEqual(modelLib.platformId('lg webos'), 'webos');
  assert.strictEqual(modelLib.platformId('firetv'), 'fire_tv');
  assert.strictEqual(modelLib.platformId('Sony BRAVIA'), 'bravia');
  assert.strictEqual(modelLib.platformId(undefined), 'android_tv');
  assert.strictEqual(modelLib.platformId('toaster'), null);
});

test('a list of pages: each page has its own entity, platform and style', () => {
  const m = compile(`
- name: TV
  platform: Roku
  entity_id: media_player.roku
  style: {accent: orange, show_title: false}
  rows: [[home]]
- name: AC
  entity_id: climate.ac
  style: {theme: light}
  hold_time: 800
  rows: [[home, power]]
  custom_actions:
    - {name: power, icon: mdi:power, tap_action: {action: toggle}}
- name: Box
  remote_id: remote.box
  start: true
  rows: [[home]]
`);
  assert.deepStrictEqual(m.errors, []);
  const [tv, ac, box] = m.pages;
  assert.strictEqual(tv.ctx.platformId, 'roku');
  assert.strictEqual(tv.ctx.media_player_id, 'media_player.roku');
  assert.strictEqual(tv.style.accent, 'orange');
  assert.strictEqual(tv.style.show_title, false);
  assert.strictEqual(tv.elements[0].parts.center.tap.key, 'home');
  // the AC page has no platform, so `home` is unknown there
  assert.strictEqual(ac.ctx.platformId, null);
  assert.strictEqual(ac.elements[0].type, 'spacer');
  assert.match(m.warnings.join('\n'), /Page "AC": unknown element "home"/);
  assert.strictEqual(ac.style.theme, 'light');
  assert.strictEqual(ac.options.hold_time, 800);
  assert.strictEqual(ac.elements[1].timing.hold_time, 800);
  assert.strictEqual(ac.buttons.select, null);
  // a remote_id alone means Android TV, like the card; an entity_id alone doesn't
  assert.strictEqual(box.ctx.platformId, 'android_tv');
  assert.strictEqual(compile('- {name: S, entity_id: media_player.s, rows: []}').pages[0].ctx.platformId, null);
  assert.strictEqual(compile('- {name: S, entity_id: media_player.s, rows: []}').pages[0].ctx.media_player_id, 'media_player.s');
  assert.strictEqual(box.elements[0].parts.center.tap.key, 'HOME');
  assert.strictEqual(box.start, true);
});

test('YAML anchors share settings between pages', () => {
  const m = compile(`
- &tv
  name: One
  platform: Kodi
  media_player_id: media_player.kodi
  style: {accent: red}
  rows: [[home]]
- <<: *tv
  name: Two
  rows: [[back]]
`);
  assert.strictEqual(m.pages[1].ctx.platformId, 'kodi');
  assert.strictEqual(m.pages[1].style.accent, 'red');
  assert.strictEqual(m.pages[1].elements[0].parts.center.tap.key, 'Input.Back');
});

test('top-level settings of the older mapping format become page defaults', () => {
  const m = compile(`
theme: light
accent_color: '#ff0000'
style: {button: '#555555'}
platform: Roku
remote_id: remote.roku
pages:
  - name: A
    rows: [[home]]
  - name: B
    style: {theme: dark}
    rows: [[home]]
`);
  assert.deepStrictEqual([m.pages[0].style.theme, m.pages[0].style.accent, m.pages[0].style.button], ['light', '#ff0000', '#555555']);
  assert.deepStrictEqual([m.pages[1].style.theme, m.pages[1].style.accent], ['dark', '#ff0000']);
  assert.match(compile('- name: X\n  style: {sparkle: 1}\n  rows: []').warnings[0], /unknown style option "sparkle"/);
});
