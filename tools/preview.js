// Local SVG preview of a read + grid, for checking the analysis without Illustrator.
// Run: node tools/preview.js test/fixtures/jro-mark.json out.svg [settings-json]
const fs = require('node:fs');
const Grid = require('../js/grid.js');

const [, , inFile, outFile, settingsJson] = process.argv;
const input = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const m = Grid.analyze(input, settingsJson ? JSON.parse(settingsJson) : { system: 'golden', snap: true });
const [x0, y0, x1, y1] = m.bounds, pad = 0.35 * Math.max(x1 - x0, y1 - y0);
const vb = [x0 - pad, -(y1 + pad), x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
const P = (p) => `${p[0]},${-p[1]}`;

const logo = input.items.map((it) => {
  const d = it.paths.map((p) => {
    const n = p.points.length, segs = [];
    for (let i = 0; i < (p.closed ? n : n - 1); i++) {
      const a = p.points[i], b = p.points[(i + 1) % n];
      segs.push(`C${P(a.right)} ${P(b.left)} ${P(b.anchor)}`);
    }
    return `M${P(p.points[0].anchor)}${segs.join('')}${p.closed ? 'Z' : ''}`;
  }).join('');
  return `<path d="${d}" fill="#0e1014" fill-rule="evenodd" opacity="0.18"/>`;
}).join('\n');

const w = m.draw.labelSize / 12 * 0.6;
const item = (it) => {
  const dash = it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '';
  if (it.kind === 'circle') return `<circle cx="${it.c[0]}" cy="${-it.c[1]}" r="${it.r}" fill="none"${dash}/>`;
  if (it.kind === 'line') return `<line x1="${it.a[0]}" y1="${-it.a[1]}" x2="${it.b[0]}" y2="${-it.b[1]}"${dash}/>`;
  if (it.kind === 'cross') { const h = it.size / 2; return `<path d="M${it.c[0] - h},${-it.c[1]}h${it.size}M${it.c[0]},${-it.c[1] - h}v${it.size}"/>`; }
  if (it.kind === 'dot') return `<circle cx="${it.c[0]}" cy="${-it.c[1]}" r="${it.r}" fill="#e4007c" stroke="none"/>`;
  if (it.kind === 'path') return `<path d="M${P(it.segments[0][0])}${it.segments.map((s) => `C${P(s[1])} ${P(s[2])} ${P(s[3])}`).join('')}" fill="none"/>`;
  if (it.kind === 'text') return `<text x="${it.at[0]}" y="${-it.at[1]}" font-size="${it.size}" text-anchor="${it.align === 'right' ? 'end' : 'start'}" fill="#e4007c" stroke="none" font-family="DM Mono, Menlo, monospace">${it.text}</text>`;
  return '';
};
const grid = m.draw.groups.map((g) => `<g id="${g.name}">${g.items.map(item).join('')}</g>`).join('\n');

fs.writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="1400" height="${Math.round(1400 * vb[3] / vb[2])}">
<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>
${logo}
<g stroke="#e4007c" stroke-width="${w}" fill="none">${grid}</g>
</svg>`);
console.log(JSON.stringify({ circles: m.report.circles.map((c) => c.label), corners: m.report.smoothCorners.map((c) => `${c.label} ×${c.count}`), rejected: m.report.rejected }));
