#!/usr/bin/env node
// Drives the settings page in headless Chromium (set up with tools/dev/setup-browser.sh) the way
// the phone opens it: inflated from the bundle, settings injected, opened as a data: URL.
// usage: LD_LIBRARY_PATH=.dev/emu-libs/root/usr/lib/x86_64-linux-gnu node tools/dev/page-test.js
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const DEV = path.join(ROOT, '.dev');
const { chromium } = require(path.join(DEV, 'browser/node_modules/playwright-core'));
const inflate = require(path.join(ROOT, 'src/pkjs/lib/inflate'));
const ASSETS = require(path.join(ROOT, 'src/pkjs/generated/assets'));
const PAGE = require(path.join(ROOT, 'src/pkjs/generated/config_page'));
const DEF = require(path.join(ROOT, 'src/pkjs/generated/default_config'));
const STRINGS = require(path.join(ROOT, 'src/pkjs/generated/strings'));

function buildHtml(init) {
  const json = JSON.stringify(init).replace(/</g, '\\u003c');
  return inflate.gunzipBase64ToString(PAGE).replace('"__PEBBLE_INIT__"', () => json);
}

async function main() {
  let saved = null;
  const server = http.createServer((req, res) => { saved = req.url; res.end('OK'); });
  await new Promise((r) => server.listen(0, r));

  const browser = await chromium.launch({
    executablePath: fs.readdirSync(path.join(DEV, 'browser/browsers'))
      .filter((d) => d.startsWith('chromium_headless_shell'))
      .map((d) => path.join(DEV, 'browser/browsers', d, 'chrome-linux/headless_shell'))[0],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const init = {
    version: 'test', settings: { url: 'http://ha.local:8123', token: 't' }, yaml: DEF.yaml, defaultYaml: DEF.yaml,
    platform: 'emery', screen: null, iconCache: {}, assets: ASSETS, strings: STRINGS,
    entities: [{ id: 'climate.living_room_ac', name: 'AC' }],
  };
  const html = buildHtml(init);
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await page.waitForTimeout(800);
  const tabs = () => page.$$eval('#pageTabs .tab', (els) => els.map((e) => e.textContent));
  const problems = () => page.$eval('#problems', (e) => (e.hidden ? '' : e.innerText.replace(/\n/g, ' ')));
  const shot = async (name) => {
    await page.$eval('.stage', (e) => e.scrollIntoView());
    await page.screenshot({ path: path.join(DEV, name) });
  };

  assert.deepStrictEqual(await tabs(), ['TV', 'AC', 'TV box']);
  assert.strictEqual(await problems(), '');
  await page.click('#pageTabs .tab:nth-child(2)');
  await page.waitForTimeout(200);
  const info = await page.$eval('#pageInfo', (e) => e.textContent);
  assert.strictEqual(info, 'No platform · climate.living_room_ac');
  await shot('settings_ac.png');

  // inspector on the AC slider
  const box = await page.$eval('#screen', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
  await page.mouse.click(box.x + (100 / box.cw) * box.w, box.y + (122 / box.ch) * box.h);
  const insp = (await page.$eval('#inspect', (e) => e.innerText)).replace(/\n/g, ' | ');
  assert.match(insp, /climate\.living_room_ac · temperature · 16–30/);
  console.log('AC slider inspector:', insp);

  // add Roku pages to the list
  await page.selectOption('#templateSel', 'roku');
  assert.strictEqual(await page.$eval('#templateAdd', (e) => e.disabled), false);
  await page.click('#templateAdd');
  await page.waitForTimeout(400);
  assert.deepStrictEqual(await tabs(), ['TV', 'AC', 'TV box', 'Roku', 'Roku media', 'Roku apps']);
  assert.strictEqual(await problems(), '');
  assert.strictEqual(await page.$eval('#pageTabs .tab.active', (e) => e.textContent), 'Roku');

  // add a climate page and a speaker page
  for (const id of ['climate', 'speaker']) {
    await page.selectOption('#templateSel', id);
    await page.click('#templateAdd');
    await page.waitForTimeout(300);
  }
  assert.strictEqual((await tabs()).length, 8);
  assert.strictEqual(await problems(), '');
  await page.click('#pageTabs .tab:nth-child(8)');
  await page.waitForTimeout(200);
  await shot('settings_speaker.png');

  // replace everything
  await page.selectOption('#templateSel', 'kodi');
  await page.click('#templateReplace');
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await tabs(), ['Kodi', 'Kodi media', 'Kodi apps']);

  // the older mapping format can't take appended pages
  await page.$eval('#yaml', (e) => { e.value = 'platform: Roku\nremote_id: remote.r\npages:\n  - name: A\n    rows: [[home]]\n'; e.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(400);
  await page.selectOption('#templateSel', 'climate');
  assert.strictEqual(await page.$eval('#templateAdd', (e) => e.disabled), true);
  assert.match(await page.$eval('#templateHint', (e) => e.textContent), /list of pages/);
  assert.deepStrictEqual(await tabs(), ['A']);

  // save goes back through return_to
  const file = path.join(DEV, 'page_under_test.html');
  fs.writeFileSync(file, html);
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto('file://' + file + '?return_to=' + encodeURIComponent('http://localhost:' + server.address().port + '/close?'));
  await p2.waitForTimeout(500);
  await p2.click('#save');
  await p2.waitForTimeout(800);
  const payload = JSON.parse(decodeURIComponent(saved.split('?')[1]));
  assert.ok(Array.isArray(payload.config) && payload.config.length === 3);
  fs.unlinkSync(file);

  assert.deepStrictEqual(errors, []);
  console.log('settings page: all checks passed');
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
