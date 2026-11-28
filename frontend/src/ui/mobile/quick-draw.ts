/**
 * The quick-draw queue: the sessions that want the user, in the order the
 * phone deals them out one at a time.
 *
 * Blocked sessions come first because they are quicker to deal with and an
 * agent sits idle until they are answered: permission prompts, then
 * questions. Finished turns follow. Within each, the one that has waited
 * longest comes first, so nothing is starved by newer arrivals.
 */

import type { AttentionKind, AttentionState } from "../../types";

export interface QueueSession {
  id: string;
  attention?: AttentionState;
  /** What kind of input a waiting agent wants; null when the agent did not say. */
  attentionKind?: AttentionKind;
  /** When the session entered its attention state (seconds since the epoch). */
  attentionAt?: number;
}

export type CardKind = "permission" | "question" | "finished";

/**
 * The card a session gets, or null when it wants nothing. A waiting agent
 * that did not say what it wants is dealt as a question: whatever it is, it
 * blocks the agent, but it cannot be offered permission buttons.
 */
export function cardKind(session: QueueSession): CardKind | null {
  if (session.attention === "input") {
    return session.attentionKind === "permission" ? "permission" : "question";
  }
  if (session.attention === "idle") return "finished";
  return null;
}

const RANK: Record<CardKind, number> = { permission: 0, question: 1, finished: 2 };

/** The sessions to deal, in order; a session wanting nothing is left out. */
export function drawQueue<S extends QueueSession>(sessions: S[]): { session: S; kind: CardKind }[] {
  return sessions
    .map((session) => ({ session, kind: cardKind(session) }))
    .filter((c): c is { session: S; kind: CardKind } => c.kind !== null)
    .sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        (a.session.attentionAt ?? 0) - (b.session.attentionAt ?? 0),
    );
}

/** How many rows of the agent's screen a card quotes. */
export const SCREEN_TAIL_ROWS = 14;

/**
 * The bottom of an agent's screen, where a prompt is drawn: the last
 * `rows` rows down to the last one with text, so the blank rows under a
 * prompt do not push it off the card.
 */
export function screenTail(lines: string[], rows = SCREEN_TAIL_ROWS): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end--;
  return lines.slice(Math.max(0, end - rows), end).map((l) => l.trimEnd());
}

/** The queue's size in words, for the menu: "2 blocked · 1 finished". */
export function queueSummary(kinds: CardKind[]): string {
  const blocked = kinds.filter((k) => k !== "finished").length;
  const finished = kinds.length - blocked;
  const parts = [
    blocked > 0 ? `${blocked} blocked` : null,
    finished > 0 ? `${finished} finished` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ") || "nothing waiting";
}

export interface PromptOption {
  /** The key that picks this option: its number. */
  key: string;
  label: string;
  /** Lines under the option: a wrapped label or a question's description. */
  detail: string;
}

const OPTION_LINE = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(.+?)\s*$/;
const RULE_LINE = /^\s*[─╌━-]{3,}\s*$/;
const FOOTER = /esc to cancel/i;
// Options that open a text field or a conversation instead of answering;
// a single key cannot finish them.
const NEEDS_MORE = /^(type something|chat about this)/i;

/**
 * The options of the dialog at the bottom of an agent's screen, or null
 * when the screen does not show one this card can answer safely.
 *
 * Read from the screen, never assumed: Claude Code's permission dialog has
 * offered four options where an older one had three, and the key that
 * meant "no" in the old layout switches the session to auto mode in the
 * new one. A bare digit picks and confirms an option (checked against
 * Claude Code 2.1, 27 Nov 2026). Multi-select and multi-question dialogs
 * take more than one key, so they get no buttons.
 */
export function promptOptions(lines: string[]): PromptOption[] | null {
  const dialog = findDialog(lines);
  if (!dialog) return null;
  const { start, footer } = dialog;
  if (lines.slice(0, start).some((l) => /☐|☒|✔/.test(l) && /submit/i.test(l))) return null;

  const options: PromptOption[] = [];
  for (const line of lines.slice(start, footer)) {
    if (line.trim() === "" || RULE_LINE.test(line)) continue;
    const m = OPTION_LINE.exec(line);
    if (m && Number(m[1]) === options.length + 1) {
      options.push({ key: m[1]!, label: m[2]!, detail: "" });
    } else {
      const last = options[options.length - 1]!;
      last.detail = last.detail ? `${last.detail} ${line.trim()}` : line.trim();
    }
  }
  if (options.length < 2) return null;
  if (options.some((o) => /^\[|^[☐☒✔]/.test(o.label))) return null;
  return options.filter((o) => !NEEDS_MORE.test(o.label));
}

/** Where a dialog's options start, and its footer line. */
function findDialog(lines: string[]): { start: number; footer: number } | null {
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTER.test(lines[i]!)) {
      footer = i;
      break;
    }
  }
  if (footer < 0) return null;

  let start = -1;
  for (let i = footer - 1; i >= 0; i--) {
    const m = OPTION_LINE.exec(lines[i]!);
    if (m && m[1] === "1") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  return { start, footer };
}
