/**
 * Full-pane mobile screen stack manager.
 *
 * Each screen fills the viewport above the toolbar.
 * push() shows a screen, pop() returns to the previous one.
 * The terminal is the implicit base — never pushed or popped.
 */

export interface MobileScreen {
  readonly element: HTMLElement;
  onShow(): void;
  onHide(): void;
  dispose(): void;
}

export class ScreenManager {
  private stack: MobileScreen[] = [];
  private terminalPane: HTMLElement | null = null;

  /**
   * Bind the terminal pane so we can hide/show it when screens are
   * pushed on top or the stack is emptied.
   */
  setTerminalPane(el: HTMLElement): void {
    this.terminalPane = el;
  }

  push(screen: MobileScreen): void {
    // Hide current top screen (or terminal if stack is empty)
    const current = this.current();
    if (current) {
      current.element.classList.remove("mobile-screen-active");
      current.onHide();
    } else if (this.terminalPane) {
      this.terminalPane.style.display = "none";
    }

    this.stack.push(screen);
    document.body.appendChild(screen.element);
    screen.element.classList.add("mobile-screen-active");
    screen.onShow();
  }

  pop(): void {
    const top = this.stack.pop();
    if (!top) return;

    top.element.classList.remove("mobile-screen-active");
    top.onHide();
    top.element.remove();
    top.dispose();

    // Reveal previous screen or terminal
    const next = this.current();
    if (next) {
      next.element.classList.add("mobile-screen-active");
      next.onShow();
    } else if (this.terminalPane) {
      this.terminalPane.style.display = "";
    }
  }

  popToRoot(): void {
    while (this.stack.length > 0) {
      const top = this.stack.pop()!;
      top.element.classList.remove("mobile-screen-active");
      top.onHide();
      top.element.remove();
      top.dispose();
    }

    if (this.terminalPane) {
      this.terminalPane.style.display = "";
    }
  }

  current(): MobileScreen | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1]! : null;
  }

  get depth(): number {
    return this.stack.length;
  }

  dispose(): void {
    this.popToRoot();
  }
}
