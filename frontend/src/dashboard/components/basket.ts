/**
 * Basket component — two-column interactive basket with steppers.
 *
 * A generic primitive for "pick quantities from two pools and submit".
 * Used by Padarax for barter; equally usable in an IDE for moving
 * files/tasks between pools, reassigning budget across allocations,
 * or any similar dual-column stepper workflow.
 *
 * Data contract: one source whose rows carry a `side` field of
 * "left" or "right". Each row renders with a +/− stepper that
 * accumulates into a basket kept on the component instance. The
 * footer shows the running balance (right-value minus left-cost)
 * and a Confirm button that emits whatever action the panel's
 * `options.on_confirm` declares.
 *
 * Panel config:
 *   component: basket
 *   source: <name of combined basket source>
 *   fields: [name, value, count]     # field names on each row
 *   options:
 *     left_label: "Shop"             # optional column headers
 *     right_label: "You"
 *     unit: "g"                      # optional suffix on balance
 *     left_budget_source: <optional source>   # checked when net > 0
 *     left_budget_field: coin                 # default "coin"
 *     right_budget_source: <optional source>  # checked when net < 0
 *     right_budget_field: coin
 *     balance_labels:                         # optional prose overrides
 *       positive: "You receive {n}{unit}"
 *       negative: "You pay {n}{unit}"
 *       overdraw_right: "You pay {n}{unit} (you only have {budget}{unit})"
 *       overdraw_left:  "You receive {n}{unit} but they only have {budget}{unit}"
 *       empty:  "Empty basket"
 *       even:   "Even trade"
 *     on_confirm:
 *       action: provider_message
 *       message:
 *         type: <whatever the consumer expects, e.g. trade_commit>
 *         # Component appends { basket: {left, right} } at emit time.
 *
 * Per-side budget sources (`left_budget_source` / `right_budget_source`)
 * are both optional. When set, the column header shows the budget
 * ("Shop — 200g") and affordability is enforced: the *paying* side's
 * budget is checked — left when net > 0 (they pay out), right when
 * net < 0 (you pay). Overdraw → Confirm disables + balance turns red.
 * Unset → display-only, consumer validates on commit.
 */

import { BaseDashboardComponent } from "./base-component";

interface BasketEntry {
  id: string;
  qty: number;
}

type BalanceKey =
  | "positive"
  | "negative"
  | "overdraw_right"
  | "overdraw_left"
  | "empty"
  | "even";

const DEFAULT_LABELS: Record<BalanceKey, string> = {
  positive: "Net +{n}{unit}",
  negative: "Net -{n}{unit}",
  overdraw_right: "Over budget — right only has {budget}{unit}",
  overdraw_left: "Over budget — left only has {budget}{unit}",
  empty: "Empty",
  even: "Balanced",
};

export class BasketComponent extends BaseDashboardComponent {
  private basket: Map<string, number> = new Map();

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data } = this.props;
    const nameField = panel.fields[0] ?? "name";
    const valueField = panel.fields[1] ?? "value";
    const countField = panel.fields[2] ?? "count";

    const extra = panel.options ?? {};
    const leftLabel = String(extra["left_label"] ?? "Left");
    const rightLabel = String(extra["right_label"] ?? "Right");

    const leftRows = data.filter((r) => r["side"] === "left");
    const rightRows = data.filter((r) => r["side"] === "right");

    const wrapper = this.el("div", "dash-basket");

    const cols = this.el("div", "dash-basket-cols");
    cols.appendChild(
      this.renderColumn("left", leftLabel, leftRows, nameField, valueField, countField),
    );
    cols.appendChild(
      this.renderColumn("right", rightLabel, rightRows, nameField, valueField, countField),
    );
    wrapper.appendChild(cols);

    wrapper.appendChild(this.renderFooter(data, valueField));

    this.container.appendChild(wrapper);
  }

  /** Resolve a side's budget from the optional `<side>_budget_source`.
   * Returns null when the panel hasn't wired a budget for this side,
   * which signals "skip enforcement for this column". */
  private readBudget(side: "left" | "right"): number | null {
    if (!this.props) return null;
    const opts = this.props.panel.options ?? {};
    const sourceName = opts[`${side}_budget_source`];
    if (typeof sourceName !== "string" || !sourceName) return null;
    const rows = this.props.allData[sourceName] ?? [];
    if (rows.length === 0) return null;
    const fieldKey = `${side}_budget_field`;
    const field = typeof opts[fieldKey] === "string" ? (opts[fieldKey] as string) : "coin";
    const n = Number(rows[0]?.[field]);
    return Number.isFinite(n) ? n : null;
  }

  private renderColumn(
    side: "left" | "right",
    label: string,
    rows: Record<string, unknown>[],
    nameField: string,
    valueField: string,
    countField: string,
  ): HTMLElement {
    const col = this.el("div", `dash-basket-col dash-basket-col--${side}`);

    const unit = String(this.props?.panel.options?.["unit"] ?? "");
    const budget = this.readBudget(side);
    const header = this.el("div", "dash-basket-col-head");
    header.appendChild(this.el("span", "dash-basket-col-label", label));
    if (budget !== null) {
      header.appendChild(this.el("span", "dash-basket-col-budget", `${budget}${unit}`));
    }
    col.appendChild(header);

    if (rows.length === 0) {
      col.appendChild(this.el("div", "dash-basket-empty", "—"));
      return col;
    }

    for (const row of rows) {
      const id = String(row["id"] ?? "");
      const stock = Number(row[countField]) || 0;
      const qty = this.basket.get(id) ?? 0;

      const rowEl = this.el("div", "dash-basket-row");
      rowEl.appendChild(this.el("span", "dash-basket-name", this.fieldValue(row, nameField)));
      rowEl.appendChild(
        this.el("span", "dash-basket-value", `${String(row[valueField] ?? "—")}${unit}`),
      );
      rowEl.appendChild(this.el("span", "dash-basket-stock", `×${stock}`));
      rowEl.appendChild(this.renderStepper(id, qty, stock));

      col.appendChild(rowEl);
    }
    return col;
  }

  private renderStepper(id: string, qty: number, max: number): HTMLElement {
    const stepper = this.el("div", "dash-basket-stepper");

    const minus = this.el("button", "dash-basket-step", "−") as HTMLButtonElement;
    minus.disabled = qty <= 0;
    minus.addEventListener("click", () => this.step(id, -1, max));
    stepper.appendChild(minus);

    stepper.appendChild(this.el("span", "dash-basket-qty", String(qty)));

    const plus = this.el("button", "dash-basket-step", "+") as HTMLButtonElement;
    plus.disabled = qty >= max;
    plus.addEventListener("click", () => this.step(id, 1, max));
    stepper.appendChild(plus);

    return stepper;
  }

  private renderFooter(
    data: Record<string, unknown>[],
    valueField: string,
  ): HTMLElement {
    const footer = this.el("div", "dash-basket-footer");

    const { leftCost, rightGain } = this.computeBalance(data, valueField);
    const net = rightGain - leftCost;
    const leftBudget = this.readBudget("left");
    const rightBudget = this.readBudget("right");

    // Which side is *paying*? Left pays when net > 0 (they owe you);
    // right pays when net < 0 (you owe them). Check the paying side's
    // budget if one is wired.
    const leftShort = net > 0 && leftBudget !== null && net > leftBudget;
    const rightShort = net < 0 && rightBudget !== null && -net > rightBudget;
    const cantAfford = leftShort || rightShort;

    const opts = this.props?.panel.options ?? {};
    const unit = String(opts["unit"] ?? "");
    const labels = this.resolveLabels(opts["balance_labels"]);

    const balance = this.el("div", "dash-basket-balance");
    if (this.basket.size === 0) {
      balance.textContent = this.format(labels.empty, { n: 0, budget: null, unit });
    } else if (leftShort) {
      balance.classList.add("dash-basket-balance--overdraw");
      balance.textContent = this.format(labels.overdraw_left, { n: net, budget: leftBudget, unit });
    } else if (rightShort) {
      balance.classList.add("dash-basket-balance--overdraw");
      balance.textContent = this.format(labels.overdraw_right, { n: -net, budget: rightBudget, unit });
    } else if (net > 0) {
      balance.classList.add("dash-basket-balance--positive");
      balance.textContent = this.format(labels.positive, { n: net, budget: leftBudget, unit });
    } else if (net < 0) {
      balance.classList.add("dash-basket-balance--negative");
      balance.textContent = this.format(labels.negative, { n: -net, budget: rightBudget, unit });
    } else {
      balance.textContent = this.format(labels.even, { n: 0, budget: null, unit });
    }
    footer.appendChild(balance);

    const confirm = this.el("button", "dash-basket-confirm", "Confirm") as HTMLButtonElement;
    confirm.disabled = this.basket.size === 0 || cantAfford;
    confirm.addEventListener("click", () => this.emitConfirm());
    footer.appendChild(confirm);

    return footer;
  }

  private resolveLabels(raw: unknown): Record<BalanceKey, string> {
    if (raw == null || typeof raw !== "object") return DEFAULT_LABELS;
    const o = raw as Record<string, unknown>;
    const pick = (key: BalanceKey): string =>
      typeof o[key] === "string" ? (o[key] as string) : DEFAULT_LABELS[key];
    return {
      positive: pick("positive"),
      negative: pick("negative"),
      overdraw_right: pick("overdraw_right"),
      overdraw_left: pick("overdraw_left"),
      empty: pick("empty"),
      even: pick("even"),
    };
  }

  private format(
    template: string,
    ctx: { n: number; budget: number | null; unit: string },
  ): string {
    return template
      .replace(/\{n\}/g, String(ctx.n))
      .replace(/\{budget\}/g, ctx.budget == null ? "" : String(ctx.budget))
      .replace(/\{unit\}/g, ctx.unit);
  }

  private computeBalance(
    data: Record<string, unknown>[],
    valueField: string,
  ): { leftCost: number; rightGain: number } {
    let leftCost = 0;
    let rightGain = 0;
    for (const row of data) {
      const id = String(row["id"] ?? "");
      const qty = this.basket.get(id) ?? 0;
      if (qty === 0) continue;
      const value = Number(row[valueField]) || 0;
      if (row["side"] === "left") leftCost += value * qty;
      else if (row["side"] === "right") rightGain += value * qty;
    }
    return { leftCost, rightGain };
  }

  private step(id: string, delta: number, max: number): void {
    const next = Math.max(0, Math.min(max, (this.basket.get(id) ?? 0) + delta));
    if (next === 0) this.basket.delete(id);
    else this.basket.set(id, next);
    this.rebuild();
  }

  private emitConfirm(): void {
    if (!this.props || this.basket.size === 0) return;
    const { panel, data, onAction } = this.props;

    const onConfirm = panel.options?.["on_confirm"] as
      | { action: string; message?: Record<string, unknown> }
      | undefined;
    if (!onConfirm || typeof onConfirm.action !== "string") return;

    const leftBasket: BasketEntry[] = [];
    const rightBasket: BasketEntry[] = [];
    for (const row of data) {
      const id = String(row["id"] ?? "");
      const qty = this.basket.get(id) ?? 0;
      if (qty === 0) continue;
      if (row["side"] === "left") leftBasket.push({ id, qty });
      else if (row["side"] === "right") rightBasket.push({ id, qty });
    }

    const message = {
      ...(onConfirm.message ?? {}),
      basket: { left: leftBasket, right: rightBasket },
    };

    const sourceName = typeof panel.source === "string" ? panel.source : "";
    onAction({
      action: onConfirm.action,
      source: sourceName,
      message,
    });

    this.basket.clear();
  }
}
