// End-to-end check of the installed panel inside real Illustrator, through the CEP debug port (8734).
// Needs Illustrator running with the Construction Grid panel open. It opens a temporary copy of
// test/fixtures/construction-grid-test.ai (the committed fixture is never modified, and open files
// are not touched), clicks the real buttons, and closes the copy unsaved at the end.
// Every Illustrator call goes through wrap() from tools/ai.js (alerts off first) with a 20 s limit.
// Run: node tools/panel-e2e.js [screenshotDir]
const fs = require('node:fs');
const path = require('node:path');
const { connect, session, sleep, Timeout, manifestVersion, activate } = require('./cdp.js');

const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;   // Illustrator needs an absolute path
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const p = await connect();
  const { ai, aiJSON, panel, click, waitDone, select, grids, fingerprint, docs, undo, reloadPanel, openCopy } = session(p);
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); };
  const shots = [];
  const capture = async (name, rect) => {
    if (!SHOTS) return;
    activate();
    await sleep(500);
    const f = path.join(SHOTS, name + '.png');
    await ai(`var o = new ImageCaptureOptions(); o.resolution = 216; o.antiAliasing = true; o.transparency = false;
      app.activeDocument.imageCapture(new File(${JSON.stringify(f)}), [${rect.join(',')}], o); return "ok";`);
    check('capture ' + name + ' was written', fs.existsSync(f) && fs.statSync(f).size > 0, f);
    shots.push(f);
  };
  const panelShot = async (name) => {
    if (!SHOTS) return;
    activate();
    await sleep(500);
    const r = await p.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    shots.push(f);
  };

  // Load the panel's current files.
  const version = manifestVersion(), hostVersion = await reloadPanel();
  check('the panel reloaded host.jsx ' + version, hostVersion === version, hostVersion);

  const docsBefore = await docs();
  const copy = await openCopy('e2e');
  try {
    // 0. Loaded properly (hard rule 2a.1)
    check('window.Grid and window.SC are loaded in CEP', await p.evaluate('typeof window.Grid === "object" && typeof window.Grid.analyze === "function" && typeof window.SC === "object"'));
    const abs = await aiJSON(`var d = app.activeDocument, o = []; for (var i = 0; i < d.artboards.length; i++) o.push('{"name":' + CG_json(d.artboards[i].name) + ',"rect":[' + d.artboards[i].artboardRect.join(',') + ']}'); return '[' + o.join(',') + ']';`);
    const fp0 = await fingerprint();
    // The first original item that differs from the start, with both versions, or null.
    const untouched = async () => {
      const a = JSON.parse(fp0).items, b = JSON.parse(await fingerprint()).items;
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { item: i, was: a[i], now: b[i] };
      return null;
    };

    // Settings persist between runs: start with snap off.
    await p.evaluate(`(() => { const c = document.getElementById('snap'); if (c.checked) c.click(); return true; })()`);

    // 1. Nothing selected: button off, plain instruction
    await select([]);
    await sleep(1800);
    let s = await panel();
    check('nothing selected: Generate is off and says what to do', s.disabled && /Select a logo/.test(s.live), s);

    // 2. JRO mark: Generate draws one grid group on the JRO artboard
    await select(['JRO mark']);
    await sleep(1800);
    s = await panel();
    check('live line names the artboard', /Draws a grid on JRO\./.test(s.live) && !s.disabled && s.button === 'GENERATE', s);
    await click('generate');
    s = await waitDone();
    let g = await grids();
    const jroGrid = g.groups.filter((x) => x.name === 'Grid · JRO');
    const inRect = (b, r) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; return cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]; };
    check('status reports the grid in plain words', /^Grid drawn on JRO: 17 smooth corners/.test(s.status), s.status);
    // The R's leg (shape 2) has three curves that aren't circles; positions as the Info panel shows them.
    check('the warning lists which curves aren\'t circles, and where', s.status.includes('3 curves aren\'t close enough to a circle to draw: shape 2 from the left at 786, 661 · 786, 690 · 796, 871 px.'), s.status);
    check('one grid group, named for the JRO artboard', g.groups.length === 1 && jroGrid.length === 1, g.groups.map((x) => x.name));
    // Every later step undoes what Generate drew; without a grid those undos would revert other steps.
    if (!jroGrid.length) throw new Error('Generate drew no grid, so the run stops here. Panel said: ' + s.status);
    check('the grid sits on the JRO artboard', jroGrid[0] && inRect(jroGrid[0].bounds, abs[0].rect) && !abs.slice(1).some((a) => inRect(jroGrid[0].bounds, a.rect)), jroGrid[0]?.bounds);
    check('Construction is the top layer and locked', g.top && g.locked, g);
    check('17 corners drawn with two ticks and a dot each', jroGrid[0]?.subs['Smooth corners'] === 17 * 4, jroGrid[0]?.subs);
    check('no new document appeared', (await docs()) === docsBefore + 1);
    { const d = await untouched(); check('the logo is untouched', !d, d); }
    s = await panel();
    check('button turns into Regenerate', s.button === 'REGENERATE' && !s.exportDisabled, s);
    const markB = (await aiJSON('return "[" + app.activeDocument.pageItems.getByName("JRO mark").geometricBounds.join(",") + "]";'));
    const pad = 0.32 * Math.max(markB[2] - markB[0], markB[1] - markB[3]);
    const shotRect = [markB[0] - pad, markB[1] + pad, markB[2] + pad, markB[3] - pad];

    // 3. One undo removes the whole grid. Undo checks come before captures: see step 3b.
    await undo();
    await sleep(600);
    g = await grids();
    check('one undo removes the grid', g.groups.length === 0, g.groups.map((x) => x.name));
    { const d = await untouched(); check('after undo the logo is untouched', !d, d); }

    // 3b. Capture the grid, then measure whether imageCapture added an undo step of its own.
    await sleep(1800);
    await click('generate');
    await waitDone();
    await capture('jro-grid', shotRect);
    await panelShot('panel-after-generate');
    if (SHOTS) {
      await undo();
      await sleep(600);
      const kept = (await grids()).groups.length;
      console.log('  info imageCapture ' + (kept ? 'adds an undo step: one undo after it left the grid' : 'adds no undo step'));
      if (kept) { await undo(); await sleep(600); }
      g = await grids();
      check('no grid left before step 4', g.groups.length === 0, g.groups.map((x) => x.name));
    }

    // 4. Snap on, Generate, then Regenerate three times: always exactly one group
    await p.evaluate(`(() => { const c = document.getElementById('snap'); if (!c.checked) c.click(); return c.checked; })()`);
    await sleep(1800);
    await click('generate');
    await waitDone();
    for (let i = 0; i < 3; i++) {
      await sleep(1800);
      s = await panel();
      if (i === 0) check('live line says Replaces', /Replaces the grid on JRO\./.test(s.live), s.live);
      await click('generate');
      s = await waitDone();
    }
    g = await grids();
    check('three Regenerates leave exactly one grid group', g.groups.length === 1, g.groups.map((x) => x.name));
    check('status says replaced', /^Grid replaced on JRO/.test(s.status), s.status);
    const texts = g.groups[0]?.texts || [];
    check('snapped labels read R17 · 1 : 1, R44.5 · 1 : 2.618, R72 · 1 : 4.236', ['R17 px · Single curve 69.2% · 1 : 1', 'R44.5 px · Single curve 69.2% · 1 : 2.618', 'R72 px · Single curve 69.2% · 1 : 4.236'].every((t) => texts.includes(t)), texts);
    check('the group note stores the settings', /^construction-grid \{"v":1,"system":"golden"/.test(g.groups[0]?.note || ''), g.groups[0]?.note);
    await panelShot('panel-after-regenerate');
    await undo();
    await sleep(600);
    g = await grids();
    check('one undo after a Regenerate goes back one step, still one group', g.groups.length === 1, g.groups.map((x) => x.name));
    await capture('jro-grid-golden', shotRect);   // the grid from the previous Regenerate, also snapped

    // 5. A second artboard gets its own grid; the JRO grid stays
    await select(['phi circle 20', 'phi circle 32.4', 'phi circle 52.4']);
    await sleep(1800);
    await click('generate');
    s = await waitDone();
    g = await grids();
    check('Synthetic gets its own grid and the JRO grid stays', g.groups.length === 2 && g.groups.some((x) => x.name === 'Grid · Synthetic'), g.groups.map((x) => x.name));
    check('phi circles snap to 1 : 1.618 and 1 : 2.618', ['1 : 1.618', '1 : 2.618'].every((r) => (g.groups.find((x) => x.name === 'Grid · Synthetic')?.texts || []).some((t) => t.endsWith(r))), g.groups.find((x) => x.name === 'Grid · Synthetic')?.texts);
    await undo();

    // 6. Export guideline frame: a 1920 x 1080 artboard with the logo at 15% and the grid
    await select(['JRO mark']);
    await sleep(1800);
    await click('exportFrame');
    s = await waitDone();
    const frame = await aiJSON(`var d = app.activeDocument, a = d.artboards[d.artboards.length - 1], r = a.artboardRect, L = d.layers.getByName("Guideline frame"), lg = L.groupItems[0], b = lg.geometricBounds;
      return '{"name":' + CG_json(a.name) + ',"w":' + (r[2] - r[0]) + ',"h":' + (r[1] - r[3]) + ',"rect":[' + r.join(',') + '],"logoH":' + (b[1] - b[3]) + ',"logoW":' + (b[2] - b[0]) + ',"opacity":' + lg.opacity + '}';`);
    check('frame artboard is 1920 x 1080', Math.abs(frame.w - 1920) < 0.01 && Math.abs(frame.h - 1080) < 0.01, frame);
    check('logo copy is 648 tall (or 1536 wide) at 15% opacity', (Math.abs(frame.logoH - 648) < 0.5 || Math.abs(frame.logoW - 1536) < 0.5) && Math.abs(frame.opacity - 15) < 0.01, frame);
    check('status names the new artboard', /Guideline frame added/.test(s.status), s.status);
    // Line weights and dot sizes of each grid: the frame's copy keeps the line weight it had.
    const style = await aiJSON(`var L = app.activeDocument.layers.getByName("Construction"), out = [];
      for (var i = 0; i < L.groupItems.length; i++) {
        var g = L.groupItems[i]; if (g.parent.typename !== "Layer") continue;
        var w = 0, dot = 0;
        for (var j = 0; j < g.groupItems.length; j++) {
          var sub = g.groupItems[j]; if (sub.parent.name !== g.name) continue;
          for (var k = 0; k < sub.pathItems.length; k++) { var q = sub.pathItems[k]; if (q.stroked) w = Math.max(w, q.strokeWidth); else dot = Math.max(dot, q.width); }
        }
        out.push('{"name":' + CG_json(g.name) + ',"weight":' + w + ',"dot":' + dot + '}');
      }
      return '[' + out.join(',') + ']';`);
    console.log('  info grid styles ' + JSON.stringify(style));
    const src = style.find((x) => x.name === 'Grid · JRO'), dst = style.find((x) => x.name === 'Grid · ' + frame.name);
    check('the frame grid keeps the line weight', src && dst && Math.abs(dst.weight - src.weight) < 0.01, style);
    { const d = await untouched(); check('after export the original logo is untouched', !d, d); }
    await capture('jro-guideline-frame', frame.rect);
    await undo();
    await sleep(600);
    const abCount = await ai('return String(app.activeDocument.artboards.length);').then(Number);
    check('one undo removes the frame artboard', abCount === abs.length, abCount);

    await p.send('Emulation.setDeviceMetricsOverride', { width: 280, height: 420, deviceScaleFactor: 0, mobile: false });
    await sleep(300);
    const fit = await p.evaluate('JSON.stringify({ h: innerHeight, content: document.documentElement.scrollHeight, open: document.getElementById("advanced").open })').then(JSON.parse);
    check('fits at default 280 x 420 with Advanced closed', fit.content <= fit.h && !fit.open, fit);
    await p.send('Emulation.clearDeviceMetricsOverride');
    check('no console errors or exceptions in the panel', p.problems.length === 0, p.problems);
  } finally {
    // Teardown: close the copy unsaved and go back to the user's file.
    await copy.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ screenshots: shots }, null, 1));
  console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} PASSED`);
  p.ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e instanceof Timeout ? 'STOP: ' + e.message + ' Tell Jose before doing anything else.' : e);
  process.exit(2);
});
