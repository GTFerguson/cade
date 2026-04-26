---
title: xterm.js Webfont Loading — Research and Official Solution
created: 2026-04-26
updated: 2026-04-26
status: active
tags: [xterm, webgl, fonts, rendering, frontend]
---

# xterm.js Webfont Loading — Research and Official Solution

Research log answering: *has anyone in the wider ecosystem solved the xterm.js + WebGL + webfont rendering problem we have spent 12 attempts on, and is there a working reference implementation?*

**TL;DR**: Yes. The xterm.js team ships an official addon — `@xterm/addon-web-fonts` (released 2024) — which solves exactly this class of bug. Its internals confirm our diagnosis (the `fontFamily` toggle-through-sentinel is the right way to force a remeasure, and `document.fonts.ready` alone is not enough — each `FontFace` must be `.load()`-ed individually). We are missing that final step.

See also: [[xterm-rendering-issue]] (attempt log), [[browser-terminal-emulators]] (renderer landscape).

---

## 1. The Problem Is Well-Known and Acknowledged Upstream

The xterm.js team has acknowledged this exact symptom class since 2017.

### Issue #1164 — "Better support for web fonts"

(Tier 2: GitHub issue with extensive maintainer participation, opened 2017-12-22 by `@vincentwoo`, comment thread continuing through 2018+.)

**`@vincentwoo` describing the symptom (2018-03-26)** — same shape as ours:

> "Even using fontfaceobserver to delay terminal creation, I sometimes see the wrong font loaded. Additionally, in Firefox, it appears to also cause some foreground text to render as black (on black). Has anyone spent a lot of time getting xterm 3.x working in production with webfonts?"

**`@vincentwoo` (2018-03-27) — root-cause analysis that matches our experience exactly**:

> "In xterm 2.x this was less of an issue because xterm would render to the DOM, and the presence of those DOM nodes with the correct `fontFamily` attribute would cause the browser to load the appropriate font. In the new world, *everything* needs to be correctly loaded before xterm can render. That includes, for instance, the bold variant of the font and any other separate variations."
>
> "I think there is a lot of virtue in xterm rendering a hidden dummy span which triggers the loading of any font variants it may need for the chosen `fontFamily` it has been configured with, and then deferring (or refreshing) when those fonts have been loaded."

**`@mofux` (CONTRIBUTOR, 2017-12-22) — the manual workaround that became the basis for `nudgeReflow()`**:

> "You could also force xterm.js into refreshing its char atlas by setting the fontFamily on the theme once you know that the font is available:
> ```js
> term.setOption('theme', { fontFamily: 'YourFontFamily' })
> ```"

**`@Tyriar` (MAINTAINER, 2018-03-27)**:

> "I can see value in an addon that does this and then forces a repaint and refresh of the texture atlas after things are finished. Open to PRs."

**`@Tyriar` (MAINTAINER, 2018-05-17)** — accepting the third-party addon as the recommended workaround for years:

> "For anyone wanting this support @vincentwoo published an addon to make working with web fonts easy which you can grab at https://www.npmjs.com/package/xterm-webfont"

**Conclusion**: From 2017 through 2024, the xterm.js maintainers' position was "use a third-party addon (`xterm-webfont`)." A first-party solution did not exist.

Source: <https://github.com/xtermjs/xterm.js/issues/1164>

### Issue #3817 — "Xterm.js is not using imported fonts" (2022)

(Tier 2: GitHub issue, maintainer reply.) Same root cause; `@Tyriar` again redirects to the third-party addon: *"I think you're after https://www.npmjs.com/package/xterm-webfont"*.

Source: <https://github.com/xtermjs/xterm.js/issues/3817#issuecomment-1131610498>

### Issue #3280 — "WebGL renderer doesn't rerender correctly after changing the font"

(Tier 2: GitHub issue, closed 2022-07-24.) Closed as "Seems to be fixed". The fix landed in xterm 5.x but only addresses the *explicit `fontFamily`-change* path, not the implicit "the wrong atlas was baked at attach time" path that ours hits.

Source: <https://github.com/xtermjs/xterm.js/issues/3280>

---

## 2. Third-Party Workaround — `xterm-webfont` (CoderPad, 2018–)

(Tier 3: Community addon, npm package, recommended by xterm.js maintainer for ~6 years.)

**Repo**: <https://github.com/CoderPad/xterm-webfont>
**npm**: <https://www.npmjs.com/package/xterm-webfont>

Full source (`src/index.js`, ~25 LoC):

```js
const FontFaceObserver = require("fontfaceobserver");

module.exports = class XtermWebfont {
  activate(terminal) {
    this._terminal = terminal;
    terminal.loadWebfontAndOpen = function(element) {
      const fontFamily = this.getOption("fontFamily");
      const regular = new FontFaceObserver(fontFamily).load();
      const bold = new FontFaceObserver(fontFamily, { weight: "bold" }).load();

      return regular.constructor.all([regular, bold]).then(
        () => { this.open(element); return this; },
        () => { this.setOption("fontFamily", "Courier"); this.open(element); return this; }
      );
    };
  }
  dispose() { delete this._terminal.loadWebfontAndOpen; }
};
```

**What it does**: blocks `terminal.open()` until both regular and bold variants of the font family are confirmed loaded (via `FontFaceObserver`, which renders a hidden DOM span and polls for stable metrics — stronger signal than `document.fonts.ready`).

**Why it's not enough for us**:
- Targets xterm 4.x (`getOption`/`setOption` were removed in v5).
- Only loads regular + bold; ignores italic and bold-italic — which is exactly the variant set our diffs surface.
- No support for the WebGL addon specifically; just delays `term.open()`.
- Has not been updated since 2020.

---

## 3. The Official Solution — `@xterm/addon-web-fonts`

(Tier 1: First-party xterm.js addon, MIT licensed, copyright 2024 The xterm.js authors.)

**npm**: <https://www.npmjs.com/package/@xterm/addon-web-fonts>
**Source**: <https://github.com/xtermjs/xterm.js/blob/master/addons/addon-web-fonts/src/WebFontsAddon.ts>
**Docs**: <https://github.com/xtermjs/xterm.js/blob/master/addons/addon-web-fonts/README.md>

**Compatibility**: requires xterm.js v5+. We are on `^5.5.0` per `frontend/package.json`.

**Released versions on npm**: `0.1.0` (latest) plus `0.2.0-beta.113` through `0.2.0-beta.117`.

### Maintainer's own description of the bug class

From the official README:

> "xterm.js on the other hand heavily relies on exact measurement of character glyphs to layout its output. This is done by determining the glyph width (DOM renderer) or by creating a glyph texture (WebGl renderer) for every output character. For performance reasons both is done in synchronous code and cached. **This logic only works properly, if a font glyph is available on its first usage, otherwise the browser will pick a glyph from a fallback font messing up the metrics.**"
>
> "For webfonts and xterm.js this means that we cannot rely on the default loading strategy of the browser, but have to preload the font files before using that font in xterm.js."

This is verbatim our diagnosis.

### How the addon works (annotated walkthrough of `WebFontsAddon.ts`)

```typescript
export function loadFonts(fonts?: (string | FontFace)[]): Promise<FontFace[]> {
  return document.fonts.ready.then(() => _loadFonts(fonts));
}
```

The static `loadFonts` first awaits `document.fonts.ready`, then *also* awaits per-`FontFace` `.load()`:

```typescript
function _loadFonts(fonts?: (string | FontFace)[]): Promise<FontFace[]> {
  const ffs = Array.from(document.fonts);
  if (!fonts || !fonts.length) {
    return Promise.all(ffs.map(ff => ff.load()));   // <-- the critical step
  }
  // ... per-family lookup ...
  return Promise.all(toLoad.map(ff => ff.load()));
}
```

**This is the step our implementation skips.** `document.fonts.ready` resolves when the FontFaceSet considers loading complete, but individual `FontFace.load()` is what guarantees the OffscreenCanvas-visible loading is finished.

The `relayout` method, called after fonts are loaded, performs the *exact* sentinel toggle we already have in `nudgeReflow()`:

```typescript
public async relayout(): Promise<void> {
  if (!this._term) return;
  await document.fonts.ready;
  const family = this._term.options.fontFamily;
  // ... derive `clean` (system fonts) and `dirty` (web fonts) families ...
  await _loadFonts(dirty);
  if (this._term) {
    this._term.options.fontFamily = clean.length ? createFamily(clean) : 'monospace';
    this._term.options.fontFamily = family;   // <-- our nudgeReflow, validated
  }
}
```

The toggle-through-sentinel pattern in our `webgl-renderer.ts:86` is **identical** to what the official addon does. Our diagnosis (xterm option setter early-returns on equal values) was correct.

### The "still happens after attempts 1–11" symptom is acknowledged

From the README (§ "Forced Layout Update"):

> "If you have the addon loaded into your terminal, you can force the terminal to update the layout with the method `WebFontsAddon.relayout`. **This might come handy, if the terminal shows webfont related output issue for unknown reasons.**"
>
> "Note that this method is only meant as a quickfix on a running terminal to keep it in a working condition. A production-ready integration should never rely on it, better fix the real root cause (most likely not properly awaiting the font loader higher up in the code)."

The "production-ready integration ... most likely not properly awaiting the font loader higher up in the code" line is directed exactly at integrations like ours.

### Recommended usage (verbatim from official README)

Static-loader pattern (preferred — entire bootstrap waits on font load):

```typescript
import { Terminal } from '@xterm/xterm';
import { loadFonts } from '@xterm/addon-web-fonts';

loadFonts(['Web Mono 1', 'Super Powerline']).then(() => {
  const terminal = new Terminal({
    fontFamily: '"Web Mono 1", "Super Powerline", monospace',
  });
  terminal.open(your_terminal_div_element);
});
```

Instance pattern (when bootstrap can't be deferred):

```typescript
const terminal = new Terminal({ fontFamily: '"Web Mono 1", monospace' });
const webFontsInstance = new WebFontsAddon();
terminal.loadAddon(webFontsInstance);

webFontsInstance.loadFonts(['Web Mono 1']).then(() => {
  terminal.open(your_terminal_div_element);
});
```

The constructor argument `initialRelayout` (default `true`) means the addon will *also* call `relayout()` once `document.fonts.ready` resolves — handles the case where fonts arrive after `terminal.open()` has been called.

---

## 4. Why VS Code Doesn't Hit This Bug

(Tier 4: inference from architecture, not direct citation — but consistent with maintainer statements above.)

VS Code is the largest production xterm.js consumer. It uses the WebGL addon. It does not exhibit the black-block bug. Why:

1. **Electron environment** — fonts are bundled with the application as installed system fonts (not async-loaded over HTTP via `@font-face`).
2. **OS-level font registration** — the OS reports the font as available before any JavaScript runs.
3. **No `document.fonts.ready` race** — by the time the renderer process boots, the font is already in the system font cache, OffscreenCanvas-visible.

The black-block class of bug is **specific to web-deployed xterm.js with web-loaded fonts**. CADE is in this category. VS Code, Hyper, Tabby (all desktop-app uses of xterm.js) are not.

---

## 5. Gap Analysis — Our Implementation vs the Official Addon

| Concern | Official addon | Our `webgl-renderer.ts` + `font-loader.ts` | Gap |
|---|---|---|---|
| Block bootstrap on font load | `loadFonts(['family']).then(() => term.open(...))` | `preloadMonoFonts()` called from `main.ts` but **not awaited** before terminal init | **YES — root cause candidate** |
| Per-`FontFace.load()` await | `Promise.all(ffs.map(ff => ff.load()))` | Only `document.fonts.ready` (FontFaceSet-level) | **YES — matches OffscreenCanvas tick-gap symptom** |
| Italic/bold-italic loaded | All matching FontFace variants in family | All 8 woff2 declared in `fonts.css`, loaded via `document.fonts.load()` | likely fine if `document.fonts.load()` actually loads each face — verify |
| `relayout()` on fonts.ready | `initialRelayout: true` calls `relayout()` after `document.fonts.ready` | `attachWhenFontsReady()` in `webgl-renderer.ts:47` — equivalent | **PARITY** |
| Toggle-through-sentinel remeasure | `fontFamily = 'monospace'; fontFamily = original` | `fontFamily = ff + ', monospace'; fontFamily = ff` | **PARITY** |
| Runtime `relayout()` quickfix | Public API, intended for "unknown weird issues" | None — we only invalidate on font-load / DPR / theme | **GAP — could be a session-recovery hook** |

The two real gaps:

1. **Bootstrap is not awaited**. `frontend/src/main.ts` calls `preloadMonoFonts()` (fire-and-forget) and then proceeds to mount the app. If a terminal mounts before that promise resolves, we're back at "atlas baked at the wrong moment".
2. **`document.fonts.ready` is not equivalent to `Promise.all(ffs.map(ff => ff.load()))`**. The first only signals the FontFaceSet's collective state; the second is what the official addon does and what guarantees individual face availability to OffscreenCanvas.

---

## 6. Recommended Path Forward

(Tier 1 evidence: official xterm.js addon source code; Tier 2: maintainer guidance from issue #1164.)

**Adopt `@xterm/addon-web-fonts` and use the static `loadFonts()` loader.** Specifically:

1. Install: `npm install --save @xterm/addon-web-fonts`.
2. In `main.ts`, replace the fire-and-forget `preloadMonoFonts()` with `await loadFonts(['JetBrains Mono'])` before any terminal init code runs.
3. Optionally also load the `WebFontsAddon` instance into the terminal so its `relayout()` is available as a runtime quickfix when the symptom recurs (per maintainer's own recommendation).
4. Keep our existing `WebglRenderer` lifecycle code — the official addon does not own renderer attach/detach; that responsibility is correctly ours.
5. Delete `nudgeReflow()` and `attachWhenFontsReady()` — they duplicate the addon's logic, and the addon's version is authoritatively correct.

This is the first time in 12 attempts we have a fix grounded in an upstream-maintained reference implementation rather than reverse-engineering xterm internals.

---

## References

- xterm.js official addon — `@xterm/addon-web-fonts` source: <https://github.com/xtermjs/xterm.js/blob/master/addons/addon-web-fonts/src/WebFontsAddon.ts>
- xterm.js official addon — README: <https://github.com/xtermjs/xterm.js/blob/master/addons/addon-web-fonts/README.md>
- xterm.js official addon — npm: <https://www.npmjs.com/package/@xterm/addon-web-fonts>
- Issue #1164, "Better support for web fonts": <https://github.com/xtermjs/xterm.js/issues/1164>
- Issue #3280, "The webgl renderer doesn't rerender correctly after changing the font": <https://github.com/xtermjs/xterm.js/issues/3280>
- Issue #3817, "Xterm.js is not using imported fonts": <https://github.com/xtermjs/xterm.js/issues/3817>
- Third-party addon `xterm-webfont` (deprecated/unmaintained): <https://github.com/CoderPad/xterm-webfont>
- `FontFaceObserver` (used by `xterm-webfont`): <https://github.com/bramstein/fontfaceobserver>
