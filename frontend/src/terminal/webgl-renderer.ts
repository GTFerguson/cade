import { Terminal as XTerm } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";

export class WebglRenderer {
  private terminal: XTerm;
  private addon: CanvasAddon | null = null;
  private dprMql: MediaQueryList | null = null;
  private dprListener: (() => void) | null = null;
  private disposed = false;

  constructor(terminal: XTerm) {
    this.terminal = terminal;
    this.bindDprListener();
    this.attach();
  }

  /** Re-attach after theme changes or DPR changes. */
  refresh(): void {
    if (this.disposed) return;
    this.detach();
    this.attach();
  }

  private attach(): void {
    if (this.disposed) return;
    try {
      const addon = new CanvasAddon();
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
    if (this.dprMql && this.dprListener) {
      this.dprMql.removeEventListener("change", this.dprListener);
    }
    this.dprMql = null;
    this.dprListener = null;
    this.detach();
  }
}
