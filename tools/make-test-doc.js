// Builds test/fixtures/construction-grid-test.ai once. Run: node tools/make-test-doc.js [path/to/jro.ai]
// It opens a temporary copy of Jose's jro.ai, keeps only the main JRO mark (the 448 × 379 group that
// matches jro-logo.svg), recolors it ink (#0E1014, allowed by the brand) so it reads on white, adds a
// synthetic artboard with known answers and an empty artboard, saves the fixture and closes the copy.
// The original jro.ai is never opened. Never build the fixture through the panel.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SC = require('../js/vendor/engine-core.js');
const { run } = require('./ai.js');

const src = process.argv[2] || path.join(os.homedir(), 'Downloads', 'jro.ai');
const out = path.resolve(__dirname, '..', 'test', 'fixtures', 'construction-grid-test.ai');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-fixture-')), 'jro-copy.ai');
fs.copyFileSync(src, tmp);

const K = 0.5522847498307936;
const v = (x, y) => ({ x, y });
const fromSC = (pts) => pts.map((p) => [[p.anchor.x, p.anchor.y], [(p.left || p.anchor).x, (p.left || p.anchor).y], [(p.right || p.anchor).x, (p.right || p.anchor).y]]);
const square = (x, y, n) => [v(x, y), v(x + n, y), v(x + n, y + n), v(x, y + n)];
const circle = (cx, cy, r) => [0, 1, 2, 3].map((i) => {
  const a = (i * Math.PI) / 2, p = [cx + r * Math.cos(a), cy + r * Math.sin(a)], t = [-Math.sin(a) * r * K, Math.cos(a) * r * K];
  return [p, [p[0] - t[0], p[1] - t[1]], [p[0] + t[0], p[1] + t[1]]];
});
const PHI = (1 + Math.sqrt(5)) / 2;

// Artboard 2 spans x 1000..2440, y 576..-864 (document coordinates, y up).
const shapes = [
  { name: 'phi circle 20', pts: circle(1200, 300, 20) },
  { name: 'phi circle 32.4', pts: circle(1300, 300, 20 * PHI) },
  { name: 'phi circle 52.4', pts: circle(1450, 300, 20 * PHI * PHI) },
  { name: 'Single curve 69.2% R17', pts: fromSC(SC.roundPolygon(square(1150, -100, 160), null, { mode: 'cubic', radius: 17, k: 0.692 }, true)) },
  { name: 'Smoothing 60% R20', pts: fromSC(SC.roundPolygon(square(1450, -100, 160), null, { mode: 'smooth', radius: 20, smoothing: 0.6 }, true)) },
];

// Runs through tools/ai.js, which turns alerts off before app.open and closes the copy unsaved.
const body = `
    var report = [];
    var L = doc.layers.getByName("Layer 1"), mark = null, i, j;
    for (i = 0; i < L.pageItems.length; i++) {
      var it = L.pageItems[i], b = it.geometricBounds;
      if (it.parent.typename === "Layer" && it.typename === "GroupItem" && Math.abs(b[0] - 3280.67) < 0.1 && Math.abs(b[1] + 1194.02) < 0.1) mark = it;
    }
    if (!mark) throw new Error("JRO mark group not found");
    for (i = 0; i < doc.layers.length; i++) {
      var layer = doc.layers[i]; layer.locked = false;
      for (j = layer.pageItems.length - 1; j >= 0; j--) {
        var p = layer.pageItems[j];
        if (p.parent.typename === "Layer" && p.uuid !== mark.uuid) p.remove();
      }
    }
    mark.name = "JRO mark";
    var mb = mark.geometricBounds;
    mark.translate(144 - (mb[0] + mb[2]) / 2, -144 - (mb[1] + mb[3]) / 2);
    var ink = new RGBColor(); ink.red = 14; ink.green = 16; ink.blue = 20;
    for (i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].filled) doc.pathItems[i].fillColor = ink;
    for (i = 0; i < doc.compoundPathItems.length; i++) { try { doc.compoundPathItems[i].pathItems.length && (doc.compoundPathItems[i].pathItems[0].fillColor = ink); } catch (e) {} }
    doc.artboards[0].name = "JRO";
    var syn = doc.artboards.add([1000, 576, 2440, -864]); syn.name = "Synthetic";
    var empty = doc.artboards.add([2600, 576, 4040, -864]); empty.name = "Empty";
    var shapes = ${JSON.stringify(shapes)};
    for (i = 0; i < shapes.length; i++) {
      var path = L.pathItems.add(), pts = shapes[i].pts;
      for (j = 0; j < pts.length; j++) {
        var q = path.pathPoints.add();
        q.anchor = pts[j][0]; q.leftDirection = pts[j][1]; q.rightDirection = pts[j][2]; q.pointType = PointType.CORNER;
      }
      path.closed = true; path.filled = true; path.fillColor = ink; path.stroked = false; path.name = shapes[i].name;
    }
    var opts = new IllustratorSaveOptions(); opts.pdfCompatible = true;
    doc.saveAs(new File(${JSON.stringify(out)}), opts);
    return "saved, items " + doc.pageItems.length + ", artboards " + doc.artboards.length;
`;

console.log(run(body, { open: tmp }));
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
