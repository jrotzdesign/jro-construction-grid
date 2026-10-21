// Real marks rarely keep Smooth Corners output intact: Pathfinder and added anchors split corners,
// and narrow counters put two corners back to back. The JRO mark has both.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/vendor/engine-core.js');
const Grid = require('../js/grid.js');
const { fromSC, doc, within } = require('./helpers.js');

const v = (x, y) => ({ x, y });
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const isCurve = (a, b) => a.right[0] !== a.anchor[0] || a.right[1] !== a.anchor[1] || b.left[0] !== b.anchor[0] || b.left[1] !== b.anchor[1];

// Split every curved segment at t with de Casteljau, the way an added anchor does.
function splitCurves(pathData, t) {
  const pts = pathData.points, n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = { ...pts[i] }, b = pts[(i + 1) % n];
    out.push(a);
    if (!isCurve(a, b)) continue;
    const p01 = lerp(a.anchor, a.right, t), p12 = lerp(a.right, b.left, t), p23 = lerp(b.left, b.anchor, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), mid = lerp(p012, p123, t);
    a.right = p01;
    out.push({ anchor: mid, left: p012, right: p123, setNextLeft: p23 });
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].setNextLeft) { out[(i + 1) % out.length] = { ...out[(i + 1) % out.length], left: out[i].setNextLeft }; delete out[i].setNextLeft; }
  }
  return { closed: true, points: out };
}

const roundRect = (w, h, opts) => fromSC(SC.roundPolygon([v(0, 0), v(w, 0), v(w, h), v(0, h)], null, opts, true));
const JRO = { mode: 'cubic', radius: 17, k: 0.692 };

for (const t of [0.5, 0.3]) {
  test(`a Single curve corner split at t=${t} still reads as one corner`, () => {
    const m = Grid.analyze(doc([splitCurves(roundRect(100, 100, JRO), t)]));
    assert.deepEqual(m.smoothCorners.map((c) => c.label), Array(4).fill('R17 pt · Single curve 69.2%'));
    assert.equal(m.circles.length, 0);
  });
}

test('a split Smoothing corner still reads as one corner', () => {
  const m = Grid.analyze(doc([splitCurves(roundRect(100, 100, { mode: 'smooth', radius: 10, smoothing: 0.6 }), 0.5)]));
  assert.deepEqual(m.smoothCorners.map((c) => c.label), Array(4).fill('R10 pt · Smoothing 60%'));
  assert.equal(m.circles.length, 0);
});

test('a slot as wide as two split corners gives four corners, not two circles', () => {
  const m = Grid.analyze(doc([splitCurves(roundRect(34, 200, JRO), 0.5)]));
  assert.deepEqual(m.smoothCorners.map((c) => c.label), Array(4).fill('R17 pt · Single curve 69.2%'));
  assert.equal(m.circles.length, 0);
});

test('the JRO mark reads as R17, R44.5 and R72 Single curve corners on φ⁰, φ², φ³', () => {
  const m = Grid.analyze(require('./fixtures/jro-mark.json'), { system: 'golden', snap: true });
  const count = {};
  for (const c of m.smoothCorners) count[c.label] = (count[c.label] || 0) + 1;
  assert.deepEqual(count, {
    'R17 px · Single curve 69.2% · 1 : 1': 9,
    'R44.5 px · Single curve 69.2% · 1 : 2.618': 2,
    'R72 px · Single curve 69.2% · 1 : 4.236': 6,
  });
  assert.equal(m.circles.length, 0);
  within(assert, m.unitR, 17, 0.005, 'unit');
});
