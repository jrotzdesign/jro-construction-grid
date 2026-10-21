// The draw model is what jsx/host.jsx turns into Illustrator objects, grouped by element type.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/vendor/engine-core.js');
const Grid = require('../js/grid.js');
const { circle, fromSC, doc } = require('./helpers.js');

const group = (m, name) => m.draw.groups.find((g) => g.name === name);
const sq = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
const jroCorners = (n) => doc([fromSC(SC.roundPolygon(sq(n), null, { mode: 'cubic', radius: 17, k: 0.692 }, true))]);

test('smooth corners draw their real curve, two ticks and the corner dot, with one shared label', () => {
  const m = Grid.analyze(jroCorners(100));
  const items = group(m, 'Smooth corners').items;
  assert.equal(items.filter((i) => i.kind === 'path').length, 4);
  assert.equal(items.filter((i) => i.kind === 'line').length, 8);
  assert.equal(items.filter((i) => i.kind === 'dot').length, 4);
  const texts = group(m, 'Labels').items.filter((i) => i.kind === 'text').map((i) => i.text);
  assert.deepEqual(texts.filter((t) => t.startsWith('R17')), ['R17 pt · Single curve 69.2%']);
});

test('label size is 1.2% of the logo, at least 5 pt, times the size control', () => {
  assert.equal(Grid.analyze(jroCorners(1000)).draw.labelSize, 12);
  assert.equal(Grid.analyze(jroCorners(40)).draw.labelSize, 5);
  assert.equal(Grid.analyze(jroCorners(1000), { labelScale: 2 }).draw.labelSize, 24);
});

test('element types can be switched off, verticals and loose fits start off, horizontals are dashed', () => {
  const m = Grid.analyze(doc([circle(0, 0, 50), circle(150, 0, 50)]));
  assert.deepEqual(m.draw.groups.map((g) => g.name), ['Circles', 'Horizontals', 'Centers', 'Labels']);
  assert.deepEqual(group(m, 'Horizontals').items[0].dash, [4, 3]);
  const off = Grid.analyze(doc([circle(0, 0, 50)]), { draw: { circles: false, labels: false } });
  assert.deepEqual(off.draw.groups.map((g) => g.name), ['Horizontals', 'Centers']);
});

test('circle labels sit outside the logo and link to their cluster letter', () => {
  const m = Grid.analyze(doc([circle(0, 0, 50), circle(150, 0, 30)]), { system: 'golden', snap: false });
  const [x0, y0, x1, y1] = m.bounds;
  const texts = group(m, 'Labels').items.filter((i) => i.kind === 'text' && /^[A-Z] ·/.test(i.text));
  assert.equal(texts.length, 2);
  for (const t of texts) assert.ok(t.at[0] < x0 || t.at[0] > x1 || t.at[1] < y0 || t.at[1] > y1, `${t.text} sits on the logo`);
});

test('the report lists clusters, corners and what was rejected', () => {
  const m = Grid.analyze(jroCorners(100), { system: 'golden', snap: true });
  assert.deepEqual(m.report.smoothCorners.map((c) => [c.label.split(' · ').slice(0, 2).join(' · '), c.count]), [['R17 pt · Single curve 69.2%', 4]]);
  assert.deepEqual(m.report.circles, []);
});

// DM Mono advance is 0.6 em; a text box runs from the descender to the cap height.
const box = (t) => {
  const w = t.text.length * t.size * 0.6, x0 = t.align === 'right' ? t.at[0] - w : t.at[0];
  return [x0, t.at[1] - t.size * 0.25, x0 + w, t.at[1] + t.size * 0.8];
};
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

test('on the JRO mark no label overlaps another label, the logo or a horizontal', () => {
  const m = Grid.analyze(require('./fixtures/jro-mark.json'), { system: 'golden', snap: true });
  const texts = group(m, 'Labels').items.filter((i) => i.kind === 'text');
  const boxes = texts.map(box);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(boxes[i], boxes[j]), `"${texts[i].text}" overlaps "${texts[j].text}"`);
    for (const h of m.horizontals) {
      const own = texts[i].text === h.label;
      if (!own) assert.ok(!hit(boxes[i], [h.a[0], h.y, h.b[0], h.y]), `"${texts[i].text}" sits on ${h.label}`);
    }
    assert.ok(!hit(boxes[i], m.bounds), `"${texts[i].text}" sits on the logo`);
  }
});

// Does a drawn grid item cross a text box? Lines by clipping, circle outlines by their nearest and
// farthest distance to the box, curves by sampling, dots and crosses by their own small box.
const segHits = (a, b, r) => {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [[-d[0], a[0] - r[0]], [d[0], r[2] - a[0]], [-d[1], a[1] - r[1]], [d[1], r[3] - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
};
const circleHits = (c, rad, r) => {
  const nx = Math.max(r[0], Math.min(c[0], r[2])), ny = Math.max(r[1], Math.min(c[1], r[3]));
  const near = Math.hypot(nx - c[0], ny - c[1]);
  const far = Math.max(...[[r[0], r[1]], [r[0], r[3]], [r[2], r[1]], [r[2], r[3]]].map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
  return near <= rad && rad <= far;
};
const bez = (s, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * s[0][k] + 3 * u * u * t * s[1][k] + 3 * u * t * t * s[2][k] + t * t * t * s[3][k]); };
const itemHits = (it, r) => {
  if (it.kind === 'line') return segHits(it.a, it.b, r);
  if (it.kind === 'circle') return circleHits(it.c, it.r, r);
  if (it.kind === 'dot') return hit([it.c[0] - it.r, it.c[1] - it.r, it.c[0] + it.r, it.c[1] + it.r], r);
  if (it.kind === 'cross') return hit([it.c[0] - it.size / 2, it.c[1] - it.size / 2, it.c[0] + it.size / 2, it.c[1] + it.size / 2], r);
  if (it.kind === 'path') return it.segments.some((s) => { for (let i = 0; i < 32; i++) if (segHits(bez(s, i / 32), bez(s, (i + 1) / 32), r)) return true; return false; });
  throw new Error('unknown item ' + it.kind);
};
const gridHits = (m) => {
  const out = [];
  const texts = group(m, 'Labels').items.filter((i) => i.kind === 'text');
  for (const g of m.draw.groups) {
    if (g.name === 'Labels') continue;
    g.items.forEach((it, k) => {
      for (const t of texts) {
        // A horizontal's own name sits just past its end, in line with it: that's not a crossing.
        if (g.name === 'Horizontals' && t.text === m.horizontals[k].label) continue;
        if (itemHits(it, box(t))) out.push(`"${t.text}" sits on ${g.name} #${k}`);
      }
    });
  }
  // Leaders are drawn lines too: one may not run through another label. Each follows its own text.
  const items = group(m, 'Labels').items;
  items.forEach((l, k) => {
    if (l.kind !== 'line') return;
    for (const t of texts) if (t !== items[k - 1] && segHits(l.a, l.b, box(t))) out.push(`the leader of "${items[k - 1].text}" runs through "${t.text}"`);
  });
  return out;
};

const ALL = { circles: true, smoothCorners: true, tangents: true, lines: true, horizontals: true, verticals: true, centers: true, loose: true, labels: true };
for (const [name, opt] of [['snap on', { snap: true }], ['snap off', { snap: false }], ['every element on', { snap: true, draw: ALL }]]) {
  test(`on the JRO mark (${name}) no label sits on any drawn grid line, circle or mark`, () => {
    const m = Grid.analyze(require('./fixtures/jro-mark.json'), Object.assign({ system: 'golden' }, opt));
    assert.deepEqual(gridHits(m), []);
  });
}
