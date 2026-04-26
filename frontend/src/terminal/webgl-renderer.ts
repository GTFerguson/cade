/**
 * Owns the WebGL addon lifecycle on a single xterm Terminal.
 *
 * Responsibilities:
 * - Attach the addon at construction.
 * - Rebuild the atlas on theme change (callers invoke `refresh()`).
 * - Rebuild the atlas on DPR change (HiDPI / display switch).
 * - Recover from `webglcontextlost` (browser GL eviction under context
 *   pressure — typical with multiple tabs).
 *
 * Webfont loading and post-load remeasurement are NOT this class's
 * responsibility. That lives in WebFontsAddon (frontend/src/terminal/
 * web-fonts.ts), which the terminal loads alongside this. Without that
 * separation the atlas can bake against fallback metrics on first attach
 * and render glyphs as black blocks for the addon's lifetime — see
 * docs/reference/xterm-webfont-loading.md.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

export class WebglRenderer {
  private terminal: XTerm;
  private addon: WebglAddon | null = null;
  private dprMql: MediaQueryList | null = null;
  private dprListener: (() => void) | null = null;
  private disposed = false;
  private contextLossRecoveryTimer: number | null = null;

  constructor(terminal: XTerm) {
    this.terminal = terminal;
    this.bindDprListener();
    this.attach();
  }

  /** Force a full atlas rebuild. Use after theme changes. */
  refresh(): void {
    if (this.disposed) return;
    this.detach();
    this.attach();
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
      // Addon may already be partially disposed.
    }
    this.addon = null;
  }

  private bindDprListener(): void {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const dpr = window.devicePixelRatio || 1;
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const listener = () => {
      this.refresh();
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
    if (this.dprMql && this.dprListener) {
      this.dprMql.removeEventListener("change", this.dprListener);
    }
    this.dprMql = null;
    this.dprListener = null;
    this.detach();
  }
}
