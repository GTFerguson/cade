/**
 * Owns a WebglAddon and rebuilds it whenever its rendering inputs change.
 *
 * xterm.js's WebGL renderer rasterises glyphs into a texture atlas at first
 * paint. The atlas is not invalidated when the underlying inputs change —
 * font load completion, devicePixelRatio change, or theme update. The result
 * is solid-block glyph corruption: the atlas serves stale cells while xterm
 * samples them at the new metrics.
 *
 * Disposing and re-loading the addon forces a full atlas rebuild and is the
 * canonical fix.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

export class WebglRenderer {
  private terminal: XTerm;
  private addon: WebglAddon | null = null;
  private dprMql: MediaQueryList | null = null;
  private dprListener: (() => void) | null = null;
  private fontLoadListener: (() => void) | null = null;
  private disposed = false;
  private contextLossRecoveryTimer: number | null = null;

  constructor(terminal: XTerm) {
    this.terminal = terminal;
    this.bindFontLoadListener();
    this.bindDprListener();
    this.attachWhenFontsReady();
  }

  /**
   * Defer the initial WebGL attach until document.fonts.ready resolves.
   *
   * xterm's atlas is baked at attach time using canvas.measureText() against
   * whatever font is available at that instant. Attaching before the bundled
   * JetBrains Mono has loaded causes the atlas to use fallback-font metrics —
   * glyphs end up the wrong size and render as solid black blocks.
   *
   * document.fonts.ready resolves immediately when fonts are cached, and
   * after the network fetch completes when they're not. During the wait xterm
   * falls back to its DOM renderer, which has no atlas and is always correct.
   * The visible gap is under one animation frame for cached fonts, or the
   * actual fetch latency for cold loads — neither is perceptible in practice.
   */
  private attachWhenFontsReady(): void {
    if (typeof document === "undefined" || !document.fonts) {
      this.attach();
      return;
    }
    document.fonts.ready
      .then(() => {
        // Guard against double-attach: loadingdone fires (sync) before the
        // ready promise resolves (microtask), so invalidate() may have already
        // called attach() by the time we get here.
        if (this.disposed || this.addon !== null) return;
        this.nudgeReflow();
        this.attach();
      })
      .catch(() => {
        if (!this.disposed) this.attach();
      });
  }

  /**
   * Force a full rebuild of the WebGL atlas. Use after theme changes.
   */
  refresh(): void {
    if (this.disposed) return;
    this.detach();
    this.attach();
  }

  /**
   * Rebuild after metrics-affecting changes (font load, DPR change). Nudges
   * xterm into re-measuring the character cell before the atlas is rebuilt.
   */
  private invalidate(): void {
    if (this.disposed) return;
    this.nudgeReflow();
    this.detach();
    this.attach();
  }

  private nudgeReflow(): void {
    // xterm's option setters early-return when the new value equals the old,
    // so re-assigning the same fontFamily does NOT trigger a re-measurement.
    // Toggle through a sentinel value to force the setter to do real work,
    // then restore the original. This is what actually re-measures cell
    // dimensions against the now-loaded font face — without it, the atlas
    // gets rebuilt with stale fallback metrics and glyphs render as black
    // blocks at the wrong cell size.
    const ff = this.terminal.options.fontFamily;
    if (ff != null) {
      this.terminal.options.fontFamily = ff + ", monospace";
      this.terminal.options.fontFamily = ff;
    }
  }

  private attach(): void {
    if (this.disposed) return;
    try {
      const addon = new WebglAddon(true);
      addon.onContextLoss(() => {
        this.detach();
        if (this.contextLossRecoveryTimer != null) {
          window.clearTimeout(this.contextLossRecoveryTimer);
        }
        this.contextLossRecoveryTimer = window.setTimeout(() => {
          this.contextLossRecoveryTimer = null;
          this.attach();
        }, 100);
      });
      this.terminal.loadAddon(addon);
      this.addon = addon;
      this.prewarmAtlas();
    } catch {
      this.addon = null;
    }
  }

  /**
   * Force xterm to measure and bake every weight/style variant into the
   * WebGL atlas now, while we know fonts are loaded.
   *
   * xterm's atlas is built lazily — each variant (italic, bold, bold-italic)
   * is measured the first time it appears on screen. Measurement runs on an
   * OffscreenCanvas whose font registration can lag behind document.fonts
   * readiness by a tick or more. A variant added during that gap bakes with
   * system-fallback metrics and renders as black for the lifetime of the
   * addon. The bug is observable as: regular ASCII renders fine, then later
   * (sometimes after minutes of use, or as soon as a syntax-highlighted diff
   * lands) italic and bold glyphs start coming through as solid black blocks.
   *
   * Writing one character of each variant on the alternate screen buffer
   * forces all four to be measured and atlased now. Main screen content and
   * cursor position are unaffected. The whole sequence is one atomic write —
   * xterm parses it before scheduling the next render frame, so no alt-screen
   * content ever paints.
   *
   * xterm uses two weights (`fontWeight` 400 default, `fontWeightBold` 700
   * default) × {regular, italic} = 4 variants. The 8-face load in
   * font-loader.ts also covers Medium/SemiBold for the chat path; xterm
   * itself never asks for those.
   */
  private prewarmAtlas(): void {
    this.terminal.write(
      "\x1b[?1049h" +
        "X" +
        "\x1b[3mX\x1b[0m" +
        "\x1b[1mX\x1b[0m" +
        "\x1b[1;3mX\x1b[0m" +
        "\x1b[?1049l",
    );
  }

  private detach(): void {
    try {
      this.addon?.dispose();
    } catch {
      // Ignore — addon may already be in a partially-disposed state.
    }
    this.addon = null;
  }

  private bindFontLoadListener(): void {
    if (typeof document === "undefined" || !document.fonts) return;
    this.fontLoadListener = () => this.invalidate();
    document.fonts.addEventListener("loadingdone", this.fontLoadListener);
  }

  private bindDprListener(): void {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const dpr = window.devicePixelRatio || 1;
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const listener = () => {
      this.invalidate();
      mql.removeEventListener("change", listener);
      // Re-bind against the new DPR so subsequent changes also trigger.
      this.dprMql = null;
      this.dprListener = null;
      this.bindDprListener();
    };
    mql.addEventListener("change", listener);
    this.dprMql = mql;
    this.dprListener = listener;
  }

  dispose(): void {
    this.disposed = true;
    if (this.contextLossRecoveryTimer != null) {
      window.clearTimeout(this.contextLossRecoveryTimer);
      this.contextLossRecoveryTimer = null;
    }
    if (this.fontLoadListener && typeof document !== "undefined" && document.fonts) {
      document.fonts.removeEventListener("loadingdone", this.fontLoadListener);
    }
    if (this.dprMql && this.dprListener) {
      this.dprMql.removeEventListener("change", this.dprListener);
    }
    this.fontLoadListener = null;
    this.dprMql = null;
    this.dprListener = null;
    this.detach();
  }
}
