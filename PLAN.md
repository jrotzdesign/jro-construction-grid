# Construction Grid: plan

Illustrator 2026 (v30) CEP panel. Select a logo and it reads the real curves, fits circles to them, finds smooth corners, tangents and key horizontals, and draws a clean construction grid on a locked "Construction" layer for brand guidelines.

Status: Phase 1 done (research, grill, this plan). Phase 2 starts on "go".

---

## 1. Prior art (checked 2026-10-20)

Nothing found fits circles to existing curves, snaps them to a ratio series and reports the error.

| Tool | What it does | Overlap |
|---|---|---|
| Gridit / Logo Grid Generator (Akrivi, $39 Lite) | Base grids, "reveal construction and circle paths", clearspace with logomark detection | Closest. Doesn't mention fitting, tolerances or ratios. Not verified (paid). |
| Logrido ($20, or $30/yr for v2) | Grids, clearspace, circular grids (beta) around artwork | Overlay only |
| GridMe (CEP, $4–5/mo) | Repetitive guide and grid work | Overlay only |
| Figma Golden Spiral, Golden Ratio Design System | Preset φ grids and rectangles | Generators, no analysis |
| WebToolsBar Logo Grid, Grid Maker Pro | Fixed 6:4:3 or golden template over an SVG | Template only |
| Adobe Exchange | No listing found for any of these | n/a |

Decision: build it.

Reused code:
- **GoldenScale** (`jrotzdesign/golden-scale`): `PHI`, the `FIB` array, and the `nearestFibIndex`/`nextFib` logic. GoldenScale has no general series table, so root-2 and custom are new code.
- **Smooth Corners** (`jrotzdesign/smooth-corners`) `engine-core.js` v1.3.4 is vendored into `js/vendor/`. It serves as the test oracle, and the detector also uses it to check each smooth corner by rebuilding it (§3.3).
- **Optical Center** (`jrotzdesign/jro-optical-center`): repo layout, UMD pattern, `node --test`, CDP panel driving, fixture rules.

---

## 2. Decisions from the grill

| # | Decision |
|---|---|
| Q1 | Build it. |
| Q2 | Faithful by default (every circle hugs real curve). With snap on it becomes explanatory: circles move to the series and report how far. Nothing is drawn that wasn't fitted to real curve first. |
| Q3 | Circles only. Ellipses and free curves go to Rejected. "Loose fits" can be drawn, off by default. |
| Q4 | Reads PathItems and CompoundPathItems at any group depth. Rejects live text, symbols, images, meshes with a message. Skips clipping paths. Open stroked paths are read along their centerline. Ignores anything on the Construction layer. |
| Q5 | Ratio systems: Golden φⁿ (n −4..4), Fibonacci Fₖ × u, Root-2 √2ⁿ, Custom list, None. |
| Q6 | Unit "1" = **best-fit unit**: the radius that lands the most clustered radii on the series. Override: click a report row to make that circle 1. |
| Q7 | **One grid per artboard.** The Construction layer holds one group per artboard. Regenerate replaces only that artboard's group. |
| Q8 | One user-set color (default JRO teal #29A191, plus a "construction gray" 50% K preset), 0.25 pt, no fill. Circles and tangents solid, horizontals dashed 4/3, centers 3 pt crosses. |
| Q9 | One label per radius cluster, outside the circle at about 45° with a leader line. Horizontals carry names. Snap error appears in the panel only. |
| Q10 | Export frame: 1920 × 1080 artboard to the right of the others. The logo copy fits 60% of the height and is tinted to 15%, with the grid on top. |
| Q11 | Test logos: JRO mark (committed), plus the Twitter bird and Apple logo **local only**: gitignored, never committed, never in publishable screenshots. |
| Q12 | Key verticals are their own element type, off by default. |
| Smooth corners | Their own element type, labeled in Smooth Corners' exact terms. The actual curve is drawn. The JRO mark is the main test. |
| Q13 | With snap on, draw the **snapped** circle. Measured r, snapped r and error % go in the report. |
| Q14 | Circles outside snap tolerance are drawn as measured, labeled "≈", and flagged off-series. |
| Q15 | Centers snap to alignment first (shared x/y with another center, a horizontal or a vertical), then the spacing between aligned centers snaps to unit × series. No ratio lattice. |
| Q16 | A tangent is drawn only where a real straight segment touches a circle or smooth corner, or runs between two. A loose straight segment is drawn only if it shares an edge line with at least one other segment. |
| Q17 | Both Smooth Corners modes are detected. Labels use that panel's words and value scales so they can be typed straight back in (format in §5). |
| Q18 | A smooth corner is drawn as its actual curve, with ticks at the tangent points and a dot at the corner point. No reference circle. |
| Q19 | A smooth corner's R counts toward clustering and the unit. Its ratio is shown only when snap is on. |
| Q20 | The unit override is stored on the artboard's grid group, survives Regenerate (matched by radius within cluster tolerance), and is cleared by "reset unit". |
| Q21 | A grid belongs to the artboard containing the center of the selection's bounds. A selection spanning artboards is refused. The group is named `Grid · <artboard name>`. |
| Q22 | Tolerance sliders read in % of logo height, with the pt value beside them. |
| Q23 | One budget for both fit and snap: **max deviation ≤ 0.5 pt at export-frame scale**, measured against the sampled real curve. |
| Q24 | Smooth-corner label format fixed (§5). Single curve within 55.2 ± 0.5% and Smoothing 0% count as circles. |
| Q25 | Clusters are lettered A, B, C… on the art and in the report. Report sections: Circles, Smooth corners, Lines, Horizontals, Rejected. |
| Q26 | Panel uses JRO ink/paper, following Illustrator's UI brightness, with teal for the active state and Generate only and rosa mexicano for flags only. DM Mono caps labels, Figtree body, both bundled (OFL). Artboard labels are DM Mono Regular (Menlo fallback), **size = 1.2% of the logo's larger dimension, min 5 pt**, with a size control under line style. |
| Q27 | Horizontal rules as in §3.8. Type names are used even on pure marks. |
| Q28 | Test set as in §7. |
| Q29 | The JRO mark is committed in `test/fixtures/construction-grid-test.ai` (private repo). |
| Q30 | Install/Uninstall `.command` + `.bat` copied from Smooth Corners. Bundle `com.jro.constructiongrid`, v0.1.0. gitleaks and a `local/` check before every push. |
| Undo | Checked with `app.executeMenuCommand("undo")`. Jose presses ⌘Z himself in his own test. |

**Measured ratios always carry "≈"** (Jose, at "go"): with snap off, a circle label shows `A · R40.2 pt · ≈ 1 : 1.62`. That's the measured ratio to the unit, two decimals. When the system is None, the unit is the cluster with the most arc length. Only a snapped ratio appears without "≈" (`1 : 1.618`, three decimals; Fibonacci `5u`). An off-series circle with snap on reads `≈ 1 : 1.71`.

## 2a. Hard rules (Optical Center lessons, set at "go")

1. **Module loading:** every pure module sets both `module.exports` and `window.<Name>`. A test loads each one in a vm context with both `module` and `window` defined.
2. **"Done" means verified in real Illustrator through the CEP debug port:** select the JRO mark, click Generate, the grid appears on the right artboard, Regenerate replaces it, and one undo reverts it. Stubs or a plain browser don't count.
3. **No visible scratch documents.** Paths are read directly and read-only.
4. **Every menu command** is wrapped with `userInteractionLevel = DONTDISPLAYALERTS` and restored in `finally`. If a call times out, stop and tell Jose.
5. **The panel fits at its default height without scrolling.** The primary action is at the top, settings sit in a collapsed **Advanced** section, and errors are plain English only.

---

## 3. Algorithm

Everything in §3 is a pure module, `js/grid.js` (ES5, UMD that also sets `window.Grid`, which the CEP mixed-context quirk requires). It is unit-tested in Node. ExtendScript only reads geometry (§4.1) and draws a finished model (§4.2).

### 3.0 Scale and the budget

- `H`, `W` = height and width of the selection's geometric bounds.
- Frame scale `s = min(648 / H, 1536 / W)`. 648 = 60% of 1080, and 1536 = 80% of 1920 is the cap for wide logos.
- **Budget `β = 0.5 pt / s`** in document points. That's 0.077% of H for square and tall logos. Every geometric acceptance test below is "max deviation ≤ β" unless noted.

### 3.1 Input

Subpaths as cubic segments `{p0, p1, p2, p3}` in document coordinates (y up), grouped by item and subpath, with closed, polarity and even-odd flags.

### 3.2 Segment classes

A segment is **straight** when both handles lie within β/4 of the chord (this includes retracted handles). Every other segment is **curved**. Zero-length segments are dropped. Curved segments are G1-joined when the tangent angle at the shared anchor differs by ≤ 2°.

### 3.3 Smooth corners (exact, checked by rebuilding)

Look for the pattern **straight – curved run – straight** where the run's end tangents line up with the two straight segments (≤ 0.5°).

1. V = intersection of the two edge lines. φ = turn angle. p = |S − V| and |E − V|, which must match within β.
2. **Single curve** (run is one cubic, handles along the edges): `k = |handle| / p` (both handles must match within 1%), and `R = p / tan(φ/2)`. If |k − 55.23%| ≤ 0.5 it's a circular fillet and goes to §3.4 as an exact circle. Otherwise it's a smooth corner `{mode: "cubic", R, k}`.
3. **Smoothing** (run is a curvature ramp, then an arc, then a ramp): fit the middle arc (§3.4) to get R, then `s = p / (R · tan(φ/2)) − 1`, rounded to a whole %. s = 0 means a circle.
4. **Check:** rebuild the corner with `SC.buildCorner(prev, V, next, {mode, radius: R, smoothing | k})` and require a max deviation ≤ β from the real run. This guarantees the label typed into Smooth Corners reproduces the shape. A run that fails stays curved and continues to §3.4.

### 3.4 Sample, curvature, fit

1. Sample each curved segment by arc length, step ≤ β·4 and at least 16 points. Compute signed curvature analytically from the Bézier derivatives: κ = (x′y″ − y′x″) / |v|³.
2. Walk each G1 chain and split where κ changes sign or where |κ − running median| / |κ| > 10%. These give the seed runs.
3. Fit each run with a **Taubin fit**. Kasa is biased on short arcs, and logos are full of them. Then do 2 Gauss–Newton geometric refinement steps.
4. Grow each run into its neighbors while the fit holds. Accept it if:
   - max |‖p − c‖ − r| ≤ β
   - sweep ≥ 15°
   - arc length ≥ 1.5% of max(W, H)
5. Merge accepted arcs that share a circle (center and r within β) into one circle with several arcs, across subpaths and items.
6. Runs that fail go to Rejected with their reason (loose / too short / not circular), along with their best error.

### 3.5 Cluster radii and pick the unit

1. Sort the radii of circles and smooth corners. A radius joins a cluster when |Δr| ≤ β. The cluster value is the mean weighted by arc length. Letters are A, B, C… from largest to smallest.
2. Series values S:
   - Golden {φⁿ, n −4..4}
   - Root-2 {√2ⁿ, n −4..4}
   - Fibonacci {1, 2, 3, 5, 8, 13, 21, 34, 55, 89}
   - Custom: your list
3. Unit candidates are u = r_c / σ for every cluster c and σ ∈ S. Score each u by the arc length of the clusters that pass the snap test (§3.6) at that u, with lowest total deviation as the tie-break.
4. Geometric series (golden, root-2) make u and u·φ equivalent. Among equivalent winners, take the u that equals a real cluster radius, preferring the most arc length, so "1" is always a circle you can see. For Fibonacci, the tie-break is the larger u.
5. **Override:** the clicked cluster's radius becomes u. It's stored in the group's `note` JSON `{v: 1, system, unitR}` and matched within β on Regenerate.

### 3.6 Snap (snap on)

- **Radius:** σ* = the nearest series value to r/u, and r′ = σ*·u.
- **Center:** order clusters by arc length. For each center, align x and y to the nearest target within β: an already-snapped center, a key horizontal (§3.8), or a key vertical. Then snap the distance between two aligned centers to u·σ within β.
- **Acceptance (Q23):** the snapped circle (r′ plus the snapped center) must stay within max deviation ≤ β of **every sampled point on every arc it claims**. Otherwise the circle stays measured and is flagged off-series.
- **Report:** measured r, r′, error % = (r′ − r) / r, and max deviation in pt at frame scale.

### 3.7 Lines and tangents

- Collinear straight segments (distance ≤ β, angle ≤ 0.5°) merge into edge lines.
- **Tangent:** a straight segment whose end meets an accepted arc or smooth corner with G1 continuity. It's drawn tangent point to tangent point and extended past each end by 4% of max(W, H). If snapping moved a circle, the tangent is recomputed against the snapped circle (the shared tangent nearest the original segment).
- **Line:** an edge line holding ≥ 2 separate segments. Everything else is skipped (Q16).

### 3.8 Key horizontals and verticals

- Candidates are horizontal straight segments (≤ 0.5°, weighted by length) and curve y-extrema (horizontal tangents). y values are clustered within β.
- **BASELINE** = the lowest cluster containing a flat edge ≥ 2% of W, or extrema from ≥ 2 subpaths. **CAP HEIGHT** = the same rule, highest cluster.
- **OVERSHOOT ±n pt** = round extrema beyond baseline or cap within 4% of H, labeled with the offset in document units. If the mark has no flat bottom, the baseline is the lowest extremum and no overshoot is drawn.
- **X-HEIGHT** = a flat-top cluster between 40% and 80% of cap height spanning ≥ 2 separate shapes.
- **Verticals** (off by default) work the same way on x, plus a symmetry axis: a mirror test of the sample points about x = c, accepted when the mean nearest-point distance is ≤ β.

### 3.9 Output model

`{ unit, system, frameScale, budget, clusters[], elements: {circles, smoothCorners, tangents, lines, horizontals, verticals, centers}, labels[], report, rejected[] }`

Labels are placed outside each circle at 45°, trying 45/135/315/225° and keeping the first that doesn't overlap the logo bounds or another label. They get a leader line. Label size is max(5 pt, 1.2% × max(W, H)) × the size control.

---

## 4. Illustrator side

### 4.1 `exportSelection()`: read-only

Walks the selection (groups recursively), writes geometry JSON, and lists rejects with reasons. It makes no document writes and adds no undo steps (verified pattern from Optical Center).

### 4.2 `drawGrid(model, settings)`: one call, one undo step

1. Find or create the top layer **Construction**, then unlock it.
2. Remove the `Grid · <artboard name>` group if it exists. Other artboards' groups aren't touched.
3. Build the group with type subgroups **Circles, Smooth corners, Tangents, Lines, Horizontals, Verticals, Centers, Labels**. Draw only the types turned on.
4. Strokes use the color in the document's color mode (RGB or CMYK), the set weight, and dashes per type.
5. Write the settings and override into `group.note`, then relock the layer.

Originals are never selected for writing, moved or restyled.

### 4.3 `exportFrame()`: one call

1. Add a 1920 × 1080 artboard 200 pt to the right of the rightmost artboard.
2. Duplicate the logo items onto an unlocked layer **Guideline frame**, and the artboard's grid group onto Construction as `Grid · <new artboard>`.
3. Scale both by s around the shared center:
   - logo with strokes scaled, so it looks the same
   - grid strokes **not** scaled, so they stay at your weight
   - labels scale with the copy, so they stay at 1.2% of the logo
4. Center on the artboard. Tint the logo copy's fills and strokes to 15% (mixed with white).

### 4.4 Panel (JRO brand)

Sections, top to bottom. The panel fits its default height with no scrolling; everything from Fit to Line style sits in a collapsed **Advanced** section (rule 2a.5):
- **Generate** (teal), or **Regenerate** when a grid exists for the artboard
- **Fit:** tolerance slider (% H · pt)
- **Snap:** on/off, ratio system, custom list, snap tolerance (% H · pt), "reset unit"
- **Draw:** checkboxes for Circles, Smooth corners, Tangents, Lines, Horizontals, Centers, Labels, plus Verticals and Loose fits (both off by default)
- **Line style:** color with JRO teal and construction gray presets, weight, then **Label size** (% of logo, default 1.2, min 5 pt)
- **Report:** lettered rows, click to make 1
- **Export guideline frame**

Panel copy goes through the humanizer skill.

---

## 5. Label formats

| Element | Snap off | Snap on |
|---|---|---|
| Circle cluster | `A · R40.2 pt · ≈ 1 : 1.62` | `A · 1 : 1.618` (Fibonacci `A · 5u`), off-series `A · ≈ 1 : 1.71` |
| Smooth corner, Single curve | `R17 pt · Single curve 69.2%` | `R17 pt · Single curve 69.2% · 1 : 0.618` |
| Smooth corner, Smoothing | `R10 pt · Smoothing 60%` | `R10 pt · Smoothing 60% · 1 : 1.618` |
| Horizontal | `BASELINE`, `CAP HEIGHT`, `X-HEIGHT`, `OVERSHOOT −2.1 pt` | same |

- The words and precision match Smooth Corners exactly. "Smoothing" is the readout for its "Corner smoothing" slider (0–100, whole numbers). "Single curve" is the readout for its "Curve fullness" slider (40–100, one decimal).
- R is in document ruler units (pt/px/mm/in, the units Smooth Corners offers; pt otherwise), one decimal, trailing zeros dropped.
- A Single curve value outside 40–100 is still labeled, and the report says "outside Smooth Corners range".

---

## 6. Tolerance defaults and why

| Setting | Default | Why |
|---|---|---|
| Deviation budget β (fit **and** snap) | **0.5 pt at frame scale** = 0.077% of H for square/tall logos (0.77 pt on a 1000 pt master, 0.03 pt on a 40 pt favicon) | Your rule: nothing drawn sits more than 0.5 pt off the art where it's presented. One budget keeps fit and snap consistent. It's strict, so loosely golden logos will mostly show as off-series, which is the honest result. |
| Min arc sweep | 15° | Below that, a 0.5 pt budget can't pin the radius. The estimate swings by more than 0.5% on short arcs. |
| Min arc length | 1.5% of max(W, H) | Skips tiny joins and ink-trap nicks. |
| Straight segment | handles within β/4 of the chord | Tighter than β so near-flat curves aren't treated as lines. |
| G1 join / collinear / horizontal | 2° / 0.5° / 0.5° | Illustrator's smooth points hold well under 1°. 2° allows for hand-edited handles. |
| Curvature split | 10% from the running median | Splits arc-to-arc changes, then the fit decides. |
| Radius cluster | Δr ≤ β | Two radii closer than the budget can't be told apart on the presentation. |
| Single curve = circle | 55.2 ± 0.5% | Matches Smooth Corners' "circle" tick. |
| Overshoot window | 4% of H | Typical type overshoot is 1–3%. |
| X-height band | 40–80% of cap | Covers most Latin wordmarks and keeps marks from producing false hits. |
| Label size | 1.2% of max(W, H), min 5 pt | Your Q26 change. |
| Line weight | 0.25 pt | Q8. |

---

## 7. Test set

### 7.1 Unit tests (`node --test`, TDD with the tdd skill)

Pass bar: radii recovered within **0.5%**.

1. Full circle drawn like the Ellipse tool (4 cubics, κ = 0.5523), r = 1, 17, 500, rotated 0/33/90° and translated: 1 circle, center within β.
2. Single arcs with 30°, 90° and 180° sweep, as 1 and 2 cubics: r within 0.5%. A 10° arc goes to Rejected as too short.
3. Anchors jittered ±0.1% of r: still recovered, still under the budget.
4. Capsule and teardrop: exactly 2 circles plus the right 2 tangents. No extra common tangents.
5. φⁿ set snaps to golden with error under 0.01%. Fibonacci {1,2,3,5,8} × 7.3 recovers u = 7.3. A root-2 set and a custom list.
6. A circle at 1.71× → off-series. The best-fit unit picks the majority even when the smallest circle is off-series. The override sets u and survives a round trip through the note JSON.
7. **Corners generated by `engine-core.js`:**
   - Single curve 69.2% R17 (the JRO case) → `R17 pt · Single curve 69.2%`
   - 55.2% → circle
   - Smoothing 60% R10 → `R10 pt · Smoothing 60%`
   - Smoothing 0% → circle
   - all of the above at 60°, 90° and 120° corners, plus a budget-clamped corner
8. Ellipse 2:1 and a free S-curve: no circle, listed in Rejected.
9. Rectangle and L shape: lines only where segments share an edge line, and no circles.
10. Synthetic "o" + "x": BASELINE, CAP HEIGHT, and OVERSHOOT with the right sign and value.
11. Compound path with a hole (even-odd), zero-length handles, degenerate segments: no crash, correct output.
12. Label formatting: units, trailing zeros, the "≈" form, Fibonacci `5u`, and the outside-range note.
13. Loading: `grid.js` runs in a vm context that has both `module` and `window` (the Optical Center lesson).

### 7.2 Illustrator checks (CEP debug port, on a **copy** of the committed fixture)

- The fixture holds the JRO mark, a synthetic artboard (known circles + Smooth Corners corners), and an empty artboard. It's built once with `tools/make-test-doc.jsx`, never through the panel.
- **Originals untouched:** `exportSelection()` JSON for every original item is identical before and after Generate, Regenerate ×3 and Export.
- **Regenerate replaces:** after 3 regenerates there is still exactly 1 group per artboard, and the other artboards' groups are byte-identical.
- **Undo:** after Generate, `executeMenuCommand("undo")` removes the whole group and leaves the layer state as before (one undo step). The same check runs for Export.
- **Export frame:** the new artboard is 1920 × 1080, the logo copy is 648 pt tall (or 1536 wide), grid strokes stay at the set weight, and labels sit at 1.2% of the logo.
- Scratch docs are closed in the same script with `DONOTSAVECHANGES`, and dialog-opening menu commands are never probed.

### 7.3 Real logos and screenshots

| Logo | Source | Expected | Screenshots |
|---|---|---|---|
| JRO mark | `~/Downloads/jro.ai` → fixture | Smooth corners `R17 pt · Single curve 69.2%`, lines on the shared stem edges, BASELINE and CAP HEIGHT. Few or no circles, since it's mostly straight. | `screenshots/` (shareable) |
| Twitter bird | Wikimedia Commons SVG → `test/fixtures/local/` | Published construction is all circles, so most of the outline should be covered by fitted circles. | `screenshots/local/*-INTERNAL.png` |
| Apple logo | Wikimedia Commons SVG → `test/fixtures/local/` | The golden-circle claim is contested, so expect fits plus honest off-series flags. | `screenshots/local/*-INTERNAL.png` |

Artboards are exported as PNG by script, and the panel is captured through CDP.

---

## 8. Repo layout

Matches Optical Center:

```
jro-construction-grid/
  CSXS/manifest.xml        com.jro.constructiongrid, ILST [30.0,99.9], CSXS 11
  index.html  css/  fonts/ (DM Mono, Figtree; OFL)  icons/
  js/grid.js               pure algorithm (§3)
  js/series.js             ratio systems (PHI/FIB from GoldenScale)
  js/vendor/engine-core.js Smooth Corners v1.3.4 (oracle + rebuild check)
  js/panel.js  js/CSInterface.js
  jsx/host.jsx             exportSelection / drawGrid / exportFrame
  test/*.test.js  test/fixtures/construction-grid-test.ai
  test/fixtures/local/     gitignored (Twitter, Apple)
  tools/make-test-doc.jsx  tools/panel-e2e.js
  screenshots/  screenshots/local/ (gitignored)
  Install / Uninstall Construction Grid (Mac).command / (Windows).bat
```

`.gitignore` adds `test/fixtures/local/` and `screenshots/local/`. Private repo `jrotzdesign/jro-construction-grid` is created at the start of Phase 2. gitleaks runs and `git ls-files | grep local/` must come back empty before every push.

---

## 9. Phase 2 order

1. Scaffold the repo, manifest and `.gitignore`. Create the private GitHub repo.
2. `series.js` + tests.
3. `grid.js` with TDD, in this order: sampling/curvature → Taubin fit → runs and acceptance → smooth corners (engine-core oracle) → clustering and unit → snap → lines and tangents → horizontals → labels/model.
4. `host.jsx` `exportSelection`, checked read-only on the fixture.
5. `drawGrid` + panel. Then checks for regenerate, undo and originals.
6. `exportFrame`.
7. Run on the 3 logos and take screenshots.
8. `/code-review`, code-simplification, humanizer on panel copy.
9. Report: algorithm summary, defaults, failure cases.

## 10. Failure cases expected going in

- **Short arcs** (< 15°) and tight ink traps are rejected, so small details won't get circles.
- **Free curves, ellipses, and non-uniformly scaled circles** are rejected as not circular, by design (Q3).
- **Auto-traced or hand-nudged art:** anchor jitter beyond β breaks runs, giving few circles and a long Rejected list.
- **Designer-adjusted circles** (optical tweaks) miss the 0.5 pt snap, so expect off-series flags on "golden" logos.
- **Corners not made by Smooth Corners** (asymmetric handles, handles off the edge lines) aren't classified as smooth corners. They fall back to circle fits or Rejected.
- **Golden/root-2 unit ambiguity** (u vs u·φ) is handled by the tie-break, but the "1" chosen may not be the circle you think of first. The override exists for that.
- **Clipped art:** content outside a clipping mask is still analyzed, because masks are skipped, not applied.
- **Appearance-only geometry** (Offset Path effects, variable-width strokes, brushes) isn't read. Only path anchors are.
