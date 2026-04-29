/**
 * MCPStatusIcon — statusline indicator for MCP server auth state.
 *
 * Shows a plug icon: red when any server is unauthenticated, dim when all ok.
 * Clicking opens a flyout listing each server; clicking a row opens its auth URL.
 */

export interface MCPEntry {
  name: string;
  authenticated: boolean;
  /** MCP server URL — needed to initiate OAuth via /api/mcp/oauth/start */
  serverUrl?: string;
  /** Optional one-line reason: "401", "no_token", "not_found", etc. */
  reason?: string;
}

export interface MCPStatusIconOptions {
  /** Path prefix to backend (root_path), used when fetching /api/mcp/oauth/start. */
  apiPrefix?: string;
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
  private apiPrefix: string;

  private repositionHandler = (): void => {
    if (this.open) this.positionFlyout();
  };

  constructor(options: MCPStatusIconOptions = {}) {
    this.apiPrefix = options.apiPrefix ?? "";
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
    const wrapper = document.createElement("div");
    wrapper.className = "mcp-status-entry";

    const row = document.createElement("div");
    row.className = "permissions-row mcp-status-row";

    const label = document.createElement("span");
    label.className = "permissions-row-label";
    label.textContent = entry.name;

    const status = document.createElement("span");
    status.className = `mcp-status-indicator mcp-status-indicator--${entry.authenticated ? "ok" : "error"}`;
    status.textContent = entry.authenticated ? "ok" : (entry.reason || "auth");

    row.appendChild(label);
    row.appendChild(status);
    wrapper.appendChild(row);

    if (!entry.authenticated) {
      const detail = document.createElement("div");
      detail.className = "mcp-status-detail";
      detail.style.display = "none";

      const para = document.createElement("div");
      para.className = "mcp-status-detail-text";
      para.textContent = entry.serverUrl
        ? `Authenticate ${entry.name} to enable its tools. CADE will open the OAuth flow in your browser; on success, tokens are saved and you can reload to start using the tools.`
        : `${entry.name} is not authenticated, but no server URL was provided so CADE can't start an OAuth flow automatically.`;
      detail.appendChild(para);

      if (entry.serverUrl) {
        const btn = document.createElement("button");
        btn.className = "mcp-status-detail-action";
        btn.textContent = `Authenticate ${entry.name}`;
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          btn.textContent = "Opening browser…";
          try {
            const url = await this.startAuth(entry);
            window.open(url, "_blank", "noopener,noreferrer");
            para.textContent = `Continue in your browser. When auth completes, ${entry.name} tools become available immediately — no reload needed.`;
            btn.style.display = "none";
          } catch (err) {
            btn.disabled = false;
            btn.textContent = `Authenticate ${entry.name}`;
            para.textContent = `Could not start OAuth flow: ${err instanceof Error ? err.message : String(err)}`;
          }
        });
        detail.appendChild(btn);
      }

      wrapper.appendChild(detail);

      row.style.cursor = "pointer";
      row.title = `Click to expand auth options for ${entry.name}`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = detail.style.display !== "none";
        detail.style.display = open ? "none" : "";
      });
    }

    return wrapper;
  }

  private async startAuth(entry: MCPEntry): Promise<string> {
    if (!entry.serverUrl) throw new Error("missing serverUrl");
    const r = await fetch(`${this.apiPrefix}/api/mcp/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ server: entry.name, serverUrl: entry.serverUrl }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(text);
    }
    const data = await r.json();
    if (!data.authUrl) throw new Error("backend did not return authUrl");
    return data.authUrl as string;
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
