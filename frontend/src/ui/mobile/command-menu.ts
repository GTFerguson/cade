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
  /** Close this tab; the session keeps running on the backend. */
  onDetach: () => void;
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

    // Header names the session this menu belongs to.
    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    const active = this.callbacks.getTabs().find((t) => t.isActive);
    header.textContent = `[ ${active?.name ?? "cade"} ]`;
    this.element.appendChild(header);

    const body = document.createElement("div");
    body.className = "mobile-screen-body";
    const list = document.createElement("div");
    list.className = "options-list";
    body.appendChild(list);
    this.element.appendChild(body);

    this.addSection(list, "files");
    this.addOption(list, "[search]", "find a file", () => this.callbacks.onSearch());
    const recent = this.callbacks.getRecentCount();
    this.addOption(
      list,
      "[recent]",
      recent > 0 ? `${recent} changed` : "no changes yet",
      () => this.callbacks.onRecent(),
    );
    this.addOption(list, "[files]", "browse tree", () => this.callbacks.onFiles());
    const currentFile = this.callbacks.getCurrentFileName();
    this.addOption(list, "[viewer]", currentFile ?? "no file", () => this.callbacks.onViewer());
    if (this.callbacks.isDashboardAvailable()) {
      this.addOption(list, "[dashboard]", "", () => this.callbacks.onDashboard());
    }

    this.addSection(list, "sessions");
    for (const tab of this.callbacks.getTabs()) {
      this.addTabOption(list, tab);
    }
    // Sessions already running on this backend (started elsewhere) that
    // this device can attach to.
    for (const session of this.callbacks.getLiveSessions()) {
      this.addLiveSessionOption(list, session);
    }
    this.addOption(list, "[detach]", "leave it running, close this tab", () =>
      this.callbacks.onDetach(),
    );

    this.addSection(list, "app");
    this.addOption(list, "[notify]", this.callbacks.getPushState(), () =>
      this.callbacks.onTogglePush(),
    );
    this.addOption(list, "[theme]", this.callbacks.getCurrentThemeName(), () =>
      this.callbacks.onTheme(),
    );
    this.addOption(list, "[reconnect]", "", () => this.callbacks.onReconnect());

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    statusline.innerHTML =
      `<span><span class="status-mode">MENU</span></span>` +
      `<span style="flex:1"></span>` +
      `<span class="help-hint">tap to select · swipe → back</span>`;
    this.element.appendChild(statusline);

    // Set initial selection and wire clicks
    this.nav.reset();
    this.nav.renderSelection();
    this.nav.wireClickHandlers();
  }

  private addSection(container: HTMLElement, title: string): void {
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = title;
    container.appendChild(label);
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
    const indicator = ["tab-indicator", "remote"];
    if (session.attention === "input") indicator.push("needs-input");
    else if (session.attention === "idle") indicator.push("idle");
    const meta =
      session.attention === "input" ? "needs you · attach" :
      session.attention === "idle" ? "done · attach" :
      `${session.agent} · attach`;
    el.innerHTML =
      `<span class="${indicator.join(" ")}"></span>` +
      `<span class="option-label">${escapeHtml(name)}</span>` +
      `<span class="option-meta">${escapeHtml(meta)}</span>`;
    container.appendChild(el);
    this.optionEls.push(el);
    this.actions.push(() => this.callbacks.onAdoptSession(session));
  }

}
