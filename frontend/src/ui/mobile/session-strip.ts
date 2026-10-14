/**
 * One-line strip above the mobile terminal naming the current session,
 * with a dot per open tab so unread output elsewhere is visible at a
 * glance. ‹ › and a horizontal swipe move between sessions; tapping the
 * name opens the command menu.
 */

import { escapeHtml } from "@core/ui/menu-nav";

export interface StripTab {
  id: string;
  name: string;
  isActive: boolean;
  unread: boolean;
  /** Set by attention hooks: the agent is waiting for input, or finished a turn. */
  attention?: "input" | "idle" | null;
}

export interface SessionStripCallbacks {
  onSwitchRelative: (direction: 1 | -1) => void;
  onOpenMenu: () => void;
}

const SWIPE_THRESHOLD_PX = 50;

/** The tab `direction` steps from the active one, wrapping; null with fewer than two. */
export function neighbourTab<T extends { id: string; isActive: boolean }>(
  tabs: T[],
  direction: 1 | -1,
): T | null {
  if (tabs.length < 2) return null;
  const idx = tabs.findIndex((t) => t.isActive);
  if (idx === -1) return tabs[0]!;
  return tabs[(idx + direction + tabs.length) % tabs.length]!;
}

export class SessionStrip {
  readonly element: HTMLElement;
  private nameEl: HTMLElement;
  private dotsEl: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private touchStartX: number | null = null;
  private touchStartY: number | null = null;

  constructor(private callbacks: SessionStripCallbacks) {
    this.element = document.createElement("div");
    this.element.id = "session-strip";
    this.element.className = "session-strip";

    this.prevBtn = this.makeButton("‹", -1);
    this.nextBtn = this.makeButton("›", 1);

    const centre = document.createElement("button");
    centre.className = "session-strip-centre";
    centre.setAttribute("aria-label", "sessions");
    centre.addEventListener("click", () => this.callbacks.onOpenMenu());

    this.nameEl = document.createElement("span");
    this.nameEl.className = "session-strip-name";
    this.dotsEl = document.createElement("span");
    this.dotsEl.className = "session-strip-dots";
    centre.appendChild(this.nameEl);
    centre.appendChild(this.dotsEl);

    this.element.appendChild(this.prevBtn);
    this.element.appendChild(centre);
    this.element.appendChild(this.nextBtn);

    this.element.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      if (!t) return;
      this.touchStartX = t.clientX;
      this.touchStartY = t.clientY;
    }, { passive: true });
    this.element.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0];
      if (!t || this.touchStartX === null || this.touchStartY === null) return;
      const dx = t.clientX - this.touchStartX;
      const dy = t.clientY - this.touchStartY;
      this.touchStartX = null;
      this.touchStartY = null;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return;
      // Swiping left pulls the next session in from the right.
      this.callbacks.onSwitchRelative(dx < 0 ? 1 : -1);
    });
  }

  private makeButton(label: string, direction: 1 | -1): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "session-strip-arrow";
    btn.textContent = label;
    btn.setAttribute("aria-label", direction === 1 ? "next session" : "previous session");
    btn.addEventListener("click", () => this.callbacks.onSwitchRelative(direction));
    return btn;
  }

  render(tabs: StripTab[], agentLabel?: string | null): void {
    const active = tabs.find((t) => t.isActive);
    const name = active?.name ?? "no session";
    this.nameEl.innerHTML =
      escapeHtml(name) +
      (agentLabel ? `<span class="session-strip-agent"> · ${escapeHtml(agentLabel)}</span>` : "");

    this.dotsEl.innerHTML = tabs
      .map((t) => {
        const cls = ["session-strip-dot"];
        if (t.isActive) cls.push("active");
        if (t.unread) cls.push("unread");
        if (t.attention === "input") cls.push("needs-input");
        else if (t.attention === "idle") cls.push("idle");
        return `<span class="${cls.join(" ")}" title="${escapeHtml(t.name)}"></span>`;
      })
      .join("");

    const multiple = tabs.length > 1;
    this.prevBtn.disabled = !multiple;
    this.nextBtn.disabled = !multiple;
  }

  show(): void {
    this.element.style.display = "";
    document.documentElement.style.setProperty("--session-strip-height", "32px");
  }

  hide(): void {
    this.element.style.display = "none";
    document.documentElement.style.setProperty("--session-strip-height", "0px");
  }

  dispose(): void {
    this.hide();
    this.element.remove();
  }
}
