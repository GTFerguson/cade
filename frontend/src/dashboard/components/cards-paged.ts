/**
 * CardsPaged — infinite-scroll variant of the cards component.
 *
 * Renders a windowed slice of any list-source data with
 * IntersectionObserver-based load-more and a client-side trim buffer.
 * General enough to live in cade/core alongside CardsComponent.
 *
 * Configurable via panel.extra:
 *   target_size  — entries to show by default       (default 15)
 *   buffer_size  — overflow before trim triggers     (default  5)
 *   page_size    — entries added per scroll-load     (default  5)
 *   stale_ms     — gap (ms) before stale-reset fires (default 180000)
 *
 * Trim logic: when windowSize > target + buffer AND the scroll is idle
 * for 800 ms AND the viewport is near the top, the oldest entries are
 * discarded back to target_size. This keeps the DOM lean while
 * preserving entries the user is actively reading further down.
 *
 * Scroll-position preservation: saves scrollTop on dispose and restores
 * it after each rebuild so live data pushes don't snap the user to the
 * top of the list. Cleared on stale-reset.
 *
 * Supports the full cards feature set: fields, badges, favourite toggle,
 * expandable detail components (e.g. split_markdown), expansion state
 * preserved across view switches.
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";
import type { DashboardAction, PanelConfig } from "../types";

const DEFAULT_TARGET    = 15;
const DEFAULT_BUFFER    =  5;
const DEFAULT_PAGE      =  5;
const DEFAULT_STALE_MS  = 180_000; // 3 minutes
const SCROLL_IDLE_MS    = 800;
const TRIM_SCROLL_TOP   = 50;  // px — only trim when near top
const ENTRY_H_APPROX    = 68;  // px — initial fill-count estimate
const BACK_TO_TOP_SHOW  = 80;  // px — scrollTop threshold to reveal strip

interface PagedState {
  windowSize: number;
  expanded: Set<string>;
  lastFirstId: unknown;
  lastHideTime: number;
  savedScrollTop: number;
}

// Module-level — survives component destruction on view switches because
// DashboardPane disposes + recreates components on every renderView().
const pagedStates = new Map<string, PagedState>();

function getState(key: string, initial: number): PagedState {
  let s = pagedStates.get(key);
  if (!s) {
    s = { windowSize: initial, expanded: new Set(), lastFirstId: undefined, lastHideTime: 0, savedScrollTop: 0 };
    pagedStates.set(key, s);
  }
  return s;
}

export class CardsPaged extends BaseDashboardComponent {
  private observer: IntersectionObserver | null = null;
  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private backToTopEl: HTMLElement | null = null;

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data, onAction } = this.props;
    const sourceKey = typeof panel.source === "string" ? panel.source : "_paged";

    const target   = Number(panel.extra?.["target_size"]  ?? DEFAULT_TARGET);
    const buffer   = Number(panel.extra?.["buffer_size"]  ?? DEFAULT_BUFFER);
    const pageSize = Number(panel.extra?.["page_size"]    ?? DEFAULT_PAGE);
    const staleMs  = Number(panel.extra?.["stale_ms"]     ?? DEFAULT_STALE_MS);
    const max = target + buffer;

    // Compute initial fill from the visible pane height.
    const scrollEl = this.container.closest<HTMLElement>(".dashboard-view-content");
    const containerH = scrollEl?.clientHeight ?? 500;
    const initialSize = Math.max(target, Math.ceil(containerH / ENTRY_H_APPROX) + buffer);

    const state = getState(sourceKey, initialSize);

    // Stale detection — reset when new content arrived after a long gap.
    let savedScrollTop = state.savedScrollTop;
    state.savedScrollTop = 0;

    const currentFirstId = data[0]?.["id"];
    if (state.lastFirstId !== undefined && currentFirstId !== state.lastFirstId) {
      if (Date.now() - state.lastHideTime > staleMs) {
        state.windowSize = initialSize;
        state.expanded.clear();
        savedScrollTop = 0;
      }
    }
    state.lastFirstId = currentFirstId;

    state.windowSize = Math.min(state.windowSize, data.length);

    const visible = data.slice(0, state.windowSize);
    const hasMore = state.windowSize < data.length;

    const wrapper = this.el("div", "dash-cards dash-cards--list");
    wrapper.setAttribute("role", "list");

    for (const item of visible) {
      wrapper.appendChild(this.buildCard(item, panel, state, onAction));
    }

    if (hasMore) {
      const sentinel = this.el("div", "cards-paged-sentinel");
      wrapper.appendChild(sentinel);

      this.observer?.disconnect();
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            this.observer?.disconnect();
            state.windowSize = Math.min(state.windowSize + pageSize, data.length);
            if (scrollEl) state.savedScrollTop = scrollEl.scrollTop;
            this.rebuild();
          }
        },
        { root: scrollEl ?? null, threshold: 0.1 },
      );
      requestAnimationFrame(() => {
        if (sentinel.isConnected) this.observer?.observe(sentinel);
      });
    }

    this.container.appendChild(wrapper);

    // Restore scroll position after data-driven rebuilds so live pushes
    // don't snap the user to the top.
    if (savedScrollTop > 0 && scrollEl) {
      requestAnimationFrame(() => { scrollEl.scrollTop = savedScrollTop; });
    }

    // Attach scroll listener for trim-on-idle and back-to-top visibility.
    if (scrollEl && scrollEl !== this.scrollEl) {
      if (this.scrollEl && this.scrollHandler) {
        this.scrollEl.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollEl = scrollEl;
      this.scrollHandler = () => {
        // Immediate: toggle back-to-top strip visibility.
        this.setBackToTopVisible((scrollEl.scrollTop ?? 0) > BACK_TO_TOP_SHOW);

        // Debounced: trim oldest entries when idle near the top.
        if (this.scrollIdleTimer) clearTimeout(this.scrollIdleTimer);
        this.scrollIdleTimer = setTimeout(() => {
          this.scrollIdleTimer = null;
          const atTop = (scrollEl.scrollTop ?? 0) < TRIM_SCROLL_TOP;
          if (atTop && state.windowSize > max) {
            state.windowSize = target;
            this.rebuild();
          }
        }, SCROLL_IDLE_MS);
      };
      scrollEl.addEventListener("scroll", this.scrollHandler, { passive: true });
    }

    // Back-to-top strip — injected directly into the scroll container so that
    // position:sticky works despite overflow:hidden on .dashboard-panel.
    if (scrollEl) this.ensureBackToTop(scrollEl, sourceKey);
  }

  private ensureBackToTop(scrollEl: HTMLElement, sourceKey: string): void {
    const attr = "data-back-to-top";
    const existing = scrollEl.querySelector<HTMLElement>(`[${attr}="${sourceKey}"]`);
    if (existing) {
      this.backToTopEl = existing;
      return;
    }
    const btn = document.createElement("button");
    btn.setAttribute(attr, sourceKey);
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", "Return to latest entries");
    btn.className = "cards-paged-back-to-top";

    const tab = document.createElement("span");
    tab.className = "cards-paged-back-to-top-tab";
    tab.textContent = "↑";
    tab.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "cards-paged-back-to-top-body";

    const label = document.createElement("span");
    label.className = "cards-paged-back-to-top-label";
    label.textContent = "latest";

    const dots = document.createElement("span");
    dots.className = "cards-paged-back-to-top-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.textContent = "· · · · · · · · · · · · · · · · · · · · · ·";

    body.appendChild(label);
    body.appendChild(dots);
    btn.appendChild(tab);
    btn.appendChild(body);

    btn.addEventListener("click", () => {
      scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    });
    scrollEl.prepend(btn);
    this.backToTopEl = btn;
  }

  private setBackToTopVisible(visible: boolean): void {
    if (!this.backToTopEl) return;
    this.backToTopEl.style.opacity = visible ? "1" : "0";
    this.backToTopEl.style.pointerEvents = visible ? "auto" : "none";
  }

  private buildCard(
    item: Record<string, unknown>,
    panel: PanelConfig,
    state: PagedState,
    onAction: (a: DashboardAction) => void,
  ): HTMLElement {
    const card = this.el("article", "dash-card");
    const cardKey = String(item["id"] ?? "");
    const isOpen = cardKey ? state.expanded.has(cardKey) : false;

    let firstRendered = false;
    for (const field of panel.fields) {
      const val = this.fieldValue(item, field);
      if (!val) continue;
      if (!firstRendered) {
        card.appendChild(this.el("h4", "dash-card-title", val));
        firstRendered = true;
      } else {
        card.appendChild(this.el("div", "dash-card-field", val));
      }
    }

    const onFavourite = panel.options?.["on_favourite"] as
      | { action: string; message?: Record<string, unknown> }
      | undefined;
    const favouriteField = typeof panel.extra?.["favourite_field"] === "string"
      ? (panel.extra["favourite_field"] as string)
      : "favourite";

    if (panel.badges.length > 0) {
      const badgesEl = this.el("div", "dash-card-badges");
      badgesEl.setAttribute("role", "list");
      badgesEl.setAttribute("aria-label", "tags");
      for (const badgeField of panel.badges) {
        if (onFavourite && badgeField === favouriteField) {
          const isFav = Boolean(item[favouriteField]);
          const star = this.el(
            "button",
            `dash-card-favourite${isFav ? " dash-card-favourite--on" : ""}`,
            isFav ? "★" : "☆",
          );
          star.setAttribute("type", "button");
          star.setAttribute("aria-label", isFav ? "unfavourite" : "favourite");
          star.setAttribute("role", "listitem");
          star.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            onAction({
              action: onFavourite.action,
              source: typeof panel.source === "string" ? panel.source : "",
              entityId: cardKey,
              message: {
                ...(onFavourite.message ?? {}),
                event_id: item["id"],
                body_md: String(item["_notes"] ?? ""),
                favourite: !isFav,
              },
            });
          });
          badgesEl.appendChild(star);
          continue;
        }
        const val = this.fieldValue(item, badgeField);
        if (val) {
          const b = this.badge(val, badgeField);
          b.setAttribute("role", "listitem");
          badgesEl.appendChild(b);
        }
      }
      card.appendChild(badgesEl);
    }

    const detailCfg = panel.detail as Record<string, unknown> | undefined;
    if (detailCfg && typeof detailCfg["component"] === "string") {
      const chevron = this.el(
        "span",
        `dash-card-chevron${isOpen ? " dash-card-chevron--open" : ""}`,
        isOpen ? "▾" : "▸",
      );
      chevron.setAttribute("aria-hidden", "true");
      card.appendChild(chevron);
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-expanded", isOpen ? "true" : "false");
      card.style.cursor = "pointer";

      const detailEl = this.el("div", "dash-card-detail");
      if (isOpen) {
        this.renderDetail(detailEl, detailCfg, item);
        card.appendChild(detailEl);
      }

      const toggle = () => {
        if (!cardKey) return;
        if (state.expanded.has(cardKey)) {
          state.expanded.delete(cardKey);
          card.setAttribute("aria-expanded", "false");
          chevron.classList.remove("dash-card-chevron--open");
          chevron.textContent = "▸";
          detailEl.replaceChildren();
          if (detailEl.parentElement === card) card.removeChild(detailEl);
        } else {
          state.expanded.add(cardKey);
          card.setAttribute("aria-expanded", "true");
          chevron.classList.add("dash-card-chevron--open");
          chevron.textContent = "▾";
          this.renderDetail(detailEl, detailCfg, item);
          card.appendChild(detailEl);
        }
      };

      card.addEventListener("click", (e: Event) => {
        if ((e.target as HTMLElement).closest(".dash-card-detail")) return;
        toggle();
      });
      card.addEventListener("keydown", (e: Event) => {
        const key = (e as KeyboardEvent).key;
        if (key === "Enter" || key === " ") { e.preventDefault(); toggle(); }
      });
    } else {
      card.setAttribute("role", "listitem");
    }

    return card;
  }

  private renderDetail(
    host: HTMLElement,
    detailCfg: Record<string, unknown>,
    row: Record<string, unknown>,
  ): void {
    if (!this.props) return;
    const componentName = String(detailCfg["component"] ?? "");
    if (!componentName) return;
    const registry = createDefaultRegistry();
    if (!registry.has(componentName)) return;
    try {
      const comp = registry.create(componentName);
      comp.render(host, {
        panel: {
          component: componentName,
          fields: Array.isArray(detailCfg["fields"]) ? (detailCfg["fields"] as string[]) : [],
          columns: [],
          badges: [],
          filter: {},
          sortable: false,
          filterable: [],
          searchable: [],
          inline_edit: [],
          options: (detailCfg["options"] as Record<string, unknown>) ?? detailCfg,
          extra: {},
          source: this.props.panel.source ?? "",
        },
        data: [row],
        allData: this.props.allData,
        config: this.props.config,
        onAction: this.props.onAction,
      });
    } catch {
      // Broken detail config should not take down the list.
    }
  }

  dispose(): void {
    if (this.props) {
      const key = typeof this.props.panel.source === "string"
        ? this.props.panel.source
        : "_paged";
      const state = pagedStates.get(key);
      if (state) {
        state.lastHideTime = Date.now();
        const scrollEl = this.container?.closest<HTMLElement>(".dashboard-view-content");
        if (scrollEl) state.savedScrollTop = scrollEl.scrollTop;
      }
    }

    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener("scroll", this.scrollHandler);
      this.scrollEl = null;
      this.scrollHandler = null;
    }
    if (this.scrollIdleTimer) {
      clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    this.backToTopEl?.remove();
    this.backToTopEl = null;
    this.observer?.disconnect();
    this.observer = null;
    super.dispose();
  }
}
