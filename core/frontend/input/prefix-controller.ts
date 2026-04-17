/**
 * Tmux-style prefix-key state machine.
 *
 * Models the activation lifecycle for a prefix-based shortcut system where
 * a dedicated key (e.g. Ctrl-A) arms a transient "prefix mode" during which
 * subsequent keys trigger global shortcuts. Supports two usage flows:
 *
 *   Tap-then-shortcut — press & release prefix, then press shortcut.
 *   Prefix mode stays active for a configurable timeout; one shortcut
 *   deactivates it.
 *
 *   Hold-and-shortcut — hold prefix, tap shortcut while held, release.
 *   Multiple shortcuts can fire while held; releasing prefix deactivates
 *   as soon as at least one shortcut has been used.
 *
 * The controller owns the state machine only — it does not install DOM
 * listeners, decide what shortcuts mean, or interpret non-prefix input.
 * The consumer installs its own keyboard listeners and drives this class
 * through `activate()`, `keyHeld()`, `keyReleased()`, and
 * `notifyShortcutUsed()`.
 */

export interface PrefixControllerOptions {
  /**
   * Return the active timeout (ms) before an un-held prefix auto-deactivates.
   * Called on each activation so a config change is picked up live.
   */
  getTimeout: () => number;

  /**
   * Optional: called with `true` on activation and `false` on deactivation.
   * Useful for driving a status-bar indicator.
   */
  onChange?: (active: boolean) => void;
}

export class PrefixController {
  private active = false;
  private timeoutId: number | null = null;
  private held = false;
  private usedWhileHeld = false;

  constructor(private readonly options: PrefixControllerOptions) {}

  /**
   * Arm prefix mode. Restarts the auto-deactivate timer.
   */
  activate(): void {
    const wasActive = this.active;
    this.active = true;
    this.clearTimer();
    this.timeoutId = window.setTimeout(
      () => this.deactivate(),
      this.options.getTimeout()
    );
    if (!wasActive) {
      this.options.onChange?.(true);
    }
  }

  /**
   * Disarm prefix mode. Safe to call when already inactive.
   */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.clearTimer();
    this.options.onChange?.(false);
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Record that the prefix key itself is being held. Consumer must pair
   * this with `keyReleased()` on keyup of the same key.
   */
  keyHeld(): void {
    this.held = true;
    this.usedWhileHeld = false;
  }

  /**
   * Record that the prefix key has been released. If a shortcut fired
   * while it was held, immediately deactivates prefix mode. Otherwise lets
   * the tap flow's timeout handle deactivation.
   */
  keyReleased(): void {
    this.held = false;
    if (this.usedWhileHeld) {
      this.deactivate();
    }
  }

  isKeyHeld(): boolean {
    return this.held;
  }

  /**
   * Tell the controller a shortcut has been handled. In hold mode this
   * just marks usage (prefix stays armed until release). In tap-then-
   * shortcut mode it deactivates immediately so the next keystroke is
   * treated normally.
   */
  notifyShortcutUsed(): void {
    if (this.held) {
      this.usedWhileHeld = true;
    } else {
      this.deactivate();
    }
  }

  /**
   * Release any pending timers. Call when tearing down the owning
   * component so the controller doesn't outlive its listeners.
   */
  dispose(): void {
    this.clearTimer();
    this.active = false;
    this.held = false;
    this.usedWhileHeld = false;
  }

  private clearTimer(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
