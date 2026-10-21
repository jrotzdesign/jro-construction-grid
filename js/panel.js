/* Construction Grid panel logic. Analysis lives in grid.js; document work lives in jsx/host.jsx. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };
  var POLL_MS = 800, SLOW_MS = 20000, DROP_MS = 1000, MAX_ROWS = 4;

  // Everything the user can see in the status line. Raw script errors never reach it.
  var MESSAGES = {
    "no-document": "Open a document first.",
    "editing-text": "Finish editing the text first.",
    "no-selection": "Select a logo first.",
    "spans-artboards": "The selection crosses artboards. Select art on one artboard.",
    "off-artboard": "Move the selection onto an artboard first.",
    "nothing-readable": "Nothing in the selection can be measured. Outline text and expand effects first.",
    "no-paths": "The selection has no paths to measure.",
    "no-grid": "Generate a grid for this artboard first.",
    "nothing-found": "No circles, corners or shared lines found in the selection.",
    "no-answer": "Illustrator didn't answer. Close any open dialog and try again.",
    "slow": "Still waiting for Illustrator. If a dialog is open, close it.",
    "internal": "Something went wrong. Try again, or close and reopen the panel."
  };

  var REJECTED = {
    "not circular": ["curve isn't close enough to a circle to draw", "curves aren't close enough to a circle to draw"],
    "too short": ["arc is too short to measure", "arcs are too short to measure"],
    "live text": ["live text object was skipped. Outline it to include it", "live text objects were skipped. Outline them to include them"],
    "placed image": ["placed image was skipped", "placed images were skipped"],
    "image": ["image was skipped", "images were skipped"],
    "symbol": ["symbol was skipped. Expand it to include it", "symbols were skipped. Expand them to include them"],
    "mesh": ["mesh was skipped", "meshes were skipped"],
    "effect object": ["effect object was skipped. Expand it to include it", "effect objects were skipped. Expand them to include them"],
    "graph": ["graph was skipped", "graphs were skipped"],
    "unsupported object": ["object type isn't supported and was skipped", "objects aren't supported and were skipped"]
  };

  var STYLES = {
    teal: { rgb: [41, 161, 145], cmyk: [75, 10, 50, 0] },
    gray: { rgb: [147, 149, 152], cmyk: [0, 0, 0, 50] }
  };

  var DRAW_LABELS = [["circles", "Circles"], ["smoothCorners", "Smooth corners"], ["tangents", "Tangents"], ["lines", "Lines"],
    ["horizontals", "Horizontals"], ["verticals", "Verticals"], ["centers", "Centers"], ["labels", "Labels"], ["loose", "Loose fits"]];

  var DEFAULTS = {
    fitTol: 0, snapTol: 0, snap: false, system: "golden", custom: "", color: "teal", weight: 0.25, labelSize: 1.2,
    draw: { circles: true, smoothCorners: true, tangents: true, lines: true, horizontals: true, verticals: false, centers: true, labels: true, loose: false }
  };

  var state = { busy: false, peek: null, model: null, settings: null, pendingUnit: undefined, idleAt: 0, dropUntil: 0 };

  // ---------- settings (per-panel convenience, so localStorage is fine) ----------

  function loadSettings() {
    var s = JSON.parse(JSON.stringify(DEFAULTS)), saved = null;
    try { saved = JSON.parse(localStorage.getItem("construction-grid.settings") || "null"); } catch (e) {}
    if (saved && typeof saved === "object") {
      for (var k in DEFAULTS) if (k !== "draw" && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
      if (saved.draw) for (var d in DEFAULTS.draw) if (typeof saved.draw[d] === "boolean") s.draw[d] = saved.draw[d];
    }
    return s;
  }

  function saveSettings() { try { localStorage.setItem("construction-grid.settings", JSON.stringify(state.settings)); } catch (e) {} }

  // ---------- host calls ----------

  function PanelError(code, detail) { this.code = code; this.detail = detail; }

  // Every character outside host.jsx's payload whitelist (non-ASCII, and ASCII like "%" in labels)
  // is sent as a \u escape, which only ever occurs inside JSON strings. Numbers keep 4 decimals.
  function payload(o) {
    return JSON.stringify(o, function (k, v) { return typeof v === "number" ? Math.round(v * 10000) / 10000 : v; })
      .replace(/[^\w \[\]{},:."+\-\\]/g, function (c) { return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4); });
  }

  // A call can't be cancelled, so the panel waits for the real answer with the buttons locked.
  // Illustrator freezes this panel while a script runs, so the slow note can only show when the
  // script hasn't started yet (an open dialog). A slow reply also drops clicks queued meanwhile.
  function host(fn, arg) {
    var call = fn + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")", started = Date.now();
    return new Promise(function (resolve, reject) {
      var slow = setTimeout(function () {
        console.info("[Construction Grid] still waiting after " + SLOW_MS + " ms: " + fn);
        if (fn !== "CG_probe") setStatus("err", MESSAGES.slow);
      }, SLOW_MS);
      cs.evalScript(call, function (raw) {
        clearTimeout(slow);
        if (Date.now() - started > SLOW_MS) state.dropUntil = performance.now() + DROP_MS;
        if (typeof raw !== "string" || raw.charAt(0) !== "{") { reject(new PanelError("no-answer", raw)); return; }
        var res;
        try { res = JSON.parse(raw); } catch (e) { reject(new PanelError("internal", "unparseable reply: " + raw.slice(0, 120))); return; }
        if (!res.ok) reject(new PanelError(res.code || "internal", res.error)); else resolve(res);
      });
    });
  }

  // The manifest's ScriptPath runs once per Illustrator session, so the panel loads host.jsx itself.
  // $.evalFile has to run at the top level: inside a function it would define nothing global.
  function loadHost() {
    var f = cs.getExtensionPath() + "/jsx/host.jsx";
    return new Promise(function (resolve) {
      cs.evalScript("try { $.evalFile(new File(" + JSON.stringify(f) + ")); 'ok'; } catch (e) { 'ERR ' + e.message; }", function (raw) {
        if (raw !== "ok") console.info("[Construction Grid] host.jsx didn't load: " + raw);
        resolve();
      });
    });
  }

  function plain(e) {
    if (e instanceof PanelError) {
      if (e.code === "internal" || e.code === "no-answer") console.info("[Construction Grid] " + e.code + ": " + e.detail);
      return MESSAGES[e.code] || MESSAGES.internal;
    }
    console.info("[Construction Grid] " + (e && e.stack ? e.stack : e));
    return MESSAGES.internal;
  }

  // ---------- wording ----------

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function describe(p) {
    if (!p || !p.doc) return "Open a document to start.";
    if (p.editingText) return "Finish editing the text first.";
    if (!p.count) return "Select a logo to draw its grid.";
    if (p.spans) return "The selection crosses artboards.";
    if (p.offArtboard) return "Move the selection onto an artboard.";
    return (p.hasGrid ? "Replaces the grid on " : "Draws a grid on ") + p.artboard + ".";
  }

  function summary(m) {
    var parts = [];
    if (m.circles.length) parts.push(plural(m.circles.length, "circle", "circles"));
    if (m.smoothCorners.length) parts.push(plural(m.smoothCorners.length, "smooth corner", "smooth corners"));
    if (m.tangents.length) parts.push(plural(m.tangents.length, "tangent", "tangents"));
    if (m.lines.length) parts.push(plural(m.lines.length, "line", "lines"));
    if (m.horizontals.length) parts.push(plural(m.horizontals.length, "horizontal", "horizontals"));
    return parts.join(", ");
  }

  function warnings(m) {
    var out = [];
    if (m.unitOverrideLost) out.push("The circle you made 1 isn't in the selection any more, so the best fit is back.");
    m.report.rejected.forEach(function (r) {
      var w = REJECTED[r.reason];
      if (w) out.push(r.count + " " + (r.count === 1 ? w[0] : w[1]) + (r.curves ? ": " + where(r.curves, m.unit) : "") + ".");
    });
    return out;
  }

  // "shape 2 from the left at 786, 661 · 786, 690 px", top to bottom, at most 4 positions.
  function where(curves, unit) {
    var sorted = curves.slice().sort(function (a, b) { return a.at[1] - b.at[1] || a.at[0] - b.at[0]; });
    var shapes = [], at = {};
    sorted.slice(0, 4).forEach(function (c) {
      if (!at[c.element]) { at[c.element] = []; shapes.push(c.element); }
      at[c.element].push(Math.round(c.at[0]) + ", " + Math.round(c.at[1]));
    });
    var more = sorted.length - 4;
    return shapes.map(function (s) { return s + " at " + at[s].join(" · "); }).join("; ") + " " + unit + (more > 0 ? " and " + more + " more" : "");
  }

  // ---------- status, report, controls ----------

  function setStatus(kind, head, list) {
    var box = $("status"), html = head ? "<b>" + esc(head) + "</b>" : "";
    box.className = "status " + (kind || "");
    if (list && list.length) {
      html += "<ul>" + list.slice(0, 2).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
      if (list.length > 2) html += "<div>and " + (list.length - 2) + " more</div>";
    }
    box.innerHTML = html;
  }

  function renderReport() {
    var m = state.model, rows = $("rows");
    rows.innerHTML = "";
    if (!m) { $("report").classList.add("hidden"); return; }
    var items = [];
    m.report.circles.forEach(function (c) {
      items.push({ r: c.r, text: c.label, n: "×" + c.count, flag: c.offSeries ? "off-series" : "" });
    });
    m.report.smoothCorners.forEach(function (c) {
      items.push({ r: c.R, text: c.label, n: "×" + c.count, flag: c.note || "" });
    });
    $("report").classList.toggle("hidden", !items.length);
    items.slice(0, MAX_ROWS).forEach(function (it) {
      var b = document.createElement("button");
      b.className = "rowbtn" + (m.unitR != null && Math.abs(it.r - m.unitR) <= m.budget ? " unit" : "");
      b.title = "Make this radius 1";
      b.innerHTML = "<span>" + esc(it.text) + (it.flag ? " <span class=\"flag\">" + esc(it.flag) + "</span>" : "") + "</span><span class=\"n\">" + esc(it.n) + "</span>";
      b.addEventListener("click", fresh(function () { state.pendingUnit = it.r; generate(); }));
      rows.appendChild(b);
    });
    if (items.length > MAX_ROWS) {
      var more = document.createElement("div");
      more.className = "more";
      more.textContent = "and " + (items.length - MAX_ROWS) + " more on the artboard";
      rows.appendChild(more);
    }
  }

  function renderPeek() {
    var p = state.peek, ready = !!(p && p.count && !p.editingText && !p.spans && !p.offArtboard) && !state.busy;
    $("live").textContent = describe(p);
    $("generate").textContent = p && p.hasGrid ? "Regenerate" : "Generate";
    $("generate").disabled = !ready;
    $("exportFrame").disabled = !(ready && p.hasGrid);
  }

  function setBusy(b) {
    state.busy = b;
    if (!b) state.idleAt = performance.now();
    renderPeek();
  }

  // Clicks made while Illustrator had the panel frozen arrive after the reply. Drop anything stamped
  // before the panel went idle, and any click in the first second after a slow reply.
  function fresh(handler) {
    return function (ev) {
      if (ev && ev.timeStamp < state.idleAt) return;
      if (performance.now() < state.dropUntil) return;
      handler();
    };
  }

  function tolText(v, m) {
    if (!v) return "Auto";
    var pct = v / 100, t = (v / 100).toFixed(2) + "% of height";
    if (m) t += " · " + (Math.round(pct / 100 * (m.bounds[3] - m.bounds[1]) * 100) / 100) + " " + m.unit;
    return t;
  }

  function renderSettings() {
    var s = state.settings;
    $("fitTol").value = s.fitTol; $("fitText").textContent = tolText(s.fitTol, state.model);
    $("snapTol").value = s.snapTol; $("snapText").textContent = tolText(s.snapTol, state.model);
    $("snap").checked = s.snap;
    $("system").value = s.system;
    $("custom").value = s.custom;
    $("custom").classList.toggle("hidden", s.system !== "custom");
    $("weight").value = s.weight;
    $("labelSize").value = s.labelSize;
    $("swTeal").classList.toggle("on", s.color === "teal");
    $("swGray").classList.toggle("on", s.color === "gray");
    DRAW_LABELS.forEach(function (d) { $("draw-" + d[0]).checked = s.draw[d[0]]; });
  }

  // ---------- actions ----------

  function analysisSettings(note) {
    var s = state.settings, saved = Grid.decodeNote(note);
    var unitR = state.pendingUnit !== undefined ? state.pendingUnit : (saved ? saved.unitR : null);
    return {
      fitTol: s.fitTol ? s.fitTol / 10000 : null,
      snapTol: s.snapTol ? s.snapTol / 10000 : null,
      snap: s.snap,
      system: s.system,
      custom: s.custom.split(/[\s,;]+/).map(Number).filter(function (x) { return x > 0 && isFinite(x); }),
      unitR: unitR,
      labelScale: s.labelSize / 1.2,
      draw: s.draw
    };
  }

  function generate() {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "");
    var replacing = !!(state.peek && state.peek.hasGrid);
    host("CG_read")
      .then(function (input) {
        var opt = analysisSettings(input.note), m = Grid.analyze(input, opt);
        var drawn = m.draw.groups.filter(function (g) { return g.name !== "Labels"; }).length;
        if (!drawn) throw new PanelError("nothing-found");
        var style = STYLES[state.settings.color];
        return host("CG_draw", payload({
          artboard: input.artboard.index,
          groups: m.draw.groups,
          style: { rgb: style.rgb, cmyk: style.cmyk, weight: state.settings.weight },
          note: Grid.encodeNote({ system: opt.system, unitR: opt.unitR })
        })).then(function (res) {
          state.model = m;
          state.pendingUnit = undefined;
          if (state.peek) state.peek.hasGrid = true;
          renderReport();
          renderSettings();
          setStatus("ok", (replacing ? "Grid replaced on " : "Grid drawn on ") + res.artboard + ": " + summary(m) + ".", warnings(m));
        });
      })
      .catch(function (e) { state.pendingUnit = undefined; setStatus("err", plain(e)); })
      .then(function () { setBusy(false); });
  }

  function exportFrame() {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "");
    host("CG_read")
      .then(function (input) {
        var m = Grid.analyze(input, analysisSettings(input.note));
        return host("CG_exportFrame", payload({ artboard: input.artboard.index, scale: m.frameScale }));
      })
      .then(function (res) { setStatus("ok", "Guideline frame added on a new artboard, " + res.artboard + "."); })
      .catch(function (e) { setStatus("err", plain(e)); })
      .then(function () { setBusy(false); });
  }

  function poll() {
    if (state.busy || document.hidden) { setTimeout(poll, POLL_MS); return; }
    host("CG_probe")
      .then(function (p) { state.peek = p; })
      .catch(function () { state.peek = null; })
      .then(function () { renderPeek(); setTimeout(poll, POLL_MS); });
  }

  // ---------- theme ----------

  function applyTheme() {
    var env = cs.getHostEnvironment(), c = env && env.appSkinInfo && env.appSkinInfo.panelBackgroundColor && env.appSkinInfo.panelBackgroundColor.color;
    if (!c) return;
    document.body.classList.toggle("light", (c.red + c.green + c.blue) / 3 > 128);
  }

  // ---------- wiring ----------

  function init() {
    state.settings = loadSettings();
    var box = $("draw");
    DRAW_LABELS.forEach(function (d) {
      var l = document.createElement("label");
      l.className = "check";
      l.innerHTML = "<input type=\"checkbox\" id=\"draw-" + d[0] + "\"> " + esc(d[1]);
      box.appendChild(l);
    });
    renderSettings();
    renderPeek();
    applyTheme();
    cs.addEventListener("com.adobe.csxs.events.ThemeColorChanged", applyTheme);

    var change = function () { saveSettings(); renderSettings(); };
    $("fitTol").addEventListener("input", function () { state.settings.fitTol = Number(this.value); change(); });
    $("snapTol").addEventListener("input", function () { state.settings.snapTol = Number(this.value); change(); });
    $("snap").addEventListener("change", function () { state.settings.snap = this.checked; change(); });
    $("system").addEventListener("change", function () { state.settings.system = this.value; change(); });
    $("custom").addEventListener("change", function () { state.settings.custom = this.value; change(); });
    $("weight").addEventListener("change", function () {
      var v = Number(this.value);
      state.settings.weight = v > 0 && isFinite(v) ? Math.min(5, v) : DEFAULTS.weight; change();
    });
    $("labelSize").addEventListener("change", function () {
      var v = Number(this.value);
      state.settings.labelSize = v > 0 && isFinite(v) ? Math.min(5, v) : DEFAULTS.labelSize; change();
    });
    ["swTeal", "swGray"].forEach(function (id) {
      $(id).addEventListener("click", function () { state.settings.color = this.getAttribute("data-color"); change(); });
    });
    DRAW_LABELS.forEach(function (d) {
      $("draw-" + d[0]).addEventListener("change", function () { state.settings.draw[d[0]] = this.checked; change(); });
    });
    $("resetUnit").addEventListener("click", fresh(function () {
      state.pendingUnit = null;
      if (state.peek && state.peek.hasGrid) generate(); else setStatus("", "The best-fit unit is used on the next Generate.");
    }));
    $("generate").addEventListener("click", fresh(generate));
    $("exportFrame").addEventListener("click", fresh(exportFrame));
    loadHost().then(poll);
  }

  init();
})();
