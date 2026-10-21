const test = require('node:test');
const assert = require('node:assert/strict');
const Grid = require('../js/grid.js');
const { path, polygon, circle, doc, within } = require('./helpers.js');

const capsule = path([0, -20], [
  { line: [100, -20] }, { arc: { c: [100, 0], r: 20, from: -90, to: 90 } },
  { line: [0, 20] }, { arc: { c: [0, 0], r: 20, from: 90, to: 270 } },
]);

// Big circle r50 at the origin, small r10 at (0, 150), joined by their two outer tangents.
const a = (Math.asin(40 / 150) * 180) / Math.PI;
const on = (c, r, deg) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const teardrop = path(on([0, 0], 50, a), [
  { line: on([0, 150], 10, a) }, { arc: { c: [0, 150], r: 10, from: a, to: 180 - a } },
  { line: on([0, 0], 50, 180 - a) }, { arc: { c: [0, 0], r: 50, from: 180 - a, to: 360 + a } },
]);

test('a capsule gives two circles and its two tangents, nothing else', () => {
  const m = Grid.analyze(doc([capsule]));
  assert.equal(m.circles.length, 2);
  assert.equal(m.tangents.length, 2);
  assert.equal(m.lines.length, 0);
});

test('a teardrop gives both circles and exactly the two tangents the outline follows', () => {
  const m = Grid.analyze(doc([teardrop]));
  assert.deepEqual(m.circles.map((c) => Math.round(c.r)).sort((x, y) => x - y), [10, 50]);
  assert.equal(m.tangents.length, 2);
});

test('a lone rectangle or L shape has no shared edge lines and no circles', () => {
  for (const shape of [polygon([[0, 0], [100, 0], [100, 60], [0, 60]]), polygon([[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]])]) {
    const m = Grid.analyze(doc([shape]));
    assert.equal(m.lines.length, 0);
    assert.equal(m.circles.length, 0);
  }
});

test('two stems on a shared baseline and top get exactly those two lines', () => {
  const m = Grid.analyze(doc([polygon([[0, 0], [30, 0], [30, 100], [0, 100]]), polygon([[50, 0], [80, 0], [80, 100], [50, 100]])]));
  assert.deepEqual(m.lines.map((l) => Math.round(l.a[1])).sort((x, y) => x - y), [0, 100]);
});

test('"o" and "x" give baseline, cap height and both overshoots', () => {
  const o = [circle(50, 50, 52), circle(50, 50, 40)];
  const x = polygon([[130, 0], [160, 0], [180, 35], [200, 0], [230, 0], [195, 50], [230, 100], [200, 100], [180, 65], [160, 100], [130, 100], [165, 50]]);
  const m = Grid.analyze(doc([o, x]));
  const byName = Object.fromEntries(m.horizontals.map((h) => [h.label, Math.round(h.y * 10) / 10]));
  assert.deepEqual(byName, { BASELINE: 0, 'CAP HEIGHT': 100, 'OVERSHOOT −2 pt': -2, 'OVERSHOOT +2 pt': 102 });
});

test('centers snap into line with each other and onto series spacing', () => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const m = Grid.analyze(doc([circle(0, 0, 10), circle(10 * PHI ** 4 + 0.02, 0.02, 10 * PHI)]), { system: 'golden', snap: true });
  const [p, q] = m.circles.map((c) => c.drawC);
  assert.equal(p[1], q[1], 'centers on one horizontal');
  within(assert, Math.abs(p[0] - q[0]), m.unitR * PHI ** 4, 1e-9, 'spacing = unit × φ⁴');
});
