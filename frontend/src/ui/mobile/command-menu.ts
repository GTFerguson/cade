/**
 * Full-pane command menu for mobile.
 *
 * Replaces the bottom-sheet OverflowMenu. Shows:
 *  - [files] / [viewer] shortcuts
 *  - Tab list with active indicators
 *  - [reconnect] / [theme] actions
 *
 * Uses MenuNav for vim-style keyboard navigation.
 */

import { MenuNav, escapeHtml } from "@core/ui/menu-nav";
import type { LiveSessionInfo } from "../../types";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface OverflowTab {
  id: string;
  name: string;
  projectPath: string;
  isActive: boolean;
  /** Output arrived while another tab was active. */
  unread?: boolean;
  attention?: "input" | "idle" | null;
}

export interface CommandMenuCallbacks {
  getTabs: () => OverflowTab[];
  onSwitchTab: (id: string) => void;
  /** Sessions running on the backend that have no tab here yet. */
  getLiveSessions: () => LiveSessionInfo[];
  onAdoptSession: (session: LiveSessionInfo) => void;
  onFiles: () => void;
  onSearch: () => void;
  onRecent: () => void;
  getRecentCount: () => number;
  onViewer: () => void;
  onDashboard: () => void;
  isDashboardAvailable: () => boolean;
  onReconnect: () => void;
  onTheme: () => void;
  /** Current push-notification state, for the [notify] entry. */
  getPushState: () => string;
  onTogglePush: () => void;
  onBack: () => void;
  getCurrentFileName: () => string | null;
  getCurrentThemeName: () => string;
}

export class CommandMenu implements MobileScreen {
  readonly element: HTMLElement;
  private optionEls: HTMLElement[] = [];
  private actions: (() => void)[] = [];
  private nav: MenuNav;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cleanupSwipe: (() => void) | null = null;

  constructor(private callbacks: CommandMenuCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-command-menu";

    this.nav = new MenuNav({
      getOptions: () => this.optionEls,
      onSelect: (i) => this.actions[i]?.(),
      onBack: () => this.callbacks.onBack(),
      onCancel: () => this.callbacks.onBack(),
    });
  }

  onShow(): void {
    this.render();

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (this.nav.handleKeyDown(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", this.boundKeyHandler, true);

    // Swipe right from edge to go back
    this.cleanupSwipe = setupSwipeBack(this.element, () =>
      this.callbacks.onBack()
    );
  }

  onHide(): void {
    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    this.cleanupSwipe?.();
    this.cleanupSwipe = null;
  }

  dispose(): void {
    this.onHide();
    this.optionEls = [];
    this.actions = [];
  }

  /** Re-render in place, keeping the current selection where possible. */
  refresh(): void {
    if (!this.boundKeyHandler) return;
    const selected = this.nav.selectedIndex;
    this.render();
    this.nav.selectedIndex = Math.min(selected, Math.max(0, this.optionEls.length - 1));
    this.nav.renderSelection();
  }

  private render(): void {
    this.element.innerHTML = "";
    this.optionEls = [];
    this.actions = [];

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:100%;max-width:320px;";

    // Header
    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    header.style.cssText = "background:transparent;border:none;margin-bottom:24px;";
    header.textContent = "[ command ]";
    wrapper.appendChild(header);

    const list = document.createElement("div");
    list.className = "options-list";

    // [search] / [recent] / [files]
    this.addOption(list, "[search]", "find a file", () =>
      this.callbacks.onSearch()
    );
    const recent = this.callbacks.getRecentCount();
    this.addOption(
      list,
      "[recent]",
      recent > 0 ? `${recent} changed` : "no changes yet",
      () => this.callbacks.onRecent()
    );
    this.addOption(list, "[files]", "browse tree", () =>
      this.callbacks.onFiles()
    );

    // [viewer]
    const currentFile = this.callbacks.getCurrentFileName();
    this.addOption(
      list,
      "[viewer]",
      currentFile ?? "no file",
      () => this.callbacks.onViewer()
    );

    // [dashboard] — only when the tab has a dashboard config
    if (this.callbacks.isDashboardAvailable()) {
      this.addOption(list, "[dashboard]", "", () =>
        this.callbacks.onDashboard()
      );
    }

    // Divider + tabs section
    list.appendChild(this.createDivider());
    const tabLabel = document.createElement("div");
    tabLabel.className = "section-label";
    tabLabel.textContent = "tabs";
    list.appendChild(tabLabel);

    const tabs = this.callbacks.getTabs();
    for (const tab of tabs) {
      this.addTabOption(list, tab);
    }

    // Sessions already running on this backend (started elsewhere) that
    // this device can attach to.
    const live = this.callbacks.getLiveSessions();
    if (live.length > 0) {
      list.appendChild(this.createDivider());
      const liveLabel = document.createElement("div");
      liveLabel.className = "section-label";
      liveLabel.textContent = "on server";
      list.appendChild(liveLabel);
      for (const session of live) {
        this.addLiveSessionOption(list, session);
      }
    }

    // Divider + bottom actions
    list.appendChild(this.createDivider());
    this.addOption(list, "[reconnect]", "", () =>
      this.callbacks.onReconnect()
    );
    this.addOption(list, "[notify]", this.callbacks.getPushState(), () =>
      this.callbacks.onTogglePush()
    );
    this.addOption(
      list,
      "[theme]",
      this.callbacks.getCurrentThemeName(),
      () => this.callbacks.onTheme()
    );

    wrapper.appendChild(list);
    this.element.appendChild(wrapper);

    // Help text - mobile-friendly instructions
    const help = document.createElement("div");
    help.className = "pane-help mobile-help";
    help.innerHTML = `<span class="help-hint">tap to select · swipe → back</span>`;
    this.element.appendChild(help);

    // Set initial selection and wire clicks
    this.nav.reset();
    this.nav.renderSelection();
    this.nav.wireClickHandlers();
  }

  private addOption(
    container: HTMLElement,
    label: string,
    meta: string,
    action: () => void
  ): void {
    const el = document.createElement("div");
    el.className = "option";
    el.innerHTML =
      `<span class="option-label">${escapeHtml(label)}</span>` +
      (meta
        ? `<span class="option-meta">${escapeHtml(meta)}</span>`
        : "");
    container.appendChild(el);
    this.optionEls.push(el);
    this.actions.push(action);
  }

  private addTabOption(container: HTMLElement, tab: OverflowTab): void {
    const el = document.createElement("div");
    el.className = "option";
    const indicator = ["tab-indicator"];
    if (tab.isActive) indicator.push("active");
    if (tab.attention === "input") indicator.push("needs-input");
    else if (tab.attention === "idle") indicator.push("idle");
    else if (tab.unread) indicator.push("unread");
    const meta =
      tab.attention === "input" ? "needs you" :
      tab.attention === "idle" ? "done" :
      tab.unread ? "new output" : tab.projectPath;
    el.innerHTML =
      `<span class="${indicator.join(" ")}"></span>` +
      `<span class="option-label">${escapeHtml(tab.name)}</span>` +
      `<span class="option-meta">${escapeHtml(meta)}</span>`;
    container.appendChild(el);
    this.optionEls.push(el);
    this.actions.push(() => this.callbacks.onSwitchTab(tab.id));
  }

  private addLiveSessionOption(container: HTMLElement, session: LiveSessionInfo): void {
    const name = session.label ?? session.projectPath.split("/").pop() ?? session.id;
    const el = document.createElement("div");
    el.className = "option";
    el.innerHTML =
      `<span class="tab-indicator"></span>` +
      `<span class="option-label">${escapeHtml(name)}</span>` +
      `<span class="option-meta">${escapeHtml(`${session.agent} · ${session.clients} online`)}</span>`;
    container.appendChild(el);
    this.optionEls.push(el);
    this.actions.push(() => this.callbacks.onAdoptSession(session));
  }

  private createDivider(): HTMLElement {
    const d = document.createElement("div");
    d.className = "divider";
    return d;
  }
}
