const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/vendor/engine-core.js');
const Grid = require('../js/grid.js');
const { K, circle, polygon, fromSC, doc } = require('./helpers.js');

test('a 2:1 ellipse and a free S-curve give no circles and land in Rejected', () => {
  const a = 100, b = 50, ka = a * K, kb = b * K;
  const ellipse = { closed: true, points: [
    { anchor: [a, 0], left: [a, -kb], right: [a, kb] }, { anchor: [0, b], left: [ka, b], right: [-ka, b] },
    { anchor: [-a, 0], left: [-a, kb], right: [-a, -kb] }, { anchor: [0, -b], left: [-ka, -b], right: [ka, -b] },
  ] };
  const s = { closed: false, points: [{ anchor: [0, 0], left: [0, 0], right: [60, 80] }, { anchor: [100, 0], left: [40, -80], right: [100, 0] }] };
  for (const shape of [ellipse, s]) {
    const m = Grid.analyze(doc([shape]));
    assert.equal(m.circles.length, 0);
    assert.ok(m.rejected.length > 0);
  }
});

test('a compound path with a hole, zero-length segments and retracted handles still reads right', () => {
  const sq = polygon([[0, 0], [200, 0], [200, 0], [200, 200], [0, 200]]);   // duplicate anchor = zero-length segment
  const hole = circle(100, 100, 40);
  const m = Grid.analyze(doc([[sq, hole]]));
  assert.equal(m.circles.length, 1);
  assert.equal(Math.round(m.circles[0].r), 40);
  assert.equal(Grid.analyze(doc([])).circles.length, 0);
  assert.equal(Grid.analyze(doc([polygon([[5, 5]])])).circles.length, 0);
});

test('labels use the document units with one decimal and no trailing zeros', () => {
  const mm = 72 / 25.4;
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const m = Grid.analyze(doc([fromSC(SC.roundPolygon(sq, null, { mode: 'cubic', radius: 3 * mm, k: 0.692 }, true))], { units: 'mm' }));
  assert.equal(m.smoothCorners[0].label, 'R3 mm · Single curve 69.2%');
});

test('a Single curve value outside the 40–100 slider range is labeled and noted', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const m = Grid.analyze(doc([fromSC(SC.roundPolygon(sq, null, { mode: 'cubic', radius: 17, k: 0.35 }, true))]));
  assert.equal(m.smoothCorners[0].label, 'R17 pt · Single curve 35%');
  assert.equal(m.report.smoothCorners[0].note, 'outside Smooth Corners range');
});
