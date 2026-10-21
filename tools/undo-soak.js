// Undo soak test through the debug port: Generate -> Regenerate -> undo -> undo, N times on a copy
// of the fixture, logging which grid (by uuid) each undo leaves. Expected: the first undo brings
// back the Generate's grid, the second leaves none. Conditions rotate so each one is tried a few
// times: plain (600 ms before undo), immediate undo, a capture before each undo, snap on, the
// 0.1.1 e2e's order, and an undo sent right after activating Illustrator.
// Each step also logs the selection, the JRO mark's bounds and the frontmost app, so input that
// reaches Illustrator from outside the test (a click, an arrow-key nudge) shows up in the log.
// Leave the Mac alone while it runs: bringing Illustrator to the front sends your typing there.
// Self-guarding: before each click and each undo, the selection, active artboard and the JRO mark's
// bounds must match what they were at the start. If not, something outside the test touched the
// document: the run is logged as "outside input", skipped (not counted), and a fresh copy is opened.
// Run: node tools/undo-soak.js [runs=20] [logFile]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { connect, session, sleep, Timeout, manifestVersion, activate } = require('./cdp.js');

const RUNS = Number(process.argv[2]) || 20;
const LOG = process.argv[3] || null;
// 'e2e' repeats the 0.1.1 e2e's failing order exactly: activate, capture, activate, panel
// screenshot, then undo with no wait. 'activate' sends the undo right after bringing Illustrator up.
const CONDITIONS = ['plain', 'immediate', 'capture', 'snap', 'e2e', 'activate'];
const { execFileSync } = require('node:child_process');
// The frontmost app, read without any permission prompt (lsappinfo ships with macOS).
class OutsideInput extends Error {}
const front = () => { try { return /="([^"]+)"/.exec(execFileSync('lsappinfo', ['info', '-only', 'name', execFileSync('lsappinfo', ['front']).toString().trim()]).toString())[1]; } catch (e) { return '?'; } };

(async () => {
  const p = await connect();
  const { ai, click, waitDone, select, grids, undo, reloadPanel, openCopy } = session(p);
  const lines = [];
  const log = (o) => { const l = JSON.stringify(o); lines.push(l); console.log(l); };
  const ids = async () => (await grids()).groups.filter((g) => g.name === 'Grid · JRO').map((g) => g.uuid);
  // What is selected (top-level names) and which artboard is active, to tell selection changes apart.
  const sel = () => ai(`var d = app.activeDocument, s = d.selection, n = [];
    for (var i = 0; i < s.length && i < 4; i++) n.push(s[i].name || s[i].typename);
    var b = d.pageItems.getByName("JRO mark").geometricBounds;
    for (var k = 0; k < 4; k++) b[k] = Math.round(b[k] * 100) / 100;
    return n.join("+") + (s.length > 4 ? "+" + (s.length - 4) + " more" : "") + " @" + d.artboards[d.artboards.getActiveArtboardIndex()].name + " mark " + b.join(",");`);
  const t0 = Date.now(), t = () => ((Date.now() - t0) / 1000).toFixed(1);
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-soak-shots-'));

  const hostVersion = await reloadPanel();
  if (hostVersion !== manifestVersion()) throw new Error('host.jsx ' + hostVersion + ' is loaded, expected ' + manifestVersion());
  let copy = await openCopy('soak'), base;
  const start = async () => { await select(['JRO mark']); await sleep(1800); base = await sel(); };
  // Returns the state it read, throwing if it differs from the start.
  const guard = async (where) => { const s = await sel(); if (s !== base) throw new OutsideInput(where + ': ' + s); return s; };
  const bad = [], outside = [];
  try {
    await start();
    for (let run = 1; run <= RUNS; run++) {
      const cond = CONDITIONS[(run - 1) % CONDITIONS.length];
      await p.evaluate(`(() => { const c = document.getElementById('snap'); if (c.checked !== ${cond === 'snap'}) c.click(); return true; })()`);
      const before = await ids();
      const capture = async () => {
        if (cond !== 'capture' && cond !== 'e2e') return;
        activate();
        await sleep(500);
        const f = path.join(shotDir, 'run' + run + '.png');
        await ai(`var o = new ImageCaptureOptions(); o.resolution = 72; app.activeDocument.imageCapture(new File(${JSON.stringify(f)}), [-100, 100, 400, -400], o); return "ok";`);
        if (cond === 'e2e') { activate(); await sleep(500); }
        await p.send('Page.captureScreenshot', { format: 'png' });
      };
      const settle = () => sleep(cond === 'immediate' || cond === 'e2e' || cond === 'activate' ? 0 : 600);
      const preUndo = () => { if (cond === 'activate') activate(); return front(); };

      try {
        await sleep(1800);   // let the panel's poll see the selection
        const sel0 = await guard('before Generate');
        await click('generate');
        const s1 = await waitDone();
        const gen = await ids();
        await capture();
        await sleep(1800);
        const sel1 = await guard('before Regenerate'), tRegen = t();
        await click('generate');
        const s2 = await waitDone();
        const regen = await ids();
        await capture();
        await settle();
        const f1 = preUndo();
        await guard('before undo 1');
        await undo();
        await settle();
        const u1 = await ids();
        const f2 = preUndo();
        await guard('before undo 2');
        await undo();
        await settle();
        const u2 = await ids();
        const sel2 = await guard('after undo 2');

        const ok = before.length === 0 && gen.length === 1 && regen.length === 1 && regen[0] !== gen[0] &&
          u1.length === 1 && u1[0] === gen[0] && u2.length === 0;
        const short = (a) => a.map((u) => u.slice(-6));
        log({ run, cond, ok, t: tRegen, front: [f1, f2], sel: [sel0, sel1, sel2], before: short(before), generate: short(gen), regenerate: short(regen), undo1: short(u1), undo2: short(u2),
          status1: s1.status.slice(0, 40), status2: s2.status.slice(0, 40) });
        if (!ok) {
          bad.push(run);
          // Get back to an empty document before the next run, so one bad step doesn't cascade.
          for (let k = 0; k < 3 && (await ids()).length; k++) { await undo(); await sleep(600); }
          if ((await ids()).length) throw new Error('could not get back to an empty Construction layer after run ' + run);
        }
      } catch (e) {
        if (!(e instanceof OutsideInput)) throw e;
        outside.push(run);
        log({ run, cond, outsideInput: e.message, expected: base, front: front(), t: t() });
        // Undo can't be trusted to unwind someone else's steps, so start over on a fresh copy.
        await copy.close();
        copy = await openCopy('soak');
        await start();
      }
    }
  } finally {
    await copy.close();
    fs.rmSync(shotDir, { recursive: true, force: true });
    if (LOG) fs.writeFileSync(LOG, lines.join('\n') + '\n');
  }
  const counted = RUNS - outside.length;
  if (outside.length) console.log(`skipped ${outside.length} run(s) for outside input: ${outside.join(', ')}`);
  console.log(bad.length ? `UNDO SOAK: ${bad.length} of ${counted} runs off (runs ${bad.join(', ')})` : `UNDO SOAK: all ${counted} counted runs as expected`);
  p.ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error(e instanceof Timeout ? 'STOP: ' + e.message + ' Tell Jose before doing anything else.' : e);
  process.exit(2);
});
