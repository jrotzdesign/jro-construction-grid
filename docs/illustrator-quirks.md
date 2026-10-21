# Illustrator quirks

Copied from the "Illustrator quirks we learned" section of `jro-optical-center/HANDOFF.md`
(2026-10-21). Names like `OC_run` and `engine.jsx` are Optical Center's. The section after the copy
checks Construction Grid against each item.

Each of these cost time. All were seen in Illustrator 30.4.0 on macOS.

### Dialogs and alerts

- **A modal dialog stops scripting.** While one is open, every `evalScript` waits. That's how the
  session froze twice: a save dialog, and a probe of `executeMenuCommand("Expand3")`, which opens
  the Expand dialog.
- **Never use Expand or Expand Appearance menu commands.** If you need Outline Stroke, it's
  `executeMenuCommand("OffsetPath v22")`, which opens no dialog. The engine doesn't use it; only
  `tools/stroke-compare.jsx` does.
- **Wrap menu commands and document work** in
  `app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS`, restored in `finally`.
  `OC_run` does this for every engine call.
- **Close scratch documents in the same script** with `doc.close(SaveOptions.DONOTSAVECHANGES)`.
  A scratch document left open gets a save prompt later. The engine no longer opens any;
  `stroke-compare.jsx` still uses one.
- **If a probe hangs, stop.** Sending more scripts only queues them behind the dialog.

### Selection and undo

- **One script call is one undo step.** Reading geometry adds none.
  `app.executeMenuCommand("undo")` is Edit → Undo.
- **Don't touch the selection in a call that changes the document.** Clearing it
  (`doc.selection = null`) and reselecting, inside a call that also duplicates, outlines and
  removes, makes Edit → Undo revert nothing at all, even after three tries. Duplicating with the
  original still selected works, so the engine leaves the selection alone.
- **Duplicate into another document** returns `undefined` when the original is selected, even
  though the copy is made. In the same document it returns the copy. The engine still looks for
  the copy just above the original if it ever gets `undefined`.
- **Illustrator drops locked art from the selection:** locked text, text on a locked layer, and
  any group whose members are all locked. A group with locked text plus something unlocked stays
  selected, which is the one locked case a press can reach.
- **Duplicates of locked items:** a duplicate of a locked item is locked, but `createOutline()`
  and `remove()` still work on it.
- **Live text that's already centered** before the first press leaves one empty undo step,
  because outlining the copy counts as a change.
- **Stacking order:** `zOrderPosition` is wrong for text frames; it can repeat another item's
  value. Stacking order comes from the index in `parent.pageItems`, where 0 is the topmost.
- **`PageItem.tags.add()`** throws an MNGT error. The key object is held by `PageItem.uuid` in
  panel memory and lasts for the session only.

### Compound paths

- **Fill, stroke and fill rule live on the member paths.** The engine reads them from
  `pathItems[0]` and treats the whole compound as one piece.
- **Holes come from nesting, not from a path's own winding.** Hole and outer can be wound the same
  way. Polarity is read from `PolarityValues.NEGATIVE`, but the fill rule and nesting decide
  holes.
- **New paths pick up the default 1 pt stroke.** A compound path built by script got a 1 pt stroke
  that skewed the stroke mass. `make-test-doc.jsx` sets `stroked = false` on it.
- **Crossing or self-intersecting paths** get a warning. Their centroid may be off.

### `$.evalFile` scope

- **Inside a function, `$.evalFile` defines the file's functions in that function's scope.** The
  0.2.1 panel reloaded `engine.jsx` from inside an IIFE, which reported success and replaced
  nothing. Call it at the top level. A top-level `try` statement's value is what `evalScript`
  returns.
- **ScriptPath runs only once.** The manifest's ScriptPath loads `engine.jsx` once per Illustrator
  session. Reloading the panel (`location.reload()`) doesn't re-run it, which is why the panel
  reloads the engine itself.
- **`$.evalFile` at the top level runs `optical.js` with `this` as the global object,** so its
  wrapper sets `Optical` there.
- **Overriding DOM methods has no effect.** For example, `TextFrame.prototype.createOutline =
  ...` changes nothing. That's why the engine has the `OC_testFault` hook.

### The panel freezes during scripts

- **While an ExtendScript call runs, the CEP panel's JavaScript is frozen too.** No `setTimeout`
  fires and nothing repaints until the reply. A "still waiting" message can only appear when
  Illustrator hasn't started the script yet, for example because a dialog is open.
- **The old 20 s timeout would have misfired.** Its timer and the reply can only fire once the
  panel unfreezes, so for a slow call 0.2.1 would likely have reported a timeout for a move that
  had in fact happened. This is inferred from the freeze, not observed.
- **A click made during the freeze is delivered after the reply.** It started a second press whose
  "Already centered." replaced the real result. The panel now drops clicks stamped before it went
  idle, and any click in the first second after a slow reply.
  - Only `click()` from a second debugger connection reproduced this. A CDP mouse event, or a
    `click()` on the same connection, didn't start a second press even with the guard turned off.
  - A real mouse click from macOS couldn't be tested (no Accessibility permission).
- **Illustrator is noticeably slower when it isn't the frontmost app.** The e2e brings it to the
  front with `osascript -e 'tell application "Adobe Illustrator" to activate'`.

### CEP

- **With `--enable-nodejs --mixed-context`, `module` exists in the panel.** A wrapper that only
  sets `module.exports` leaves `window.X` undefined. That shipped as "Optical is not defined" in
  0.1.0. `test/loading.test.js` reproduces it with a vm context that has both `module` and
  `window`.
- **Unsigned panels need `PlayerDebugMode`.** The installer sets it for CSXS 9–14. The debug port
  is 8733 (`.debug`).
- **The installer waits for a key.** It ends with `read -n 1`. Run it from a script as
  `echo x | bash "Install Optical Center (Mac).command"`, or it hangs.


## How Construction Grid handles each

Checked 2026-10-21 against 0.1.1, rechecked against 0.1.2. "Fixed" means the item was missed in 0.1.0 and is fixed now.

### Dialogs and alerts

- **Modal dialog stops scripting:** ok. The panel shows "Still waiting for Illustrator" after
  20 s. `tools/ai.js` and `tools/panel-e2e.js` stop the run on a 20 s timeout.
- **No Expand menu commands:** ok. The panel uses no menu commands. The e2e uses only `undo`.
- **DONTDISPLAYALERTS:** ok. `CG_run` in `jsx/host.jsx` wraps every host entry point, and
  `wrap()` in `tools/ai.js` wraps every tool call, before `app.open` too. Both restore it in `finally`.
- **Close scratch documents in the same script:** ok. The panel opens none. `make-test-doc.js`
  closes its copy unsaved in the same call. The e2e keeps its temp copy open across calls on
  purpose and closes it unsaved in `finally`.
- **If a probe hangs, stop:** ok. A timeout ends the e2e with "Tell Jose before doing anything else".

### Selection and undo

- **One script call is one undo step:** ok. Generate is `CG_read` (no writes) then one `CG_draw`.
  Export is one `CG_exportFrame`. The e2e checks one undo after each.
- **Don't touch the selection in a call that changes the document:** fixed. `CG_exportFrame`
  cleared the selection and reselected the logo in the same call. It now leaves it alone.
  `CG_draw` never touched it. The e2e changes the selection in calls of its own.
- **Duplicate into another document returns undefined:** not affected. Everything is duplicated
  within the same document, and the logo copies' return values aren't used.
- **Locked art drops out of the selection:** not affected for reading. A selected group can
  still hold a locked path, and it's read like any other.
- **Duplicates of locked items are locked:** not tested. The guideline frame scales a copy of the
  logo. A logo with a locked member inside a group hasn't been tried.
- **Centered live text leaves an empty undo step:** doesn't apply. Nothing is outlined.
- **`zOrderPosition` is wrong for text:** ok, it isn't used. Construction goes on top with
  `layer.zOrder(BRINGTOFRONT)`, and the e2e checks `doc.layers[0]`.
- **`tags.add()` throws:** ok, it isn't used. Settings live in the grid group's `note`.
- **New here, the e2e's one-off undo miss was outside input:** 0.1.1's e2e once saw an undo
  that left the grid. A soak (`tools/undo-soak.js`) ran Generate, Regenerate and two undos
  many times. Runs missed only while someone used the Mac: the test brings Illustrator to the
  front, so a click lands there and changes the selection, or an arrow key nudges the logo.
  That nudge adds an undo step, and our undo reverts it instead of the grid. With the Mac left
  alone, 42 of 42 runs were right, across every timing tried. The soak now checks the
  selection and the logo's position before each click and undo, and skips a run touched from
  outside. Leave the Mac alone during the e2e and the soak.

### Compound paths

- **Fill, stroke and fill rule live on member paths:** doesn't apply. The read takes geometry only.
- **Holes come from nesting:** doesn't apply. The analysis doesn't use fills.
- **New paths get a 1 pt stroke:** ok. `CG_drawItem` sets `filled` and `stroked` on every path,
  labels get no stroke, and `make-test-doc.js` sets `stroked = false`.
- **Crossing paths:** doesn't apply. No centroids.
- **New here, compounds made from groups report no `pathItems`:** `CG_hiddenGroups` finds their
  groups through `doc.groupItems` by the parent's `uuid`. The R and O bowls of the JRO mark
  need it.

### Transforms

- **New here, `transform()`'s line-width argument is a factor:** 0.1.1 passed 100 to keep the
  grid's weights and got 25 pt lines from 0.25 pt. `CG_exportFrame` passes 1 for the grid and
  the scale factor for the logo. The e2e checks the frame grid's line weight.

### `$.evalFile` scope

- **Inside a function it defines nothing global:** ok. The panel's `loadHost()` runs it at the top
  level. `wrap({ host: true })` runs it inside its wrapper, but only that call uses the functions.
- **ScriptPath runs only once:** fixed. The panel now loads `jsx/host.jsx` itself on every load.
  The e2e reloads the panel and checks that `CG_VERSION` matches the manifest.
- **`this` is the global object:** doesn't apply. `grid.js` runs in the panel only.
- **Overriding DOM methods does nothing:** doesn't apply. No fault hooks yet.

### The panel freezes during scripts

- **Panel JavaScript is frozen during a call:** fixed. 0.1.0 had the same 20 s reject timer
  as Optical Center 0.2.1. It could report "didn't answer" for a call that worked. The panel now
  waits for the real reply and only shows a note.
- **A click made during the freeze arrives after the reply:** fixed. All buttons, rows and Reset
  unit drop clicks stamped before the panel went idle, and any click in the first second after a
  slow reply. Not reproduced here. Optical Center needed a second debugger connection to do it.
- **Slower when not frontmost:** ok. The e2e brings Illustrator to the front at the start and
  before each capture.
- **New here, `imageCapture` needs an absolute path:** with a relative one it returns without
  error and writes nothing. The e2e resolves the folder and checks each file exists. Measured:
  a capture adds no undo step.

### CEP

- **`module` exists in the panel:** ok. `grid.js` and `engine-core.js` set both `module.exports`
  and `window.*`, and `test/loading.test.js` checks it.
- **PlayerDebugMode:** ok. The installer sets it for CSXS 9–14. The debug port is 8734.
- **Installer waits for a key:** ok. It only waits when run from a terminal (`[ -t 0 ]`), so
  `bash "Install Construction Grid (Mac).command"` from a script doesn't hang.
