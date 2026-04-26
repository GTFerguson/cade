/**
 * Full-pane TUI help overlay displaying keybinding guide.
 *
 * Laid out as two rows:
 *   Row 1 — PANES + TABS (workspace navigation)
 *   Row 2 — CHAT + FILE TREE + MISC (pane-specific bindings)
 */

import type { Component } from "./types";
import { renderHelpBar } from "@core/ui/menu-nav";

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
    this.overlay = document.createElement("div");
    this.overlay.className = "help-overlay";

    const panel = document.createElement("div");
    panel.className = "help-panel";

    const header = document.createElement("div");
    header.className = "help-header";
    header.textContent = "[ KEYBINDINGS ]";
    panel.appendChild(header);

    const divider = document.createElement("div");
    divider.className = "help-divider";
    panel.appendChild(divider);

    this.body = document.createElement("div");
    this.body.className = "help-body";

    // ── Row 1: Panes + Tabs ──

    const paneBindings: Binding[] = [
      { label: "focus left / right", key: "Alt+h / Alt+l" },
      { label: "resize left / right", key: "Alt+H / Alt+L" },
      { label: "toggle terminal", key: "Alt+s" },
      { label: "toggle viewer", key: "Alt+v" },
      { label: "focus chat input", key: "Alt+i" },
      { label: "theme selector", key: "Ctrl+p" },
      { label: "view latest plan", key: "Ctrl+g" },
    ];

    const tabBindings: Binding[] = [
      { label: "prev / next tab", key: "Alt+d / Alt+f" },
      { label: "new tab", key: "Alt+t" },
      { label: "close tab", key: "Alt+w" },
      { label: "new remote tab", key: "Alt+r" },
      { label: "toggle dashboard", key: "Alt+q" },
      { label: "go to tab 1-9", key: "Alt+1-9" },
    ];

    this.body.appendChild(
      buildRow("help-row-general", [
        buildSection("WORKSPACE", paneBindings),
        buildSection("TABS", tabBindings),
      ])
    );

    // ── Row 2: Chat + File Tree + Agents ──

    const chatBindings: Binding[] = [
      { label: "focus input", key: "i  (or Alt+i global)" },
      { label: "blur input", key: "Esc" },
      { label: "scroll up / down", key: "k / j" },
      { label: "page up / down", key: "PgUp / PgDn" },
      { label: "jump top / bottom", key: "gg / G" },
      { label: "scroll while typing", key: "Alt+k/j/g/G" },
      { label: "approve agent", key: "Alt+y" },
      { label: "reject agent", key: "Alt+n" },
    ];

    const treeBindings: Binding[] = [
      { label: "navigate", key: "j / k" },
      { label: "open / expand", key: "l" },
      { label: "collapse", key: "h" },
      { label: "jump top / bottom", key: "gg / G" },
      { label: "search", key: "/" },
      { label: "clear search", key: "Esc" },
    ];

    const agentBindings: Binding[] = [
      { label: "next / prev agent", key: "Alt+] / Alt+[" },
      { label: "next / prev mode", key: "Alt+m / Alt+M" },
      { label: "scroll top / bottom", key: "prefix g / G" },
    ];

    this.body.appendChild(
      buildRow("help-row-panes", [
        buildSection("CHAT", chatBindings),
        buildSection("FILE TREE", treeBindings),
        buildSection("AGENTS", agentBindings),
      ])
    );

    panel.appendChild(this.body);

    const footer = document.createElement("div");
    footer.className = "help-footer";
    footer.innerHTML = renderHelpBar([
      { key: "j/k", label: "scroll" },
      { key: "q / Esc", label: "close" },
    ]);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
  }
}
