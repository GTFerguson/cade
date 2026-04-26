/**
 * Webfont loader for xterm.js — ported from @xterm/addon-web-fonts.
 *
 * The published addon (https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-fonts)
 * has a peer dependency on xterm.js v6-beta, which we don't ship. The
 * implementation only uses public v5 APIs (`term.options.fontFamily`,
 * `document.fonts`, the `ITerminalAddon` shape), so it ports cleanly.
 *
 * Original license: MIT, Copyright (c) 2024 The xterm.js authors.
 *
 * Why we have this at all: xterm measures glyph cells synchronously at
 * `term.open()` time. If the bundled webfont isn't fully loaded into the
 * OffscreenCanvas font registry by then, measurement falls back to a system
 * font. The atlas bakes with wrong cell dimensions and renders glyphs as
 * black blocks for the lifetime of the addon. `loadFonts()` here forces the
 * per-FontFace `.load()` await that `document.fonts.ready` alone does not
 * guarantee. See docs/reference/xterm-webfont-loading.md for the full
 * research log.
 */

import type { Terminal, ITerminalAddon } from "@xterm/xterm";

function unquote(s: string): string {
  if (s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  if (s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1);
  return s;
}

function quote(s: string): string {
  const pos = s.match(/([-_a-zA-Z0-9\xA0-\u{10FFFF}]+)/u);
  const neg = s.match(/^(-?\d|--)/m);
  if (!neg && pos && pos[1] === s) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function splitFamily(family: string | undefined): string[] {
  if (!family) return [];
  return family.split(",").map((e) => unquote(e.trim()));
}

function createFamily(families: string[]): string {
  return families.map(quote).join(", ");
}

function hashFontFace(ff: FontFace): string {
  return JSON.stringify([
    unquote(ff.family),
    ff.stretch,
    ff.style,
    ff.unicodeRange,
    ff.weight,
  ]);
}

function _loadFonts(fonts?: (string | FontFace)[]): Promise<FontFace[]> {
  const ffs = Array.from(document.fonts);
  if (!fonts || !fonts.length) {
    return Promise.all(ffs.map((ff) => ff.load()));
  }
  let toLoad: FontFace[] = [];
  const ffsHashed = ffs.map((ff) => hashFontFace(ff));
  for (const font of fonts) {
    if (font instanceof FontFace) {
      const fontHashed = hashFontFace(font);
      const idx = ffsHashed.indexOf(fontHashed);
      if (idx === -1) {
        document.fonts.add(font);
        ffs.push(font);
        ffsHashed.push(fontHashed);
        toLoad.push(font);
      } else {
        toLoad.push(ffs[idx]!);
      }
    } else {
      const familyFiltered = ffs.filter((ff) => font === unquote(ff.family));
      toLoad = toLoad.concat(familyFiltered);
      if (!familyFiltered.length) {
        return Promise.reject(
          new Error(`font family "${font}" not registered in document.fonts`),
        );
      }
    }
  }
  return Promise.all(toLoad.map((ff) => ff.load()));
}

/**
 * Wait for webfont resources to be fully loaded.
 *
 * Without arguments, loads every face currently in `document.fonts`. With
 * a list of family-name strings, loads only the faces whose family matches.
 * With `FontFace` instances, registers and loads them.
 *
 * The returned promise resolves only after all matching faces have finished
 * loading. This is stronger than `document.fonts.ready`, which signals the
 * FontFaceSet's collective state but does not guarantee per-face readiness
 * in the OffscreenCanvas font registry that xterm's WebGL renderer measures
 * against.
 */
export function loadFonts(
  fonts?: (string | FontFace)[],
): Promise<FontFace[]> {
  return document.fonts.ready.then(() => _loadFonts(fonts));
}

/**
 * Terminal addon. Optional — `loadFonts()` standalone is enough for the
 * bootstrap-time gate. Load this addon into a terminal if you want runtime
 * `relayout()` available (e.g. to recover from a webfont rendering glitch
 * mid-session).
 */
export class WebFontsAddon implements ITerminalAddon {
  private _term: Terminal | undefined;

  constructor(public initialRelayout: boolean = true) {}

  public dispose(): void {
    this._term = undefined;
  }

  public activate(term: Terminal): void {
    this._term = term;
    if (this.initialRelayout) {
      document.fonts.ready.then(() => this.relayout());
    }
  }

  public loadFonts(fonts?: (string | FontFace)[]): Promise<FontFace[]> {
    return loadFonts(fonts);
  }

  /**
   * Force xterm to remeasure the cell against currently-loaded webfonts.
   *
   * Toggles `fontFamily` through a sentinel value to defeat xterm's
   * same-value early-return in the option setter. Awaits `_loadFonts(dirty)`
   * first so we know all per-face loads have completed before remeasure.
   */
  public async relayout(): Promise<void> {
    if (!this._term) return;
    await document.fonts.ready;
    const family = this._term.options.fontFamily;
    if (!family) return;
    const families = splitFamily(family);
    const webFamilies = Array.from(
      new Set(Array.from(document.fonts).map((e) => unquote(e.family))),
    );
    const dirty: string[] = [];
    const clean: string[] = [];
    for (const fam of families) {
      (webFamilies.indexOf(fam) !== -1 ? dirty : clean).push(fam);
    }
    if (!dirty.length) return;
    await _loadFonts(dirty);
    if (this._term) {
      this._term.options.fontFamily = clean.length
        ? createFamily(clean)
        : "monospace";
      this._term.options.fontFamily = family;
    }
  }
}
