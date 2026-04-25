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
    this.attach();
    this.bindFontLoadListener();
    this.bindDprListener();
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
    const ff = this.terminal.options.fontFamily;
    if (ff != null) {
      // Re-assigning the same value forces xterm's renderer to re-measure
      // the character cell against the now-resolved font face.
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
    } catch {
      this.addon = null;
    }
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
