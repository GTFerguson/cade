/**
 * Context budget indicator — segmented progress bar showing how full
 * the model's context window is. Displayed in the chat statusline.
 *
 * Uses prompt_tokens from ChatDone events (the current context usage,
 * not a cumulative sum — each response's prompt_tokens already includes
 * the full conversation history).
 */

const NUM_SEGMENTS = 8;

// Default context window when the backend can't resolve one (litellm
// has no entry and providers.toml doesn't override). Frontend fallback
// only — the backend authoritatively resolves this from litellm's catalog
// and any per-provider context_window override in providers.toml.
const FALLBACK_CONTEXT_WINDOW = 200_000;

const DEFAULT_WARN_PCT = 75;
const DEFAULT_DANGER_PCT = 90;
// "Half full" threshold for the green tier — the backend doesn't carry an
// explicit value for this since it's purely a visual cue.
const HEALTHY_PCT = 50;

export interface ContextBudgetConfig {
  warn?: number;   // 0..1 fraction (e.g. 0.75)
  danger?: number; // 0..1 fraction
  window?: number; // tokens
}

export class ContextBudgetIndicator {
  private el: HTMLElement;
  private segments: HTMLElement[] = [];
  private labelEl: HTMLElement;
  private contextWindow = FALLBACK_CONTEXT_WINDOW;
  private warnPct = DEFAULT_WARN_PCT;
  private dangerPct = DEFAULT_DANGER_PCT;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "context-budget";
    this.el.style.display = "none";

    const bar = document.createElement("div");
    bar.className = "context-budget-bar";

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const seg = document.createElement("div");
      seg.className = "context-budget-seg";
      bar.appendChild(seg);
      this.segments.push(seg);
    }

    this.labelEl = document.createElement("span");
    this.labelEl.className = "context-budget-label";

    this.el.appendChild(bar);
    this.el.appendChild(this.labelEl);
  }

  getElement(): HTMLElement {
    return this.el;
  }

  setModel(_model: string): void {
    // Window is supplied authoritatively via setBudget() from the backend.
    // Kept for callers that only have a model name; window stays at its
    // current value (default or last-set-by-backend).
  }

  setBudget(budget: ContextBudgetConfig | undefined): void {
    if (!budget) return;
    if (typeof budget.window === "number" && budget.window > 0) {
      this.contextWindow = budget.window;
    }
    if (typeof budget.warn === "number" && budget.warn > 0 && budget.warn <= 1) {
      this.warnPct = budget.warn * 100;
    }
    if (typeof budget.danger === "number" && budget.danger > 0 && budget.danger <= 1) {
      this.dangerPct = budget.danger * 100;
    }
  }

  private getSegmentColor(pct: number): string {
    if (pct >= this.dangerPct) return "var(--accent-red)";
    if (pct >= this.warnPct) return "var(--accent-orange)";
    if (pct >= HEALTHY_PCT) return "var(--accent-green)";
    return "var(--accent-blue)";
  }

  update(promptTokens: number): void {
    if (promptTokens <= 0 || this.contextWindow <= 0) return;

    const pct = Math.min(100, (promptTokens / this.contextWindow) * 100);
    const filledCount = Math.ceil((pct / 100) * NUM_SEGMENTS);
    const color = this.getSegmentColor(pct);

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const seg = this.segments[i];
      if (!seg) continue;
      seg.style.background = i < filledCount ? color : "";
    }

    this.labelEl.textContent = `${Math.round(pct)}%`;
    this.el.style.display = "flex";
  }

  reset(): void {
    for (const seg of this.segments) {
      seg.style.background = "";
    }
    this.labelEl.textContent = "";
    this.el.style.display = "none";
  }
}
