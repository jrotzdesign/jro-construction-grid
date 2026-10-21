// Smooth Corners' own engine draws the corners, so the expected labels come from the tool that made them.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/vendor/engine-core.js');
const Grid = require('../js/grid.js');
const { fromSC, doc, within } = require('./helpers.js');

const v = (x, y) => ({ x, y });
const square = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)];                         // 90° corners
const triangle = [v(0, 0), v(200, 0), v(100, 100 * Math.sqrt(3))];                      // 60°
const hexagon = [0, 1, 2, 3, 4, 5].map((i) => v(100 * Math.cos((i * Math.PI) / 3), 100 * Math.sin((i * Math.PI) / 3))); // 120°
const shapes = { '60°': triangle, '90°': square, '120°': hexagon };

const rounded = (anchors, opts) => doc([fromSC(SC.roundPolygon(anchors, null, opts, true))]);

for (const [angle, anchors] of Object.entries(shapes)) {
  test(`${angle} corners in Single curve 69.2% R17 (the JRO corner) read back exactly`, () => {
    const m = Grid.analyze(rounded(anchors, { mode: 'cubic', radius: 17, k: 0.692 }));
    assert.equal(m.smoothCorners.length, anchors.length);
    for (const c of m.smoothCorners) {
      within(assert, c.R, 17, 0.005, 'R');
      assert.equal(c.label, 'R17 pt · Single curve 69.2%');
    }
    assert.equal(m.circles.length, 0);
  });

  test(`${angle} corners in Smoothing 60% R10 read back exactly`, () => {
    const m = Grid.analyze(rounded(anchors, { mode: 'smooth', radius: 10, smoothing: 0.6 }));
    assert.equal(m.smoothCorners.length, anchors.length);
    for (const c of m.smoothCorners) {
      within(assert, c.R, 10, 0.005, 'R');
      assert.equal(c.label, 'R10 pt · Smoothing 60%');
    }
  });

  test(`${angle} corners in Smoothing 0% are plain circles`, () => {
    const m = Grid.analyze(rounded(anchors, { mode: 'smooth', radius: 10, smoothing: 0 }));
    assert.equal(m.smoothCorners.length, 0);
    assert.equal(m.circles.length, anchors.length);
    for (const c of m.circles) within(assert, c.r, 10, 0.005, 'r');
  });
}

test('Single curve 55.2% on a square is a circle, like the "circle" tick in Smooth Corners', () => {
  const m = Grid.analyze(rounded(square, { mode: 'cubic', radius: 17, k: 0.5523 }));
  assert.equal(m.smoothCorners.length, 0);
  assert.equal(m.circles.length, 4);
});

test('a corner clamped by a short edge reports what is really there (Smoothing drops to 25%)', () => {
  // 20 pt square, R8 Smoothing 60%: each corner wants 8 × 1.6 = 12.8 pt of a 10 pt half-edge,
  // so Smooth Corners lowers smoothing to 10 / 8 − 1 = 25% and keeps R8.
  const small = [v(0, 0), v(20, 0), v(20, 20), v(0, 20)];
  const m = Grid.analyze(rounded(small, { mode: 'smooth', radius: 8, smoothing: 0.6 }));
  assert.equal(m.smoothCorners.length, 4);
  for (const c of m.smoothCorners) assert.equal(c.label, 'R8 pt · Smoothing 25%');
});
