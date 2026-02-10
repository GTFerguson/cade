/**
 * Full-pane TUI help overlay displaying keybinding guide.
 *
 * Auto-generates binding display from getUserConfig().keybindings so
 * the help screen always reflects current configuration. Laid out as
 * two rows: general+tabs side-by-side, then terminal|tree|viewer in
 * three columns matching the workspace panes.
 */

import type { Component } from "./types";
import { getUserConfig, parseKeybinding } from "../config/user-config";
import { renderHelpBar } from "./menu-nav";

// ─── Label Maps ──────────────────────────────────────────────────────

const PANE_LABELS: Record<string, string> = {
  focusLeft: "focus left",
  focusRight: "focus right",
  resizeLeft: "resize left",
  resizeRight: "resize right",
};

const TAB_LABELS: Record<string, string> = {
  next: "next tab",
  previous: "prev tab",
  create: "new tab",
  createRemote: "new remote",
  close: "close tab",
};

const MISC_LABELS: Record<string, string> = {
  toggleTerminal: "toggle agent",
  cycleAgentNext: "next agent",
  cycleAgentPrev: "prev agent",
  toggleViewer: "toggle viewer",
  toggleNeovim: "toggle neovim",
};

// ─── Formatting Utilities ────────────────────────────────────────────

function formatBinding(binding: string): string {
  const parsed = parseKeybinding(binding);
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  parts.push(parsed.key);
  return parts.join("+");
}

function formatPrefixed(binding: string): string {
  return `prefix ${formatBinding(binding)}`;
}

// ─── DOM Helpers ─────────────────────────────────────────────────────

type Binding = { label: string; key: string };

function buildSection(title: string, bindings: Binding[]): HTMLElement {
  const section = document.createElement("div");

  const heading = document.createElement("div");
  heading.className = "help-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  for (const { label, key } of bindings) {
    const row = document.createElement("div");
    row.className = "help-binding-row";

    const labelEl = document.createElement("span");
    labelEl.className = "help-binding-label";
    labelEl.textContent = label;

    const keyEl = document.createElement("span");
    keyEl.className = "help-binding-key";
    keyEl.textContent = key;

    row.appendChild(labelEl);
    row.appendChild(keyEl);
    section.appendChild(row);
  }

  return section;
}

function buildRow(className: string, sections: HTMLElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = `help-row ${className}`;
  for (const s of sections) row.appendChild(s);
  return row;
}

// ─── HelpOverlay ─────────────────────────────────────────────────────

export class HelpOverlay implements Component {
  private overlay: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private isVisible = false;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  initialize(): void {
    // No-op — render happens on show()
  }

  show(): void {
    if (this.isVisible) return;

    // Remove stale overlay if any
    this.overlay?.remove();
    this.render();

    document.body.appendChild(this.overlay!);
    // Force reflow before adding visible class
    void this.overlay!.offsetHeight;
    this.overlay!.classList.add("visible");
    this.isVisible = true;

    this.boundKeyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      switch (e.key) {
        case "q":
        case "Escape":
          this.hide();
          break;
        case "j":
        case "ArrowDown":
          this.body?.scrollBy({ top: 40 });
          break;
        case "k":
        case "ArrowUp":
          this.body?.scrollBy({ top: -40 });
          break;
      }
    };

    setTimeout(() => {
      document.addEventListener("keydown", this.boundKeyHandler!, true);
    }, 50);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    this.overlay?.classList.remove("visible");
    this.overlay?.remove();
    this.overlay = null;
    this.body = null;
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  dispose(): void {
    this.hide();
  }

  // ─── Render ──────────────────────────────────────────────────────

  private render(): void {
    const kb = getUserConfig().keybindings;

    this.overlay = document.createElement("div");
    this.overlay.className = "help-overlay";

    const panel = document.createElement("div");
    panel.className = "help-panel";

    // Header
    const header = document.createElement("div");
    header.className = "help-header";
    header.textContent = "[ KEYBINDINGS ]";
    panel.appendChild(header);

    // Divider
    const divider = document.createElement("div");
    divider.className = "help-divider";
    panel.appendChild(divider);

    // Scrollable body
    this.body = document.createElement("div");
    this.body.className = "help-body";

    // ── Row 1: General + Tabs ──

    const generalBindings: Binding[] = Object.entries(PANE_LABELS).map(
      ([key, label]) => ({
        label,
        key: formatPrefixed(kb.pane[key as keyof typeof kb.pane]),
      })
    );

    const tabBindings: Binding[] = Object.entries(TAB_LABELS).map(
      ([key, label]) => ({
        label,
        key: formatPrefixed(kb.tab[key as keyof typeof kb.tab]),
      })
    );
    tabBindings.push({ label: "go to 1-9", key: "prefix 1-9" });

    this.body.appendChild(
      buildRow("help-row-general", [
        buildSection("GENERAL", generalBindings),
        buildSection("TABS", tabBindings),
      ])
    );

    // ── Row 2: Terminal + File Tree + Viewer ──

    const terminalBindings: Binding[] = Object.entries(MISC_LABELS).map(
      ([key, label]) => ({
        label,
        key: formatPrefixed(kb.misc[key as keyof typeof kb.misc]),
      })
    );
    terminalBindings.push({
      label: "scroll top",
      key: formatPrefixed(kb.navigation.scrollToTop),
    });
    terminalBindings.push({
      label: "scroll bottom",
      key: formatPrefixed(kb.navigation.scrollToBottom),
    });
    terminalBindings.push({ label: "theme", key: "prefix t" });

    const treeBindings: Binding[] = [
      { label: "navigate", key: "j/k" },
      { label: "open/expand", key: "l" },
      { label: "collapse", key: "h" },
      { label: "jump top", key: "gg" },
      { label: "jump bottom", key: "G" },
      { label: "search", key: "/" },
      { label: "clear search", key: "Esc" },
    ];

    const viewerBindings: Binding[] = [
      { label: "scroll", key: "j/k" },
      { label: "top", key: "gg" },
      { label: "bottom", key: "G" },
      { label: "page down", key: "Ctrl+d" },
      { label: "page up", key: "Ctrl+u" },
      { label: "edit mode", key: "i" },
    ];

    this.body.appendChild(
      buildRow("help-row-panes", [
        buildSection("FILE TREE", treeBindings),
        buildSection("TERMINAL", terminalBindings),
        buildSection("VIEWER", viewerBindings),
      ])
    );

    panel.appendChild(this.body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "help-footer";
    footer.innerHTML = renderHelpBar([
      { key: "j/k", label: "scroll" },
      { key: "q", label: "close" },
      { key: "Esc", label: "close" },
    ]);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
  }
}
