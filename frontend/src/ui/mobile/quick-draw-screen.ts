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
import { answerTone, drawQueue, promptOptions, screenTail, type CardKind, type PromptOption } from "./quick-draw";

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

/** MenuNav's index when no row is selected: Enter then selects nothing. */
const NO_SELECTION = -1;

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

    const top = dealt[0];
    const position = top ? queue.indexOf(top) + 1 : 0;
    this.header.textContent = top ? `[ queue · ${position}/${queue.length} ]` : "[ queue ]";
    this.body.innerHTML = "";
    this.optionEls = [];
    this.actions = [];

    const key = top ? waitKey(top.session) : null;
    const sameCard = key === this.shownKey;
    const selected = this.nav.selectedIndex;
    if (!sameCard) this.dealtAt = Date.now();
    this.shownKey = key;

    // What the session wants scrolls in the space above; the controls sit
    // in a dock at the bottom, so they stay under the thumb in the same
    // place however long the prompt above them is.
    const info = document.createElement("div");
    info.className = "quick-draw-info";
    this.body.appendChild(info);
    const dock = document.createElement("div");
    dock.className = "options-list quick-draw-dock";
    this.body.appendChild(dock);

    if (top) this.renderCard(info, dock, top.session, top.kind, dealt.length - 1);
    else this.renderEmpty(info, dock, queue.length);

    // A new card starts with nothing selected, so a stray Enter does nothing
    // and no row looks like the one to press; j/k pick one.
    this.nav.selectedIndex = sameCard ? Math.min(selected, this.optionEls.length - 1) : NO_SELECTION;
    this.nav.renderSelection();
  }

  private renderEmpty(info: HTMLElement, dock: HTMLElement, skipped: number): void {
    const empty = document.createElement("div");
    empty.className = "quick-draw-empty";
    empty.textContent = "nothing waiting";
    info.appendChild(empty);
    if (skipped > 0) {
      this.addOption(dock, `[show ${skipped} skipped]`, "quick-draw-again", () => {
        this.skipped.clear();
        this.render();
      });
    }
  }

  private renderCard(
    info: HTMLElement,
    dock: HTMLElement,
    session: QueueCardSession,
    kind: CardKind,
    behind: number,
  ): void {
    const card = document.createElement("div");
    card.className = "quick-draw-card";
    card.dataset["kind"] = kind;
    card.dataset["session"] = session.id;

    const who = document.createElement("div");
    who.className = "quick-draw-who";
    const waited = session.attentionAt ? relativeTime(session.attentionAt * 1000, Date.now()) : "";
    who.innerHTML =
      `<span class="quick-draw-name">` +
      (session.group
        ? `<span class="quick-draw-group" style="color: ${escapeHtml(session.groupColour ?? "inherit")}">${escapeHtml(session.group)}</span> `
        : "") +
      `${escapeHtml(session.name)}</span>` +
      `<span class="quick-draw-what">${KIND_SAYS[kind]}${waited ? ` · ${waited}` : ""}</span>`;
    card.appendChild(who);

    if (session.message) {
      const message = document.createElement("div");
      message.className = "quick-draw-message";
      message.textContent = session.message;
      card.appendChild(message);
    }

    const lines = this.callbacks.getScreenLines(session.id);
    const options = this.answerOptions(session, kind, lines);
    // With the answers listed, the message already says what is asked; the
    // screen is quoted only when it is the one way to see the prompt.
    const tail = lines && !options ? screenTail(lines) : [];
    if (tail.length > 0) {
      const screen = document.createElement("pre");
      screen.className = "quick-draw-screen";
      screen.textContent = tail.join("\n");
      card.appendChild(screen);
    }
    info.appendChild(card);

    for (const option of options ?? []) {
      // The prompt's own words, as it shows them: an answer is content,
      // like a tab name, so it is not bracketed or lowercased like a command.
      const text = option.detail ? `${option.label} ${option.detail}` : option.label;
      const el = this.addOption(dock, text, "quick-draw-answer", () => this.answer(session, kind, option));
      const label = el.querySelector<HTMLElement>(".option-label")!;
      label.dataset["tone"] = answerTone(option.label);
      const key = document.createElement("span");
      key.className = "quick-draw-key";
      key.textContent = option.key;
      el.insertBefore(key, label);
      el.dataset["key"] = option.key;
      el.dataset["label"] = option.label;
    }

    const row = document.createElement("div");
    row.className = "quick-draw-row";
    dock.appendChild(row);
    this.addOption(row, "[open]", "quick-draw-go", () => this.callbacks.onGoTo(session.id));
    this.addOption(row, behind > 0 ? `[next · ${behind}]` : "[skip]", "quick-draw-next", () => {
      this.skipped.add(waitKey(session));
      this.render();
    });
  }

  /** A one-line option row; long labels are cut short so every row is the same height. */
  private addOption(container: HTMLElement, label: string, className: string, action: () => void): HTMLElement {
    const el = document.createElement("div");
    el.className = `option ${className}`;
    el.innerHTML = `<span class="option-label">${escapeHtml(label)}</span>`;
    el.title = label;
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
