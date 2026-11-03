# HA Remote for Pebble

A touchscreen TV / streaming-box remote for the Pebble Time 2 and Pebble Round 2. It controls
your devices through Home Assistant, and you design the layout in YAML in the same format as
[universal-remote-card](https://github.com/Nerwyn/universal-remote-card).

- **No companion app.** The phone side runs as PebbleKit JS inside the Pebble app and calls
  Home Assistant's REST API directly.
- **Settings page built in.** The settings page (connection, YAML editor, live watch preview,
  key reference) ships gzipped inside the app. It is inflated and opened when you tap the gear
  in the Pebble app, so it works without any hosted website.
- **One page per device.** Each page has its own entity (a TV, an AC, a TV box, a speaker…),
  its own buttons and its own style.
- **Touch first.** Tap, hold, hold-to-repeat, double tap, swipe, drag, sliders and a click
  wheel. Up/Down switch pages; Select runs whatever you assign to `ok` on that page.
- **Same keys as the card.** All 15 platforms of universal-remote-card are supported: Android TV,
  Fire TV, Roku, Apple TV, LG webOS, Samsung, Sony BRAVIA, Kodi, Philips, Jellyfin, Denon,
  Yamaha, Unified Remote, Unfolded Circle and Generic. Their default keys, apps and icons are
  included.

## Requirements

- A touch Pebble: **Pebble Time 2** (`emery`, 200×228) or **Pebble Round 2** (`gabbro`, 260×260).
- The current Pebble phone app from Core Devices (Android or iOS).
- Home Assistant reachable from your phone (LAN or remote URL) and a **long-lived access
  token** (Profile → Security → Long-lived access tokens).
- The integration for your TV in Home Assistant, e.g. *Android TV Remote*, *Roku*, *Apple TV*,
  *LG webOS*, *Samsung TV*, *Kodi*.

## Build and install

```sh
# once: the Pebble tool and SDK (Python 3.10–3.13)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install --python 3.13 pebble-tool
pebble sdk install latest

# in this folder
npm install
npm run build                      # regenerates embedded assets + settings page, then pebble build
pebble install --phone <PHONE_IP>  # or sideload build/pebble-ha-remote.pbw
```

Then open the app's settings in the Pebble phone app (the gear next to HA Remote):

1. Enter your Home Assistant URL (e.g. `http://homeassistant.local:8123`) and token.
2. Build your list of pages under **YAML**: start from the example, add pages from
   **Templates** (TV platforms, AC/climate, speaker), or paste universal-remote-card YAML.
   Replace the `my_…` entity ids with yours. **Keys & apps** lists every name you can use and
   your HA entities; tap one to insert it.
3. Check the preview, then tap **Save**. The watch confirms "Connected to Home Assistant"
   or shows what went wrong.

## Using the remote

| Input | Does |
|---|---|
| Tap | `tap_action` |
| Hold (500 ms) | `hold_action`. `{action: repeat}` repeats the tap while held. With no hold action, a `key` is sent as a long press (`hold_secs: 1`), like the card |
| Double tap | `double_tap_action` (only elements that define one wait for a second tap) |
| Touchpad swipe | the `up`/`down`/`left`/`right` action; keep holding to repeat it |
| Dragpad (`drag_action`) | one step every 18 px you drag |
| Circlepad | five buttons; with a `drag_action` the ring is a click wheel (one step per 20°) |
| Slider | shows the entity's current value; drag, and the new value is sent on release |
| Up / Down | previous / next page (configurable per page) |
| Select | the page's `ok` action (tap, hold and double click) |
| Back | exit |

A touch that only wakes the screen is ignored, so a sleeve brushing a dark screen doesn't press
anything.

## YAML

The config is a **list of pages**. Each page is its own remote: its own entity or TV platform,
rows, watch buttons, custom actions and style. Up/Down switch between them.

```yaml
- name: TV                          # a TV or box: platform + entities, like the card
  platform: LG webOS
  media_player_id: media_player.living_room_tv
  style: {accent: '#ff5500'}
  ok: center                        # Select button: any element name, or actions
  rows:
    - [power, home, back, menu]
    - [touchpad]
    - [volume_down, volume_mute, volume_up]

- name: AC                          # anything else: the page's entity
  entity_id: climate.living_room_ac
  style: {theme: light, accent: '#0055ff'}
  ok: power
  rows:
    - [power, cool]
    - [temperature]
  custom_actions:
    - name: power
      icon: mdi:power
      tap_action: {action: toggle}  # no target: uses the page entity
    - name: cool
      icon: mdi:snowflake
      tap_action: {action: perform-action, perform_action: climate.set_hvac_mode, data: {hvac_mode: cool}}
    - type: slider                  # shows the set temperature, drag to change it
      name: temperature
      icon: mdi:thermometer
      value_attribute: temperature
      unit_of_measurement: '°'
      range: [16, 30]
      step: 0.5
      tap_action:
        action: perform-action
        perform_action: climate.set_temperature
        data: {temperature: '{{ value }}'}

- name: TV box
  platform: Android TV
  remote_id: remote.tv_box
  ok: play_pause
  rows:
    - [back, home, play_pause, power]
    - [touchpad]
    - [netflix, youtube, plex]
```

The full version is [`examples/default.yaml`](examples/default.yaml). The settings page has
templates for every TV platform, an AC/climate page and a speaker page, which you can add to
your list one at a time.

### Page keys

| Key | Meaning |
|---|---|
| `name` | Title shown on the watch |
| `rows` | The layout, exactly like the card: each entry is a row, a nested list is a column, then a row again. `null` / `''` leaves a gap. Shortcuts: `volume_buttons`, `navigation_buttons`, `dpad`, `numpad`, `dialpad`, `xpad`, `npad` |
| `entity_id` | The page's main entity. Actions without a target use it: `toggle`, and `perform-action` in the same domain (e.g. `climate.*` on a `climate.` entity). So do sliders and `config.entity` in templates. A `remote.` / `media_player.` entity also fills `remote_id` / `media_player_id` |
| `platform`, `remote_id`, `media_player_id`, `keyboard_id`, `config_entry_id`, `device`, `mac` | As in the card. A page with a platform, or an explicit `remote_id` / `media_player_id` (Android TV by default, like the card), gets that platform's built-in keys and apps. Other pages only use their `custom_actions` |
| `custom_actions` | Elements for this page (they override built-in names) |
| `ok`, `up`, `down` | Watch buttons: an element name, `none`, or `tap_action` / `hold_action` / `double_tap_action`. Up/Down switch pages on tap unless you set their `tap_action` |
| `style` | See below |
| `haptics`, `hold_time`, `repeat_delay`, `double_tap_window` | As in the card, per page |
| `start: true` | Open this page first (otherwise the last page used) |

```yaml
style:
  theme: dark          # base palette: dark (default) or light
  accent: '#00aaff'    # pressed buttons, slider fill, current page dot
  background: black    # page background
  button: '#555555'    # button background
  text: white          # icons and labels
  pad: '#005555'       # touchpad / circlepad background
  title: '#aaaaaa'     # page name and dots
  show_title: true     # title bar (page name + dots)
```

Colors are `#rgb`, `#rrggbb`, `rgb()` or names, mapped to the Pebble's 64 colors. Single
elements can also set `color` and `background`.

To share settings between pages, use YAML anchors:

```yaml
- &tv
  name: TV
  platform: Roku
  remote_id: remote.roku
  style: {accent: purple}
  rows: [[home, back], [touchpad]]
- <<: *tv                           # same device and style...
  name: TV apps                     # ...different name and rows
  rows: [[netflix, youtube, plex]]
```

A plain universal-remote-card config still works (one page), and so does the earlier
`pages:` mapping format, where top-level keys act as defaults for every page.

### Elements, actions and templates

**Elements:** `button` (default), `touchpad`, `circlepad` and `slider` (`range`, `step`,
`vertical`, `entity_id`, `value_attribute`, `unit_of_measurement`). Sliders show the entity's
current value, e.g. "22.5°" (or a percentage for a 0–1 range), and refresh after each action
on the page. Elements can also set `width` / `height` (their share of a row / column; default 1,
touchpad/circlepad 3), `color` / `background`, or be written inline in `rows`:
`- {name: x, icon: mdi:y, tap_action: …}`.

**Actions:** `key`, `source`, `perform-action` / `call-service`, `toggle`, `repeat`, `none`,
`keyboard` / `textbox` / `search` (you dictate on the watch), plus `page`
(`page: next | previous | 2 | Name`). A list of actions runs in order.

**Templates:**
- Expressions: `{{ value }}`, arithmetic, comparisons, `x if c else y`, and the filters
  `| float`, `| int`, `| round(n)` and `| abs`.
- Home Assistant state, read when the action runs: `states('sensor.x')`,
  `state_attr(config.entity, 'temperature')`, `is_state(…)` and `is_state_attr(…)`.
- Variables: `value`, `clockwise`, `deltaX`, `deltaY` and `config`.

**Not available on a watch:**
- actions: `more-info`, `navigate`, `url`, `assist`, `fire-dom-event`, `eval`, multi-finger
  and momentary actions
- CSS `styles`
- labels on circlepad directions (give them an `icon`)

Icons: any `mdi:` icon works. About 400 common ones and the card's 52 brand logos are bundled;
the phone loads any others once from your Home Assistant server (the icon files its own frontend
ships under `/static/mdi/`) and caches them. The app connects to nothing but Home Assistant: it declares only the
`Internet` and `LocalNetwork` permissions (manifest version 2), so a Home Assistant URL on your
home network or on the internet both work, and no location or timeline access is requested.

## Languages

The watch, the toasts and the settings page are available in English, French, Arabic, Turkish,
German, Dutch, Spanish and Indonesian. **Language** in the settings defaults to *Automatic*: the
watch follows its system language and the settings page the phone's. Pick a language there to
use it on both. Your own labels and page names from the YAML are never translated.

The watch shows English when its font can't draw the language: Arabic needs firmware 4.20 or
later with an Arabic language pack, and Turkish letters (ğ, ı, ş) need a font that has them. The
watch checks this itself and the settings page says so.

To add a language:

1. Copy `src/pkjs/lang/en.js` to `src/pkjs/lang/<code>.js` and translate it (phone messages and
   the settings page; keep `{placeholders}`, `<code>` and `` `backtick` `` parts as they are).
2. Add the code to `LANGS` and `NAMES` in `src/pkjs/lib/i18n.js`, and the same code, in the same
   position, to `LANG_CODES`, the `L_…` enum and the `STRS` table in `src/c/i18n.c` (the
   watch's own strings).
3. `npm run gen` (packs the translations into `src/pkjs/generated/strings.js`), then `npm test`:
   it checks that every language has every string.

## How it works

```
 watch (C)                       phone: PebbleKit JS                     Home Assistant
 ─────────                       ───────────────────                     ──────────────
 draws packed layout   ◄─ layout ─  YAML ─► model ─► layout ─► pack
 touch/buttons ─► gestures ─ event ─►  resolve action ─► service call ──► REST /api/services
 toasts, sliders       ◄─ state ──  GET /api/states  ◄──────────────────
 1 MB persist: layout + settings backup ◄──► restored if Android wipes PKJS storage
```

- **Phone (`src/pkjs/`)** compiles the YAML config into pages (`lib/model.js`) and lays them out
  for the watch's screen (`lib/layout.js`). On round screens each row is narrowed to fit the
  circle. It then rasterizes icons to 2-bit anti-aliased bitmaps in pure JS (`lib/raster.js`),
  packs everything into a compact binary (`lib/pack.js`) and sends it only when its hash
  changed. Events from the watch go through `lib/actions.js` (the card's per-platform key and
  source mapping) and `lib/ha.js` (XHR, iOS-safe).
- **Watch (`src/c/`)** stores the layout in persistent storage, so it appears instantly. It
  draws it (`render.c`), recognizes gestures from the raw touch stream (`main.c`) and talks to
  the phone (`comm.c`). It also keeps a copy of your settings, because the Android Pebble app
  can lose PebbleKit JS storage when it's killed. The phone restores from that copy
  automatically.
- **Settings page (`config/`)** is bundled by esbuild, gzipped and embedded as base64
  (`src/pkjs/generated/config_page.js`, about 55 KB). When opened, the phone inflates it with a
  small built-in inflater (`lib/inflate.js`; iOS has no `DecompressionStream`), injects your
  settings and opens it as a `data:` URL. The preview decodes the exact bytes the watch gets.

## Development

```sh
npm test              # unit tests (config compiler, actions, layout/pack, inflate, templates, translations)
npm run gen           # rebuild generated assets, translations + settings page
npm run preview       # also writes config/preview.html to open in a desktop browser
npm run import-urc -- /path/to/universal-remote-card   # refresh key maps from a card checkout
npm run icon          # regenerate the launcher icon
```

### Emulator

Tools in `tools/dev/` run the emulator without installing system packages. Everything they
download goes to `.dev/` (gitignored, safe to delete).

```sh
bash tools/dev/setup-emulator-libs.sh            # once: qemu's libraries into .dev/
python3 tools/dev/mock_ha.py &                   # fake Home Assistant on :8123, logs to .dev/calls.jsonl
tools/dev/peb.sh kill
python3 tools/dev/seed_settings.py emery examples/default.yaml   # settings (URL + token + config)
tools/dev/peb.sh install --emulator emery --vnc
python3 tools/dev/touch.py tap 120 40            # touch the screen (watch pixels)
python3 tools/dev/touch.py swipe 100 120 100 70
tools/dev/peb.sh emu-button --emulator emery --vnc click down
tools/dev/peb.sh screenshot --emulator emery --vnc --no-open .dev/shot.png
~/.local/share/uv/tools/pebble-tool/bin/python tools/dev/emu_logs.py emery 10   # watch + phone logs
```

Settings page browser test (headless Chromium in `.dev/`):

```sh
bash tools/dev/setup-browser.sh
LD_LIBRARY_PATH=.dev/emu-libs/root/usr/lib/x86_64-linux-gnu node tools/dev/page-test.js
```

Emulator notes:

- Always pass `--vnc` to emulator commands. Mixing VNC and non-VNC commands restarts the
  emulator.
- Touch goes through the VNC display. The QEMU monitor's `mouse_move` only sends relative
  motion, which the touch device ignores.
- **Saving settings from `pebble emu-app-config` doesn't work with pebble-tool 5.0.40.** Its
  pypkjs passes the page's response to JavaScript as Python `bytes`, so `webviewclosed` never
  fires (this affects every app). Real phones are fine; `seed_settings.py` writes the settings
  directly instead.

## Credits

Platform key/source maps and brand icons come from
[universal-remote-card](https://github.com/Nerwyn/universal-remote-card) (Apache-2.0). Icons are
[Material Design Icons](https://pictogrammers.com/library/mdi/) (Apache-2.0), and the YAML parser
is [js-yaml](https://github.com/nodeca/js-yaml) (MIT). See [NOTICE](NOTICE).
