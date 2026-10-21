// Third-party test logos, local only (PLAN Q11): for each SVG in test/fixtures/local/, opens a copy
// in Illustrator, saves what CG_read sees as <name>.json next to it (for test/local.test.js), runs
// Generate through the panel and captures the artboard and the whole grid to
// screenshots/local/<name>-INTERNAL.png.
// Both folders are gitignored. Every call goes through the runner with a 20 s limit.
// Run: node tools/local-logos.js
const fs = require('node:fs');
const path = require('node:path');
const { connect, session, sleep, Timeout, activate } = require('./cdp.js');

const LOCAL = path.resolve(__dirname, '..', 'test', 'fixtures', 'local');
const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'local');

(async () => {
  const svgs = fs.readdirSync(LOCAL).filter((f) => f.endsWith('.svg'));
  if (!svgs.length) throw new Error('no SVGs in test/fixtures/local/');
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = await connect();
  const { ai, click, waitDone, panel, grids, reloadPanel, openCopy } = session(p);
  await reloadPanel();
  for (const svg of svgs) {
    const name = path.basename(svg, '.svg');
    const copy = await openCopy('local-' + name, path.join(LOCAL, svg));
    try {
      await ai('var d = app.activeDocument; d.selection = null; for (var i = 0; i < d.pageItems.length; i++) if (d.pageItems[i].parent.typename === "Layer") d.pageItems[i].selected = true; return String(d.selection.length);');
      const read = JSON.parse(await ai('return CG_read();'));
      delete read.ok;
      fs.writeFileSync(path.join(LOCAL, name + '.json'), JSON.stringify(read));
      await sleep(1800);   // let the panel's poll see the selection
      await click('generate');
      const s = await waitDone();
      const g = await grids();
      const f = path.join(SHOTS, name + '-INTERNAL.png');
      activate();
      await sleep(500);
      await ai(`var d = app.activeDocument, o = new ImageCaptureOptions(); o.resolution = 216; o.antiAliasing = true;
        var r = d.artboards[d.artboards.getActiveArtboardIndex()].artboardRect, L = d.layers.getByName("Construction");
        for (var i = 0; i < L.groupItems.length; i++) { var g = L.groupItems[i].visibleBounds; r = [Math.min(r[0], g[0]), Math.max(r[1], g[1]), Math.max(r[2], g[2]), Math.min(r[3], g[3])]; }
        var m = 0.03 * Math.max(r[2] - r[0], r[1] - r[3]);
        d.imageCapture(new File(${JSON.stringify(f)}), [r[0] - m, r[1] + m, r[2] + m, r[3] - m], o); return "ok";`);
      const panelShot = await p.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name + '-panel-INTERNAL.png'), Buffer.from(panelShot.result.data, 'base64'));
      console.log(JSON.stringify({ logo: name, items: read.items.length, grids: g.groups.length, status: s.status, captured: fs.existsSync(f), rows: (await panel()).rows }));
    } finally {
      await copy.close();
    }
  }
  p.ws.close();
})().catch((e) => {
  console.error(e instanceof Timeout ? 'STOP: ' + e.message + ' Tell Jose before doing anything else.' : e);
  process.exit(2);
});
