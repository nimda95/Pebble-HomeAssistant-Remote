'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const inflate = require('../src/pkjs/lib/inflate');

let assets = null;
function getAssets() {
  if (!assets) assets = JSON.parse(inflate.gunzipBase64ToString(require('../src/pkjs/generated/assets')));
  return assets;
}

function loadYaml(file) {
  return yaml.load(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}

module.exports = { getAssets, loadYaml, yaml };
