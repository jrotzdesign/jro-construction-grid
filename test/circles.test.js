const test = require('node:test');
const assert = require('node:assert/strict');
const Grid = require('../js/grid.js');
const { circle, doc, within } = require('./helpers.js');

for (const r of [1, 17, 500]) {
  for (const rot of [0, 33, 90]) {
    test(`an Ellipse-tool circle r=${r} rotated ${rot}° comes back as one circle`, () => {
      const cx = 1000 + r * 3, cy = -400 - r;
      const m = Grid.analyze(doc([circle(cx, cy, r, rot)]));
      assert.equal(m.circles.length, 1);
      within(assert, m.circles[0].r, r, 0.005, 'radius');
      assert.ok(Math.hypot(m.circles[0].c[0] - cx, m.circles[0].c[1] - cy) <= m.budget, 'center within the budget');
    });
  }
}

const { path, rng } = require('./helpers.js');
const arcPath = (r, sweep, pieces) => {
  const a = (d) => [r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180)];
  return path(a(20), [{ arc: { c: [0, 0], r, from: 20, to: 20 + sweep, pieces } }], false);
};

for (const [sweep, options] of [[30, [1, 2]], [90, [1, 2]], [180, [2, 4]]]) {
  for (const pieces of options) {
    test(`a ${sweep}° arc drawn as ${pieces} cubic(s) gives its radius back`, () => {
      const m = Grid.analyze(doc([arcPath(100, sweep, pieces)]));
      assert.equal(m.circles.length, 1);
      within(assert, m.circles[0].r, 100, 0.005, 'radius');
    });
  }
}

test('a 180° arc squeezed into one cubic is not a circle (1.8% of r off) and is rejected', () => {
  const m = Grid.analyze(doc([arcPath(100, 180, 1)]));
  assert.equal(m.circles.length, 0);
  assert.ok(m.rejected.some((r) => r.reason === 'not circular'));
});

test('a 10° arc is too short to trust and goes to Rejected', () => {
  const m = Grid.analyze(doc([arcPath(100, 10, 1)]));
  assert.equal(m.circles.length, 0);
  assert.ok(m.rejected.some((r) => r.reason === 'too short'));
});

test('anchors jittered by 0.1% of r still give the circle back, under the budget', () => {
  const rand = rng(7), r = 100;
  const c = circle(0, 0, r, 12);
  for (const p of c.points) {
    const a = rand() * 2 * Math.PI, d = rand() * 0.001 * r, dx = d * Math.cos(a), dy = d * Math.sin(a);
    for (const k of ['anchor', 'left', 'right']) p[k] = [p[k][0] + dx, p[k][1] + dy];
  }
  const m = Grid.analyze(doc([c]));
  assert.equal(m.circles.length, 1);
  within(assert, m.circles[0].r, r, 0.005, 'radius');
  assert.ok(m.circles[0].dev <= m.budget);
});
