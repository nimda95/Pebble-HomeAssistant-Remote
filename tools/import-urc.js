#!/usr/bin/env node
// Imports the default key/source maps and brand icons from a checkout of
// https://github.com/Nerwyn/universal-remote-card (Apache-2.0) into data/urc.json.
//
// Usage: node tools/import-urc.js <path-to-universal-remote-card-checkout>
//
// The map files are TypeScript modules that export one array literal each. We strip the
// import line and type annotation, then evaluate the literal in an empty vm context.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = process.argv[2];
if (!repo) {
  console.error('usage: node tools/import-urc.js <universal-remote-card checkout>');
  process.exit(1);
}
const mapsDir = path.join(repo, 'src/models/maps');

function evalLiteral(file, typeName) {
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^import[^\n]*\n/gm, '');
  const re = new RegExp('export const (\\w+)\\s*:\\s*' + typeName + '\\[\\]\\s*=\\s*');
  const m = src.match(re);
  if (!m) throw new Error('no exported array in ' + file);
  const body = src.slice(m.index + m[0].length).replace(/;\s*$/, '');
  return vm.runInNewContext('(' + body + ')', Object.create(null), { timeout: 2000 });
}

// CSS styles are meaningless on a watch, so drop them to keep the bundle small.
function strip(o) {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) {
      if (k === 'styles') continue;
      out[k] = strip(o[k]);
    }
    return out;
  }
  return o;
}

const platforms = {};
for (const dir of fs.readdirSync(mapsDir).sort()) {
  const full = path.join(mapsDir, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  const entry = { keys: [], sources: [] };
  const keysFile = path.join(full, 'defaultKeys.ts');
  const sourcesFile = path.join(full, 'defaultSources.ts');
  if (fs.existsSync(keysFile)) entry.keys = strip(evalLiteral(keysFile, 'IElementConfig'));
  if (fs.existsSync(sourcesFile)) entry.sources = strip(evalLiteral(sourcesFile, 'IElementConfig'));
  platforms[dir] = entry;
  console.log(dir.padEnd(16), 'keys', String(entry.keys.length).padStart(3), 'sources', String(entry.sources.length).padStart(3));
}

const iconList = evalLiteral(path.join(mapsDir, 'defaultIcons.ts'), 'IIconConfig');
const icons = {};
for (const i of iconList) icons[i.name] = i.path;
console.log('brand icons', Object.keys(icons).length);

let version = 'unknown';
try {
  version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
} catch (e) { /* ignore */ }

const out = {
  source: 'https://github.com/Nerwyn/universal-remote-card',
  license: 'Apache-2.0',
  version: version,
  platforms: platforms,
  icons: icons,
};
const dest = path.join(__dirname, '..', 'data', 'urc.json');
fs.writeFileSync(dest, JSON.stringify(out) + '\n');
console.log('wrote', dest, fs.statSync(dest).size, 'bytes (universal-remote-card ' + version + ')');
