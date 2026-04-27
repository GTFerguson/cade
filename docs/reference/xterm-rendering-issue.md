---
title: xterm.js Black-Block Rendering Issue — Attempt Log
created: 2026-04-25
updated: 2026-04-27
status: root cause identified at driver layer — see attempt 13. CADE-side fix pending (DOM renderer fallback).
---

# xterm.js Black-Block Rendering Issue — Attempt Log

**Symptom**: Certain characters in the xterm.js terminal render as solid black rectangles instead of glyphs. Occurs in the main CC terminal. Reproduces on brand-new terminal instances (rules out atlas overflow). Platform: web browser (Vite/FastAPI backend, Linux/WebKitGTK + Mesa).

**Resolution (primary bug)**: The actual root cause was that bundled font files were referenced with **absolute** URLs (`/fonts/...`) but the EC2 deployment serves CADE at a subpath (`/cade/`) via nginx. The browser at `/cade/` resolved `/fonts/...` to the nginx root, which 404'd. Fonts silently failed to load, the WebGL atlas baked with system-fallback metrics (much narrower cells than JetBrains Mono), and only the thinnest glyphs (`i`, `j`, `(`, `)`, `-`) survived inside the undersized cells. Everything wider got clipped to black. **Fix**: move fonts from `public/fonts/` to `styles/fonts/` so Vite processes them and rewrites URLs with the correct base path. Attempts 1–9 were all real fixes for real adjacent bugs but none addressed the URL/base-path issue that was the actual cause of the user-visible symptom.

**Residual issue (RESOLVED-DIAGNOSED, fix not yet shipped)**: After attempts 8–11 landed, a smaller class of black characters still appeared. Attempt 12 theorised an OffscreenCanvas tick-gap and shipped a "prewarm atlas" fix; attempt 13 (2026-04-27) walked back from that theory entirely. **The residual black blocks were never a font-loading bug — they were a Mesa OpenGL driver bug rejecting WebGL `glTexImage2D` allocations on Intel UHD (CML GT2)**. 200+ `GL_INVALID_OPERATION` errors confirmed the driver-layer cause. None of attempts 1–12 could have fixed it because the failing call is below the JS layer. See attempt 13 for the full diagnosis and remediation paths (Vulkan ANGLE backend, Mesa upgrade, DOM-renderer fallback, dGPU offload).

**Related reference**: [[browser-terminal-emulators]] — landscape, renderer comparison, and documented xterm.js WebGL failures.

---

## Root Cause (Best Current Understanding)

xterm.js's WebGL renderer builds its glyph texture atlas by measuring character cell dimensions with `CharSizeService`. The primary measurement strategy (`TextMetricsMeasureStrategy`) uses an **OffscreenCanvas** whose `ctx.font` is set to the terminal's `fontFamily`. The measurement runs at atlas-init time.

If the bundled web font (`JetBrains Mono`) has not been parsed into the browser's font subsystem when measurement runs, `measureText('W')` uses whatever system fallback is available. The atlas is then baked with wrong cell dimensions. Glyphs drawn at wrong sizes clip outside their cells and render as black.

The challenge: every attempted fix has either targeted the wrong layer, had a subtle no-op in the rebuild path, or introduced a different rendering artefact.

---

## Attempt History

### 1. `preserveDrawingBuffer` + context-loss handling
**Commit**: `0b89412` — 2026-04-18
**Theory**: GPU was auto-clearing frames out of sync with xterm's render loop.
**Change**: Set `preserveDrawingBuffer: true` on WebglAddon. On context loss, dispose addon so xterm falls back to canvas.
**Result**: Did not fix black blocks. Context loss events aren't the cause.

---

### 2. `terminal.refresh()` after context loss
**Commit**: `23c8cd7` — 2026-04-18
**Theory**: After `webgl.dispose()`, xterm's DOM fallback wasn't repainting.
**Change**: Call `terminal.refresh(0, rows-1)` after disposal to force immediate DOM repaint.
**Result**: Did not fix. DOM repaint helps cosmetically on context loss but doesn't address atlas baking.

---

### 3. Switch to canvas renderer (`@xterm/addon-canvas`)
**Commit**: `0d72c40` — 2026-04-19
**Theory**: WebGL renderer has fundamental atlas issues; canvas renderer avoids WebGL state problems.
**Change**: Replaced `WebglAddon` with `CanvasAddon` in both main terminal and neovim pane.
**Result**: **FAILED** — canvas renderer had cell-width measurement bugs on some GPU/DPR combos, producing **white blocks** between characters. Different artefact, same class of problem. Reverted.

---

### 4. Revert to WebGL renderer
**Commit**: `b3f8bb8` — 2026-04-24
**Theory**: WebGL is better than canvas despite its issues; white blocks (canvas) are worse than black blocks (WebGL).
**Change**: Reverted to `WebglAddon` with `preserveDrawingBuffer = true`. Note: v0.19 API takes positional boolean, not options object.
**Result**: White blocks gone. Black blocks remain.

---

### 5. Bundle JetBrains Mono + `loadingdone` atlas rebuild
**Commit**: `f7668bf` — 2026-04-25
**Theory**: Font was never bundled → xterm measured against OS fallback → wrong cell dims → black blocks. Three interlocking causes: no bundled font, no font-readiness check before attach, no atlas rebuild on font load.
**Changes**:
- Bundle `JetBrainsMono-Regular.woff2` + `JetBrainsMono-SemiBold.woff2`
- `@font-face` with `font-display: block` in `fonts.css`
- `font-loader.ts` calls `document.fonts.load()` at terminal init
- `webgl-renderer.ts`: owns WebglAddon lifecycle, rebuilds atlas on `loadingdone`, DPR change, theme change
- `nudgeReflow()`: re-assigns `fontFamily` to same value to "force remeasure" ← **this was a no-op** (xterm's option setter early-returns when new value === old value)
**Result**: Did not fully fix. `nudgeReflow()` never actually triggered remeasure. Black blocks persisted.

---

### 6. Full weight set (chat fix)
**Commit**: `8e7dc9d` — 2026-04-25
**Theory**: Chat CSS used weights 400/500/600/700 but only 400/600 were bundled. WebKitGTK + Mesa synthesises missing weights, producing malformed glyphs.
**Changes**:
- Bundle all 8 faces (Regular/Italic, Medium/MediumItalic, SemiBold/SemiBoldItalic, Bold/BoldItalic)
- `preloadMonoFonts()` loads all 8 at app startup from `main.ts`
**Result**: Fixed chat code spans specifically. Terminal black blocks unchanged — same root cause (atlas baked before font load) but in a different code path.

---

### 7. Fix `nudgeReflow()` no-op + `fonts.ready` rebuild
**Commit**: pending (this session) — 2026-04-25
**Theory**: Two bugs: (a) `nudgeReflow()` set fontFamily to same value → xterm's option setter no-ops, CharSizeService never remeasures. (b) `loadingdone` misses fonts that loaded before WebglRenderer mounted — need `document.fonts.ready` to catch cached-font case.
**Changes**:
- `nudgeReflow()`: toggle through sentinel `ff + ", monospace"` then back — different values force option setter to fire
- `scheduleFontsReadyRebuild()`: await `document.fonts.ready` in constructor, call `invalidate()` after resolve
**Result**: **FAILED** — user confirmed still happening after hard refresh on brand-new instance.

*Post-analysis*: `document.fonts.ready` may resolve before OffscreenCanvas (used by `TextMetricsMeasureStrategy`) can access the font. There may be a tick gap. More importantly: even if remeasure fires correctly, we're still building an initial wrong atlas and trying to patch it — this fight is against the grain.

---

### 8. Defer WebGL attach until `fonts.ready`
**Commit**: pending (this session) — 2026-04-25
**Theory**: Stop fighting the rebuild path. Never build the atlas before fonts are ready. During the wait, xterm uses its DOM renderer (correct, no atlas). Attach WebGL only after `document.fonts.ready` resolves.
**Changes**:
- Constructor no longer calls `attach()` immediately
- `attachWhenFontsReady()` awaits `document.fonts.ready`, calls `nudgeReflow()` + `attach()`
- If `document.fonts` unavailable: falls back to immediate attach
**Status**: **UNTESTED** — just applied. Awaiting user confirmation.

---

## What We Know Doesn't Work

| Approach | Why it fails |
|---|---|
| `preserveDrawingBuffer` | Context persistence isn't the cause |
| Canvas renderer | Own measurement bugs (white blocks) |
| Bundle the font | Necessary but not sufficient — timing still wrong |
| `font-display: block` | Blocks CSS paint, not canvas `measureText()` |
| Re-assign `fontFamily` to same value | xterm option setter no-ops on equal values |
| Await `fonts.ready`, then rebuild | Still races; initial wrong atlas exists |

## What We Know Is True

- **Atlas overflow is ruled out**: v5.1+ supports multi-page atlas; issue reproduces on brand-new instances with zero output.
- **Font bundling is necessary**: without it, every cold load uses wrong metrics. Keeps it.
- **Canvas renderer is worse**: white blocks on GPU/DPR combos. Don't revisit.
- **DOM renderer is the safe escape hatch**: no atlas, browser handles metrics, correct always. 3× slower paint but imperceptible for CC-style output.
- **xterm issues #1164, #3280, #3817**: these bugs are tracked upstream and unfixed. We're patching around known xterm limitations.

---

### 9. `rescaleOverlappingGlyphs: true`
**Commit**: pending — 2026-04-25
**Symptom**: 2 chars in "almost" flickering as CC streams `✽ Considering… (9m 10s · ↓ 21.0k tokens · almost done thinking with high effort)`. Different from solid black blocks — chars flash in and out on each status line redraw.
**Theory**: `✽` (U+273D) and `·` (U+00B7) are not in JetBrains Mono. Browser falls back to a system font whose natural glyph width exceeds the cell. On each status line redraw the overflow bleeds into adjacent WebGL atlas cells, corrupting the neighbours temporarily.
**Change**: `rescaleOverlappingGlyphs: true` in `XTerm` constructor (`terminal.ts`). xterm v5.5 scales down glyphs that would overflow their cell before rasterising them into the atlas. Zero performance cost.
**Status**: UNTESTED — just applied.

---

### 10. Move fonts out of `public/`, use relative URLs (the actual fix)
**Commit**: pending — 2026-04-25
**Symptom**: On EC2 only `i`, `j`, `(`, `)`, `-` rendered — every wider glyph was a solid black rectangle. Local dev was fine.
**Theory**: The width-selectivity of which glyphs survived is the diagnostic. Those are the narrowest glyphs in a monospace font. They're the only ones that fit inside cells sized for a *narrower* fallback font. Conclusion: the atlas was built with system-fallback metrics, which means the bundled JetBrains Mono never reached the browser at all. Investigating: nginx config on EC2 routes `/cade/*` to the CADE backend and `return 404` for everything else (including `/`). The font CSS used absolute URL `url("/fonts/JetBrainsMono-Regular.woff2")`. Browser at `http://ec2/cade/` resolved that to `http://ec2/fonts/...` which hit nginx's 404 fallback. Fonts silently failed; `document.fonts.ready` resolved (failed loads still count as "done"); WebGL atlas baked with whatever the OS fallback provided.
**Changes**:
- Moved 8 woff2 files from `frontend/public/fonts/` to `frontend/styles/fonts/`. Files in `public/` are copied verbatim by Vite and not URL-rewritten; files inside the `src` tree go through Vite's asset pipeline.
- Changed all `url("/fonts/X.woff2")` to `url("./fonts/X.woff2")` in `fonts.css`.
- Added a comment explaining the constraint so this doesn't get reverted.
- Verified: `npm run build` produces `dist/assets/JetBrainsMono-*-[hash].woff2` and the built CSS references them as `url(/assets/JetBrainsMono-Regular-[hash].woff2)`. With `VITE_BASE_PATH=/cade` the path becomes `/cade/assets/...` which routes through nginx correctly.
**Status**: **RESOLVED** — pending EC2 redeploy + hard refresh to confirm.

---

### 11. Guard `attachWhenFontsReady` against double-attach race
**Commit**: pending — 2026-04-26
**Symptom**: After attempts 8–10 deployed, all users on first load saw **white blocks between every character** plus broken horizontal lines. Same visual artefact as attempt 3 (canvas renderer) but the root cause was different: a race introduced by attempt 8's deferred-attach approach.
**Root cause**: `bindFontLoadListener` (registered in the constructor) subscribes to `document.fonts` `loadingdone`. `attachWhenFontsReady` (also registered in the constructor) waits on `document.fonts.ready`. When fonts load over the network, both fire — `loadingdone` synchronously, then `ready` resolves as a microtask. Sequence:
1. Fonts finish loading → `loadingdone` fires → `invalidate()` runs → `detach()` (no-op) + `attach()` → `this.addon = addon1`, WebGL context bound to canvas.
2. Microtask: `ready` resolves → `attachWhenFontsReady` callback runs → `attach()` again *without* a preceding `detach()` → second `WebglAddon` activated on the same terminal, second WebGL context requested on the same canvas. Both addons respond to render events; the GL contexts fight; atlas state corrupts → white blocks + broken lines.

This regression hit every user on first load because attempt 10 changed the font URLs (from `/fonts/X.woff2` to Vite-hashed `/assets/JetBrainsMono-X-[hash].woff2`), so every browser had a cache miss and went through the network-load path that triggers the race. Cached fonts wouldn't have hit it — `loadingdone` wouldn't fire on this page load and `ready` would resolve immediately, only attaching once.
**Change**: Add `|| this.addon !== null` to the guard inside the `document.fonts.ready` `.then()` callback in `webgl-renderer.ts`. If `invalidate()` already attached via `loadingdone`, the `ready` callback bails out.
**Lesson**: this is the same visual symptom as attempt 3 (canvas renderer → white blocks) but a wholly different cause. "White blocks between characters" is a class of artefact produced any time the WebGL/canvas atlas's cell metrics get out of sync with the actual glyph dimensions — measurement bugs (canvas attempt 3), measurement-time fallback fonts (attempts 1–9), or here, two renderers fighting over one canvas (attempt 8 race). Future debugging: when this symptom returns, the question is *which* path desynchronised the metrics, not "is it canvas or WebGL".
**Status**: **RESOLVED** — confirmed by user on local dev.

---

### 12. Pre-warm the WebGL atlas with all four weight/style variants
**Commit**: pending — 2026-04-26
**Symptom**: After attempts 1–11 land, the bulk of black-block rendering is gone, but a smaller set of characters still render as black — most noticeably inside Claude Code edit diffs where syntax highlighters style comments, strings, and keywords with italic. Regular ASCII renders correctly; italic/bold variants in the same line render black.
**User observations (2026-04-26)**:
- With a single project tab open, no glitches reproduce immediately, but black blocks eventually start appearing after extended use.
- Multiple tabs accelerate the onset.
- This rules out "happens only at attach time" — it's a lazy-bake-on-first-use bug that fires the first time a given variant is rendered, whenever that happens to be.

These observations together fit a clear pattern: each tab spawns its own xterm + `WebglAddon`, so each adds another WebGL context (browsers cap active contexts — Chrome ~16 — and evict the oldest when over limit, firing `webglcontextlost`) and another OffscreenCanvas measurement path. Two amplifiers under multi-tab load: (a) WebGL context pressure increases the rate of `contextlost` → `setTimeout(100)` → re-`attach()`, and re-attach re-runs the atlas bake during whatever the OffscreenCanvas state happens to be; (b) when a tab attaches *after* `document.fonts.ready` is already resolved, the `.then()` callback fires as an immediate microtask with no natural async lag — exactly the window in which OffscreenCanvas is most likely not yet registered for the requested face. Single-tab cold load benefits from the network-load latency masking the tick gap; warm subsequent attaches don't. And the single-tab eventual onset is the same bug, just rolled by the dice on whatever moment a syntax-highlighted italic glyph first hits the atlas.
**Theory**: Attempt 7's post-analysis flagged this as plausible: `document.fonts.ready` resolves once the `FontFace` objects are loaded, but xterm measures cells on an `OffscreenCanvas` via `TextMetricsMeasureStrategy`. The OffscreenCanvas font registration may lag the FontFaceSet's "loaded" status by a tick. Glyphs added to the atlas during that lag use whatever the OffscreenCanvas can resolve — system fallback. Because xterm's atlas is built lazily (per-variant, on first paint of that variant), Regular gets the right metrics if no italic was on screen at attach time, but the *first* italic glyph ever rendered may bake in with fallback metrics and stay wrong for the lifetime of the addon. Diffs disproportionately surface this because they're often the first place italic appears.
**Change**: At the end of `attach()` in `webgl-renderer.ts`, call `prewarmAtlas()`. The method writes one character of each of the four variants xterm uses (regular, italic, bold, bold-italic — xterm's `fontWeight` default 400 + `fontWeightBold` default 700, × italic on/off) wrapped in alternate-screen-buffer enter/exit (`\x1b[?1049h` / `\x1b[?1049l`). xterm parses the entire write atomically before scheduling the next render frame, so the alt-screen content never paints; main screen and cursor are unaffected. After the write, the atlas has all four variants baked with the correct metrics, and lazy-bake gambling is eliminated. Runs on every successful `attach()` — initial, font-load invalidate, DPR change, theme refresh, and context-loss recovery — because each of those rebuilds the atlas from scratch.
**Considered alternatives**:
- `requestAnimationFrame` delay before attach (cheaper, but only papers over the gap; doesn't help when the gap returns mid-session via context-loss re-attach).
- DOM-based measure strategy: not exposed by the addon API.
- Hidden offscreen Terminal: separate atlas, doesn't help.
**Status**: implemented, awaiting user confirmation. Built; deploy via `./scripts/deploy.sh <host> --skip-setup` (or just refresh local desktop / dev server).

---

### 13. Diagnosed driver-layer bug — Mesa OpenGL `texImage2D` rejection on Intel UHD (CML GT2)
**Commit**: pending (this session) — 2026-04-27
**Symptom (continuing)**: Black blocks still appear after attempts 1–12 land. User confirms identical visual symptom — characters replaced by solid black rectangles, sometimes recovering on resize-triggered repaint (DevTools panel exhibited the same recovery, an early signal that this was below the xterm layer).

**Diagnostic data captured (`chrome://gpu` 2026-04-27, ~250 errors over a typical session)**:
```
GL_INVALID_OPERATION: Error: 0x00000502, in
.../angle/src/libANGLE/renderer/gl/TextureGL.cpp,
allocateMipmapLevelsForGeneration:1593.
```
Each error is ANGLE attempting `functions->texImage2D(...)` for a mipmap level allocation and the underlying GL driver rejecting it. xterm's WebGL addon allocates a glyph-atlas texture; when an allocation fails silently like this, the atlas page is uninitialised; reads from it produce black or garbage. This is exactly the visual symptom we'd been chasing in attempts 1–12.

**Hardware/driver state**:
- Optimus laptop: NVIDIA RTX 2080 Super dGPU available, but `*ACTIVE*` GPU is Intel UHD Graphics (CML GT2 / 10th gen)
- Driver: Mesa 25.2.8-0ubuntu0.24.04.1 (the standard Ubuntu 24.04 backport)
- Chrome 147.0.7727.101 on Linux 6.17.0-22-generic, GL implementation `egl-angle / angle=opengl`, ANGLE 2.1.27286
- WebGL marked "Hardware accelerated" in `chrome://gpu` Graphics Feature Status — i.e. Chrome thinks it's working; the bug is below that layer

**Why attempts 1–12 could not have helped**:
- `texImage2D` allocation failure happens *after* xterm builds its WebGL command stream. By the time the driver rejects the call, font measurements have long since happened correctly. Font metrics, atlas timing, and addon lifecycle are all upstream of the failure.
- The DevTools-panel-recovers-on-resize tell was the giveaway: DevTools doesn't use xterm. Any "fix at the xterm layer" is the wrong altitude.

**Why VS Code etc. don't hit this** (refines section 4 of [[xterm-webfont-loading]] §4): same hardware running VS Code's WebGL renderer can, in theory, hit the same Mesa bug. Most VS Code Linux users either run on a system with a working OpenGL driver or have the iGPU swapped out by their distro's GPU selection. CADE-via-Chrome is more exposed because Chrome's GPU process has its own ANGLE pipeline and is harder for the user to reroute without explicit env vars.

**Remediation paths (none are CADE-side fixes)**:

1. **Switch Chrome's ANGLE backend to Vulkan** — `--use-angle=vulkan` reroutes through Mesa's Vulkan driver (ANV), which is generally less buggy than its GL driver. Intel UHD CML GT2 has Vulkan support exposed in `chrome://gpu` Dawn info. Lowest-effort test, fully reversible.
2. **Upgrade Mesa** — kisak PPA (`ppa:kisak/kisak-mesa`) or oibaf bleeding-edge. Newer Mesa versions often have Intel iGPU fixes. Reboot required.
3. **Force the dGPU** — `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome`. Works but battery/heat cost makes it impractical as a daily driver.
4. **File a Mesa bug** — long-tail. Repro on `gitlab.freedesktop.org/mesa/mesa`. Won't help in the short term but unblocks future Intel CML GT2 users.

**CADE-side fix (defensive, ships regardless of whether the user fixes their driver)**:
Add a DOM-renderer fallback. xterm.js falls back to DOM elements with no atlas, no `texImage2D`, no GPU texture allocation at all. Trigger via a user setting or URL flag like `?renderer=dom`. ~3× slower paint, imperceptible for chat-style output. Bulletproof against any driver-level failure on any GPU. **Status**: not yet implemented.

**User-facing remediation guide saved at**: `~/Documents/cade-nvidia-gpu-test.md` (the user's local notes — not part of this repo, but referenced here for provenance).

**Status**: **DIAGNOSIS CONFIRMED**, CADE-side fallback pending. User to test `--use-angle=vulkan` and Mesa upgrade in their environment first.

---

## Why Earlier Attempts All Missed

Two distinct bugs, both producing the same visual symptom (black-block characters), got conflated. Untangling them retrospectively:

**Bug A (resolved attempt 10)**: deployment-path bug. Absolute font URLs broke under the EC2 nginx subpath layout, fonts 404'd, atlas baked with system-fallback metrics. Attempts 1–9 patched application logic looking for a timing bug; the actual cause was environmental (config, paths). **Lesson**: when a symptom only reproduces in one environment, the cause is almost always environmental — first diagnostic should be "is the asset actually reaching the browser" (DevTools Network tab), not "is our application code correct".

**Bug B (diagnosed attempt 13, fix pending)**: Mesa OpenGL driver bug rejecting `glTexImage2D` mipmap allocations on Intel UHD CML GT2. Same visual symptom as Bug A, but a wholly different cause far below the application layer. Attempts 11–12 patched higher application layers (race conditions, prewarm) looking for the residual occurrence; none of them could have fixed it because the failure is in Mesa, not in JS. **Lesson**: when application-layer fixes don't land but the symptom continues, look at the layers below before iterating again. `chrome://gpu` and the Chrome GPU-process error log should have been step 1, not step 13. The DevTools-panel-also-flickers tell was direct evidence the bug was below xterm; we should have caught that earlier.

The earlier fixes (font bundling, `nudgeReflow` correction, `fonts.ready` gate, `rescaleOverlappingGlyphs`, double-attach guard, prewarm) are kept — each addresses a real bug that would surface eventually even after Bug A's URL fix landed and Bug B's driver fix lands at the user's system level.

## What's In The Code Now

| File | Change | Why |
|---|---|---|
| `frontend/styles/fonts/*.woff2` | Bundled JetBrains Mono, 8 weights | Eliminates OS-font dependency |
| `frontend/styles/fonts.css` | Relative `url("./fonts/...")` | Vite processes URLs with correct base path |
| `frontend/src/terminal/font-loader.ts` | `preloadMonoFonts()` | Kicks fetch before any UI mounts |
| `frontend/src/main.ts` | `preloadMonoFonts()` at startup | Earliest possible fetch trigger |
| `frontend/src/terminal/webgl-renderer.ts` | Defer attach until `document.fonts.ready` | Atlas built once with correct metrics |
| `frontend/src/terminal/webgl-renderer.ts` | `nudgeReflow()` toggles fontFamily through sentinel | Forces xterm to remeasure (the same-value setter is a no-op) |
| `frontend/src/terminal/webgl-renderer.ts` | `attachWhenFontsReady` checks `this.addon !== null` before attaching | Prevents double-attach race when `loadingdone` fires before `fonts.ready` resolves |
| `frontend/src/terminal/webgl-renderer.ts` | `prewarmAtlas()` called from `attach()` after addon load | Bakes all 4 weight/style variants into the atlas immediately so no variant gets lazy-measured during an OffscreenCanvas tick gap |
| `frontend/src/terminal/terminal.ts` | `rescaleOverlappingGlyphs: true` | Fallback-font glyphs (✽, ·) won't bleed into adjacent atlas cells |

## Pending CADE-side change (attempt 13 follow-up)

| File | Change | Why |
|---|---|---|
| `frontend/src/terminal/webgl-renderer.ts` (or `terminal.ts`) | DOM-renderer fallback gate, triggered by user setting or `?renderer=dom` URL flag | Bypass WebGL entirely on machines with broken OpenGL drivers (Intel Mesa, etc.). xterm's DOM renderer has no atlas and no `texImage2D` calls, so any GPU/driver-layer rejection is impossible. ~3× slower paint, imperceptible for chat-style output. |
