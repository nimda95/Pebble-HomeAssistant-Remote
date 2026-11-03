'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { getAssets, yaml } = require('./helpers');
const modelLib = require('../src/pkjs/lib/model');
const actions = require('../src/pkjs/lib/actions');
const template = require('../src/pkjs/lib/template');

const G = actions.G;

function setup(src) {
  const m = modelLib.compile(yaml.load(src), getAssets());
  assert.deepStrictEqual(m.errors, []);
  return m;
}

// Plans the steps for a gesture on element `name` of page 0.
function plan(m, name, part, gesture, value, extraVars) {
  const page = m.pages[0];
  const el = name in { select: 1, up: 1, down: 1 } ? page.buttons[name] : page.elements.find((e) => e.name === name);
  const r = actions.resolve(el, part || 0, gesture || G.TAP, value);
  if (!r) return null;
  return actions.planAction(r.action, page.ctx, el, Object.assign({}, r.vars, extraVars || {}), r.holdFallback);
}

const svc = (domain, service, data) => ({ type: 'service', domain, service, data });

test('key actions map to the right service per platform', () => {
  const cases = [
    ['Android TV', 'remote_id: remote.tv', 'home', svc('remote', 'send_command', { entity_id: 'remote.tv', command: 'HOME' })],
    ['Roku', 'remote_id: remote.roku', 'home', svc('remote', 'send_command', { entity_id: 'remote.roku', command: 'home' })],
    ['Kodi', 'media_player_id: media_player.kodi', 'home', svc('kodi', 'call_method', { entity_id: 'media_player.kodi', method: 'Input.Home' })],
    ['LG webOS', 'media_player_id: media_player.lg', 'home', svc('webostv', 'button', { entity_id: 'media_player.lg', button: 'HOME' })],
    ['Samsung TV', 'remote_id: remote.sam', 'home', svc('remote', 'send_command', { entity_id: 'remote.sam', command: 'KEY_HOME' })],
  ];
  for (const [platform, ids, name, expected] of cases) {
    const m = setup(`platform: ${platform}\n${ids}\nrows: [[${name}]]`);
    assert.deepStrictEqual(plan(m, name), [expected], platform);
  }
});

test('holding a key without hold_action sends a long press (hold_secs)', () => {
  const m = setup('remote_id: remote.tv\nrows: [[home]]');
  assert.deepStrictEqual(plan(m, 'home', 0, G.HOLD), [svc('remote', 'send_command', { entity_id: 'remote.tv', command: 'HOME', hold_secs: 1 })]);
});

test('repeat holds repeat the tap; double tap falls back to tap', () => {
  const m = setup('remote_id: remote.tv\nrows: [[volume_up]]');
  const tap = [svc('remote', 'send_command', { entity_id: 'remote.tv', command: 'VOLUME_UP' })];
  assert.deepStrictEqual(plan(m, 'volume_up', 0, G.REPEAT), tap);
  assert.deepStrictEqual(plan(m, 'volume_up', 0, G.DOUBLE), tap);
  assert.deepStrictEqual(plan(m, 'volume_up', 0, G.HOLD), []); // `repeat` itself does nothing
});

test('source actions per platform', () => {
  let m = setup('remote_id: remote.tv\nrows: [[netflix]]');
  assert.deepStrictEqual(plan(m, 'netflix'), [svc('remote', 'turn_on', { entity_id: 'remote.tv', activity: 'netflix://' })]);
  m = setup('platform: Roku\nmedia_player_id: media_player.roku\nrows: [[netflix]]');
  assert.deepStrictEqual(plan(m, 'netflix'), [svc('media_player', 'select_source', { entity_id: 'media_player.roku', source: 'Netflix' })]);
});

test('perform-action renders templates and autofills the target', () => {
  const m = setup(`
media_player_id: media_player.tv
rows: [[vol]]
custom_actions:
  - type: slider
    name: vol
    range: [0, 1]
    tap_action:
      action: perform-action
      perform_action: media_player.volume_set
      data: {volume_level: '{{ value | float }}'}
`);
  assert.deepStrictEqual(plan(m, 'vol', 0, G.SLIDE, 0.42), [svc('media_player', 'volume_set', { volume_level: 0.42, entity_id: 'media_player.tv' })]);
});

test('touchpad swipes, dragpad steps and clickwheel rotation', () => {
  const m = setup('remote_id: remote.tv\nrows: [[touchpad, dragpad, clickwheel]]');
  assert.strictEqual(plan(m, 'touchpad', 1, G.TAP)[0].data.command, 'DPAD_UP');
  assert.strictEqual(plan(m, 'touchpad', 4, G.REPEAT)[0].data.command, 'DPAD_RIGHT');
  assert.strictEqual(plan(m, 'touchpad', 0, G.TAP)[0].data.command, 'DPAD_CENTER');
  assert.strictEqual(plan(m, 'dragpad', 3, G.DRAG)[0].data.command, 'DPAD_LEFT');
  assert.strictEqual(plan(m, 'dragpad', 2, G.DRAG)[0].data.command, 'DPAD_DOWN');
  assert.strictEqual(plan(m, 'clickwheel', 0, G.ROTATE, 1)[0].data.command, 'VOLUME_UP');
  assert.strictEqual(plan(m, 'clickwheel', 0, G.ROTATE, 0)[0].data.command, 'VOLUME_DOWN');
  assert.strictEqual(plan(m, 'clickwheel', 1, G.TAP)[0].data.command, 'MENU');
});

test('toggle, page and lists of actions', () => {
  const m = setup(`
rows: [[a, b, c]]
custom_actions:
  - name: a
    tap_action: {action: toggle, target: {entity_id: [light.x, lock.door, button.y]}}
  - name: b
    tap_action: {action: page, page: Apps}
  - name: c
    tap_action:
      - {action: perform-action, perform_action: script.turn_on, target: {entity_id: script.movie}}
      - {action: page, page: next}
`);
  assert.deepStrictEqual(plan(m, 'a'), [
    svc('homeassistant', 'toggle', { entity_id: 'light.x' }),
    { type: 'lock_toggle', entity_id: 'lock.door' },
    svc('button', 'press', { entity_id: 'button.y' }),
  ]);
  assert.deepStrictEqual(plan(m, 'b'), [{ type: 'page', page: 'Apps' }]);
  assert.deepStrictEqual(plan(m, 'c'), [svc('script', 'turn_on', { entity_id: 'script.movie' }), { type: 'page', page: 'next' }]);
});

test('keyboard actions ask the watch to dictate, then send text', () => {
  const m = setup('remote_id: remote.tv\nkeyboard_id: media_player.adb\nrows: [[keyboard, search]]');
  const first = plan(m, 'keyboard');
  assert.strictEqual(first[0].type, 'dictate');
  const page = m.pages[0];
  const kb = page.elements.find((e) => e.name === 'keyboard');
  assert.deepStrictEqual(actions.planAction(first[0].action, page.ctx, kb, { text: 'star wars' }), [
    svc('remote', 'send_command', { entity_id: 'remote.tv', command: 'text:star wars' }),
  ]);
  const search = page.elements.find((e) => e.name === 'search');
  const steps = actions.planAction(search.parts.center.tap, page.ctx, search, { text: 'say "hi"' });
  assert.strictEqual(steps[0].domain, 'androidtv');
  assert.match(steps[0].data.command, /--es query "say \\"hi\\""/);
});

test('missing entities and unsupported actions give clear errors', () => {
  let m = setup('platform: Android TV\nrows: [[home]]');
  assert.throws(() => plan(m, 'home'), /Set remote_id for Android TV/);
  m = setup('- name: AC\n  entity_id: climate.ac\n  rows: [[x]]\n  custom_actions: [{name: x, tap_action: {action: key, key: POWER}}]');
  assert.throws(() => plan(m, 'x'), /need a `platform`/);
  m = setup('rows: [[x]]\ncustom_actions: [{name: x, tap_action: {action: more-info}}]');
  assert.throws(() => plan(m, 'x'), /not available on the watch/);
});

test('templates', () => {
  const v = { value: 0.5, clockwise: false, deltaX: 3, deltaY: -10 };
  assert.strictEqual(template.renderString('{{ value | float }}', v), 0.5);
  assert.strictEqual(template.renderString('{{ (value * 100) | int }}%', v), '50%');
  assert.strictEqual(template.renderString('VOL{{ "UP" if clockwise else "DOWN" }}', v), 'VOLDOWN');
  assert.strictEqual(template.renderString('{{ ("R" if deltaX > 0 else "L") if (deltaX | abs) > (deltaY | abs) else ("D" if deltaY > 0 else "U") }}', v), 'U');
  assert.strictEqual(template.renderString('{{ value | round(0) }}', { value: 2.5 }), 3);
  assert.strictEqual(template.renderString('{{ not value }}', v), false);
  assert.throws(() => template.renderString('{{ states("x") }}', v), /unsupported template function/);
  assert.throws(() => template.renderString('{% if x %}', v), /not supported/);
  assert.deepStrictEqual(template.render({ a: ['{{ value * 2 }}'], b: 'x' }, v), { a: [1], b: 'x' });
});

test('a page entity is the default target', () => {
  const m = setup(`
- name: AC
  entity_id: climate.ac
  rows: [[power, mode, other, slide]]
  custom_actions:
    - {name: power, tap_action: {action: toggle}}
    - {name: mode, tap_action: {action: perform-action, perform_action: climate.set_hvac_mode, data: {hvac_mode: cool}}}
    - {name: other, tap_action: {action: perform-action, perform_action: script.turn_on, target: {entity_id: script.x}}}
    - {name: slide, type: slider, range: [16, 30], step: 0.5, value_attribute: temperature,
       tap_action: {action: perform-action, perform_action: climate.set_temperature, data: {temperature: '{{ value }}'}}}
`);
  assert.deepStrictEqual(plan(m, 'power'), [svc('homeassistant', 'toggle', { entity_id: 'climate.ac' })]);
  assert.deepStrictEqual(plan(m, 'mode'), [svc('climate', 'set_hvac_mode', { hvac_mode: 'cool', entity_id: 'climate.ac' })]);
  assert.deepStrictEqual(plan(m, 'other'), [svc('script', 'turn_on', { entity_id: 'script.x' })]);
  assert.deepStrictEqual(plan(m, 'slide', 0, G.SLIDE, 21.5), [svc('climate', 'set_temperature', { temperature: 21.5, entity_id: 'climate.ac' })]);
  assert.strictEqual(m.pages[0].elements[3].entity_id, 'climate.ac');
});

test('templates can read Home Assistant state', async () => {
  const m = setup(`
- name: AC
  entity_id: climate.ac
  rows: [[up, mode]]
  custom_actions:
    - name: up
      tap_action:
        action: perform-action
        perform_action: climate.set_temperature
        data: {temperature: "{{ state_attr(config.entity, 'temperature') | float + 0.5 }}"}
    - name: mode
      tap_action:
        action: perform-action
        perform_action: climate.set_hvac_mode
        data: {hvac_mode: "{{ 'heat' if is_state('climate.ac', 'cool') else 'cool' }}"}
`);
  const states = { 'climate.ac': { state: 'cool', attributes: { temperature: 21 } } };
  const fetched = [];
  const getState = (id, cb) => { fetched.push(id); setImmediate(() => (states[id] ? cb(null, states[id]) : cb(new Error('Unknown entity ' + id)))); };
  const page = m.pages[0];
  const run = (name) => new Promise((resolve, reject) => {
    const el = page.elements.find((e) => e.name === name);
    actions.planWithStates(el.parts.center.tap, page.ctx, el, {}, false, getState, (err, steps) => (err ? reject(err) : resolve(steps)));
  });
  assert.deepStrictEqual(await run('up'), [svc('climate', 'set_temperature', { temperature: 21.5, entity_id: 'climate.ac' })]);
  assert.deepStrictEqual(await run('mode'), [svc('climate', 'set_hvac_mode', { hvac_mode: 'heat', entity_id: 'climate.ac' })]);
  assert.deepStrictEqual(fetched, ['climate.ac', 'climate.ac']);
  // no state needed: no fetch
  const plain = await new Promise((resolve) => actions.planWithStates({ action: 'toggle' }, page.ctx, null, {}, false, getState, (e, st) => resolve(st)));
  assert.deepStrictEqual(plain, [svc('homeassistant', 'toggle', { entity_id: 'climate.ac' })]);
  assert.strictEqual(fetched.length, 2);
  // unknown entity -> error
  await assert.rejects(new Promise((resolve, reject) => actions.planWithStates(
    { action: 'perform-action', perform_action: 'light.turn_on', data: { brightness: "{{ states('light.nope') }}" } },
    page.ctx, null, {}, false, getState, (err, st) => (err ? reject(err) : resolve(st)))), /Unknown entity light.nope/);
});
