/**
 * The quick-draw screen: the sessions that want the user, dealt one card at
 * a time in `drawQueue` order.
 *
 * A card names the session and its workspace, says what kind of wait it is,
 * and quotes the bottom of the agent's screen, where the prompt is drawn,
 * when this device has the session open. When that screen shows a dialog
 * `promptOptions` can read, and the agent is one whose keys have been
 * checked, the card offers the dialog's own options as buttons. "go to it"
 * opens the session; "next" puts the card aside for this showing of the
 * screen. The screen redraws whenever the sessions change, so a prompt
 * answered elsewhere drops out of the queue without anyone acting on its
 * card.
 */

import { MenuNav, escapeHtml } from "@core/ui/menu-nav";
import type { AttentionKind, AttentionState } from "../../types";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";
import { relativeTime } from "./recent-files";
import {
  PROMPT_CONTEXT_ROWS,
  drawQueue,
  promptContext,
  promptOptions,
  screenTail,
  type CardKind,
  type PromptOption,
} from "./quick-draw";

export interface QueueCardSession {
  id: string;
  name: string;
  group?: string | null;
  groupColour?: string;
  attention?: AttentionState;
  attentionKind?: AttentionKind;
  attentionAt?: number;
  message?: string | null;
  /** The agent adapter running in the session, e.g. "claude-code". */
  agent?: string;
}

/**
 * Agents whose dialogs have been seen to take a bare digit as pick and
 * confirm. Another agent's card offers no answer buttons until its keys
 * have been checked the same way.
 */
export const ANSWERABLE_AGENTS = new Set(["claude-code"]);

export interface QuickDrawCallbacks {
  getSessions: () => QueueCardSession[];
  /** The agent's screen for a session open on this device, else null. */
  getScreenLines: (id: string) => string[] | null;
  onGoTo: (id: string) => void;
  /** Send one key to the session's agent terminal, without taking over its size. */
  onAnswer: (id: string, key: string) => void;
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

/**
 * How long a newly dealt card ignores answer taps. Answering deals the next
 * card under the finger, so a double tap would otherwise answer that one too.
 */
export const CARD_SETTLE_MS = 500;

const KIND_SAYS: Record<CardKind, string> = {
  permission: "wants permission",
  question: "has a question",
  finished: "finished its turn",
};

/** A card is put aside for one wait only: the same session waiting again comes back. */
const waitKey = (s: QueueCardSession) => `${s.id}@${s.attentionAt ?? 0}`;

/**
 * The queue as a full-pane option list, the command menu's pattern: what
 * the session wants as plain text, then its answers and the queue's own
 * actions as `[bracketed]` options that j/k/l/h and taps both drive.
 */
export class QuickDrawScreen implements MobileScreen {
  readonly element: HTMLElement;
  private header: HTMLElement;
  private body: HTMLElement;
  private skipped = new Set<string>();
  /** Waits answered from this screen: never dealt again, so never answered twice. */
  private answered = new Set<string>();
  private optionEls: HTMLElement[] = [];
  private actions: (() => void)[] = [];
  private nav: MenuNav;
  /** The wait on show, so a redraw of the same card keeps the selection. */
  private shownKey: string | null = null;
  private dealtAt = 0;
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
    this.body.className = "mobile-screen-body";
    this.element.appendChild(this.body);

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    statusline.innerHTML =
      `<span><span class="status-mode">QUEUE</span></span>` +
      `<span style="flex:1"></span>` +
      `<span class="help-hint">blocked first · swipe → back</span>`;
    this.element.appendChild(statusline);

    this.nav = new MenuNav({
      getOptions: () => this.optionEls,
      onSelect: (i) => this.actions[i]?.(),
      onBack: () => this.callbacks.onBack(),
      onCancel: () => this.callbacks.onBack(),
    });
  }

  render(): void {
    const live = new Set(drawQueue(this.callbacks.getSessions()).map((c) => waitKey(c.session)));
    // Forget cards whose wait is over, so the sets cannot grow.
    for (const key of this.skipped) if (!live.has(key)) this.skipped.delete(key);
    for (const key of this.answered) if (!live.has(key)) this.answered.delete(key);
    const queue = drawQueue(this.callbacks.getSessions()).filter((c) => !this.answered.has(waitKey(c.session)));
    const dealt = queue.filter((c) => !this.skipped.has(waitKey(c.session)));

    this.header.textContent = queue.length > 0 ? `[ queue · ${queue.length} ]` : "[ queue ]";
    this.body.innerHTML = "";
    this.optionEls = [];
    this.actions = [];

    const top = dealt[0];
    const key = top ? waitKey(top.session) : null;
    const sameCard = key === this.shownKey;
    const selected = this.nav.selectedIndex;
    if (!sameCard) this.dealtAt = Date.now();
    this.shownKey = key;

    let first = 0;
    if (top) first = this.renderCard(top.session, top.kind, dealt.length - 1);
    else this.renderEmpty(queue.length);

    // A new card starts on [go to it], never on an answer: a stray Enter
    // must not approve anything.
    this.nav.selectedIndex = sameCard ? Math.min(selected, Math.max(0, this.optionEls.length - 1)) : first;
    this.nav.renderSelection();
  }

  private renderEmpty(putAside: number): void {
    const empty = document.createElement("div");
    empty.className = "quick-draw-empty";
    empty.textContent = putAside > 0 ? `${putAside} put aside` : "nothing waiting";
    this.body.appendChild(empty);
    if (putAside > 0) {
      const list = this.list();
      this.addOption(list, "[deal them again]", "", "quick-draw-again", () => {
        this.skipped.clear();
        this.render();
      });
    }
  }

  /** Draws the card; returns the index of its [go to it] option. */
  private renderCard(session: QueueCardSession, kind: CardKind, behind: number): number {
    const info = document.createElement("div");
    info.className = "quick-draw-card";
    info.dataset["kind"] = kind;
    info.dataset["session"] = session.id;

    const who = document.createElement("div");
    who.className = "quick-draw-who";
    who.innerHTML =
      (session.group
        ? `<span class="quick-draw-group" style="color: ${escapeHtml(session.groupColour ?? "inherit")}">${escapeHtml(session.group)}</span> `
        : "") + `<span class="quick-draw-name">${escapeHtml(session.name)}</span>`;
    info.appendChild(who);

    const what = document.createElement("div");
    what.className = "quick-draw-what";
    const waited = session.attentionAt ? ` · ${relativeTime(session.attentionAt * 1000, Date.now())}` : "";
    what.textContent = `${KIND_SAYS[kind]}${waited}`;
    info.appendChild(what);

    if (session.message) {
      const message = document.createElement("div");
      message.className = "quick-draw-message";
      message.textContent = session.message;
      info.appendChild(message);
    }

    const lines = this.callbacks.getScreenLines(session.id);
    const options = this.answerOptions(session, kind, lines);
    const tail = !lines ? [] : options ? screenTail(promptContext(lines), PROMPT_CONTEXT_ROWS) : screenTail(lines);
    if (tail.length > 0) {
      const screen = document.createElement("pre");
      screen.className = "quick-draw-screen";
      screen.textContent = tail.join("\n");
      info.appendChild(screen);
    }
    this.body.appendChild(info);

    const list = this.list();
    if (options) {
      this.addSection(list, "answer");
      for (const option of options) {
        const el = this.addOption(
          list,
          `[${option.label.toLowerCase()}]`,
          option.detail,
          "quick-draw-answer",
          () => this.answer(session, kind, option),
        );
        el.dataset["key"] = option.key;
        el.dataset["label"] = option.label;
      }
      this.addSection(list, "queue");
    }
    const goTo = this.optionEls.length;
    this.addOption(list, "[go to it]", "open the session", "quick-draw-go", () => this.callbacks.onGoTo(session.id));
    this.addOption(list, "[next]", behind > 0 ? `${behind} more` : "last one", "quick-draw-next", () => {
      this.skipped.add(waitKey(session));
      this.render();
    });
    return goTo;
  }

  private list(): HTMLElement {
    const list = document.createElement("div");
    list.className = "options-list";
    this.body.appendChild(list);
    return list;
  }

  private addSection(container: HTMLElement, title: string): void {
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = title;
    container.appendChild(label);
  }

  /**
   * An option row. A detail line wraps under the label instead of sitting
   * at the right, because a dialog's option can be a sentence or a path.
   */
  private addOption(
    container: HTMLElement,
    label: string,
    detail: string,
    className: string,
    action: () => void,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = `option ${className}`;
    el.innerHTML =
      `<span class="option-label">${escapeHtml(label)}` +
      (detail ? `<span class="quick-draw-detail">${escapeHtml(detail)}</span>` : "") +
      `</span>`;
    // Bound to this row's own action, not its index: after a redraw, a tap
    // on a row that has gone must not run whatever now sits in its place.
    const index = this.optionEls.length;
    el.addEventListener("click", () => {
      if (this.optionEls[index] !== el) return;
      this.nav.selectedIndex = index;
      this.nav.renderSelection();
      action();
    });
    container.appendChild(el);
    this.optionEls.push(el);
    this.actions.push(action);
    return el;
  }

  private answerOptions(
    session: QueueCardSession,
    kind: CardKind,
    lines: string[] | null,
  ): PromptOption[] | null {
    if (kind === "finished" || !lines || !ANSWERABLE_AGENTS.has(session.agent ?? "")) return null;
    const options = promptOptions(lines);
    return options && options.length > 0 ? options : null;
  }

  /**
   * Send an option's key, but only if the dialog on screen still offers
   * that option under that key: the card may have been drawn before the
   * dialog changed.
   */
  private answer(session: QueueCardSession, kind: CardKind, option: PromptOption): void {
    if (Date.now() - this.dealtAt < CARD_SETTLE_MS) return;
    const now = this.answerOptions(session, kind, this.callbacks.getScreenLines(session.id));
    const same = now?.find((o) => o.key === option.key);
    if (same && same.label === option.label && !this.answered.has(waitKey(session))) {
      this.answered.add(waitKey(session));
      this.callbacks.onAnswer(session.id, option.key);
    }
    this.render();
  }

  onShow(): void {
    this.render();
    this.callbacks.requestRefresh();
    this.refreshTimer = setInterval(() => this.callbacks.requestRefresh(), QUEUE_REFRESH_MS);
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (this.nav.handleKeyDown(e)) {
        e.preventDefault();
        e.stopPropagation();
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
    this.optionEls = [];
    this.actions = [];
  }
}
