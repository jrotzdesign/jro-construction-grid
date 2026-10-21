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

module.exports = { P, path, circle, polygon, fromSC, doc, rng, within, K };
