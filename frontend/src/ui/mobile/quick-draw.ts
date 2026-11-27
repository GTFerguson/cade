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
