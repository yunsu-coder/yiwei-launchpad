// lib/font.js - 字体混淆解码
const fs = require('fs');
const path = require('path');

const FONT_MAP_FILE = path.join(__dirname, '..', 'font-map.json');

function loadFontMap() {
  try { return JSON.parse(fs.readFileSync(FONT_MAP_FILE, 'utf8')); }
  catch { return {}; }
}

function decodeText(text, map) {
  return text.split('').map(c => map[c] || c).join('');
}

module.exports = { loadFontMap, decodeText };
