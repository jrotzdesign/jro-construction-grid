// Builders for synthetic test geometry, in the shape jsx/host.jsx exports:
// a point is { anchor, left, right } where left/right are Illustrator's left/right direction handles.
const K = 0.5522847498307936;

const P = (x, y) => [x, y];
const corner = (p) => ({ anchor: p, left: p, right: p });

// A path from a start point and a list of moves:
//   { line: [x, y] }
//   { arc: { c: [x, y], r, from: deg, to: deg, pieces? } }   (counter-clockwise when to > from)
// Arcs are split into cubics of at most 90°, the way Illustrator draws circles.
function path(start, moves, closed = true) {
  const pts = [corner(start)];
  for (const m of moves) {
    if (m.line) { pts.push(corner(m.line)); continue; }
    const { c, r, from, to, pieces } = m.arc;
    const a0 = (from * Math.PI) / 180, a1 = (to * Math.PI) / 180;
    const n = pieces || Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const d = (a1 - a0) / n, h = (4 / 3) * Math.tan(Math.abs(d) / 4) * r, sg = Math.sign(d);
    const at = (a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
    const tan = (a) => [-Math.sin(a) * sg, Math.cos(a) * sg];
    for (let i = 0; i < n; i++) {
      const t0 = a0 + d * i, t1 = t0 + d, last = pts[pts.length - 1];
      last.right = [last.anchor[0] + tan(t0)[0] * h, last.anchor[1] + tan(t0)[1] * h];
      const e = at(t1);
      pts.push({ anchor: e, left: [e[0] - tan(t1)[0] * h, e[1] - tan(t1)[1] * h], right: e });
    }
  }
  if (closed) {
    const last = pts[pts.length - 1], first = pts[0];
    if (Math.hypot(last.anchor[0] - first.anchor[0], last.anchor[1] - first.anchor[1]) < 1e-9) {
      pts.pop();
      first.left = last.left;
    }
  }
  return { closed, points: pts };
}

// A circle drawn the way Illustrator's Ellipse tool does: 4 cubics, anchors at 0/90/180/270° (+ rotation).
function circle(cx, cy, r, rotDeg = 0) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = ((rotDeg + 90 * i) * Math.PI) / 180;
    const p = [cx + r * Math.cos(a), cy + r * Math.sin(a)], t = [-Math.sin(a) * r * K, Math.cos(a) * r * K];
    pts.push({ anchor: p, left: [p[0] - t[0], p[1] - t[1]], right: [p[0] + t[0], p[1] + t[1]] });
  }
  return { closed: true, points: pts };
}

function polygon(coords) { return { closed: true, points: coords.map(corner) }; }

// Smooth Corners output ({anchor:{x,y}, left, right}) to the host format.
function fromSC(points) {
  const a = (v) => [v.x, v.y];
  return { closed: true, points: points.map((p) => ({ anchor: a(p.anchor), left: a(p.left), right: a(p.right) })) };
}

const doc = (paths, extra = {}) => ({ units: 'pt', items: paths.map((p) => ({ paths: Array.isArray(p) ? p : [p] })), ...extra });

// Deterministic jitter (mulberry32).
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const within = (assert, actual, expected, relTol, what = '') =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relTol,
    `${what} ${actual} is not within ${relTol * 100}% of ${expected}`);

// DM Mono advance is 0.6 em; a text box runs from the descender to the cap height.
const box = (t) => {
  const w = t.text.length * t.size * 0.6, x0 = t.align === 'right' ? t.at[0] - w : t.at[0];
  return [x0, t.at[1] - t.size * 0.25, x0 + w, t.at[1] + t.size * 0.8];
};
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// Does a drawn grid item cross a text box? Lines by clipping, circle outlines by their nearest and
// farthest distance to the box, curves by sampling, dots and crosses by their own small box.
const segHits = (a, b, r) => {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [[-d[0], a[0] - r[0]], [d[0], r[2] - a[0]], [-d[1], a[1] - r[1]], [d[1], r[3] - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
};
const circleHits = (c, rad, r) => {
  const nx = Math.max(r[0], Math.min(c[0], r[2])), ny = Math.max(r[1], Math.min(c[1], r[3]));
  const near = Math.hypot(nx - c[0], ny - c[1]);
  const far = Math.max(...[[r[0], r[1]], [r[0], r[3]], [r[2], r[1]], [r[2], r[3]]].map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
  return near <= rad && rad <= far;
};
const bez = (s, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * s[0][k] + 3 * u * u * t * s[1][k] + 3 * u * t * t * s[2][k] + t * t * t * s[3][k]); };
const itemHits = (it, r) => {
  if (it.kind === 'line') return segHits(it.a, it.b, r);
  if (it.kind === 'circle') return circleHits(it.c, it.r, r);
  if (it.kind === 'dot') return hit([it.c[0] - it.r, it.c[1] - it.r, it.c[0] + it.r, it.c[1] + it.r], r);
  if (it.kind === 'cross') return hit([it.c[0] - it.size / 2, it.c[1] - it.size / 2, it.c[0] + it.size / 2, it.c[1] + it.size / 2], r);
  if (it.kind === 'path') return it.segments.some((s) => { for (let i = 0; i < 32; i++) if (segHits(bez(s, i / 32), bez(s, (i + 1) / 32), r)) return true; return false; });
  throw new Error('unknown item ' + it.kind);
};
// Every place a label's text crosses a drawn grid item, or a leader runs through another label.
const gridHits = (m) => {
  const group = (name) => m.draw.groups.find((g) => g.name === name);
  const out = [];
  const texts = group('Labels').items.filter((i) => i.kind === 'text');
  for (const g of m.draw.groups) {
    if (g.name === 'Labels') continue;
    g.items.forEach((it, k) => {
      for (const t of texts) {
        // A horizontal's own name sits just past its end, in line with it: that's not a crossing.
        if (g.name === 'Horizontals' && t.text === m.horizontals[k].label) continue;
        if (itemHits(it, box(t))) out.push(`"${t.text}" sits on ${g.name} #${k}`);
      }
    });
  }
  // Leaders are drawn lines too: one may not run through another label. Each follows its own text.
  const items = group('Labels').items;
  items.forEach((l, k) => {
    if (l.kind !== 'line') return;
    for (const t of texts) if (t !== items[k - 1] && segHits(l.a, l.b, box(t))) out.push(`the leader of "${items[k - 1].text}" runs through "${t.text}"`);
  });
  return out;
};

module.exports = { P, path, circle, polygon, fromSC, doc, rng, within, K, box, hit, gridHits };

