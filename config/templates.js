// Page templates for the settings page. Each returns YAML text for one or more pages
// (list items at the root), so they can be appended to the user's list of pages.
'use strict';

var modelLib = require('../src/pkjs/lib/model');

function row(names) {
  return names.length ? '    - [' + names.join(', ') + ']' : null;
}

// A TV / streaming box: a remote page, a media page and an apps page.
function platformPages(assets, pid) {
  var lib = modelLib.platformLibrary(assets, pid);
  var plat = assets.platforms[pid] || { sources: [] };
  var has = function (n) { return !!lib[n]; };
  var pick = function (list) { return list.filter(has); };
  var name = modelLib.PLATFORM_NAMES[pid];
  var short = name.replace(/^(Sony|LG|Unfolded) /, '');
  var keyByMediaPlayer = ['kodi', 'webos', 'denon_avr'].indexOf(pid) >= 0;
  var head = ['  platform: ' + name];
  if (!keyByMediaPlayer || pid === 'kodi') head.push('  remote_id: remote.my_' + pid);
  head.push('  media_player_id: media_player.my_' + pid);
  if (pid === 'fire_tv' || pid === 'bravia') head.push('  keyboard_id: media_player.my_' + pid + '_adb');

  var out = [];
  var page = function (title, extra, rows) {
    rows = rows.filter(Boolean);
    if (!rows.length) return;
    out.push('- name: ' + title);
    head.forEach(function (l) { out.push(l); });
    (extra || []).forEach(function (l) { out.push(l); });
    out.push('  rows:');
    rows.forEach(function (r) { out.push(r); });
    out.push('');
  };

  page(short, [has('center') ? '  ok: center' : '  ok: none'], [
    row(pick(['back', 'home', 'menu', 'power'])),
    has('touchpad') ? '    - [touchpad]' : row(pick(['dpad'])),
    row(pick(['volume_down', 'volume_mute', 'volume_up'])),
  ]);
  var media = pick(['previous', 'skip_backward', 'rewind']).slice(0, 1)
    .concat(pick(['play_pause']))
    .concat(pick(['next', 'skip_forward', 'fast_forward']).slice(0, 1));
  var more = pick(['rewind', 'stop', 'fast_forward']);
  page(short + ' media', has('play_pause') ? ['  ok: play_pause'] : [], [
    row(media),
    more.length > 1 ? row(more) : null,
    has('slider') ? '    - [slider]' : null,
  ]);
  var apps = (plat.sources || []).slice(0, 9).map(function (s) { return s.name; });
  var appRows = [];
  for (var i = 0; i < apps.length; i += 3) appRows.push(row(apps.slice(i, i + 3)));
  page(short + ' apps', [], appRows);
  return out.join('\n');
}

var CLIMATE = [
  '- name: AC',
  '  entity_id: climate.my_ac',
  '  style:',
  '    theme: light',
  "    accent: '#0055ff'",
  '  ok: power',
  '  rows:',
  '    - [power, cool, heat, fan_only]',
  '    - [temperature]',
  '    - [temp_down, temp_up]',
  '  custom_actions:',
  '    - name: power',
  '      icon: mdi:power',
  '      tap_action: {action: toggle}',
  '    - name: cool',
  '      icon: mdi:snowflake',
  '      tap_action: {action: perform-action, perform_action: climate.set_hvac_mode, data: {hvac_mode: cool}}',
  '    - name: heat',
  '      icon: mdi:fire',
  '      tap_action: {action: perform-action, perform_action: climate.set_hvac_mode, data: {hvac_mode: heat}}',
  '    - name: fan_only',
  '      icon: mdi:fan',
  '      tap_action: {action: perform-action, perform_action: climate.set_hvac_mode, data: {hvac_mode: fan_only}}',
  '    - type: slider',
  '      name: temperature',
  '      icon: mdi:thermometer',
  '      value_attribute: temperature',
  "      unit_of_measurement: '°'",
  '      range: [16, 30]',
  '      step: 0.5',
  '      tap_action:',
  '        action: perform-action',
  '        perform_action: climate.set_temperature',
  "        data: {temperature: '{{ value }}'}",
  '    - name: temp_down',
  '      icon: mdi:minus',
  '      tap_action:',
  '        action: perform-action',
  '        perform_action: climate.set_temperature',
  "        data: {temperature: \"{{ state_attr(config.entity, 'temperature') | float - 0.5 }}\"}",
  '    - name: temp_up',
  '      icon: mdi:plus',
  '      tap_action:',
  '        action: perform-action',
  '        perform_action: climate.set_temperature',
  "        data: {temperature: \"{{ state_attr(config.entity, 'temperature') | float + 0.5 }}\"}",
  '',
].join('\n');

var SPEAKER = [
  '- name: Speaker',
  '  entity_id: media_player.my_speaker',
  '  style:',
  "    accent: '#55aa00'",
  '  ok: play_pause',
  '  rows:',
  '    - [previous, play_pause, next]',
  '    - [volume]',
  '  custom_actions:',
  '    - name: previous',
  '      icon: mdi:skip-previous',
  '      tap_action: {action: perform-action, perform_action: media_player.media_previous_track}',
  '    - name: play_pause',
  '      icon: mdi:play-pause',
  '      tap_action: {action: perform-action, perform_action: media_player.media_play_pause}',
  '    - name: next',
  '      icon: mdi:skip-next',
  '      tap_action: {action: perform-action, perform_action: media_player.media_next_track}',
  '    - type: slider',
  '      name: volume',
  '      icon: mdi:volume-high',
  '      value_attribute: volume_level',
  '      range: [0, 1]',
  '      step: 0.01',
  '      tap_action:',
  '        action: perform-action',
  '        perform_action: media_player.volume_set',
  "        data: {volume_level: '{{ value }}'}",
  '',
].join('\n');

// [{ id, label, yaml(assets) }]
function list() {
  var out = [
    { id: 'climate', label: 'Air conditioner / climate', yaml: function () { return CLIMATE; } },
    { id: 'speaker', label: 'Speaker / any media player', yaml: function () { return SPEAKER; } },
  ];
  Object.keys(modelLib.PLATFORM_NAMES).forEach(function (pid) {
    if (pid === 'generic_remote') return;
    out.push({
      id: pid,
      label: modelLib.PLATFORM_NAMES[pid] + ' (remote, media, apps)',
      yaml: function (assets) { return platformPages(assets, pid); },
    });
  });
  return out;
}

// Appends page YAML to a config whose root is a list of pages.
function appendPages(text, pagesYaml) {
  var t = text.replace(/\s+$/, '');
  return (t ? t + '\n\n' : '') + pagesYaml.replace(/\s+$/, '') + '\n';
}

module.exports = { list: list, appendPages: appendPages, platformPages: platformPages };
