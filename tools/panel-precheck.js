// Offline pre-check, not the verification (that's tools/panel-e2e.js in real Illustrator).
// Loads the panel in headless Chrome with jsx/host.jsx's real plumbing: every evalScript string the
// panel sends is evaluated as-is, so its quoting, CG_parse's payload whitelist, CG_run's error
// codes and CG_json's reply encoding are the real ones. Only the document work is stubbed:
// CG_read answers with test/fixtures/jro-mark.json and CG_draw / CG_exportFrame draw nothing.
// Checks for script errors, a drawn status, and that the panel fits 280 x 420 with Advanced closed.
// Run: node tools/panel-precheck.js [screenshotDir]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const out = process.argv[2] || null;
const host = fs.readFileSync(path.join(repo, 'jsx', 'host.jsx'), 'utf8');
const read = fs.readFileSync(path.join(repo, 'test', 'fixtures', 'jro-mark.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page before the panel loads. The stubs keep each entry point's real wrapper and parse.
const fakeHost = `
  window.app = { userInteractionLevel: 0, coordinateSystem: 0 };
  window.UserInteractionLevel = { DONTDISPLAYALERTS: 1 };
  window.CoordinateSystem = { DOCUMENTCOORDINATESYSTEM: 1 };
  window.$ = { evalFile: function () {} };
  window.File = function (p) { this.fsName = p; };
  (0, eval)(${JSON.stringify(host)});
  ['CG_probe', 'CG_read', 'CG_draw', 'CG_exportFrame'].forEach(function (f) {
    if (typeof window[f] !== 'function') throw new Error('host.jsx no longer defines ' + f);
  });
  window.__hasGrid = false;
  window.__sent = [];
  window.CG_probe = function () { return CG_run(function () { return { doc: true, count: 1, artboard: 'JRO', hasGrid: window.__hasGrid }; }); };
  window.CG_read = function () { return CG_run(function () { return ${read}; }); };
  window.CG_draw = function (json) { return CG_run(function () { var o = CG_parse(json); window.__hasGrid = true; return { artboard: 'JRO', counts: {}, groups: o.groups.length }; }); };
  window.CG_exportFrame = function (json) { return CG_run(function () { CG_parse(json); return { artboard: 'JRO · guideline', index: 2 }; }); };
  window.__adobe_cep__ = {
    getHostEnvironment: function () { return JSON.stringify({ appSkinInfo: { panelBackgroundColor: { color: { red: 50, green: 50, blue: 50 } } } }); },
    addEventListener: function () {},
    getSystemPath: function () { return '/fake/extension'; },
    evalScript: function (s, cb) {
      window.__sent.push(s.slice(0, 40));
      setTimeout(function () {
        var r;
        try { r = String((0, eval)(s)); } catch (e) { r = 'EvalScript error.'; console.error('evalScript threw: ' + e.message + ' in ' + s.slice(0, 80)); }
        cb(r);
      }, 5);
    }
  };`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-precheck-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + dir, '--window-size=280,420', 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); };
  try {
    let targets;
    for (let i = 0; i < 40 && !targets; i++) { try { targets = await (await fetch('http://localhost:9333/json')).json(); } catch (e) { await sleep(250); } }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map(), problems = [], infos = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id) { pending.get(msg.id)?.(msg); return; }
      if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled') (msg.params.type === 'info' ? infos : problems).push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
    const shot = async (name, clip) => {
      if (!out) return;
      const r = await send('Page.captureScreenshot', clip ? { format: 'png', captureBeyondViewport: true, clip } : { format: 'png' });
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64'));
    };
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 280, height: 420, deviceScaleFactor: 2, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeHost });
    await send('Page.enable');
    await send('Page.navigate', { url: 'file://' + path.join(repo, 'index.html') });
    await sleep(2500);

    let s = JSON.parse(await ev(`JSON.stringify({ btn: generate.innerText, disabled: generate.disabled, sent: __sent })`));
    check('panel loads host.jsx itself, then polls', s.sent[0].startsWith('try { $.evalFile(') && s.sent.some((x) => x.startsWith('CG_probe')), s.sent);
    check('Generate is on for a selected logo', !s.disabled && s.btn === 'GENERATE', s);

    for (const snap of [false, true]) {
      await ev(`(() => { const c = document.getElementById('snap'); if (c.checked !== ${snap}) c.click(); return true; })()`);
      await sleep(1200);
      await ev(`generate.click(); true`);
      await sleep(1500);
      s = JSON.parse(await ev(`JSON.stringify({ status: document.getElementById('status').innerText, rows: [...document.querySelectorAll('.rowbtn')].length })`));
      check(`Generate (snap ${snap ? 'on' : 'off'}) passes host.jsx's payload check`, /^Grid (drawn|replaced) on JRO: /.test(s.status) && s.rows > 0, { status: s.status, panelLog: infos });
    }
    await shot('panel-precheck');
    await sleep(1200);
    await ev(`exportFrame.click(); true`);
    await sleep(1500);
    s = JSON.parse(await ev(`JSON.stringify({ status: document.getElementById('status').innerText })`));
    check('Export guideline frame passes host.jsx\'s payload check', /^Guideline frame added/.test(s.status), { status: s.status, panelLog: infos });

    const fit = JSON.parse(await ev(`JSON.stringify({ h: innerHeight, content: document.documentElement.scrollHeight, open: advanced.open })`));
    check('fits 280 x 420 with Advanced closed', fit.content <= fit.h && !fit.open, fit);
    await ev(`advanced.open = true; true`);
    await sleep(300);
    const full = await ev('document.documentElement.scrollHeight');
    await shot('panel-precheck-advanced', { x: 0, y: 0, width: 280, height: full, scale: 1 });
    check('no script errors', problems.length === 0, problems);
    ws.close();
  } finally {
    chrome.kill();
    await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `PRECHECK FAILED ${failed} of ${results.length}` : `PRECHECK ALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
