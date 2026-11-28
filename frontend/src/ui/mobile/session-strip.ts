/**
 * One-line strip above the mobile terminal naming the current session,
 * with a dot per tab of its workspace so unread output beside it is visible
 * at a glance. ‹ › and a horizontal swipe move between those sessions, as
 * the tab keys do on the desktop; tapping the name opens the command menu,
 * which lists every workspace. The active session's pull request sits at
 * the right as its number and mark, and a tap opens it. Beside it, a count
 * of the sessions waiting on the user, in any workspace, opens the queue.
 */

import { escapeHtml } from "@core/ui/menu-nav";
import { pullRequestMark, pullRequestWords, type AnyPullRequest } from "../../tabs/work-words";

export interface StripTab {
  id: string;
  name: string;
  isActive: boolean;
  unread: boolean;
  /** Set by attention hooks: the agent is waiting for input, or finished a turn. */
  attention?: "input" | "idle" | "working" | null;
  /** Tab group the tab is in, and the CSS colour the group is drawn in. */
  group?: string;
  groupColour?: string;
  /** The pull request for the tab's stream, else for its folder's branch. */
  pr?: AnyPullRequest | null;
}

export interface SessionStripCallbacks {
  onSwitchRelative: (direction: 1 | -1) => void;
  onOpenMenu: () => void;
  onOpenUrl: (url: string) => void;
  onOpenQueue: () => void;
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

/**
 * The tabs of the open workspace: those in the active tab's group, or the
 * ungrouped ones when it is in none. Every tab when none is active.
 */
export function workspaceTabs<T extends { isActive: boolean; group?: string }>(tabs: T[]): T[] {
  const active = tabs.find((t) => t.isActive);
  if (!active) return tabs;
  return tabs.filter((t) => (t.group ?? null) === (active.group ?? null));
}

export class SessionStrip {
  readonly element: HTMLElement;
  private nameEl: HTMLElement;
  private dotsEl: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private prBtn: HTMLButtonElement;
  private queueBtn: HTMLButtonElement;
  private prUrl: string | null = null;
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

    this.prBtn = document.createElement("button");
    this.prBtn.className = "session-strip-pr";
    this.prBtn.hidden = true;
    this.prBtn.addEventListener("click", () => {
      if (this.prUrl) this.callbacks.onOpenUrl(this.prUrl);
    });

    this.queueBtn = document.createElement("button");
    this.queueBtn.className = "session-strip-queue";
    this.queueBtn.hidden = true;
    this.queueBtn.addEventListener("click", () => this.callbacks.onOpenQueue());

    this.element.appendChild(this.prevBtn);
    this.element.appendChild(centre);
    this.element.appendChild(this.queueBtn);
    this.element.appendChild(this.prBtn);
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

  /** `tabs` is every open tab; the strip shows the open workspace's. */
  render(allTabs: StripTab[], agentLabel?: string | null): void {
    const tabs = workspaceTabs(allTabs);
    const active = tabs.find((t) => t.isActive);
    const name = active?.name ?? "no session";
    this.nameEl.innerHTML =
      (active?.group
        ? `<span class="session-strip-group" style="color: ${escapeHtml(active.groupColour ?? "inherit")}">${escapeHtml(active.group)}</span> `
        : "") +
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

    this.renderPullRequest(active?.pr ?? null);

    const multiple = tabs.length > 1;
    this.prevBtn.disabled = !multiple;
    this.nextBtn.disabled = !multiple;
  }

  /**
   * The queue's size: sessions blocked on the user, and finished turns.
   * Orange while anything is blocked, the finished dot's cyan otherwise;
   * hidden when nothing waits.
   */
  setQueue(blocked: number, finished: number): void {
    const total = blocked + finished;
    this.queueBtn.hidden = total === 0;
    this.queueBtn.textContent = `[${total}]`;
    this.queueBtn.classList.toggle("blocked", blocked > 0);
    const parts = [blocked > 0 ? `${blocked} blocked` : null, finished > 0 ? `${finished} finished` : null];
    this.queueBtn.setAttribute("aria-label", `queue: ${parts.filter(Boolean).join(", ")}`);
  }

  private renderPullRequest(pr: AnyPullRequest | null): void {
    this.prUrl = pr?.url ?? null;
    this.prBtn.hidden = !pr;
    if (!pr) return;
    const { text, tone } = pullRequestMark(pr);
    this.prBtn.textContent = text;
    this.prBtn.dataset["tone"] = tone;
    // The mark alone is terse; the label carries the whole state for a
    // screen reader and for a long press.
    const words = pullRequestWords(pr);
    const label = [words.text, ...words.rest].join(", ");
    this.prBtn.setAttribute("aria-label", `pull request ${label}`);
    this.prBtn.title = `${label}\n${pr.title}`;
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
