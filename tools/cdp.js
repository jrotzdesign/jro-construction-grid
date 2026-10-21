// Driving the installed panel through the CEP debug port (8734), shared by panel-e2e.js and
// undo-soak.js. Every Illustrator call goes through wrap() from tools/ai.js (alerts off first),
// sent through the panel's own ExtendScript engine, with a 20 s limit. A Timeout means: stop.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wrap, activate } = require('./ai.js');

const LIMIT_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Timeout extends Error {}

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

function session(p) {
  const ai = async (body) => {
    const call = p.evaluate(`new Promise(r => window.__adobe_cep__.evalScript(${JSON.stringify(wrap(body))}, r))`);
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
  // Top-level grid groups on the Construction layer, with their uuid so a redraw is told apart.
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
      out.push('{"name":' + CG_json(g.name) + ',"uuid":' + CG_json(g.uuid) + ',"note":' + CG_json(g.note) + ',"bounds":[' + b.join(',') + '],"subs":{' + subs.join(',') + '},"texts":' + CG_json(texts) + '}');
    }
    return '{"layer":true,"locked":' + L.locked + ',"top":' + (d.layers[0].name === "Construction") + ',"groups":[' + out.join(',') + ']}';`);
  const fingerprint = () => ai('return CG_fingerprint();');
  const docs = () => ai('return String(app.documents.length);').then(Number);
  const undo = () => ai('app.executeMenuCommand("undo"); return "ok";');

  // Reloading re-runs panel.js, which loads jsx/host.jsx itself. Returns the host's CG_VERSION.
  const reloadPanel = async () => {
    activate();
    await p.send('Page.reload', { ignoreCache: true });
    await sleep(2500);
    return ai('return typeof CG_VERSION === "string" ? CG_VERSION : "none";');
  };

  // Opens a temporary copy of the committed fixture, or of another file (never the file itself),
  // and remembers the user's active document; close() shuts the copy unsaved and goes back to it.
  const FIXTURE = path.resolve(__dirname, '..', 'test', 'fixtures', 'construction-grid-test.ai');
  const openCopy = async (label, source = FIXTURE) => {
    const userDoc = await ai('return app.documents.length ? app.activeDocument.name : "";');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construction-grid-' + label + '-'));
    const copyPath = path.join(tmpDir, 'construction-grid-' + label + path.extname(source));
    fs.copyFileSync(source, copyPath);
    const name = await ai(`return app.open(new File(${JSON.stringify(copyPath)})).name;`);
    return {
      name,
      close: async () => {
        await ai(`app.documents.getByName(${JSON.stringify(name)}).close(SaveOptions.DONOTSAVECHANGES);
          ${userDoc ? `try { app.activeDocument = app.documents.getByName(${JSON.stringify(userDoc)}); } catch (e) {}` : ''} return "ok";`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    };
  };

  return { ai, aiJSON, panel, click, waitDone, select, grids, fingerprint, docs, undo, reloadPanel, openCopy };
}

const manifestVersion = () => /ExtensionBundleVersion="([^"]+)"/.exec(fs.readFileSync(path.resolve(__dirname, '..', 'CSXS', 'manifest.xml'), 'utf8'))[1];

module.exports = { connect, session, sleep, Timeout, manifestVersion, activate };
