/**
 * MCPStatusIcon — statusline indicator for MCP server auth state.
 *
 * Shows a plug icon: red when any server is unauthenticated, dim when all ok.
 * Clicking opens a flyout listing each server; clicking a row opens its auth URL.
 */

export interface MCPEntry {
  name: string;
  authenticated: boolean;
  authUrl?: string;
}

// Minimal two-prong plug SVG
const PLUG_SVG = `<svg viewBox="0 0 10 11" fill="currentColor" width="11" height="11" aria-hidden="true">
  <rect x="2.5" y="0"   width="1.5" height="3.5" rx="0.5"/>
  <rect x="6"   y="0"   width="1.5" height="3.5" rx="0.5"/>
  <rect x="0.5" y="3"   width="9"   height="4.5" rx="1"/>
  <rect x="4.25" y="7.5" width="1.5" height="2.5" rx="0.5"/>
</svg>`;

export class MCPStatusIcon {
  private el: HTMLElement;
  private btn: HTMLButtonElement;
  private flyout: HTMLElement;
  private entries: MCPEntry[] = [];
  private open = false;

  private repositionHandler = (): void => {
    if (this.open) this.positionFlyout();
  };

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "mcp-status-widget";
    this.el.style.display = "none"; // hidden until entries arrive

    this.flyout = this.buildFlyout();
    this.btn = this.buildButton();

    this.el.appendChild(this.btn);
    document.body.appendChild(this.flyout);

    document.addEventListener("click", (e) => {
      if (!this.open) return;
      const target = e.target as Node;
      if (this.el.contains(target) || this.flyout.contains(target)) return;
      this.closeFlyout();
    });
  }

  getElement(): HTMLElement {
    return this.el;
  }

  setStatus(entries: MCPEntry[]): void {
    this.entries = entries;
    this.el.style.display = entries.length > 0 ? "" : "none";
    this.updateButton();
    this.updateFlyout();
  }

  dispose(): void {
    this.flyout.remove();
  }

  private hasUnauthenticated(): boolean {
    return this.entries.some((e) => !e.authenticated);
  }

  private buildButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "mcp-status-btn";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.updateButton(btn);
    return btn;
  }

  private updateButton(btn: HTMLButtonElement = this.btn): void {
    const bad = this.hasUnauthenticated();
    btn.className = `mcp-status-btn${bad ? " mcp-status-btn--error" : ""}`;
    btn.title = bad
      ? "MCP: some servers not authenticated — click for details"
      : "MCP: all servers connected";
    btn.innerHTML = PLUG_SVG;
  }

  private buildFlyout(): HTMLElement {
    const flyout = document.createElement("div");
    flyout.className = "mcp-status-flyout";
    flyout.setAttribute("aria-hidden", "true");
    return flyout;
  }

  private updateFlyout(): void {
    this.flyout.innerHTML = "";

    const title = document.createElement("div");
    title.className = "permissions-flyout-title"; // reuse same style
    title.textContent = "mcp servers";
    this.flyout.appendChild(title);

    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mcp-status-empty";
      empty.textContent = "no mcp servers configured";
      this.flyout.appendChild(empty);
      return;
    }

    for (const entry of this.entries) {
      this.flyout.appendChild(this.buildRow(entry));
    }
  }

  private buildRow(entry: MCPEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "permissions-row mcp-status-row"; // reuse layout styles

    const label = document.createElement("span");
    label.className = "permissions-row-label";
    label.textContent = entry.name;

    const status = document.createElement("span");
    status.className = `mcp-status-indicator mcp-status-indicator--${entry.authenticated ? "ok" : "error"}`;
    status.textContent = entry.authenticated ? "ok" : "auth";

    row.appendChild(label);
    row.appendChild(status);

    if (!entry.authenticated && entry.authUrl) {
      row.style.cursor = "pointer";
      row.title = `Authenticate ${entry.name}`;
      row.addEventListener("click", () => {
        window.open(entry.authUrl, "_blank", "noopener,noreferrer");
        this.closeFlyout();
      });
    }

    return row;
  }

  private toggle(): void {
    if (this.open) {
      this.closeFlyout();
    } else {
      this.openFlyout();
    }
  }

  private openFlyout(): void {
    this.open = true;
    this.flyout.classList.add("permissions-flyout--open");
    this.flyout.setAttribute("aria-hidden", "false");
    this.btn.classList.add("mcp-status-btn--active");
    this.positionFlyout();
    window.addEventListener("resize", this.repositionHandler);
    window.addEventListener("scroll", this.repositionHandler, true);
  }

  private closeFlyout(): void {
    this.open = false;
    this.flyout.classList.remove("permissions-flyout--open");
    this.flyout.setAttribute("aria-hidden", "true");
    this.btn.classList.remove("mcp-status-btn--active");
    window.removeEventListener("resize", this.repositionHandler);
    window.removeEventListener("scroll", this.repositionHandler, true);
  }

  private positionFlyout(): void {
    const rect = this.btn.getBoundingClientRect();
    this.flyout.style.right = `${window.innerWidth - rect.right}px`;
    this.flyout.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  }
}
