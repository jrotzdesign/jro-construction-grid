// CEP runs with --mixed-context, so `module` exists inside the panel. Each pure module must still
// land on window (Optical Center 0.1.0 shipped broken on exactly this).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = (files) => {
  const window = {};
  const ctx = vm.createContext({ module: { exports: {} }, window, Math, JSON });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  return window;
};

test('panel scripts load in order with both module and window defined', () => {
  const w = load(['vendor/engine-core.js', 'grid.js']);
  assert.equal(typeof w.SC.buildCorner, 'function');
  assert.equal(typeof w.Grid.analyze, 'function');
});
