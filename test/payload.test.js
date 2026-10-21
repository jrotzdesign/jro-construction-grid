// What the panel sends to CG_draw has to pass host.jsx's payload whitelist. Labels hold "%" and
// other ASCII the whitelist doesn't allow, which broke the first real Generate in 0.1.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Grid = require('../js/grid.js');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const whitelist = new RegExp(/if \(!(\/.+\/)\.test\(s\)\) throw new Error\("Unexpected characters/.exec(src('jsx/host.jsx'))[1].slice(1, -1));
const payload = new Function(/(function payload\(o\) \{[\s\S]+?\n  \})/.exec(src('js/panel.js'))[1] + '\nreturn payload;')();
const jro = JSON.parse(src('test/fixtures/jro-mark.json'));

test('the JRO draw payload passes the host whitelist and reads back unchanged', () => {
  for (const snap of [false, true]) {
    const m = Grid.analyze(jro, { snap, system: 'golden' });
    const o = { artboard: 0, groups: m.draw.groups, style: { rgb: [41, 161, 145], cmyk: [75, 10, 50, 0], weight: 0.25 }, note: Grid.encodeNote({ system: 'golden', unitR: m.unitR }) };
    const s = payload(o);
    assert.ok(whitelist.test(s), 'rejected characters: ' + JSON.stringify([...new Set(s.replace(/[\w\s\[\]{},:."+\-\\]/g, ''))]));
    assert.deepEqual(eval('(' + s + ')'), JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v))));
  }
});

test('any printable text survives the trip', () => {
  const text = 'R17 px · 69.2% (a/b) #1 \'q\' <x> & ~ ` ^ ! ? = ; @ $ | * — φ "z" \\ end';
  const s = payload({ t: text });
  assert.ok(whitelist.test(s));
  assert.equal(eval('(' + s + ')').t, text);
});
