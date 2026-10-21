const test = require('node:test');
const assert = require('node:assert/strict');
const Grid = require('../js/grid.js');
const { circle, doc, within } = require('./helpers.js');

const PHI = (1 + Math.sqrt(5)) / 2;
// Circles in a row, far enough apart that they never touch.
const row = (radii) => doc(radii.map((r, i) => circle(i * 200, 0, r)));
const labels = (m) => m.clusters.map((c) => c.label).sort();

test('a φⁿ set snaps to golden with ~0 error and reads upward from the smallest circle', () => {
  const m = Grid.analyze(row([10, 10 * PHI, 10 * PHI ** 2, 10 * PHI ** 3]), { system: 'golden', snap: true });
  assert.equal(m.clusters.length, 4);
  within(assert, m.unitR, 10, 0.005, 'unit');
  for (const c of m.clusters) { assert.ok(c.snapped); assert.ok(Math.abs(c.errorPct) < 0.01, `error ${c.errorPct}%`); }
  assert.deepEqual(labels(m), ['A · 1 : 4.236', 'B · 1 : 2.618', 'C · 1 : 1.618', 'D · 1 : 1']);
});

test('a Fibonacci set {1,2,3,5,8} × 7.3 recovers the unit 7.3 and labels in units', () => {
  const m = Grid.analyze(row([1, 2, 3, 5, 8].map((f) => f * 7.3)), { system: 'fibonacci', snap: true });
  within(assert, m.unitR, 7.3, 0.005, 'unit');
  assert.deepEqual(labels(m), ['A · 8u', 'B · 5u', 'C · 3u', 'D · 2u', 'E · 1u']);
});

test('root-2 and custom series snap their own sets', () => {
  let m = Grid.analyze(row([0, 1, 2, 3].map((n) => 10 * Math.SQRT2 ** n)), { system: 'root2', snap: true });
  assert.deepEqual(labels(m), ['A · 1 : 2.828', 'B · 1 : 2', 'C · 1 : 1.414', 'D · 1 : 1']);
  m = Grid.analyze(row([10, 15, 20, 30]), { system: 'custom', custom: [1, 1.5, 2, 3], snap: true });
  assert.deepEqual(labels(m), ['A · 1 : 3', 'B · 1 : 2', 'C · 1 : 1.5', 'D · 1 : 1']);
});

test('a circle at 1.71× is drawn as measured and flagged off-series', () => {
  const m = Grid.analyze(row([10, 10 * PHI, 10 * PHI ** 2, 17.1]), { system: 'golden', snap: true });
  const odd = m.clusters.find((c) => Math.abs(c.r - 17.1) < 0.1);
  assert.equal(odd.snapped, false);
  assert.equal(odd.label, 'B · ≈ 1 : 1.71');
});

test('the best-fit unit follows the majority even when the smallest circle is off-series', () => {
  const m = Grid.analyze(row([7, 10, 10 * PHI, 10 * PHI ** 2, 10 * PHI ** 3]), { system: 'golden', snap: true });
  within(assert, m.unitR, 10, 0.005, 'unit');
  assert.equal(m.clusters.find((c) => Math.abs(c.r - 7) < 0.1).snapped, false);
});

test('clicking a circle to make it 1 survives a round trip through the grid note', () => {
  const radii = [10, 10 * PHI, 10 * PHI ** 2];
  const note = Grid.encodeNote({ system: 'golden', unitR: 10 * PHI });
  const saved = Grid.decodeNote(note);
  const m = Grid.analyze(row(radii), { system: 'golden', snap: true, unitR: saved.unitR });
  within(assert, m.unitR, 10 * PHI, 0.005, 'unit');
  assert.deepEqual(labels(m), ['A · 1 : 1.618', 'B · 1 : 1', 'C · 1 : 0.618']);
  assert.equal(Grid.decodeNote('not a grid note'), null);
});

test('with snap off every ratio is measured and carries ≈', () => {
  const m = Grid.analyze(row([10, 10 * PHI]), { system: 'golden', snap: false });
  assert.deepEqual(labels(m), ['A · R16.2 pt · ≈ 1 : 1.62', 'B · R10 pt · ≈ 1 : 1']);
});

test('with no ratio system the unit is the most common radius', () => {
  const m = Grid.analyze(row([10, 25, 25, 40]), { system: 'none' });
  within(assert, m.unitR, 25, 0.005, 'unit');
  assert.equal(m.clusters.find((c) => Math.abs(c.r - 25) < 0.1).count, 2);
});
