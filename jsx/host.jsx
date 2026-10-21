/* Construction Grid: ExtendScript host.
   Every entry point returns a JSON string: {ok:true, ...} or {ok:false, code, error}.
   CG_read only reads the selection (no document writes, no undo step, no scratch document).
   CG_draw and CG_exportFrame each make one undo step and only ever touch the "Construction" and
   "Guideline frame" layers; the selected artwork is never selected for writing, moved or restyled. */

var CG_VERSION = "0.1.1";
var CG_LAYER = "Construction";
var CG_FRAME_LAYER = "Guideline frame";
var CG_PREFIX = "Grid · ";
var CG_MAX_DEPTH = 12;

// ---------- plumbing ----------

function CG_json(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(Math.round(v * 1000000) / 1000000) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    var s = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    return '"' + s.replace(/[^\x20-\x7e]/g, function (c) { return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4); }) + '"';
  }
  var out = [], i;
  if (v instanceof Array) {
    for (i = 0; i < v.length; i++) out.push(CG_json(v[i]));
    return "[" + out.join(",") + "]";
  }
  for (var k in v) if (v.hasOwnProperty(k)) out.push(CG_json(k) + ":" + CG_json(v[k]));
  return "{" + out.join(",") + "}";
}

// The panel sends JSON with every non-ASCII character escaped, so this whitelist holds.
function CG_parse(s) {
  if (!/^[\s\w\[\]{},:."+\-\\]*$/.test(s)) throw new Error("Unexpected characters in panel payload.");
  return eval("(" + s + ")");
}

// Alerts off and document coordinates (y up) for every call, restored afterwards.
function CG_run(fn) {
  var oldLevel = app.userInteractionLevel, oldCS = app.coordinateSystem, res;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    res = fn() || {};
    res.ok = true;
  } catch (e) {
    res = { ok: false, code: e.cgCode || "internal", error: String(e.message || e) + (e.line ? " (line " + e.line + ")" : "") };
  } finally {
    try { app.coordinateSystem = oldCS; } catch (e2) {}
    try { app.userInteractionLevel = oldLevel; } catch (e3) {}
  }
  return CG_json(res);
}

function CG_fail(code, message) {
  var e = new Error(message);
  e.cgCode = code;
  throw e;
}

function CG_doc() {
  if (app.documents.length === 0) CG_fail("no-document", "No document is open.");
  return app.activeDocument;
}

function CG_layer(doc, name) {
  try { return doc.layers.getByName(name); } catch (e) { return null; }
}

function CG_units(doc) {
  var u = doc.rulerUnits;
  if (u === RulerUnits.Pixels) return "px";
  if (u === RulerUnits.Millimeters) return "mm";
  if (u === RulerUnits.Inches) return "in";
  return "pt";
}

// ---------- selection ----------

function CG_selection(doc) {
  var sel = doc.selection;
  if (!sel || sel.typename === "TextRange") return null;
  var out = [];
  for (var i = 0; i < sel.length; i++) {
    var it = sel[i];
    try { if (it.layer && (it.layer.name === CG_LAYER || it.layer.name === CG_FRAME_LAYER)) continue; } catch (e) {}
    out.push(it);
  }
  return out;
}

function CG_union(items) {
  var b = null;
  for (var i = 0; i < items.length; i++) {
    var g = items[i].geometricBounds;
    if (!b) b = [g[0], g[1], g[2], g[3]];
    else { b[0] = Math.min(b[0], g[0]); b[1] = Math.max(b[1], g[1]); b[2] = Math.max(b[2], g[2]); b[3] = Math.min(b[3], g[3]); }
  }
  return b;
}

// The artboard that owns the selection: the one containing its center. Refused when the
// selection's bounds reach into more than one artboard (Q21).
function CG_artboardFor(doc, b) {
  var hits = [], home = -1, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, i, r;
  for (i = 0; i < doc.artboards.length; i++) {
    r = doc.artboards[i].artboardRect;
    if (b[0] < r[2] && b[2] > r[0] && b[1] > r[3] && b[3] < r[1]) hits.push(i);
    if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) home = i;
  }
  if (hits.length > 1) return { spans: true };
  if (home < 0) return { none: true };
  return { index: home, name: doc.artboards[home].name, rect: doc.artboards[home].artboardRect };
}

function CG_gridGroup(doc, artboardName) {
  var layer = CG_layer(doc, CG_LAYER);
  if (!layer) return null;
  for (var i = 0; i < layer.groupItems.length; i++) if (layer.groupItems[i].name === CG_PREFIX + artboardName) return layer.groupItems[i];
  return null;
}

// ---------- reading geometry ----------

function CG_pathData(p) {
  var pts = p.pathPoints, out = [];
  for (var i = 0; i < pts.length; i++) {
    var q = pts[i];
    out.push({ anchor: [q.anchor[0], q.anchor[1]], left: [q.leftDirection[0], q.leftDirection[1]], right: [q.rightDirection[0], q.rightDirection[1]] });
  }
  return { closed: p.closed, points: out };
}

var CG_REJECT = { TextFrame: "live text", PlacedItem: "placed image", RasterItem: "image", SymbolItem: "symbol", MeshItem: "mesh", PluginItem: "effect object", GraphItem: "graph", LegacyTextItem: "live text" };

// A compound path made from groups reports no pathItems at all; its groups are only reachable
// through doc.groupItems, with the compound as their parent. Built once per read.
function CG_hiddenGroups(doc, cache) {
  if (cache.map) return cache.map;
  var map = {}, gi = doc.groupItems, i, p;
  for (i = 0; i < gi.length; i++) {
    p = gi[i].parent;
    if (p.typename === "CompoundPathItem") (map[p.uuid] = map[p.uuid] || []).push(gi[i]);
  }
  cache.map = map;
  return map;
}

function CG_groupPaths(group, out, depth) {
  if (depth > CG_MAX_DEPTH) return;
  for (var i = 0; i < group.pageItems.length; i++) {
    var it = group.pageItems[i];
    if (it.typename === "PathItem") { if (!it.guides) out.push(CG_pathData(it)); }
    else if (it.typename === "GroupItem") CG_groupPaths(it, out, depth + 1);
    else if (it.typename === "CompoundPathItem") for (var k = 0; k < it.pathItems.length; k++) out.push(CG_pathData(it.pathItems[k]));
  }
}

function CG_collect(item, items, rejected, depth, ctx) {
  if (depth > CG_MAX_DEPTH) return;
  var t = item.typename, i;
  if (t === "PathItem") {
    if (item.guides || item.clipping) return;
    items.push({ paths: [CG_pathData(item)] });
  } else if (t === "CompoundPathItem") {
    var paths = [];
    for (i = 0; i < item.pathItems.length; i++) {
      if (item.pathItems[i].clipping) return;
      paths.push(CG_pathData(item.pathItems[i]));
    }
    if (!item.pathItems.length) {
      var hidden = CG_hiddenGroups(ctx.doc, ctx)[item.uuid] || [];
      for (i = 0; i < hidden.length; i++) CG_groupPaths(hidden[i], paths, depth + 1);
    }
    if (paths.length) items.push({ paths: paths });
  } else if (t === "GroupItem") {
    for (i = 0; i < item.pageItems.length; i++) CG_collect(item.pageItems[i], items, rejected, depth + 1, ctx);
  } else {
    var reason = CG_REJECT[t] || "unsupported object";
    rejected[reason] = (rejected[reason] || 0) + 1;
  }
}

// What a press of Generate would work on. Cheap: no path points are read.
function CG_probe() {
  return CG_run(function () {
    if (app.documents.length === 0) return { doc: false };
    var doc = app.activeDocument, sel = doc.selection;
    if (sel && sel.typename === "TextRange") return { doc: true, editingText: true };
    var items = CG_selection(doc);
    if (!items || !items.length) return { doc: true, count: 0 };
    var b = CG_union(items), ab = CG_artboardFor(doc, b), g = ab.name ? CG_gridGroup(doc, ab.name) : null;
    return { doc: true, count: items.length, artboard: ab.name || null, spans: !!ab.spans, offArtboard: !!ab.none, hasGrid: !!g, note: g ? g.note : null };
  });
}

function CG_read() {
  return CG_run(function () {
    var doc = CG_doc(), sel = doc.selection;
    if (sel && sel.typename === "TextRange") CG_fail("editing-text", "Text is being edited.");
    var top = CG_selection(doc);
    if (!top || !top.length) CG_fail("no-selection", "Nothing is selected.");
    var b = CG_union(top), ab = CG_artboardFor(doc, b);
    if (ab.spans) CG_fail("spans-artboards", "The selection reaches into more than one artboard.");
    if (ab.none) CG_fail("off-artboard", "The selection is not on an artboard.");
    var items = [], rej = {}, rejected = [], k;
    var ctx = { doc: doc };
    for (var i = 0; i < top.length; i++) CG_collect(top[i], items, rej, 0, ctx);
    for (k in rej) if (rej.hasOwnProperty(k)) rejected.push({ reason: k, count: rej[k] });
    if (!items.length) CG_fail(rejected.length ? "nothing-readable" : "no-paths", "No paths in the selection.");
    var g = CG_gridGroup(doc, ab.name);
    return { units: CG_units(doc), items: items, rejected: rejected, artboard: { index: ab.index, name: ab.name }, note: g ? g.note : null };
  });
}

// ---------- drawing ----------

function CG_color(doc, style) {
  var c;
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
    c = new CMYKColor(); c.cyan = style.cmyk[0]; c.magenta = style.cmyk[1]; c.yellow = style.cmyk[2]; c.black = style.cmyk[3];
  } else {
    c = new RGBColor(); c.red = style.rgb[0]; c.green = style.rgb[1]; c.blue = style.rgb[2];
  }
  return c;
}

function CG_font() {
  var names = ["DMMono-Regular", "Menlo-Regular"];
  for (var i = 0; i < names.length; i++) { try { return app.textFonts.getByName(names[i]); } catch (e) {} }
  return null;
}

function CG_stroke(p, color, weight, dash) {
  p.filled = false;
  p.stroked = true;
  p.strokeColor = color;
  p.strokeWidth = weight;
  p.strokeDashes = dash || [];
}

function CG_line(parent, a, b, color, weight, dash) {
  var p = parent.pathItems.add();
  p.setEntirePath([[a[0], a[1]], [b[0], b[1]]]);
  CG_stroke(p, color, weight, dash);
  return p;
}

function CG_drawItem(parent, it, color, weight, font) {
  var p, i;
  if (it.kind === "circle") {
    p = parent.pathItems.ellipse(it.c[1] + it.r, it.c[0] - it.r, 2 * it.r, 2 * it.r);
    CG_stroke(p, color, weight, it.dash);
  } else if (it.kind === "line") {
    CG_line(parent, it.a, it.b, color, weight, it.dash);
  } else if (it.kind === "cross") {
    var h = it.size / 2;
    CG_line(parent, [it.c[0] - h, it.c[1]], [it.c[0] + h, it.c[1]], color, weight);
    CG_line(parent, [it.c[0], it.c[1] - h], [it.c[0], it.c[1] + h], color, weight);
  } else if (it.kind === "dot") {
    p = parent.pathItems.ellipse(it.c[1] + it.r, it.c[0] - it.r, 2 * it.r, 2 * it.r);
    p.stroked = false; p.filled = true; p.fillColor = color;
  } else if (it.kind === "path") {
    p = parent.pathItems.add();
    var segs = it.segments;
    for (i = 0; i <= segs.length; i++) {
      var q = p.pathPoints.add(), s = segs[Math.min(i, segs.length - 1)];
      var anchor = i < segs.length ? s[0] : s[3];
      q.anchor = [anchor[0], anchor[1]];
      q.leftDirection = i > 0 ? [segs[i - 1][2][0], segs[i - 1][2][1]] : q.anchor;
      q.rightDirection = i < segs.length ? [s[1][0], s[1][1]] : q.anchor;
      q.pointType = PointType.CORNER;
    }
    p.closed = !!it.closed;
    CG_stroke(p, color, weight, it.dash);
  } else if (it.kind === "text") {
    var tf = parent.textFrames.pointText([it.at[0], it.at[1]]);
    tf.contents = it.text;
    var attr = tf.textRange.characterAttributes;
    attr.size = it.size;
    if (font) attr.textFont = font;
    attr.fillColor = color;
    attr.strokeColor = new NoColor();
    tf.textRange.paragraphAttributes.justification = it.align === "right" ? Justification.RIGHT : Justification.LEFT;
  }
}

// payload = { artboard: index, groups: [{name, items}], style: {rgb, cmyk, weight}, note }
function CG_draw(json) {
  return CG_run(function () {
    var doc = CG_doc(), o = CG_parse(json);
    if (o.artboard < 0 || o.artboard >= doc.artboards.length) CG_fail("internal", "Unknown artboard.");
    var abName = doc.artboards[o.artboard].name;
    var layer = CG_layer(doc, CG_LAYER);
    if (!layer) { layer = doc.layers.add(); layer.name = CG_LAYER; }
    layer.locked = false;
    layer.visible = true;
    layer.zOrder(ZOrderMethod.BRINGTOFRONT);
    var old = CG_gridGroup(doc, abName);
    if (old) old.remove();
    var grid = layer.groupItems.add();
    grid.name = CG_PREFIX + abName;
    grid.note = o.note || "";
    var color = CG_color(doc, o.style), font = CG_font(), counts = {};
    for (var g = 0; g < o.groups.length; g++) {
      var sub = grid.groupItems.add();
      sub.name = o.groups[g].name;
      sub.move(grid, ElementPlacement.PLACEATBEGINNING);
      for (var i = 0; i < o.groups[g].items.length; i++) CG_drawItem(sub, o.groups[g].items[i], color, o.style.weight, font);
      counts[o.groups[g].name] = o.groups[g].items.length;
    }
    layer.locked = true;
    return { artboard: abName, counts: counts, fontFound: !!font };
  });
}

// ---------- guideline frame ----------

function CG_uniqueArtboardName(doc, base) {
  var name = base, n = 2, taken;
  do {
    taken = false;
    for (var i = 0; i < doc.artboards.length; i++) if (doc.artboards[i].name === name) { taken = true; break; }
    if (taken) name = base + " " + n++;
  } while (taken);
  return name;
}

// payload = { artboard: index, scale } : a 1920 × 1080 artboard to the right of the others with a
// copy of the selected logo (15% opacity) and of that artboard's grid (strokes keep their weight).
function CG_exportFrame(json) {
  return CG_run(function () {
    var doc = CG_doc(), o = CG_parse(json), top = CG_selection(doc);
    if (!top || !top.length) CG_fail("no-selection", "Nothing is selected.");
    var abName = doc.artboards[o.artboard].name, grid = CG_gridGroup(doc, abName);
    if (!grid) CG_fail("no-grid", "There is no grid for this artboard yet.");

    var right = -Infinity, topEdge = 0, i, r;
    for (i = 0; i < doc.artboards.length; i++) {
      r = doc.artboards[i].artboardRect;
      if (r[2] > right) { right = r[2]; topEdge = r[1]; }
    }
    var rect = [right + 200, topEdge, right + 200 + 1920, topEdge - 1080];
    var ab = doc.artboards.add(rect);
    ab.name = CG_uniqueArtboardName(doc, abName + " · guideline");

    var layer = CG_layer(doc, CG_LAYER), frameLayer = CG_layer(doc, CG_FRAME_LAYER);
    if (!frameLayer) { frameLayer = doc.layers.add(); frameLayer.name = CG_FRAME_LAYER; }
    frameLayer.locked = false;
    layer.locked = false;
    frameLayer.move(layer, ElementPlacement.PLACEAFTER);

    // The selection is left alone: clearing and restoring it in a call that also changes the
    // document makes Edit > Undo revert nothing. Duplicating a selected item works in the same doc.
    var logo = frameLayer.groupItems.add();
    logo.name = "Logo · " + ab.name;
    for (i = top.length - 1; i >= 0; i--) top[i].duplicate(logo, ElementPlacement.PLACEATBEGINNING);
    var copy = grid.duplicate(layer, ElementPlacement.PLACEATBEGINNING);
    copy.name = CG_PREFIX + ab.name;

    // transform()'s line-width argument is a factor, not a percent: 1 keeps the grid's weights,
    // o.scale scales the logo's own strokes with it.
    var b = logo.geometricBounds, s = o.scale * 100, m = app.getScaleMatrix(s, s);
    logo.transform(m, true, true, true, true, o.scale, Transformation.DOCUMENTORIGIN);
    copy.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    b = logo.geometricBounds;
    var dx = (rect[0] + rect[2]) / 2 - (b[0] + b[2]) / 2, dy = (rect[1] + rect[3]) / 2 - (b[1] + b[3]) / 2;
    logo.translate(dx, dy);
    copy.translate(dx, dy);
    logo.opacity = 15;
    layer.locked = true;

    return { artboard: ab.name, index: doc.artboards.length - 1 };
  });
}

// ---------- test support (read-only) ----------

// Geometry and style of everything outside the grid layers, for the "originals untouched" check.
function CG_fingerprint() {
  return CG_run(function () {
    var doc = CG_doc(), out = [], i, ctx = { doc: doc };
    var walk = function (it) {
      var rec = { t: it.typename, b: it.geometricBounds, o: it.opacity }, k;
      if (it.typename === "PathItem") {
        rec.p = CG_pathData(it);
        rec.f = it.filled; rec.s = it.stroked; rec.w = it.strokeWidth;
      }
      out.push(rec);
      if (it.typename === "GroupItem") for (k = 0; k < it.pageItems.length; k++) walk(it.pageItems[k]);
      if (it.typename === "CompoundPathItem") {
        for (k = 0; k < it.pathItems.length; k++) walk(it.pathItems[k]);
        var hidden = it.pathItems.length ? [] : (CG_hiddenGroups(doc, ctx)[it.uuid] || []);
        for (k = 0; k < hidden.length; k++) walk(hidden[k]);
      }
    };
    var walkLayer = function (L) {
      if (L.name === CG_LAYER || L.name === CG_FRAME_LAYER) return;
      for (var j = 0; j < L.pageItems.length; j++) if (L.pageItems[j].parent.typename === "Layer") walk(L.pageItems[j]);
      for (var k = 0; k < L.layers.length; k++) walkLayer(L.layers[k]);
    };
    for (i = 0; i < doc.layers.length; i++) walkLayer(doc.layers[i]);
    return { items: out };
  });
}
