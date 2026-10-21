/* Construction Grid: pure analysis. Plain document coordinates (y up); jsx/host.jsx reads and draws.
   A point is { anchor, left, right } as [x, y] arrays, like Illustrator's PathPoint. */
(function (factory) {
  var sc = typeof SC !== 'undefined' ? SC : (typeof require === 'function' ? require('./vendor/engine-core.js') : null);
  var api = factory(sc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Grid = api;
})(function (SC) {
  var FRAME_H = 648, FRAME_W = 1536;   // logo box in the 1920 × 1080 guideline frame (60% high, 80% wide)
  var FRAME_DEV = 0.5;                 // max deviation, in pt at frame scale (PLAN Q23)
  var DEG = Math.PI / 180;

  // ---------- vectors ----------

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
  function dist(a, b) { return len(sub(a, b)); }
  function norm(a) { var l = len(a); return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]; }
  function angleBetween(a, b) { return Math.atan2(Math.abs(cross(a, b)), dot(a, b)); }

  // ---------- cubic Bézier ----------

  function at(s, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s.p0[0] + b * s.p1[0] + c * s.p2[0] + d * s.p3[0], a * s.p0[1] + b * s.p1[1] + c * s.p2[1] + d * s.p3[1]];
  }

  // Roots in [0, 1] of the derivative of one coordinate (for extrema).
  function extremaT(s, k) {
    var a = -s.p0[k] + 3 * s.p1[k] - 3 * s.p2[k] + s.p3[k], b = 2 * (s.p0[k] - 2 * s.p1[k] + s.p2[k]), c = s.p1[k] - s.p0[k];
    var out = [], disc, q;
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) out.push(-c / b); }
    else {
      disc = b * b - 4 * a * c;
      if (disc >= 0) { q = Math.sqrt(disc); out.push((-b + q) / (2 * a), (-b - q) / (2 * a)); }
    }
    return out.filter(function (t) { return t > 1e-9 && t < 1 - 1e-9; });
  }

  function startTangent(s) {
    var d = sub(s.p1, s.p0);
    if (len(d) < 1e-9) d = sub(s.p2, s.p0);
    if (len(d) < 1e-9) d = sub(s.p3, s.p0);
    return norm(d);
  }

  function endTangent(s) {
    var d = sub(s.p3, s.p2);
    if (len(d) < 1e-9) d = sub(s.p3, s.p1);
    if (len(d) < 1e-9) d = sub(s.p3, s.p0);
    return norm(d);
  }

  function sample(s, n) {
    var out = [];
    for (var i = 0; i <= n; i++) out.push(at(s, i / n));
    return out;
  }

  function polyLength(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

  function distToLine(p, a, b) {
    var d = sub(b, a), l = len(d);
    return l < 1e-12 ? dist(p, a) : Math.abs(cross(d, sub(p, a))) / l;
  }

  // ---------- input to segments ----------

  function segmentsOf(path, pathId) {
    var pts = path.points, n = pts.length, out = [], i, j, s, chord, gap = false;
    var count = path.closed ? n : n - 1;
    for (i = 0; i < count; i++) {
      j = (i + 1) % n;
      s = { p0: pts[i].anchor, p1: pts[i].right, p2: pts[j].left, p3: pts[j].anchor, path: pathId, index: i };
      chord = dist(s.p0, s.p3);
      // A zero-length segment is dropped, but it still separates its neighbours (two Smooth Corners
      // corners clamped against each other meet on one).
      if (chord < 1e-7 && dist(s.p0, s.p1) < 1e-7 && dist(s.p3, s.p2) < 1e-7) { gap = true; continue; }
      s.breakBefore = gap; gap = false;
      out.push(s);
    }
    if (gap && out.length) out[0].breakBefore = true;
    return { closed: !!path.closed, segments: out };
  }

  function boundsOf(paths) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    function grow(p) {
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    }
    paths.forEach(function (pa) {
      pa.segments.forEach(function (s) {
        grow(s.p0); grow(s.p3);
        extremaT(s, 0).concat(extremaT(s, 1)).forEach(function (t) { grow(at(s, t)); });
      });
    });
    return b;
  }

  // ---------- circle fit (Taubin, then Gauss–Newton) ----------

  // Chernov's Newton-based Taubin fit: algebraic, nearly unbiased on short arcs.
  function taubin(pts) {
    var n = pts.length, mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    var Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0, Mzz = 0;
    for (i = 0; i < n; i++) {
      var x = pts[i][0] - mx, y = pts[i][1] - my, z = x * x + y * y;
      Mxx += x * x; Myy += y * y; Mxy += x * y; Mxz += x * z; Myz += y * z; Mzz += z * z;
    }
    Mxx /= n; Myy /= n; Mxy /= n; Mxz /= n; Myz /= n; Mzz /= n;
    var Mz = Mxx + Myy, covXY = Mxx * Myy - Mxy * Mxy, varZ = Mzz - Mz * Mz;
    var A3 = 4 * Mz, A2 = -3 * Mz * Mz - Mzz;
    var A1 = varZ * Mz + 4 * covXY * Mz - Mxz * Mxz - Myz * Myz;
    var A0 = Mxz * (Mxz * Myy - Myz * Mxy) + Myz * (Myz * Mxx - Mxz * Mxy) - varZ * covXY;
    var X = 0, Y = A0;
    for (i = 0; i < 99; i++) {
      var Dy = A1 + X * (2 * A2 + 3 * A3 * X), Xn = X - Y / Dy;
      if (Xn === X || !isFinite(Xn)) break;
      var Yn = A0 + Xn * (A1 + Xn * (A2 + Xn * A3));
      if (Math.abs(Yn) >= Math.abs(Y)) break;
      X = Xn; Y = Yn;
    }
    var det = X * X - X * Mz + covXY;
    if (Math.abs(det) < 1e-300) return null;
    var cx = (Mxz * (Myy - X) - Myz * Mxy) / det / 2, cy = (Myz * (Mxx - X) - Mxz * Mxy) / det / 2;
    var r = Math.sqrt(cx * cx + cy * cy + Mz);
    return isFinite(r) ? { c: [cx + mx, cy + my], r: r } : null;
  }

  // Geometric refinement: minimise the sum of squared radial distances.
  function refine(fit, pts) {
    var a = fit.c[0], b = fit.c[1], r = fit.r;
    for (var it = 0; it < 2; it++) {
      var N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i][0] - a, dy = pts[i][1] - b, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-12) continue;
        var J = [-dx / d, -dy / d, -1], e = d - r;
        for (var p = 0; p < 3; p++) { g[p] += J[p] * e; for (var q = 0; q < 3; q++) N[p][q] += J[p] * J[q]; }
      }
      var step = solve3(N, g);
      if (!step) break;
      a -= step[0]; b -= step[1]; r -= step[2];
    }
    return { c: [a, b], r: r };
  }

  function solve3(A, v) {
    var m = [A[0].concat(v[0]), A[1].concat(v[1]), A[2].concat(v[2])], i, j, k;
    for (i = 0; i < 3; i++) {
      var piv = i;
      for (j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[piv][i])) piv = j;
      if (Math.abs(m[piv][i]) < 1e-300) return null;
      var t = m[i]; m[i] = m[piv]; m[piv] = t;
      for (j = i + 1; j < 3; j++) { var f = m[j][i] / m[i][i]; for (k = i; k < 4; k++) m[j][k] -= f * m[i][k]; }
    }
    var x = [0, 0, 0];
    for (i = 2; i >= 0; i--) { var sum = m[i][3]; for (j = i + 1; j < 3; j++) sum -= m[i][j] * x[j]; x[i] = sum / m[i][i]; }
    return x;
  }

  function fitCircle(pts) {
    var f = taubin(pts);
    if (!f) return null;
    f = refine(f, pts);
    var dev = 0;
    for (var i = 0; i < pts.length; i++) dev = Math.max(dev, Math.abs(dist(pts[i], f.c) - f.r));
    f.dev = dev;
    return f;
  }

  function sweepOf(pts, c) {
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      var a0 = Math.atan2(pts[i - 1][1] - c[1], pts[i - 1][0] - c[0]), a1 = Math.atan2(pts[i][1] - c[1], pts[i][0] - c[0]);
      var d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
    }
    return Math.abs(total);
  }

  // ---------- analysis ----------

  var DEFAULTS = { fitTol: null, snapTol: null, system: 'golden', custom: [], snap: false, unitR: null, labelScale: 1, draw: null };
  var DRAW = { circles: true, smoothCorners: true, tangents: true, lines: true, horizontals: true, verticals: false, centers: true, labels: true, loose: false };

  // ---------- ratio series (PHI and FIB as in Golden Scale) ----------

  var PHI = 1.6180339887498949;
  var FIB = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

  function powers(base) { var out = []; for (var n = -4; n <= 4; n++) out.push(Math.pow(base, n)); return out; }

  function seriesFor(opt) {
    if (opt.system === 'golden') return powers(PHI);
    if (opt.system === 'root2') return powers(Math.SQRT2);
    if (opt.system === 'fibonacci') return FIB.slice();
    if (opt.system === 'custom') return (opt.custom || []).filter(function (x) { return x > 0 && isFinite(x); });
    return [];
  }

  function analyze(input, settings) {
    var opt = {}, k;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    for (k in settings || {}) opt[k] = settings[k];

    var paths = [];
    (input.items || []).forEach(function (item, ii) {
      (item.paths || []).forEach(function (p, pi) { paths.push(segmentsOf(p, ii + '.' + pi)); });
    });
    var b = boundsOf(paths), W = Math.max(b[2] - b[0], 1e-9), H = Math.max(b[3] - b[1], 1e-9);
    var frameScale = Math.min(FRAME_H / H, FRAME_W / W);
    var beta = opt.fitTol != null ? opt.fitTol * H : FRAME_DEV / frameScale;
    var size = Math.max(W, H);
    var unit = UNIT_PT[input.units] ? input.units : 'pt';
    var snapBeta = opt.snapTol != null ? opt.snapTol * H : FRAME_DEV / frameScale;
    var ctx = { beta: beta, snapBeta: snapBeta, frameScale: frameScale, size: size, unit: unit, rejected: [] };

    paths.forEach(function (pa) { classify(pa, ctx); });
    var arcs = [], corners = [];
    paths.forEach(function (pa) {
      curvedRuns(pa).forEach(function (run) {
        var split = splitRun(run, ctx);
        split.corners.forEach(function (c) { c.label = cornerLabel(c, ctx); corners.push(c); });
        split.rest.forEach(function (r) { arcs = arcs.concat(fitRun(r, ctx)); });
      });
    });

    var circles = mergeArcs(arcs, ctx);
    var clusters = clusterRadii(circles, corners, ctx);
    var series = seriesFor(opt), fib = opt.system === 'fibonacci';
    var u = pickUnit(clusters, series, opt, ctx);
    clusters.forEach(function (cl) { snapCluster(cl, u.r, series, opt, ctx); });
    clusters.forEach(function (cl) { labelCluster(cl, u.r, fib, opt, ctx); });

    ctx.bounds = b; ctx.W = W; ctx.H = H; ctx.ext = 0.04 * size;
    var horizontals = keyHorizontals(paths, ctx), verticals = keyVerticals(paths, ctx);
    circles.forEach(function (c) {
      c.drawR = c.cluster.snapped ? c.cluster.snappedR : c.r;
      c.drawC = c.c.slice();
    });
    if (opt.snap && series.length) snapCenters(circles, horizontals, verticals, u.r, series, ctx);
    markOwners(circles, corners);
    var straight = [];
    paths.forEach(function (pa) { pa.segments.forEach(function (sg, i) { if (sg.straight) straight.push({ s: sg, pa: pa, i: i }); }); });
    var lines = edgeLines(straight, ctx);
    var tangents = tangentLines(straight, lines, ctx);

    var model = {
      budget: beta,
      snapBudget: snapBeta,
      frameScale: frameScale,
      bounds: b,
      unit: unit,
      unitR: u.r,
      unitOverrideLost: u.lost,
      circles: circles,
      smoothCorners: corners,
      clusters: clusters.filter(function (cl) { return cl.circles.length; }),
      tangents: tangents,
      lines: lines,
      horizontals: horizontals,
      verticals: verticals,
      rejected: ctx.rejected
    };
    var cornerGroups = groupCorners(corners);
    model.report = report(model, cornerGroups, input);
    model.draw = drawModel(model, cornerGroups, opt, ctx);
    return model;
  }

  // ---------- report ----------

  function groupCorners(corners) {
    var groups = [];
    corners.forEach(function (c) {
      for (var i = 0; i < groups.length; i++) if (groups[i].label === c.label) { groups[i].corners.push(c); return; }
      groups.push({ label: c.label, corners: [c] });
    });
    return groups;
  }

  function report(m, cornerGroups, input) {
    var reasons = {};
    m.rejected.forEach(function (r) { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    (input.rejected || []).forEach(function (r) { reasons[r.reason] = (reasons[r.reason] || 0) + (r.count || 1); });
    return {
      circles: m.clusters.map(function (cl) {
        return { letter: cl.letter, r: cl.r, count: cl.circles.length, label: cl.label, ratio: cl.ratio, snapped: cl.snapped,
          offSeries: cl.snapped === false && cl.sigma != null, errorPct: cl.errorPct, devPt: cl.devPt };
      }),
      smoothCorners: cornerGroups.map(function (g) {
        var c = g.corners[0], outside = c.mode === 'cubic' && (c.value < 0.4 - 5e-4 || c.value > 1 + 5e-4);
        return { label: g.label, count: g.corners.length, mode: c.mode, R: c.R, value: c.value, note: outside ? 'outside Smooth Corners range' : null };
      }),
      tangents: m.tangents.length,
      lines: m.lines.length,
      horizontals: m.horizontals.map(function (h) { return { label: h.label, y: h.y }; }),
      rejected: Object.keys(reasons).map(function (k) {
        var r = { reason: k, count: reasons[k] };
        if (k === 'not circular') r.curves = curveList(m, input);
        return r;
      })
    };
  }

  // Where each curve that isn't a circle is: its shape (by name, or counted from the left) and its
  // midpoint in artboard coordinates (y down, as Illustrator shows them), in the document's units.
  function curveList(m, input) {
    var items = input.items || [], rect = input.artboard && input.artboard.rect, unit = UNIT_PT[m.unit];
    var left = items.map(function (it) {
      var x = Infinity;
      (it.paths || []).forEach(function (p) { p.points.forEach(function (q) { x = Math.min(x, q.anchor[0]); }); });
      return x;
    });
    var order = left.map(function (x, i) { return i; }).sort(function (a, b) { return left[a] - left[b]; });
    return m.rejected.filter(function (r) { return r.reason === 'not circular'; }).map(function (r) {
      var ii = Number(String(r.segment.path).split('.')[0]), mid = at(r.segment, 0.5);
      var p = rect ? [mid[0] - rect[0], rect[1] - mid[1]] : mid;
      return {
        element: items[ii].name || 'shape ' + (order.indexOf(ii) + 1) + ' from the left',
        at: [Math.round(p[0] / unit * 10) / 10, Math.round(p[1] / unit * 10) / 10]
      };
    });
  }

  // ---------- draw model (what the host draws, grouped by element type) ----------

  function textBox(t) {
    var w = t.text.length * t.size * 0.6, x0 = t.align === 'right' ? t.at[0] - w : t.at[0];
    return [x0, t.at[1] - t.size * 0.25, x0 + w, t.at[1] + t.size * 0.8];
  }

  function overlaps(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }

  // Does segment a-b cross box r? (Liang-Barsky clipping.)
  function segmentHits(a, b, r) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var pq = [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dy, a[1] - r[1]], [dy, r[3] - a[1]]];
    for (var i = 0; i < 4; i++) {
      var p = pq[i][0], q = pq[i][1];
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      if (p < 0) t0 = Math.max(t0, q / p); else t1 = Math.min(t1, q / p);
      if (t0 > t1) return false;
    }
    return true;
  }

  // Does a drawn grid item cross box r? A circle's outline crosses it when the radius lies between
  // the box's nearest and farthest points from the center; curves are checked as 16 chords each.
  function itemHits(it, r) {
    if (it.kind === 'line') return segmentHits(it.a, it.b, r);
    if (it.kind === 'circle') {
      var nx = Math.max(r[0], Math.min(it.c[0], r[2])), ny = Math.max(r[1], Math.min(it.c[1], r[3]));
      var fx = Math.max(Math.abs(r[0] - it.c[0]), Math.abs(r[2] - it.c[0])), fy = Math.max(Math.abs(r[1] - it.c[1]), Math.abs(r[3] - it.c[1]));
      return dist([nx, ny], it.c) <= it.r && it.r <= Math.sqrt(fx * fx + fy * fy);
    }
    if (it.kind === 'dot' || it.kind === 'cross') {
      var h = it.kind === 'dot' ? it.r : it.size / 2;
      return overlaps([it.c[0] - h, it.c[1] - h, it.c[0] + h, it.c[1] + h], r);
    }
    return it.segments.some(function (sg) {
      var pts = sample({ p0: sg[0], p1: sg[1], p2: sg[2], p3: sg[3] }, 16);
      for (var i = 1; i < pts.length; i++) if (segmentHits(pts[i - 1], pts[i], r)) return true;
      return false;
    });
  }

  function drawModel(m, cornerGroups, opt, ctx) {
    var on = {}, k;
    for (k in DRAW) on[k] = DRAW[k];
    for (k in opt.draw || {}) on[k] = opt.draw[k];
    var size = Math.max(5, 0.012 * ctx.size) * (opt.labelScale || 1), mark = 0.6 * size;
    var groups = [], labels = [], boxes = [m.bounds];
    var put = function (name, items) { if (items.length) groups.push({ name: name, items: items }); };

    if (on.circles) put('Circles', m.circles.map(function (c) { return { kind: 'circle', c: c.drawC, r: c.drawR }; }));
    if (on.loose) put('Loose fits', m.rejected.filter(function (r) { return r.reason === 'not circular' && r.fit && r.fit.dev <= 5 * ctx.beta; })
      .map(function (r) { return { kind: 'circle', c: r.fit.c, r: r.fit.r }; }));
    if (on.smoothCorners) {
      var items = [];
      m.smoothCorners.forEach(function (c) {
        items.push({ kind: 'path', closed: false, segments: c.segments.map(function (sg) { return [sg.p0, sg.p1, sg.p2, sg.p3]; }) });
        [[c.S, startTangent(c.segments[0])], [c.E, endTangent(c.segments[c.segments.length - 1])]].forEach(function (pt) {
          var n = [-pt[1][1] * mark / 2, pt[1][0] * mark / 2];
          items.push({ kind: 'line', a: sub(pt[0], n), b: add(pt[0], n) });
        });
        items.push({ kind: 'dot', c: c.V, r: 0.15 * size });
      });
      put('Smooth corners', items);
    }
    if (on.tangents) put('Tangents', m.tangents.map(function (t) { return { kind: 'line', a: t.a, b: t.b }; }));
    if (on.lines) put('Lines', m.lines.map(function (l) { return { kind: 'line', a: l.a, b: l.b }; }));
    var hItems = m.horizontals.map(function (h) { return { kind: 'line', a: h.a, b: h.b, dash: [4, 3] }; });
    if (on.horizontals) put('Horizontals', hItems);
    if (on.verticals) put('Verticals', m.verticals.map(function (v) { return { kind: 'line', a: v.a, b: v.b, dash: [4, 3] }; }));
    if (on.centers) {
      var seen = [];
      m.circles.forEach(function (c) {
        if (seen.some(function (p) { return dist(p, c.drawC) <= ctx.beta; })) return;
        seen.push(c.drawC);
      });
      put('Centers', seen.map(function (p) { return { kind: 'cross', c: p, size: mark }; }));
    }

    if (on.labels) {
      // Every drawn grid item blocks labels too, except a horizontal's own name in the margin.
      // Leaders join the drawn items as they're placed; texts lists the placed label boxes.
      var drawn = [], texts = [];
      groups.forEach(function (g) { drawn = drawn.concat(g.items); });
      var crossings = function (box, own) {
        return boxes.filter(function (b) { return overlaps(b, box); }).length +
          drawn.filter(function (it) { return it !== own && itemHits(it, box); }).length;
      };
      var clear = function (box, own) { return crossings(box, own) === 0; };
      var place = function (text, from, dir, gap) {
        var at = add(from, mul(dir, gap));
        var t = { kind: 'text', text: text, size: size, align: dir[0] < 0 ? 'right' : 'left', at: dir[1] < 0 ? [at[0], at[1] - size * 0.8] : at };
        return t;
      };
      var keep = function (t) { boxes.push(textBox(t)); texts.push(textBox(t)); labels.push(t); };
      // The first option whose text and leader are clear, or the one crossing the fewest things.
      // The leader runs from the logo to just short of its text and may not cross another label.
      var placeWithLeader = function (text, options) {
        var chosen = null, least = Infinity;
        for (var i = 0; i < options.length && least > 0; i++) {
          var o = options[i], t = place(text, o.from, o.dir, o.gap);
          var line = { kind: 'line', a: o.from, b: add(o.from, mul(o.dir, o.gap - 0.3 * size)) };
          var n = crossings(textBox(t)) + texts.filter(function (b) { return segmentHits(line.a, line.b, b); }).length;
          if (n < least) { least = n; chosen = { t: t, line: line }; }
        }
        keep(chosen.t);
        labels.push(chosen.line);
        drawn.push(chosen.line);
      };
      // Leaving the logo along d, then further out in steps until clear of lines and labels.
      var outward = function (from, d) {
        var base = Math.max(1.5 * size, exitDistance(from, d, m.bounds) + 0.5 * size);
        return [0, 1.5, 3, 4.5, 6, 7.5, 9].map(function (step) { return { from: from, dir: d, gap: base + step * size }; });
      };
      var rotate = function (d, deg) { var c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG); return [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c]; };

      // Horizontal names sit in the left margin; one too close to the last goes to the right margin.
      if (on.horizontals) m.horizontals.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (h) {
        var y = h.y - size * 0.3, gap = 0.4 * size;
        var left = { kind: 'text', text: h.label, size: size, align: 'right', at: [h.a[0] - gap, y] };
        var right = { kind: 'text', text: h.label, size: size, align: 'left', at: [h.b[0] + gap, y] };
        var own = hItems[m.horizontals.indexOf(h)];
        keep(clear(textBox(left), own) || !clear(textBox(right), own) ? left : right);
      });
      if (on.circles) m.clusters.forEach(function (cl) {
        var c = cl.circles.slice().sort(function (a, b) { return b.length - a.length; })[0];
        var options = [];
        [45, 135, 315, 225].forEach(function (deg) {
          var d = [Math.cos(deg * DEG), Math.sin(deg * DEG)];
          options = options.concat(outward(add(c.drawC, mul(d, c.drawR)), d));
        });
        placeWithLeader(cl.label, options);
      });
      // Groups with the fewest corners have the fewest spots to choose from, so they go first.
      if (on.smoothCorners) cornerGroups.slice().sort(function (a, b) { return a.corners.length - b.corners.length; }).forEach(function (g) {
        var options = [];
        [0, 45, -45].forEach(function (deg) {
          g.corners.forEach(function (c) {
            var d = rotate(norm(sub(c.V, mul(add(c.S, c.E), 0.5))), deg);
            options = options.concat(outward(c.V, d));
          });
        });
        placeWithLeader(g.label, options);
      });
      put('Labels', labels);
    }
    return { labelSize: size, groups: groups };
  }

  // How far from p along d until it leaves the box (0 when already outside).
  function exitDistance(p, d, box) {
    var t = Infinity;
    if (d[0] > 1e-9) t = Math.min(t, (box[2] - p[0]) / d[0]);
    if (d[0] < -1e-9) t = Math.min(t, (box[0] - p[0]) / d[0]);
    if (d[1] > 1e-9) t = Math.min(t, (box[3] - p[1]) / d[1]);
    if (d[1] < -1e-9) t = Math.min(t, (box[1] - p[1]) / d[1]);
    return isFinite(t) ? Math.max(0, t) : 0;
  }

  // ---------- radius clusters, unit, snap ----------

  // Radii of circles and smooth corners within the budget of a cluster's mean join it.
  // Clusters holding a circle get letters, largest first.
  function clusterRadii(circles, corners, ctx) {
    var items = circles.map(function (c) { return { r: c.r, circle: c }; })
      .concat(corners.map(function (c) { return { r: c.R, corner: c }; }))
      .sort(function (a, b) { return a.r - b.r; });
    var out = [], cur = null;
    items.forEach(function (it) {
      if (!cur || Math.abs(it.r - cur.r) > ctx.beta) { cur = { r: it.r, circles: [], corners: [], sum: 0 }; out.push(cur); }
      if (it.circle) { cur.circles.push(it.circle); it.circle.cluster = cur; } else { cur.corners.push(it.corner); it.corner.cluster = cur; }
      cur.sum += it.r;
      cur.count = cur.circles.length + cur.corners.length;
      cur.r = cur.sum / cur.count;
    });
    var letter = 0;
    out.slice().reverse().forEach(function (cl) { if (cl.circles.length) cl.letter = String.fromCharCode(65 + letter++); });
    return out;
  }

  function nearestStep(r, u, series) {
    var best = null;
    series.forEach(function (sig) { var d = Math.abs(r - sig * u); if (!best || d < best.d) best = { sigma: sig, d: d }; });
    return best;
  }

  // The unit that lands the most clusters on the series. Ties: more radii landing, lower error,
  // a unit that is a real radius, the radius used most, then the smallest (so ratios read upward).
  function pickUnit(clusters, series, opt, ctx) {
    var i;
    if (!clusters.length) return { r: null, lost: false };
    if (opt.unitR != null) {
      for (i = 0; i < clusters.length; i++) if (Math.abs(clusters[i].r - opt.unitR) <= ctx.beta) return { r: clusters[i].r, lost: false };
    }
    var lost = opt.unitR != null, best = null;
    var better = function (a, b) {
      // Error differences under 0.1% are fitting noise, not a reason to prefer a unit.
      var keys = ['landed', 'members', 'negErr', 'real', 'used', 'negR'], eps = [0, 0, 1e-3, 0, 0, 1e-9];
      for (var k = 0; k < keys.length; k++) {
        if (a[keys[k]] > b[keys[k]] + eps[k]) return true;
        if (a[keys[k]] < b[keys[k]] - eps[k]) return false;
      }
      return false;
    };
    var steps = series.length ? series : [1];
    clusters.forEach(function (c) {
      steps.forEach(function (sig) {
        var u = c.r / sig, cand = { u: u, landed: 0, members: 0, negErr: 0, real: sig === 1 ? 1 : 0, used: sig === 1 ? c.count : 0, negR: -u };
        if (series.length) {
          clusters.forEach(function (o) {
            var st = nearestStep(o.r, u, series);
            if (st.d <= ctx.snapBeta) { cand.landed++; cand.members += o.count; cand.negErr -= st.d / o.r; }
          });
        }
        if (!best || better(cand, best)) best = cand;
      });
    });
    return { r: best.u, lost: lost };
  }

  // A cluster snaps when every member drawn at the series radius stays within the snap budget.
  function snapCluster(cl, u, series, opt, ctx) {
    cl.ratio = cl.r / u;
    cl.snapped = false;
    if (!opt.snap || !series.length) return;
    var st = nearestStep(cl.r, u, series), r2 = st.sigma * u, worst = 0;
    cl.circles.forEach(function (c) {
      c.samples.forEach(function (p) { worst = Math.max(worst, Math.abs(dist(p, c.c) - r2)); });
    });
    cl.corners.forEach(function (c) { worst = Math.max(worst, Math.abs(c.R - r2)); });
    cl.sigma = st.sigma;
    cl.snappedR = r2;
    cl.errorPct = (r2 - cl.r) / cl.r * 100;
    cl.devPt = worst * ctx.frameScale;
    cl.snapped = worst <= ctx.snapBeta;
  }

  function ratioText(x, fib, places) { return fib ? num(x, places) + 'u' : '1 : ' + num(x, places); }

  function labelCluster(cl, u, fib, opt, ctx) {
    var measured = '≈ ' + ratioText(cl.ratio, fib, 2), shown = cl.snapped ? ratioText(cl.sigma, fib, 3) : measured;
    if (cl.letter) cl.label = cl.letter + ' · ' + (opt.snap ? shown : 'R' + lengthText(cl.r, ctx) + ' · ' + measured);
    cl.corners.forEach(function (c) { if (opt.snap) c.label += ' · ' + shown; });
  }

  // ---------- centers ----------

  // Alignment first (another center, a key horizontal or vertical), then the spacing between two
  // aligned centers onto unit × series. A move is kept only if the drawn circle stays in the budget.
  function snapCenters(circles, horizontals, verticals, u, series, ctx) {
    var order = circles.slice().sort(function (a, b) { return b.length - a.length; }), done = [];
    var tol = ctx.snapBeta;
    var fits = function (c, cc) {
      for (var i = 0; i < c.samples.length; i++) if (Math.abs(dist(c.samples[i], cc) - c.drawR) > tol) return false;
      return true;
    };
    order.forEach(function (c) {
      var cc = c.c.slice(), k, axis;
      for (axis = 0; axis < 2; axis++) {
        var targets = done.map(function (o) { return o.drawC[axis]; });
        (axis ? horizontals : verticals).forEach(function (g) { targets.push(axis ? g.y : g.x); });
        var best = null;
        targets.forEach(function (t) { var d = Math.abs(cc[axis] - t); if (d <= tol && (!best || d < best.d)) best = { d: d, t: t }; });
        if (best) cc[axis] = best.t;
      }
      // spacing along the shared axis of an aligned neighbour
      for (k = 0; k < done.length; k++) {
        var o = done[k].drawC;
        for (axis = 0; axis < 2; axis++) {
          if (cc[1 - axis] !== o[1 - axis]) continue;
          var gap = cc[axis] - o[axis], st = nearestStep(Math.abs(gap), u, series);
          if (st && st.d <= tol) cc[axis] = o[axis] + (gap < 0 ? -1 : 1) * st.sigma * u;
        }
      }
      if (fits(c, cc)) c.drawC = cc;
      done.push(c);
    });
  }

  // ---------- lines and tangents ----------

  function markOwners(circles, corners) {
    circles.forEach(function (c) { c.arcs.forEach(function (a) { a.segments.forEach(function (sg) { sg.owner = { circle: c }; }); }); });
    corners.forEach(function (c) { c.segments.forEach(function (sg) { sg.owner = { corner: c }; }); });
  }

  function neighbourOf(pa, i, step) {
    var n = pa.segments.length, j = i + step;
    if (pa.closed) return pa.segments[(j + n) % n];
    return j >= 0 && j < n ? pa.segments[j] : null;
  }

  // Collinear straight segments share an edge line. A line is drawn when it holds at least two
  // separate pieces (Q16); one edge on its own is just an edge.
  function edgeLines(straight, ctx) {
    var groups = [];
    straight.forEach(function (st) {
      var d = norm(sub(st.s.p3, st.s.p0));
      if (d[0] < -1e-12 || (Math.abs(d[0]) <= 1e-12 && d[1] < 0)) d = mul(d, -1);
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (angleBetween(g.d, d) <= 0.5 * DEG && distToLine(st.s.p0, g.o, add(g.o, g.d)) <= ctx.beta && distToLine(st.s.p3, g.o, add(g.o, g.d)) <= ctx.beta) {
          g.members.push(st); return;
        }
      }
      groups.push({ d: d, o: st.s.p0, members: [st] });
    });
    var out = [];
    groups.forEach(function (g) {
      var iv = g.members.map(function (st) {
        var t0 = dot(sub(st.s.p0, g.o), g.d), t1 = dot(sub(st.s.p3, g.o), g.d);
        return [Math.min(t0, t1), Math.max(t0, t1)];
      }).sort(function (x, y) { return x[0] - y[0]; });
      var pieces = 1, end = iv[0][1];
      for (var i = 1; i < iv.length; i++) { if (iv[i][0] > end + ctx.beta) pieces++; end = Math.max(end, iv[i][1]); }
      if (pieces < 2) return;
      var lo = iv[0][0] - ctx.ext, hi = end + ctx.ext;
      out.push({ a: add(g.o, mul(g.d, lo)), b: add(g.o, mul(g.d, hi)), segments: g.members.map(function (st) { return st.s; }) });
    });
    return out;
  }

  // A straight segment that leaves a fitted circle or smooth corner along its tangent.
  function tangentLines(straight, lines, ctx) {
    var covered = [];
    lines.forEach(function (l) { covered = covered.concat(l.segments); });
    var out = [];
    straight.forEach(function (st) {
      if (covered.indexOf(st.s) >= 0) return;
      var d = norm(sub(st.s.p3, st.s.p0)), touch = [];
      var before = neighbourOf(st.pa, st.i, -1), after = neighbourOf(st.pa, st.i, 1);
      if (before && before.owner && angleBetween(endTangent(before), d) <= 2 * DEG) touch.push(before.owner);
      if (after && after.owner && angleBetween(d, startTangent(after)) <= 2 * DEG) touch.push(after.owner);
      if (!touch.length) return;
      var a = st.s.p0, b = st.s.p3, circlesTouched = touch.filter(function (t) { return t.circle; }).map(function (t) { return t.circle; });
      var moved = circlesTouched.filter(function (c) { return c.drawR !== c.r || c.drawC[0] !== c.c[0] || c.drawC[1] !== c.c[1]; });
      if (moved.length) { var re = retangent(a, b, circlesTouched); a = re[0]; b = re[1]; d = norm(sub(b, a)); }
      out.push({ a: sub(a, mul(d, ctx.ext)), b: add(b, mul(d, ctx.ext)), touches: touch });
    });
    return out;
  }

  // Redraw a tangent against snapped circles: shift it onto one circle, or take the common
  // tangent of two that lies nearest the original segment.
  function retangent(a, b, circles) {
    var d = norm(sub(b, a)), n = [-d[1], d[0]];
    var c1 = circles[0], side = dot(sub(c1.c, a), n) > 0 ? 1 : -1;
    var shift = function (c) { return dot(sub(c.drawC, a), n) - side * c.drawR; };
    if (circles.length < 2) { var sh = mul(n, shift(c1)); return [add(a, sh), add(b, sh)]; }
    var c2 = circles[1], best = null;
    commonTangents(c1.drawC, c1.drawR, c2.drawC, c2.drawR).forEach(function (t) {
      var score = angleBetween(norm(sub(t[1], t[0])), d) + dist(t[0], a) / (c1.r + c2.r) + dist(t[1], b) / (c1.r + c2.r);
      var rev = angleBetween(norm(sub(t[0], t[1])), d) + dist(t[1], a) / (c1.r + c2.r) + dist(t[0], b) / (c1.r + c2.r);
      if (rev < score) { t = [t[1], t[0]]; score = rev; }
      if (!best || score < best.score) best = { t: t, score: score };
    });
    return best ? best.t : [a, b];
  }

  // Tangent points of the outer and inner common tangents of two circles.
  function commonTangents(c1, r1, c2, r2) {
    var D = sub(c2, c1), L = len(D), out = [];
    if (L < 1e-12) return out;
    var base = Math.atan2(D[1], D[0]);
    [[r1 - r2, 1], [r1 + r2, -1]].forEach(function (k) {
      var cosA = k[0] / L;
      if (Math.abs(cosA) > 1) return;
      [1, -1].forEach(function (sg) {
        var ang = base + sg * Math.acos(cosA), n = [Math.cos(ang), Math.sin(ang)];
        out.push([add(c1, mul(n, r1)), add(c2, mul(n, k[1] * r2))]);
      });
    });
    return out;
  }

  // ---------- key horizontals and verticals ----------

  // Flat edges and curve extremes along one axis (1 = horizontals at y, 0 = verticals at x).
  function axisCandidates(paths, axis) {
    var other = 1 - axis, out = [];
    paths.forEach(function (pa, pi) {
      var shapeMax = -Infinity, shapeMin = Infinity, own = [];
      pa.segments.forEach(function (sg) {
        shapeMax = Math.max(shapeMax, sg.p0[axis], sg.p3[axis]); shapeMin = Math.min(shapeMin, sg.p0[axis], sg.p3[axis]);
        if (sg.straight) {
          var d = norm(sub(sg.p3, sg.p0));
          if (Math.abs(d[axis]) <= Math.sin(0.5 * DEG)) own.push({ v: (sg.p0[axis] + sg.p3[axis]) / 2, flat: Math.abs(sg.p3[other] - sg.p0[other]), shape: pi });
          return;
        }
        var ts = extremaT(sg, axis);
        if (Math.abs(startTangent(sg)[axis]) <= 1e-6) ts.push(0);
        ts.forEach(function (t) {
          var p = at(sg, t), q0 = at(sg, Math.max(0, t - 0.01)), q1 = at(sg, Math.min(1, t + 0.01));
          var top = Math.max(q0[axis], q1[axis]) <= p[axis] + 1e-12;
          own.push({ v: p[axis], flat: 0, extreme: top ? 'max' : 'min', shape: pi });
        });
      });
      own.forEach(function (c) {
        if (c.flat) c.edge = Math.abs(c.v - shapeMax) < 1e-6 ? 'max' : (Math.abs(c.v - shapeMin) < 1e-6 ? 'min' : null);
        out.push(c);
      });
    });
    return out;
  }

  function clusterValues(cands, tol) {
    var sorted = cands.slice().sort(function (a, b) { return a.v - b.v; }), out = [], cur = null;
    sorted.forEach(function (c) {
      if (!cur || c.v - cur.last > tol) { cur = { members: [], last: c.v }; out.push(cur); }
      cur.members.push(c); cur.last = c.v;
    });
    out.forEach(function (cl) {
      var flats = cl.members.filter(function (m) { return m.flat; }), use = flats.length ? flats : cl.members;
      cl.v = use.reduce(function (s, m) { return s + m.v; }, 0) / use.length;
      cl.flat = flats.reduce(function (s, m) { return s + m.flat; }, 0);
      cl.shapes = {};
      cl.members.forEach(function (m) { cl.shapes[m.shape] = true; });
      cl.shapeCount = Object.keys(cl.shapes).length;
      cl.extremeShapes = {};
      cl.members.forEach(function (m) { if (m.extreme) cl.extremeShapes[m.shape] = true; });
    });
    return out;
  }

  function signedLength(v, ctx) { return (v < 0 ? '−' : '+') + lengthText(Math.abs(v), ctx); }

  function keyHorizontals(paths, ctx) {
    var cl = clusterValues(axisCandidates(paths, 1), ctx.beta), out = [];
    if (!cl.length) return out;
    var qualifies = function (c) { return c.flat >= 0.02 * ctx.W || Object.keys(c.extremeShapes).length >= 2; };
    var q = cl.filter(qualifies), base, cap, rounded = false;
    if (q.length) { base = q[0]; cap = q[q.length - 1]; }
    else { base = cl[0]; cap = cl[cl.length - 1]; rounded = true; }
    var line = function (y, label) { return { y: y, label: label, a: [ctx.bounds[0] - ctx.ext, y], b: [ctx.bounds[2] + ctx.ext, y] }; };
    out.push(line(base.v, 'BASELINE'));
    if (cap !== base) out.push(line(cap.v, 'CAP HEIGHT'));
    if (!rounded) {
      var win = 0.04 * ctx.H, below = null, above = null;
      cl.forEach(function (c) {
        var lowEx = c.members.some(function (m) { return m.extreme === 'min'; }), highEx = c.members.some(function (m) { return m.extreme === 'max'; });
        if (lowEx && c.v < base.v - ctx.beta && c.v >= base.v - win && (!below || c.v < below.v)) below = c;
        if (highEx && c.v > cap.v + ctx.beta && c.v <= cap.v + win && (!above || c.v > above.v)) above = c;
      });
      if (below) out.push(line(below.v, 'OVERSHOOT ' + signedLength(below.v - base.v, ctx)));
      if (above) out.push(line(above.v, 'OVERSHOOT ' + signedLength(above.v - cap.v, ctx)));
      var hgt = cap.v - base.v;
      cl.forEach(function (c) {
        if (c === base || c === cap || c.v < base.v + 0.4 * hgt || c.v > base.v + 0.8 * hgt) return;
        var tops = {};
        c.members.forEach(function (m) { if (m.extreme === 'max' || m.edge === 'max') tops[m.shape] = true; });
        if (Object.keys(tops).length >= 2 && !out.some(function (h) { return h.label === 'X-HEIGHT'; })) out.push(line(c.v, 'X-HEIGHT'));
      });
    }
    return out;
  }

  // Stems shared by two or more vertical edges, plus the mirror axis of a symmetric mark.
  function keyVerticals(paths, ctx) {
    var out = [], line = function (x, label) { return { x: x, label: label, a: [x, ctx.bounds[1] - ctx.ext], b: [x, ctx.bounds[3] + ctx.ext] }; };
    clusterValues(axisCandidates(paths, 0), ctx.beta).forEach(function (c) {
      var flats = c.members.filter(function (m) { return m.flat; });
      if (flats.length >= 2 && c.flat >= 0.02 * ctx.H) out.push(line(c.v, 'STEM'));
    });
    var pts = [];
    paths.forEach(function (pa) { pa.segments.forEach(function (sg) { pts = pts.concat(sg.samples); }); });
    if (pts.length && pts.length <= 4000) {
      var cx = (ctx.bounds[0] + ctx.bounds[2]) / 2, total = 0;
      pts.forEach(function (p) {
        var m = [2 * cx - p[0], p[1]], best = Infinity;
        for (var i = 0; i < pts.length; i++) best = Math.min(best, dist(m, pts[i]));
        total += best;
      });
      if (total / pts.length <= ctx.beta) out.push(line(cx, 'AXIS'));
    }
    return out;
  }

  // ---------- grid note (settings kept on the artboard's grid group) ----------

  function encodeNote(o) { return 'construction-grid ' + JSON.stringify({ v: 1, system: o.system, unitR: o.unitR == null ? null : o.unitR }); }

  function decodeNote(note) {
    var m = /^construction-grid (\{.*\})$/.exec(String(note || ''));
    if (!m) return null;
    try { var o = JSON.parse(m[1]); return o && o.v === 1 ? o : null; } catch (e) { return null; }
  }

  function classify(pa, ctx) {
    pa.segments.forEach(function (s) {
      var tol = ctx.beta / 4, L = dist(s.p0, s.p3);
      var flat = distToLine(s.p1, s.p0, s.p3) <= tol && distToLine(s.p2, s.p0, s.p3) <= tol;
      if (flat && L > 0) {
        var d = norm(sub(s.p3, s.p0)), t1 = dot(sub(s.p1, s.p0), d), t2 = dot(sub(s.p2, s.p0), d);
        flat = t1 >= -tol && t1 <= L + tol && t2 >= -tol && t2 <= L + tol;
      }
      s.straight = flat;
      s.samples = sample(s, Math.min(64, Math.max(16, Math.ceil(polyLength(sample(s, 8)) / (4 * ctx.beta)))));
      s.length = polyLength(s.samples);
    });
  }

  // G1 continuity between two curved segments: tangents within 2°, no retracted handle at the join.
  function continues(a, b) {
    if (b.breakBefore || dist(a.p3, a.p2) < 1e-9 || dist(b.p1, b.p0) < 1e-9) return false;
    return angleBetween(endTangent(a), startTangent(b)) <= 2 * DEG;
  }

  // Maximal runs of G1-continuous curved segments, with the segments just before and after them
  // (null at the ends of an open path). A closed path made of nothing else is one cyclic run.
  function curvedRuns(pa) {
    var segs = pa.segments, n = segs.length, runs = [], i;
    if (!n) return runs;
    var allCurved = segs.every(function (s) { return !s.straight; });
    if (pa.closed && allCurved) {
      var breakAt = -1;
      for (i = 0; i < n; i++) if (!continues(segs[i], segs[(i + 1) % n])) { breakAt = i; break; }
      if (breakAt < 0) return [{ segments: segs.slice(), cyclic: true, prev: null, next: null }];
      segs = segs.slice(breakAt + 1).concat(segs.slice(0, breakAt + 1));
    } else if (pa.closed) {
      for (i = 0; i < n; i++) if (segs[i].straight) break;
      segs = segs.slice(i + 1).concat(segs.slice(0, i + 1));
    }
    var neighbour = function (k) { return pa.closed ? segs[(k + n) % n] : (k >= 0 && k < n ? segs[k] : null); };
    var cur = null;
    for (i = 0; i < n; i++) {
      var s = segs[i];
      if (s.straight) { cur = null; continue; }
      if (cur && continues(cur.segments[cur.segments.length - 1], s)) { cur.segments.push(s); cur.next = neighbour(i + 1); }
      else { cur = { segments: [s], cyclic: false, prev: neighbour(i - 1), next: neighbour(i + 1) }; runs.push(cur); }
    }
    return runs;
  }

  // ---------- smooth corners (Smooth Corners output, checked by rebuilding it) ----------

  var K_CIRCLE = 0.5522847498307936;

  function toSC(p) { return { x: p[0], y: p[1] }; }
  function fromSCv(p) { return [p.x, p.y]; }

  function cornerSegments(res) {
    var pts = res.points, out = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1];
      out.push({ p0: fromSCv(a.anchor), p1: fromSCv(a.right || a.anchor), p2: fromSCv(b.left || b.anchor), p3: fromSCv(b.anchor) });
    }
    return out;
  }

  function distToSegment(p, a, b) {
    var d = sub(b, a), l2 = dot(d, d), t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
    return dist(p, add(a, mul(d, t)));
  }

  function devFromCurve(pts, segs) {
    var poly = [];
    segs.forEach(function (s, i) { poly = poly.concat(i ? sample(s, 32).slice(1) : sample(s, 32)); });
    var worst = 0;
    for (var i = 0; i < pts.length; i++) {
      var best = Infinity;
      for (var j = 1; j < poly.length; j++) best = Math.min(best, distToSegment(pts[i], poly[j - 1], poly[j]));
      worst = Math.max(worst, best);
    }
    return worst;
  }

  // A curved run between two edges whose tangents carry straight on into the edges.
  // Returns { mode: "cubic" | "smooth", R, value, ... } when Smooth Corners rebuilds it within the
  // budget, "circle" when it is really a circular fillet, or null when it is not a corner at all.
  // A run of smooth pieces between straight edges can hold several corners back to back (a slot
  // end is two corners), and one corner can be split into pieces (Pathfinder, added anchors).
  // Pick the split that leaves the fewest pieces unexplained, then the fewest corners.
  // Returns { corners, rest } where rest are the leftover stretches for circle fitting.
  var MAX_CORNER_PIECES = 6;

  function splitRun(run, ctx) {
    var segs = run.segments, m = segs.length;
    if (run.cyclic || !run.prev || !run.next || !SC) return { corners: [], rest: [run] };
    var tol = 0.5 * DEG;
    var endsOk = angleBetween(endTangent(run.prev), startTangent(segs[0])) <= tol && angleBetween(endTangent(segs[m - 1]), startTangent(run.next)) <= tol;
    if (!endsOk) return { corners: [], rest: [run] };
    var best = [{ left: 0, parts: 0, from: -1, corner: null }], i, j;
    for (j = 1; j <= m; j++) {
      var b = best[j - 1], cand = { left: b.left + 1, parts: b.parts, from: j - 1, corner: null };
      for (i = Math.max(0, j - MAX_CORNER_PIECES); i < j; i++) {
        var c = cornerFit(segs.slice(i, j), ctx);
        if (!c || c === 'circle') continue;
        var bi = best[i];
        if (bi.left < cand.left || (bi.left === cand.left && bi.parts + 1 < cand.parts)) cand = { left: bi.left, parts: bi.parts + 1, from: i, corner: c };
      }
      best.push(cand);
    }
    var corners = [], rest = [], loose = [];
    var flush = function () { if (loose.length) rest.unshift({ segments: loose.reverse(), cyclic: false }); loose = []; };
    for (j = m; j > 0; j = best[j].from) {
      if (best[j].corner) { flush(); corners.unshift(best[j].corner); }
      else loose.push(segs[j - 1]);
    }
    flush();
    return { corners: corners, rest: rest };
  }

  // One Smooth Corners corner over these pieces: 'circle' for a fillet, null when nothing fits.
  function cornerFit(segments, ctx) {
    var first = segments[0], last = segments[segments.length - 1];
    var e1 = startTangent(first), e2 = endTangent(last);
    var phi = angleBetween(e1, e2), cr = cross(e1, e2);
    if (phi < DEG || phi > 179 * DEG) return null;
    var S = first.p0, E = last.p3, a = cross(sub(E, S), e2) / cr, V = add(S, mul(e1, a));
    var p1 = a, p2 = dot(sub(E, V), e2);
    if (p1 <= 0 || p2 <= 0 || Math.abs(p1 - p2) > ctx.beta) return null;
    var p = (p1 + p2) / 2, tanHalf = Math.tan(phi / 2), pts = runSamples(segments);

    // A clearly exact circle is a fillet. A near-circle within the budget still loses to a
    // Smooth Corners rebuild that matches better (Single curve 69.2% on a 60° turn is 0.06 pt off a circle).
    var circ = fitCircle(pts), circDev = circ ? circ.dev : Infinity;
    if (circDev <= ctx.beta / 10) return 'circle';
    var asCircle = circDev <= ctx.beta ? 'circle' : null;

    var prev = toSC(sub(V, mul(e1, 4 * p))), next = toSC(add(V, mul(e2, 4 * p))), Vs = toSC(V);
    var build = function (o) { var r = SC.buildCorner(prev, Vs, next, o); return r ? cornerSegments(r) : null; };
    var base = { S: S, E: E, V: V, segments: segments, samples: pts, length: polyLength(pts) };
    var cubicAt = function (k) { var sg = build({ mode: 'cubic', radius: p / tanHalf, k: k }); return sg ? devFromCurve(pts, sg) : Infinity; };

    if (segments.length === 1) {
      var h1 = dist(first.p1, first.p0), h2 = dist(first.p3, first.p2), k = (h1 + h2) / (2 * p);
      if (Math.abs(h1 - h2) > 0.01 * p) return null;
      if (Math.abs(k - K_CIRCLE) <= 0.005) return 'circle';
      var cdev = cubicAt(k);
      if (cdev > ctx.beta || cdev >= circDev) return asCircle;
      base.mode = 'cubic'; base.R = p / tanHalf; base.value = k;
      return base;
    }

    // Several pieces: a split Single curve, or Smoothing, where s and r are tied by
    // p = r·tan(φ/2)·(1 + s). Search each, refine, keep the closer rebuild.
    var smoothAt = function (s) {
      var sg = build({ mode: 'smooth', radius: p / (tanHalf * (1 + s)), smoothing: s });
      return sg ? devFromCurve(pts, sg) : Infinity;
    };
    var cubic = searchMin(cubicAt, 0.3, 1.2, 0.01), smooth = searchMin(smoothAt, 0, 1, 0.01);
    if (cubic.dev <= smooth.dev) {
      if (cubic.dev > ctx.beta || cubic.dev >= circDev) return asCircle;
      if (Math.abs(cubic.x - K_CIRCLE) <= 0.005) return 'circle';
      base.mode = 'cubic'; base.R = p / tanHalf; base.value = cubic.x;
      return base;
    }
    if (smooth.dev > ctx.beta || smooth.dev >= circDev) return asCircle;
    if (Math.round(smooth.x * 100) === 0) return 'circle';
    base.mode = 'smooth'; base.R = p / (tanHalf * (1 + smooth.x)); base.value = smooth.x;
    return base;
  }

  // Grid search over [lo, hi], then golden-section refine around the best step.
  function searchMin(f, lo, hi, step) {
    var bestX = lo, bestDev = Infinity, x, d;
    for (x = lo; x <= hi + 1e-9; x += step) { d = f(x); if (d < bestDev) { bestDev = d; bestX = x; } }
    var a = Math.max(lo, bestX - step), b = Math.min(hi, bestX + step), g = 0.6180339887498949;
    for (var it = 0; it < 30; it++) {
      var x1 = b - g * (b - a), x2 = a + g * (b - a);
      if (f(x1) < f(x2)) b = x2; else a = x1;
    }
    x = (a + b) / 2; d = f(x);
    return d < bestDev ? { x: x, dev: d } : { x: bestX, dev: bestDev };
  }

  // ---------- labels ----------

  var UNIT_PT = { pt: 1, px: 1, mm: 72 / 25.4, 'in': 72 };

  function num(x, places) { var f = Math.pow(10, places); return String(Math.round(x * f) / f); }

  function lengthText(ptValue, ctx) { return num(ptValue / UNIT_PT[ctx.unit], 1) + ' ' + ctx.unit; }

  function cornerLabel(c, ctx) {
    var style = c.mode === 'cubic' ? 'Single curve ' + num(c.value * 100, 1) + '%' : 'Smoothing ' + Math.round(c.value * 100) + '%';
    return 'R' + lengthText(c.R, ctx) + ' · ' + style;
  }

  function runSamples(segs) {
    var pts = [];
    segs.forEach(function (s, i) { pts = pts.concat(i ? s.samples.slice(1) : s.samples); });
    return pts;
  }

  // Grow arcs from whole segments: Pathfinder and Shape Builder put anchors where circles meet,
  // so arc boundaries sit on anchors in practice.
  function fitRun(run, ctx) {
    var segs = run.segments, m = segs.length, out = [], i = 0;
    while (i < m) {
      var best = null, j;
      for (j = i; j < (run.cyclic ? i + m : m); j++) {
        var part = [];
        for (var q = i; q <= j; q++) part.push(segs[q % m]);
        var pts = runSamples(part), f = fitCircle(pts);
        if (!f || f.dev > ctx.beta) {
          if (!best) ctx.rejected.push({ reason: 'not circular', fit: f, at: segs[i].p0, segment: segs[i] });
          break;
        }
        best = { c: f.c, r: f.r, dev: f.dev, segments: part, samples: pts };
      }
      if (!best) { i++; continue; }
      best.length = polyLength(best.samples);
      best.sweep = sweepOf(best.samples, best.c);
      if (best.sweep < 15 * DEG || best.length < 0.015 * ctx.size) ctx.rejected.push({ reason: 'too short', fit: best, at: best.samples[0] });
      else out.push(best);
      i += best.segments.length;
    }
    return out;
  }

  // Arcs on the same circle (center and radius within the budget) become one circle.
  function mergeArcs(arcs, ctx) {
    var circles = [];
    arcs.forEach(function (a) {
      for (var i = 0; i < circles.length; i++) {
        var c = circles[i];
        if (Math.abs(c.r - a.r) <= ctx.beta && dist(c.c, a.c) <= ctx.beta) {
          var f = fitCircle(c.samples.concat(a.samples));
          if (f && f.dev <= ctx.beta) {
            c.c = f.c; c.r = f.r; c.dev = f.dev;
            c.arcs.push(a); c.samples = c.samples.concat(a.samples); c.length += a.length;
            return;
          }
        }
      }
      circles.push({ c: a.c, r: a.r, dev: a.dev, arcs: [a], samples: a.samples.slice(), length: a.length });
    });
    return circles;
  }

  return { analyze: analyze, encodeNote: encodeNote, decodeNote: decodeNote };
});
