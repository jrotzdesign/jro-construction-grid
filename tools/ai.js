// The one way tools talk to Illustrator (PLAN 2a.4). Every call goes through run(), which sets
// DONTDISPLAYALERTS before anything else (including app.open) and restores it in finally.
// Calls run in document coordinates (y up), like jsx/host.jsx, so bounds and artboard rects agree.
// A timeout means Illustrator is blocked: stop and tell Jose. Default is 20 seconds per call.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = path.resolve(__dirname, '..', 'jsx', 'host.jsx');

// body is the inside of a function: it must `return` a string. With opts.open, the file is
// opened after alerts are off, exposed as `doc`, and closed unsaved in the same call.
// With opts.host, jsx/host.jsx is loaded first.
function wrap(body, opts = {}) {
  return `(function () {
  var __level = app.userInteractionLevel, __cs = app.coordinateSystem, doc = null;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    ${opts.host ? `$.evalFile(new File(${JSON.stringify(HOST)}));` : ''}
    ${opts.open ? `doc = app.open(new File(${JSON.stringify(opts.open)}));` : ''}
    return (function (doc) { ${body} })(doc);
  } catch (e) { return "ERR " + e.message + " line " + e.line; }
  finally {
    ${opts.open ? 'try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}' : ''}
    try { app.coordinateSystem = __cs; } catch (e3) {}
    app.userInteractionLevel = __level;
  }
})();`;
}

class Timeout extends Error {}

function run(body, opts = {}) {
  const seconds = opts.seconds || 20;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-')), 'run.jsx');
  fs.writeFileSync(f, wrap(body, opts));
  try {
    return execFileSync('osascript', ['-e', `with timeout of ${seconds} seconds`, '-e',
      `tell application "Adobe Illustrator" to do javascript file (POSIX file ${JSON.stringify(f)})`, '-e', 'end timeout'],
    { encoding: 'utf8', timeout: (seconds + 5) * 1000 }).trim();
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/-1712|timed out|ETIMEDOUT/.test(msg) || e.signal) throw new Timeout(`Illustrator call timed out after ${seconds} s. Stop and tell Jose.`);
    throw e;
  } finally {
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
}

// Illustrator runs noticeably slower when it isn't the frontmost app, and captures need it in front.
function activate() {
  execFileSync('osascript', ['-e', 'tell application "Adobe Illustrator" to activate'], { timeout: 20000 });
}

module.exports = { run, wrap, activate, Timeout, HOST };
