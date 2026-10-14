/**
 * Recall of prompts sent from the mobile composer, newest first, the way a
 * shell's up-arrow works. Kept in memory only: a prompt typed on the phone
 * is rarely wanted again next session, and the agent keeps its own history.
 */

export const COMPOSER_HISTORY_LIMIT = 50;

export class ComposerHistory {
  private entries: string[] = [];
  /** Index into entries while browsing; entries.length means "not browsing". */
  private cursor = 0;

  push(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    // A repeat of the last entry is noise, not history.
    if (this.entries[this.entries.length - 1] === trimmed) {
      this.cursor = this.entries.length;
      return;
    }
    this.entries.push(trimmed);
    if (this.entries.length > COMPOSER_HISTORY_LIMIT) {
      this.entries.shift();
    }
    this.cursor = this.entries.length;
  }

  /** Older entry, or null at the oldest. */
  prev(): string | null {
    if (this.cursor === 0) return null;
    this.cursor--;
    return this.entries[this.cursor] ?? null;
  }

  /** Newer entry; returns "" when stepping past the newest (back to a blank composer). */
  next(): string | null {
    if (this.cursor >= this.entries.length) return null;
    this.cursor++;
    return this.cursor === this.entries.length ? "" : this.entries[this.cursor]!;
  }

  reset(): void {
    this.cursor = this.entries.length;
  }

  get size(): number {
    return this.entries.length;
  }
}
