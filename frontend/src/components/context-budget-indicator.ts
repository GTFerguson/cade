/**
 * Context budget indicator — segmented progress bar showing how full
 * the model's context window is. Displayed in the chat statusline.
 *
 * Uses prompt_tokens from ChatDone events (the current context usage,
 * not a cumulative sum — each response's prompt_tokens already includes
 * the full conversation history).
 */

const NUM_SEGMENTS = 8;

// Known context window sizes (in tokens) keyed by model name substring.
// Matched in order; first match wins.
const CONTEXT_WINDOWS: [string, number][] = [
  ["claude", 200_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4", 8_192],
  ["gpt-3.5", 16_385],
  ["gemini-1.5", 1_000_000],
  ["gemini", 32_760],
];

function lookupContextWindow(model: string): number {
  const lower = model.toLowerCase();
  for (const [key, size] of CONTEXT_WINDOWS) {
    if (lower.includes(key)) return size;
  }
  return 200_000;
}

function getSegmentColor(pct: number): string {
  if (pct >= 90) return "var(--accent-red)";
  if (pct >= 75) return "var(--accent-orange)";
  if (pct >= 50) return "var(--accent-green)";
  return "var(--accent-blue)";
}

export class ContextBudgetIndicator {
  private el: HTMLElement;
  private segments: HTMLElement[] = [];
  private labelEl: HTMLElement;
  private contextWindow = 200_000;

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

  setModel(model: string): void {
    this.contextWindow = lookupContextWindow(model);
  }

  update(promptTokens: number): void {
    if (promptTokens <= 0 || this.contextWindow <= 0) return;

    const pct = Math.min(100, (promptTokens / this.contextWindow) * 100);
    const filledCount = Math.ceil((pct / 100) * NUM_SEGMENTS);
    const color = getSegmentColor(pct);

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
