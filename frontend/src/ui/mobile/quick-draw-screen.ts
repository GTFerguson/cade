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

/** How long a session that joins the queue while it shows is marked "new". */
export const ARRIVAL_MARK_MS = 5000;

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
 * The queue as a stack of full-width cards: the card in hand at the bottom,
 * holding what the session wants, its answers and [open] / [next] in one
 * place under the thumb, and the waiting sessions stacked above it as their
 * headers, the next one nearest. Answering or skipping snaps the next one
 * down; a session joining the queue appears in the stack marked "new".
 * Rows share the command menu's option-list CSS, and j/k/l/h drive them as
 * taps do.
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
  /** A waiting card the user tapped to bring to the front. */
  private front: string | null = null;
  /** When each wait was first seen here, so a session joining the queue is marked. */
  private firstSeen = new Map<string, number>();
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
    for (const key of this.firstSeen.keys()) if (!live.has(key)) this.firstSeen.delete(key);
    if (this.front && !live.has(this.front)) this.front = null;

    const queue = drawQueue(this.callbacks.getSessions()).filter((c) => !this.answered.has(waitKey(c.session)));
    const now = Date.now();
    // Sessions already waiting when the screen opened are not news.
    const opening = this.firstSeen.size === 0;
    for (const c of queue) {
      const k = waitKey(c.session);
      if (!this.firstSeen.has(k)) this.firstSeen.set(k, opening ? 0 : now);
    }

    const dealt = queue.filter((c) => !this.skipped.has(waitKey(c.session)));
    const fronted = dealt.findIndex((c) => waitKey(c.session) === this.front);
    if (fronted > 0) dealt.unshift(...dealt.splice(fronted, 1));
    const skipped = queue.filter((c) => this.skipped.has(waitKey(c.session)));

    const top = dealt[0];
    this.header.textContent = queue.length > 0 ? `[ queue · ${queue.length} ]` : "[ queue ]";
    this.body.innerHTML = "";
    this.optionEls = [];
    this.actions = [];

    const key = top ? waitKey(top.session) : null;
    const sameCard = key === this.shownKey;
    const selected = this.nav.selectedIndex;
    if (!sameCard) this.dealtAt = now;
    this.shownKey = key;

    // The waiting sessions stack above the card in hand, the next one
    // nearest it, so what is coming is in view and the card in hand, with
    // everything to read and press, sits in one place at the bottom.
    const stack = document.createElement("div");
    stack.className = "quick-draw-stack";
    this.body.appendChild(stack);
    const upcoming = [...dealt.slice(1), ...skipped];
    for (const c of [...upcoming].reverse()) {
      this.renderWaiting(stack, c.session, c.kind, this.skipped.has(waitKey(c.session)), now);
    }

    if (top) this.renderCard(top.session, top.kind, now);
    else this.renderEmpty(skipped.length);

    // A new card starts with nothing selected, so a stray Enter does nothing
    // and no row looks like the one to press; j/k pick one.
    this.nav.selectedIndex = sameCard ? Math.min(selected, this.optionEls.length - 1) : NO_SELECTION;
    this.nav.renderSelection();
  }

  /** A session further down the queue: its header, which brings it forward when tapped. */
  private renderWaiting(
    stack: HTMLElement,
    session: QueueCardSession,
    kind: CardKind,
    skipped: boolean,
    now: number,
  ): void {
    const el = this.addOption(stack, "", "quick-draw-waiting", () => {
      this.skipped.delete(waitKey(session));
      this.front = waitKey(session);
      this.render();
    });
    el.dataset["kind"] = kind;
    el.dataset["session"] = session.id;
    el.innerHTML = "";
    const arrived = this.firstSeen.get(waitKey(session)) ?? 0;
    const isNew = arrived > 0 && now - arrived < ARRIVAL_MARK_MS;
    el.appendChild(this.headerLine(session, kind, now, skipped ? "skipped" : isNew ? "new" : null));
    if (session.message) {
      const message = document.createElement("div");
      message.className = "quick-draw-waiting-message";
      message.textContent = session.message;
      el.appendChild(message);
    }
  }

  /** Name and workspace at the left; the kind of wait, how long, and any mark at the right. */
  private headerLine(session: QueueCardSession, kind: CardKind, now: number, mark: string | null): HTMLElement {
    const line = document.createElement("div");
    line.className = "quick-draw-who";
    const waited = session.attentionAt ? relativeTime(session.attentionAt * 1000, now) : "";
    line.innerHTML =
      `<span class="quick-draw-name">` +
      (session.group
        ? `<span class="quick-draw-group" style="color: ${escapeHtml(session.groupColour ?? "inherit")}">${escapeHtml(session.group)}</span> `
        : "") +
      `${escapeHtml(session.name)}</span>` +
      `<span class="quick-draw-what">` +
      (mark ? `<span class="quick-draw-mark" data-mark="${mark}">${mark}</span> · ` : "") +
      `${KIND_SAYS[kind]}${waited ? ` · ${waited}` : ""}</span>`;
    return line;
  }

  private renderEmpty(skipped: number): void {
    const card = document.createElement("div");
    card.className = "quick-draw-current quick-draw-empty";
    card.textContent = "nothing waiting";
    this.body.appendChild(card);
    if (skipped > 0) {
      const dock = document.createElement("div");
      dock.className = "options-list quick-draw-dock";
      this.body.appendChild(dock);
      this.addOption(dock, `[show ${skipped} skipped]`, "quick-draw-again", () => {
        this.skipped.clear();
        this.render();
      });
    }
  }

  /** The card in hand: what it wants, then its answers and [open] / [next], together. */
  private renderCard(session: QueueCardSession, kind: CardKind, now: number): void {
    const current = document.createElement("div");
    current.className = "quick-draw-current";
    this.body.appendChild(current);

    const card = document.createElement("div");
    card.className = "quick-draw-card";
    card.dataset["kind"] = kind;
    card.dataset["session"] = session.id;
    card.appendChild(this.headerLine(session, kind, now, null));

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
    current.appendChild(card);

    const dock = document.createElement("div");
    dock.className = "options-list quick-draw-dock";
    current.appendChild(dock);

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
    this.addOption(row, "[next]", "quick-draw-next", () => {
      this.skipped.add(waitKey(session));
      if (this.front === waitKey(session)) this.front = null;
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
