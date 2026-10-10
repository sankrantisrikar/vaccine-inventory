// Tiny JSON file store. One object, loaded on boot, written on every mutation.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

let state = null;

function load() {
  if (state) return state;
  if (fs.existsSync(FILE)) {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    const { buildSeed } = require('./seed');
    state = buildSeed();
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE);
}

function reset() {
  const { buildSeed } = require('./seed');
  state = buildSeed();
  save();
  return state;
}

module.exports = { load, save, reset, FILE };
