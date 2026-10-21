// End-to-end check of the installed panel inside real Illustrator, through the CEP debug port (8734).
// Needs Illustrator running with the Construction Grid panel open. It opens a temporary copy of
// test/fixtures/construction-grid-test.ai (the committed fixture is never modified, and open files
// are not touched), clicks the real buttons, and closes the copy unsaved at the end.
// Every Illustrator call goes through wrap() from tools/ai.js (alerts off first) with a 20 s limit.
// Run: node tools/panel-e2e.js [screenshotDir]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wrap, activate } = require('./ai.js');

const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;   // Illustrator needs an absolute path
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const LIMIT_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const targets = await (await fetch('http://localhost:8734/json')).json();
  const t = targets.find((x) => x.type === 'page');
  if (!t) throw new Error('Construction Grid panel is not open (no target on port 8734)');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) problems.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error('panel eval failed: ' + (res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text));
    return res.result.result.value;
  };
  return { ws, send, evaluate, problems };
}

class Timeout extends Error {}

(async () => {
  const p = await connect();
  // One Illustrator call: the runner's wrapper, sent through the panel's own ExtendScript engine.
  const ai = async (body) => {
    const src = wrap(body);
    const call = p.evaluate(`new Promise(r => window.__adobe_cep__.evalScript(${JSON.stringify(src)}, r))`);
    const out = await Promise.race([call, sleep(LIMIT_MS).then(() => { throw new Timeout('Illustrator call timed out after 20 s: ' + body.slice(0, 80)); })]);
    if (typeof out === 'string' && out.startsWith('ERR ')) throw new Error('Illustrator: ' + out + ' in ' + body.slice(0, 80));
    return out;
  };
  const aiJSON = async (body) => JSON.parse(await ai(body));
  const panel = () => p.evaluate(`JSON.stringify({ live: document.getElementById('live').innerText, status: document.getElementById('status').innerText,
    button: document.getElementById('generate').innerText, disabled: document.getElementById('generate').disabled,
    exportDisabled: document.getElementById('exportFrame').disabled,
    rows: [...document.querySelectorAll('.rowbtn')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()) })`).then(JSON.parse);
  const click = (id) => p.evaluate(`document.getElementById('${id}').click(); true`);
  // An action clears the status line when it starts and writes it when it ends.
  const waitDone = async () => {
    for (let i = 0; i < 130; i++) {
      await sleep(150);
      const s = await panel();
      if (s.status.trim() && !s.disabled) return s;
    }
    throw new Timeout('the panel did not finish within 20 s');
  };
  const select = (names) => ai(`doc = app.activeDocument; doc.selection = null; ${names.map((n) => `doc.pageItems.getByName(${JSON.stringify(n)}).selected = true;`).join(' ')} return String(doc.selection.length);`);
  const grids = () => aiJSON(`
    var d = app.activeDocument, L = null, out = [];
    try { L = d.layers.getByName("Construction"); } catch (e) { return '{"layer":false,"groups":[]}'; }
    for (var i = 0; i < L.groupItems.length; i++) {
      var g = L.groupItems[i];
      if (g.parent.typename !== "Layer") continue;
      var subs = [], texts = [];
      for (var j = 0; j < g.groupItems.length; j++) {
        var s = g.groupItems[j];
        if (s.parent.typename !== "GroupItem" || s.parent.name !== g.name) continue;
        subs.push('"' + s.name + '":' + s.pageItems.length);
        if (s.name === "Labels") for (var k = 0; k < s.textFrames.length; k++) texts.push(s.textFrames[k].contents);
      }
      var b = g.geometricBounds;
      out.push('{"name":' + CG_json(g.name) + ',"note":' + CG_json(g.note) + ',"bounds":[' + b.join(',') + '],"subs":{' + subs.join(',') + '},"texts":' + CG_json(texts) + '}');
    }
    return '{"layer":true,"locked":' + L.locked + ',"top":' + (d.layers[0].name === "Construction") + ',"groups":[' + out.join(',') + ']}';`);
  const fingerprint = () => ai('return CG_fingerprint();');
  const docs = () => ai('return String(app.documents.length);').then(Number);
  const undo = () => ai('app.executeMenuCommand("undo"); return "ok";');
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

  // Load the panel's current files: reloading re-runs panel.js, which loads jsx/host.jsx itself.
  activate();
  await p.send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  const version = /ExtensionBundleVersion="([^"]+)"/.exec(fs.readFileSync(path.resolve(__dirname, '..', 'CSXS', 'manifest.xml'), 'utf8'))[1];
  const hostVersion = await ai('return typeof CG_VERSION === "string" ? CG_VERSION : "none";');
  check('the panel reloaded host.jsx ' + version, hostVersion === version, hostVersion);

  const userDoc = await ai('return app.documents.length ? app.activeDocument.name : "";');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construction-grid-e2e-'));
  const copyPath = path.join(tmpDir, 'construction-grid-e2e.ai');
  fs.copyFileSync(path.resolve(__dirname, '..', 'test', 'fixtures', 'construction-grid-test.ai'), copyPath);
  const docsBefore = await docs();
  const testDoc = await ai(`return app.open(new File(${JSON.stringify(copyPath)})).name;`);
  try {
    // 0. Loaded properly (hard rule 2a.1)
    check('window.Grid and window.SC are loaded in CEP', await p.evaluate('typeof window.Grid === "object" && typeof window.Grid.analyze === "function" && typeof window.SC === "object"'));
    const abs = await aiJSON(`var d = app.activeDocument, o = []; for (var i = 0; i < d.artboards.length; i++) o.push('{"name":' + CG_json(d.artboards[i].name) + ',"rect":[' + d.artboards[i].artboardRect.join(',') + ']}'); return '[' + o.join(',') + ']';`);
    const fp0 = await fingerprint();

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
    check('one grid group, named for the JRO artboard', g.groups.length === 1 && jroGrid.length === 1, g.groups.map((x) => x.name));
    // Every later step undoes what Generate drew; without a grid those undos would revert other steps.
    if (!jroGrid.length) throw new Error('Generate drew no grid, so the run stops here. Panel said: ' + s.status);
    check('the grid sits on the JRO artboard', jroGrid[0] && inRect(jroGrid[0].bounds, abs[0].rect) && !abs.slice(1).some((a) => inRect(jroGrid[0].bounds, a.rect)), jroGrid[0]?.bounds);
    check('Construction is the top layer and locked', g.top && g.locked, g);
    check('17 corners drawn with two ticks and a dot each', jroGrid[0]?.subs['Smooth corners'] === 17 * 4, jroGrid[0]?.subs);
    check('no new document appeared', (await docs()) === docsBefore + 1);
    check('the logo is untouched', (await fingerprint()) === fp0);
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
    check('after undo the logo is untouched', (await fingerprint()) === fp0);

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
    check('after export the original logo is untouched', (await fingerprint()) === fp0);
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
    await ai(`app.documents.getByName(${JSON.stringify(testDoc)}).close(SaveOptions.DONOTSAVECHANGES);
      ${userDoc ? `try { app.activeDocument = app.documents.getByName(${JSON.stringify(userDoc)}); } catch (e) {}` : ''} return "ok";`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
