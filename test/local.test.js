// Third-party logos, local only (PLAN Q11 and 7.3). The fixtures are what CG_read saw in real
// Illustrator, written by tools/local-logos.js into the gitignored test/fixtures/local/. Without
// them these tests are skipped, so a fresh clone passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Grid = require('../js/grid.js');
const { gridHits } = require('./helpers.js');

const fixture = (name) => {
  const f = path.join(__dirname, 'fixtures', 'local', name + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const twitter = fixture('twitter-bird'), apple = fixture('apple-logo');

// The outline's length, measured independently of grid.js: 64 chords per cubic.
const outlineLength = (d) => {
  const at = (a, b, c, e, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * e[k]); };
  let total = 0;
  for (const it of d.items) for (const p of it.paths) {
    const P = p.points, n = P.length;
    for (let i = 0; i < (p.closed ? n : n - 1); i++) {
      const A = P[i], B = P[(i + 1) % n];
      let prev = A.anchor;
      for (let k = 1; k <= 64; k++) { const q = at(A.anchor, A.right, B.left, B.anchor, k / 64); total += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
    }
  }
  return total;
};
const inCircles = (m) => m.circles.reduce((s, c) => s + c.arcs.reduce((t, a) => t + a.length, 0), 0);

test('Twitter bird: most of the outline is covered by fitted circles', { skip: !twitter && 'no local fixture' }, () => {
  // Its published construction is all circles; the beak and tail tips are the only corners.
  // 0.1.2 covers 77.6%; 70% leaves room without letting a real regression through.
  const m = Grid.analyze(twitter, { system: 'golden', snap: true });
  const share = inCircles(m) / outlineLength(twitter);
  assert.ok(share >= 0.7, `only ${(share * 100).toFixed(1)}% of the outline is in circles`);
});

test('Apple logo: circles are fitted and every one off the series is flagged, not forced', { skip: !apple && 'no local fixture' }, () => {
  const m = Grid.analyze(apple, { system: 'golden', snap: true });
  assert.ok(m.circles.length >= 5, `${m.circles.length} circles`);
  const clusters = m.report.circles;
  assert.ok(clusters.some((c) => c.offSeries), 'the contested golden-circle claim should show off-series radii');
  for (const c of clusters) assert.ok(c.snapped || c.offSeries, `${c.label} is neither on the series nor flagged`);
});

for (const [name, d] of [['Twitter bird', twitter], ['Apple logo', apple]]) {
  for (const snap of [true, false]) {
    test(`${name} (snap ${snap ? 'on' : 'off'}): no label sits on a drawn grid item or another label's leader`, { skip: !d && 'no local fixture' }, () => {
      assert.deepEqual(gridHits(Grid.analyze(d, { system: 'golden', snap })), []);
    });
  }
}
