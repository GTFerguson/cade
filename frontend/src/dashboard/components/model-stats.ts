/**
 * Model usage statistics — bar charts for call frequency, token usage,
 * and quota gauges across LLM providers.
 *
 * Expects data rows from the backend `model_usage` adapter:
 *   - one `_summary` row: { total_calls, window, model_count }
 *   - one row per model: { model, provider, calls, calls_pct,
 *       input_tokens, output_tokens, total_tokens, avg_latency_ms,
 *       quota_pct?, quota_used?, quota_limit?, quota_unit?, projects }
 *
 * Panel options:
 *   show_tokens   boolean  show token-usage bars (default: true)
 *   show_latency  boolean  show avg latency label (default: false)
 *   show_projects boolean  show per-project call breakdown (default: false)
 */

import { BaseDashboardComponent } from "./base-component";

const PROVIDER_COLORS: Record<string, string> = {
  groq: "var(--accent-orange)",
  mistral: "var(--accent-blue)",
  cerebras: "var(--accent-cyan)",
  google: "var(--accent-green)",
  openai: "var(--accent-purple, var(--accent-cyan))",
  anthropic: "var(--accent-red)",
};

function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? "var(--accent-blue)";
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export class ModelStatsComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const { data, panel } = this.props;
    const opts = panel.options as Record<string, unknown>;

    const showTokens = opts["show_tokens"] !== false;
    const showLatency = opts["show_latency"] === true;
    const showProjects = opts["show_projects"] === true;

    const summary = data.find((r) => r["id"] === "_summary");
    const modelRows = data.filter((r) => r["id"] !== "_summary");

    if (!summary || modelRows.length === 0) {
      const empty = this.el("div", "dash-model-stats-empty");
      empty.textContent = summary ? "No model calls in this window" : "No usage data";
      this.container.appendChild(empty);
      return;
    }

    const totalCalls = Number(summary["total_calls"] ?? 0);
    const window = String(summary["window"] ?? "7d");

    const maxTokens = Math.max(
      ...modelRows.map((r) => Number(r["total_tokens"] ?? 0)),
      1,
    );

    const wrapper = this.el("div", "dash-model-stats");

    // ── Summary header ──────────────────────────────────────────────────────
    const header = this.el("div", "dash-model-stats-summary");
    const totalEl = this.el("span", "dash-model-stats-total", totalCalls.toLocaleString());
    header.appendChild(totalEl);
    header.append(" calls  /  ");
    const winEl = this.el("span", "dash-model-stats-window", window);
    header.appendChild(winEl);
    wrapper.appendChild(header);

    // ── Per-model rows ───────────────────────────────────────────────────────
    const rowsEl = this.el("div", "dash-model-stats-rows");

    for (const row of modelRows) {
      const model = String(row["model"] ?? "");
      const provider = String(row["provider"] ?? "");
      const calls = Number(row["calls"] ?? 0);
      const callsPct = Number(row["calls_pct"] ?? 0);
      const totalTokens = Number(row["total_tokens"] ?? 0);
      const avgLatency = row["avg_latency_ms"] != null ? Number(row["avg_latency_ms"]) : null;
      const quotaPct = row["quota_pct"] != null ? Number(row["quota_pct"]) : null;
      const quotaLimit = row["quota_limit"] != null ? Number(row["quota_limit"]) : null;
      const quotaUnit = row["quota_unit"] != null ? String(row["quota_unit"]) : null;
      const projects = Array.isArray(row["projects"]) ? (row["projects"] as { label: string; calls: number }[]) : [];

      const accent = providerColor(provider);

      const entry = this.el("div", "dash-model-stats-entry");

      // Label row
      const labelRow = this.el("div", "dash-model-stats-label-row");
      labelRow.appendChild(this.el("span", "dash-model-stats-provider", provider));
      labelRow.appendChild(this.el("span", "dash-model-stats-model", model));

      const meta = this.el("span", "dash-model-stats-meta");
      meta.textContent = `${calls.toLocaleString()} calls`;
      if (showLatency && avgLatency !== null) {
        meta.textContent += `  ${fmtMs(avgLatency)}`;
      }
      labelRow.appendChild(meta);
      entry.appendChild(labelRow);

      // Calls bar
      entry.appendChild(this._bar(callsPct, accent, "dash-model-stats-bar-wrap"));

      // Token bar (optional)
      if (showTokens && totalTokens > 0) {
        const tokenPct = Math.min(100, (totalTokens / maxTokens) * 100);
        const tokenRow = this.el("div", "dash-model-stats-secondary-row");
        tokenRow.appendChild(
          this.el("span", "dash-model-stats-secondary-label", fmtTokens(totalTokens)),
        );
        tokenRow.appendChild(
          this._bar(tokenPct, `color-mix(in srgb, ${accent} 55%, transparent)`, "dash-model-stats-bar-wrap dash-model-stats-bar-wrap--thin"),
        );
        entry.appendChild(tokenRow);
      }

      // Per-project breakdown (optional)
      if (showProjects && projects.length > 1) {
        const projRow = this.el("div", "dash-model-stats-projects");
        for (const p of projects) {
          const chip = this.el("span", "dash-model-stats-project-chip");
          chip.textContent = `${p.label} ${p.calls}`;
          projRow.appendChild(chip);
        }
        entry.appendChild(projRow);
      }

      // Quota gauge (optional)
      if (quotaPct !== null && quotaLimit !== null) {
        const quotaColor =
          quotaPct > 80
            ? "var(--accent-red)"
            : quotaPct > 55
              ? "var(--accent-orange)"
              : "var(--accent-green)";
        const quotaRow = this.el("div", "dash-model-stats-secondary-row");
        const quotaLabel = this.el("span", "dash-model-stats-secondary-label");
        quotaLabel.textContent = `${quotaPct}% ${fmtTokens(quotaLimit)}${quotaUnit ? " " + quotaUnit : ""}`;
        quotaLabel.style.color = quotaColor;
        quotaRow.appendChild(quotaLabel);
        quotaRow.appendChild(this._bar(quotaPct, quotaColor, "dash-model-stats-bar-wrap dash-model-stats-bar-wrap--thin"));
        entry.appendChild(quotaRow);
      }

      rowsEl.appendChild(entry);
    }

    wrapper.appendChild(rowsEl);
    this.container.appendChild(wrapper);
  }

  private _bar(pct: number, color: string, wrapClass: string): HTMLElement {
    const wrap = this.el("div", wrapClass);
    const fill = this.el("div", "dash-model-stats-bar");
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    fill.style.background = color;
    wrap.appendChild(fill);
    return wrap;
  }
}
