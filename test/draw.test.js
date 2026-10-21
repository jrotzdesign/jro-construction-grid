// The draw model is what jsx/host.jsx turns into Illustrator objects, grouped by element type.
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/vendor/engine-core.js');
const Grid = require('../js/grid.js');
const { circle, fromSC, doc, box, hit, gridHits } = require('./helpers.js');

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

const ALL = { circles: true, smoothCorners: true, tangents: true, lines: true, horizontals: true, verticals: true, centers: true, loose: true, labels: true };
for (const [name, opt] of [['snap on', { snap: true }], ['snap off', { snap: false }], ['every element on', { snap: true, draw: ALL }]]) {
  test(`on the JRO mark (${name}) no label sits on any drawn grid line, circle or mark`, () => {
    const m = Grid.analyze(require('./fixtures/jro-mark.json'), Object.assign({ system: 'golden' }, opt));
    assert.deepEqual(gridHits(m), []);
  });
}
