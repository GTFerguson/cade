/**
 * Mobile overflow menu (bottom sheet) triggered by the ⋯ toolbar button.
 *
 * Shows tab list, View File, and Reconnect actions.
 * Slides up from the bottom with a backdrop for dismissal.
 */

import type { Component } from "../types";

export interface OverflowTab {
  id: string;
  name: string;
  projectPath: string;
  isActive: boolean;
}

export interface OverflowMenuCallbacks {
  getTabs: () => OverflowTab[];
  onSwitchTab: (id: string) => void;
  onViewFile: () => void;
  onReconnect: () => void;
}

export class OverflowMenu implements Component {
  private backdrop: HTMLElement;
  private menu: HTMLElement;
  private isOpen = false;

  constructor(private callbacks: OverflowMenuCallbacks) {
    // Create backdrop
    this.backdrop = document.createElement("div");
    this.backdrop.className = "overflow-menu-backdrop";

    // Create menu container
    this.menu = document.createElement("div");
    this.menu.className = "overflow-menu";

    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.menu);
  }

  initialize(): void {
    this.backdrop.addEventListener("click", () => this.close());
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    this.renderContents();

    // Show backdrop first, then slide menu up
    this.backdrop.classList.add("visible");

    // Force reflow before adding open class for transition
    this.menu.offsetHeight;
    this.menu.classList.add("open");
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.menu.classList.remove("open");
    this.backdrop.classList.remove("visible");
  }

  private renderContents(): void {
    const tabs = this.callbacks.getTabs();

    this.menu.innerHTML = "";

    // Drag handle
    const handle = document.createElement("div");
    handle.className = "overflow-menu-handle";
    this.menu.appendChild(handle);

    // Tab section
    const tabSection = document.createElement("div");
    tabSection.className = "overflow-menu-section";

    const tabTitle = document.createElement("div");
    tabTitle.className = "overflow-menu-section-title";
    tabTitle.textContent = "Tabs";
    tabSection.appendChild(tabTitle);

    for (const tab of tabs) {
      const tabEl = document.createElement("div");
      tabEl.className = "overflow-menu-tab" + (tab.isActive ? " active" : "");

      const indicator = document.createElement("div");
      indicator.className = "overflow-menu-tab-indicator";

      const info = document.createElement("div");
      info.style.cssText = "display:flex;flex-direction:column;flex:1;min-width:0;";

      const name = document.createElement("div");
      name.className = "overflow-menu-tab-name";
      name.textContent = tab.name;

      const path = document.createElement("div");
      path.className = "overflow-menu-tab-path";
      path.textContent = tab.projectPath;

      info.appendChild(name);
      info.appendChild(path);
      tabEl.appendChild(indicator);
      tabEl.appendChild(info);

      tabEl.addEventListener("click", () => {
        this.callbacks.onSwitchTab(tab.id);
        this.close();
      });

      tabSection.appendChild(tabEl);
    }

    this.menu.appendChild(tabSection);

    // Divider
    const divider = document.createElement("div");
    divider.className = "overflow-menu-divider";
    this.menu.appendChild(divider);

    // Actions
    this.addAction("📄", "View File", () => {
      this.callbacks.onViewFile();
      this.close();
    });

    this.addAction("🔌", "Reconnect", () => {
      this.callbacks.onReconnect();
      this.close();
    });
  }

  private addAction(icon: string, label: string, onClick: () => void): void {
    const action = document.createElement("div");
    action.className = "overflow-menu-action";

    const iconEl = document.createElement("span");
    iconEl.className = "overflow-menu-action-icon";
    iconEl.textContent = icon;

    const labelEl = document.createElement("span");
    labelEl.className = "overflow-menu-action-label";
    labelEl.textContent = label;

    action.appendChild(iconEl);
    action.appendChild(labelEl);

    action.addEventListener("click", onClick);
    this.menu.appendChild(action);
  }

  dispose(): void {
    this.close();
    this.backdrop.remove();
    this.menu.remove();
  }
}
