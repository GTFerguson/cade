/**
 * PermissionsButton — statusline flyout panel for permission toggles.
 *
 * Renders differently based on the active provider:
 *  - "api" (LiteLLM): full 5-toggle panel
 *  - "cc" (Claude Code): single accept-edits toggle
 */

interface PermissionState {
  providerType: "api" | "cc";
  allowRead: boolean;
  allowWrite: boolean;
  allowTools: boolean;
  allowSubagents: boolean;
  autoApproveReports: boolean;
}

const API_PERMISSIONS: { key: keyof PermissionState; label: string }[] = [
  { key: "allowRead", label: "read" },
  { key: "allowWrite", label: "write" },
  { key: "allowTools", label: "tools" },
  { key: "allowSubagents", label: "subagents" },
  { key: "autoApproveReports", label: "auto-reports" },
];

export class PermissionsButton {
  private el: HTMLElement;
  private btn: HTMLButtonElement;
  private flyout: HTMLElement;
  private state: PermissionState = {
    providerType: "api",
    allowRead: true,
    allowWrite: true,
    allowTools: true,
    allowSubagents: true,
    autoApproveReports: false,
  };
  private open = false;

  private repositionHandler = (): void => {
    if (this.open) this.positionFlyout();
  };

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "permissions-widget";

    this.flyout = this.buildFlyout();
    this.btn = this.buildButton();

    this.el.appendChild(this.btn);
    // Portal the flyout to <body> so it escapes any ancestor stacking context
    // or overflow clipping created by the chat/terminal pane hierarchy.
    document.body.appendChild(this.flyout);

    document.addEventListener("click", (e) => {
      if (!this.open) return;
      const target = e.target as Node;
      if (this.el.contains(target) || this.flyout.contains(target)) return;
      this.closeFlyout();
    });

    this.loadState();
  }

  getElement(): HTMLElement {
    return this.el;
  }

  private get isCc(): boolean {
    return this.state.providerType === "cc";
  }

  private buildButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "permissions-btn";
    btn.title = "Permissions";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // CC mode: button directly toggles accept-edits, no flyout
      if (this.isCc) {
        void this.setPermission("allowWrite", !this.state.allowWrite);
      } else {
        this.toggle();
      }
    });
    this.updateButtonLabel(btn);
    return btn;
  }

  private buildFlyout(): HTMLElement {
    const flyout = document.createElement("div");
    flyout.className = "permissions-flyout";
    flyout.setAttribute("aria-hidden", "true");

    const title = document.createElement("div");
    title.className = "permissions-flyout-title";
    title.textContent = "permissions";
    flyout.appendChild(title);

    for (const { key, label } of API_PERMISSIONS) {
      flyout.appendChild(this.buildRow(key, label));
    }

    return flyout;
  }

  private buildRow(key: keyof PermissionState, label: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "permissions-row";
    row.dataset["key"] = key;
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      const val = this.state[key];
      void this.setPermission(key, !(typeof val === "boolean" ? val : true));
    });

    const labelEl = document.createElement("span");
    labelEl.className = "permissions-row-label";
    labelEl.textContent = label;

    const toggle = document.createElement("button");
    toggle.className = "permissions-toggle";
    toggle.dataset["key"] = key;
    // Row click handles toggle; stop propagation to avoid double-firing
    toggle.addEventListener("click", (e) => e.stopPropagation());

    row.appendChild(labelEl);
    row.appendChild(toggle);
    return row;
  }

  private updateButtonLabel(btn: HTMLButtonElement = this.btn): void {
    if (this.isCc) {
      const on = this.state.allowWrite;
      btn.innerHTML = `<span class="permissions-btn-label">edits</span><span class="${on ? "perm-on" : "perm-off"}">${on ? "on" : "off"}</span>`;
      btn.title = on ? "Accept edits: on (click to disable)" : "Accept edits: off (click to enable)";
    } else {
      const { allowRead: r, allowWrite: w, allowTools: t, allowSubagents: s } = this.state;
      const parts = [
        `<span class="${r ? "perm-on" : "perm-off"}">r</span>`,
        `<span class="${w ? "perm-on" : "perm-off"}">w</span>`,
        `<span class="${t ? "perm-on" : "perm-off"}">t</span>`,
        `<span class="${s ? "perm-on" : "perm-off"}">s</span>`,
      ];
      btn.innerHTML = `<span class="permissions-btn-label">perms</span><span class="permissions-btn-flags">${parts.join("")}</span>`;
      btn.title = "Permissions";
    }
  }

  private updateFlyoutState(): void {
    for (const { key } of API_PERMISSIONS) {
      const row = this.flyout.querySelector(`[data-key="${key}"]`);
      if (!row) continue;
      const toggle = row.querySelector(".permissions-toggle") as HTMLButtonElement | null;
      if (!toggle) continue;
      const val = this.state[key];
      const on = typeof val === "boolean" ? val : true;
      toggle.textContent = on ? "on" : "off";
      toggle.classList.toggle("permissions-toggle--on", on);
      toggle.classList.toggle("permissions-toggle--off", !on);
    }
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
    this.btn.classList.add("permissions-btn--active");
    this.positionFlyout();
    window.addEventListener("resize", this.repositionHandler);
    window.addEventListener("scroll", this.repositionHandler, true);
  }

  private closeFlyout(): void {
    this.open = false;
    this.flyout.classList.remove("permissions-flyout--open");
    this.flyout.setAttribute("aria-hidden", "true");
    this.btn.classList.remove("permissions-btn--active");
    window.removeEventListener("resize", this.repositionHandler);
    window.removeEventListener("scroll", this.repositionHandler, true);
  }

  private positionFlyout(): void {
    const rect = this.btn.getBoundingClientRect();
    // Anchor flyout's bottom-right to the button's top-right, opening upward
    // and leftward. 6px gap matches the original design.
    this.flyout.style.right = `${window.innerWidth - rect.right}px`;
    this.flyout.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  }

  private async loadState(): Promise<void> {
    try {
      const res = await fetch("/api/permissions/state");
      if (!res.ok) return;
      const data = await res.json() as Partial<PermissionState>;
      this.applyState(data);
    } catch {
      // Backend unavailable — keep defaults
    }
  }

  private applyState(data: Partial<PermissionState>): void {
    if (data.providerType) this.state.providerType = data.providerType;
    for (const key of Object.keys(this.state) as (keyof PermissionState)[]) {
      if (key === "providerType") continue;
      if (key in data && typeof data[key] === "boolean") {
        (this.state as unknown as Record<string, unknown>)[key] = data[key];
      }
    }
    this.updateButtonLabel();
    this.updateFlyoutState();
    // Flyout not relevant in CC mode
    if (this.isCc && this.open) this.closeFlyout();
  }

  private async setPermission(key: keyof PermissionState, value: boolean): Promise<void> {
    (this.state as unknown as Record<string, unknown>)[key] = value;
    this.updateButtonLabel();
    this.updateFlyoutState();

    try {
      await fetch("/api/permissions/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key, value }),
      });
    } catch {
      // Best-effort sync
    }
  }
}
