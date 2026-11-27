/**
 * The quick-draw screen: the sessions that want the user, dealt one card at
 * a time in `drawQueue` order.
 *
 * A card names the session and its workspace, says what kind of wait it is,
 * and quotes the bottom of the agent's screen, where the prompt is drawn,
 * when this device has the session open. "go to it" opens the session;
 * "next" puts the card aside for this showing of the screen. The screen
 * redraws whenever the sessions change, so a prompt answered elsewhere
 * drops out of the queue without anyone acting on its card.
 */

import { escapeHtml } from "@core/ui/menu-nav";
import type { AttentionKind, AttentionState } from "../../types";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";
import { relativeTime } from "./recent-files";
import { drawQueue, screenTail, type CardKind } from "./quick-draw";

export interface QueueCardSession {
  id: string;
  name: string;
  group?: string | null;
  groupColour?: string;
  attention?: AttentionState;
  attentionKind?: AttentionKind;
  attentionAt?: number;
  message?: string | null;
}

export interface QuickDrawCallbacks {
  getSessions: () => QueueCardSession[];
  /** The agent's screen for a session open on this device, else null. */
  getScreenLines: (id: string) => string[] | null;
  onGoTo: (id: string) => void;
  onBack: () => void;
  /** Ask for fresh sessions; called on a timer while the screen shows. */
  requestRefresh: () => void;
}

/**
 * How often the sessions are asked for while the queue shows. Attention
 * changes reach this device only for sessions it has open, so the rest are
 * found by asking.
 */
export const QUEUE_REFRESH_MS = 3000;

const KIND_SAYS: Record<CardKind, string> = {
  permission: "wants permission",
  question: "has a question",
  finished: "finished its turn",
};

/** A card is put aside for one wait only: the same session waiting again comes back. */
const waitKey = (s: QueueCardSession) => `${s.id}@${s.attentionAt ?? 0}`;

export class QuickDrawScreen implements MobileScreen {
  readonly element: HTMLElement;
  private header: HTMLElement;
  private body: HTMLElement;
  private skipped = new Set<string>();
  private cleanupSwipe: (() => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private callbacks: QuickDrawCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-quick-draw";

    this.header = document.createElement("div");
    this.header.className = "mobile-screen-header";
    this.element.appendChild(this.header);

    this.body = document.createElement("div");
    this.body.className = "quick-draw-body";
    this.element.appendChild(this.body);

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    statusline.innerHTML =
      `<span><span class="status-mode">QUEUE</span></span>` +
      `<span style="flex:1"></span>` +
      `<span class="help-hint">blocked first · swipe → back</span>`;
    this.element.appendChild(statusline);
  }

  render(): void {
    const queue = drawQueue(this.callbacks.getSessions());
    const live = new Set(queue.map((c) => waitKey(c.session)));
    // Forget put-aside cards whose wait is over, so the set cannot grow.
    for (const key of this.skipped) if (!live.has(key)) this.skipped.delete(key);
    const dealt = queue.filter((c) => !this.skipped.has(waitKey(c.session)));

    this.header.textContent = queue.length > 0 ? `[ queue · ${queue.length} ]` : "[ queue ]";
    this.body.innerHTML = "";

    const top = dealt[0];
    if (!top) {
      this.renderEmpty(queue.length);
      return;
    }
    this.renderCard(top.session, top.kind, dealt.length - 1);
  }

  private renderEmpty(putAside: number): void {
    const empty = document.createElement("div");
    empty.className = "quick-draw-empty";
    empty.textContent = putAside > 0 ? `${putAside} put aside` : "nothing waiting";
    this.body.appendChild(empty);
    if (putAside > 0) {
      this.body.appendChild(
        this.button("deal them again", "quick-draw-again", () => {
          this.skipped.clear();
          this.render();
        }),
      );
    }
  }

  private renderCard(session: QueueCardSession, kind: CardKind, behind: number): void {
    const card = document.createElement("div");
    card.className = "quick-draw-card";
    card.dataset["kind"] = kind;
    card.dataset["session"] = session.id;

    const who = document.createElement("div");
    who.className = "quick-draw-who";
    who.innerHTML =
      (session.group
        ? `<span class="quick-draw-group" style="color: ${escapeHtml(session.groupColour ?? "inherit")}">${escapeHtml(session.group)}</span> `
        : "") + `<span class="quick-draw-name">${escapeHtml(session.name)}</span>`;
    card.appendChild(who);

    const what = document.createElement("div");
    what.className = "quick-draw-what";
    const waited = session.attentionAt ? ` · ${relativeTime(session.attentionAt * 1000, Date.now())}` : "";
    what.textContent = `${KIND_SAYS[kind]}${waited}`;
    card.appendChild(what);

    if (session.message) {
      const message = document.createElement("div");
      message.className = "quick-draw-message";
      message.textContent = session.message;
      card.appendChild(message);
    }

    const lines = this.callbacks.getScreenLines(session.id);
    const tail = lines ? screenTail(lines) : [];
    if (tail.length > 0) {
      const screen = document.createElement("pre");
      screen.className = "quick-draw-screen";
      screen.textContent = tail.join("\n");
      card.appendChild(screen);
    }

    const actions = document.createElement("div");
    actions.className = "quick-draw-actions";
    actions.appendChild(this.button("go to it", "quick-draw-go", () => this.callbacks.onGoTo(session.id)));
    actions.appendChild(
      this.button(behind > 0 ? `next · ${behind} more` : "next", "quick-draw-next", () => {
        this.skipped.add(waitKey(session));
        this.render();
      }),
    );
    card.appendChild(actions);
    this.body.appendChild(card);
  }

  private button(label: string, className: string, action: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", action);
    return btn;
  }

  onShow(): void {
    this.render();
    this.callbacks.requestRefresh();
    this.refreshTimer = setInterval(() => this.callbacks.requestRefresh(), QUEUE_REFRESH_MS);
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBack();
      }
    };
    document.addEventListener("keydown", this.boundKeyHandler, true);
    this.cleanupSwipe = setupSwipeBack(this.element, () => this.callbacks.onBack());
  }

  onHide(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    this.cleanupSwipe?.();
    this.cleanupSwipe = null;
  }

  dispose(): void {
    this.onHide();
  }
}
