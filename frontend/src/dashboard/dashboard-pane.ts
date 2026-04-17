/**
 * Main dashboard container.
 *
 * Orchestrates config, data, and component rendering. Receives config
 * and data via WebSocket events, builds view navigation, and delegates
 * rendering to registered components.
 */

import { MessageType } from "../platform/protocol";
import type { Component } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { createDefaultRegistry, type ComponentRegistry } from "./registry";
import type {
  DashboardAction,
  DashboardComponent,
  DashboardComponentProps,
  DashboardConfig,
  PanelConfig,
  ViewConfig,
} from "./types";

export class DashboardPane implements Component {
  private config: DashboardConfig | null = null;
  private data: Record<string, Record<string, unknown>[]> = {};
  private registry: ComponentRegistry;
  private activeViewId: string | null = null;
  private activeComponents: Map<string, DashboardComponent> = new Map();
  private onViewFileCallback: ((path: string) => void) | null = null;

  private headerEl: HTMLElement;
  private viewNavEl: HTMLElement;
  private contentEl: HTMLElement;
  private emptyEl: HTMLElement;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient,
  ) {
    this.registry = createDefaultRegistry();

    this.headerEl = document.createElement("div");
    this.headerEl.className = "dashboard-header";

    this.viewNavEl = document.createElement("div");
    this.viewNavEl.className = "dashboard-view-nav";

    this.contentEl = document.createElement("div");
    this.contentEl.className = "dashboard-view-content";

    this.emptyEl = document.createElement("div");
    this.emptyEl.className = "dashboard-empty";
    this.emptyEl.textContent = "No dashboard configured";

    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.viewNavEl);
    this.container.appendChild(this.contentEl);
    this.container.appendChild(this.emptyEl);
  }

  initialize(): void {
    this.showEmpty();
  }

  // -------------------------------------------------------------------
  // Config & data
  // -------------------------------------------------------------------

  setConfig(config: DashboardConfig): void {
    this.config = config;
    // Bracket notation header per design bible
    this.headerEl.textContent = `[ ${config.dashboard.title} ]`;
    if (config.dashboard.subtitle != null) {
      const sub = document.createElement("span");
      sub.className = "dashboard-subtitle";
      sub.textContent = config.dashboard.subtitle;
      this.headerEl.appendChild(sub);
    }
    this.buildViewNav();
    this.emptyEl.style.display = "none";
    this.headerEl.style.display = "";
    this.viewNavEl.style.display = "";
    this.contentEl.style.display = "";

    // Activate first view
    const firstView = config.views[0];
    if (firstView) {
      this.activateView(firstView.id);
    }
  }

  setData(sources: Record<string, Record<string, unknown>[]>): void {
    // Merge incoming sources into existing data (partial updates)
    for (const [key, value] of Object.entries(sources)) {
      this.data[key] = value;
    }
    // Re-render active view with new data
    if (this.activeViewId) {
      this.renderView(this.activeViewId);
    }
  }

  /**
   * Push a panel from the agent directly (no config needed).
   * Renders it at the top of the current view.
   */
  pushAgentPanel(
    panel: { id: string; title: string; component: string },
    data: Record<string, unknown>[],
  ): void {
    // Ensure dashboard is visible even without a config
    if (!this.config) {
      this.emptyEl.style.display = "none";
      this.headerEl.textContent = "[ AGENT ]";
      this.headerEl.style.display = "";
      this.contentEl.style.display = "";
    }

    // Store as a synthetic data source
    const sourceKey = `_agent_${panel.id}`;
    this.data[sourceKey] = data;

    // Build the panel config
    const panelConfig: PanelConfig = {
      component: panel.component,
      id: panel.id,
      title: panel.title,
      source: sourceKey,
      fields: data[0] ? Object.keys(data[0]).filter((k) => !k.startsWith("_")) : [],
      columns: [],
      badges: [],
      filter: {},
      sortable: false,
      filterable: [],
      searchable: [],
      inline_edit: [],
      options: {},
      extra: {},
    };

    // Remove existing panel with same ID
    const existing = this.contentEl.querySelector(
      `[data-panel-id="${panel.id}"]`,
    );
    if (existing) {
      const comp = this.activeComponents.get(panel.id);
      comp?.dispose();
      this.activeComponents.delete(panel.id);
      existing.remove();
    }

    // Create a container if none exists
    let agentArea = this.contentEl.querySelector(".dashboard-agent-panels") as HTMLElement;
    if (!agentArea) {
      agentArea = document.createElement("div");
      agentArea.className = "dashboard-agent-panels dashboard-panels";
      this.contentEl.prepend(agentArea);
    }

    // Render the panel
    const panelEl = document.createElement("div");
    panelEl.className = "dashboard-panel";
    panelEl.dataset["panelId"] = panel.id;

    const titleEl = document.createElement("div");
    titleEl.className = "dashboard-panel-title";
    titleEl.textContent = panel.title;
    panelEl.appendChild(titleEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "dashboard-panel-body";
    panelEl.appendChild(bodyEl);
    agentArea.appendChild(panelEl);

    if (this.registry.has(panel.component)) {
      try {
        const comp = this.registry.create(panel.component);
        comp.render(bodyEl, {
          panel: panelConfig,
          data,
          allData: this.data,
          config: this.config ?? {
            dashboard: { title: "Agent" },
            data_sources: {},
            views: [],
            stats: [],
          },
          onAction: (action) => this.handleAction(action),
        });
        this.activeComponents.set(panel.id, comp);
      } catch (e) {
        bodyEl.innerHTML = `<div class="dashboard-component-error">Error: ${panel.component}</div>`;
      }
    } else {
      bodyEl.innerHTML = `<div class="dashboard-component-missing">${panel.component}</div>`;
    }
  }

  clearConfig(): void {
    this.disposeComponents();
    this.config = null;
    this.data = {};
    this.activeViewId = null;
    this.showEmpty();
  }

  hasConfig(): boolean {
    return this.config !== null;
  }

  // -------------------------------------------------------------------
  // View navigation
  // -------------------------------------------------------------------

  private buildViewNav(): void {
    this.viewNavEl.innerHTML = "";
    if (!this.config) return;

    for (const view of this.config.views) {
      const tab = document.createElement("button");
      tab.className = "dashboard-view-tab";
      tab.textContent = view.title;
      tab.dataset["viewId"] = view.id;
      tab.addEventListener("click", () => this.activateView(view.id));
      this.viewNavEl.appendChild(tab);
    }
  }

  private activateView(viewId: string): void {
    this.activeViewId = viewId;

    // Update tab active state
    for (const tab of this.viewNavEl.children) {
      const el = tab as HTMLElement;
      el.classList.toggle(
        "dashboard-view-tab--active",
        el.dataset["viewId"] === viewId,
      );
    }

    this.renderView(viewId);
  }

  /** Programmatic tab switch, driven by a server-pushed
   * `dashboard_focus` frame (e.g. engine signalling "a barter
   * session just opened, focus the Barter tab"). Silently no-ops
   * if the view id isn't declared by the current config — the
   * engine should only name views that exist, but a stale config
   * shouldn't crash. */
  focusView(viewId: string): void {
    if (!this.config) return;
    const exists = this.config.views.some((v) => v.id === viewId);
    if (!exists) return;
    this.activateView(viewId);
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  private renderView(viewId: string): void {
    if (!this.config) return;

    const view = this.config.views.find((v) => v.id === viewId);
    if (!view) return;

    this.disposeComponents();
    this.contentEl.innerHTML = "";

    // Create layout container
    const layoutEl = document.createElement("div");
    layoutEl.className = `dashboard-panels ${view.layout ? `dashboard-layout-${view.layout}` : ""}`;
    this.contentEl.appendChild(layoutEl);

    for (const panel of view.panels) {
      this.renderPanel(layoutEl, panel, view);
    }
  }

  private renderPanel(
    container: HTMLElement,
    panel: PanelConfig,
    _view: ViewConfig,
  ): void {
    // Create panel wrapper
    const panelEl = document.createElement("div");
    panelEl.className = "dashboard-panel";
    if (panel.id) panelEl.dataset["panelId"] = panel.id;

    // Wide components span the full grid row
    const wideComponents = new Set(["kanban", "table", "timeline"]);
    if (wideComponents.has(panel.component)) {
      panelEl.classList.add("dashboard-panel--full-width");
    }

    if (panel.title) {
      const titleEl = document.createElement("div");
      titleEl.className = "dashboard-panel-title";
      titleEl.textContent = panel.title;
      panelEl.appendChild(titleEl);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "dashboard-panel-body";
    panelEl.appendChild(bodyEl);
    container.appendChild(panelEl);

    // Resolve data for this panel
    const sourceName =
      typeof panel.source === "string" ? panel.source : undefined;
    const panelData = sourceName ? this.data[sourceName] ?? [] : [];

    // Apply client-side filters
    const filteredData = this.applyFilters(panelData, panel);

    // Try to create and render the component
    if (!this.registry.has(panel.component)) {
      bodyEl.innerHTML = `<div class="dashboard-component-missing">Component "${panel.component}" not yet available</div>`;
      return;
    }

    try {
      const component = this.registry.create(panel.component);
      const props: DashboardComponentProps = {
        panel,
        data: filteredData,
        allData: this.data,
        config: this.config!,
        onAction: (action) => this.handleAction(action),
      };
      component.render(bodyEl, props);
      this.activeComponents.set(panel.id ?? panel.component, component);
    } catch (e) {
      console.error(`Dashboard component "${panel.component}" error:`, e);
      bodyEl.innerHTML = `<div class="dashboard-component-error">Error rendering ${panel.component}</div>`;
    }
  }

  private applyFilters(
    data: Record<string, unknown>[],
    panel: PanelConfig,
  ): Record<string, unknown>[] {
    let filtered = data;

    if (panel.filter && Object.keys(panel.filter).length > 0) {
      filtered = filtered.filter((item) => {
        for (const [key, condition] of Object.entries(panel.filter)) {
          const value = item[key];
          if (Array.isArray(condition)) {
            // Filter by inclusion in list
            if (!condition.includes(value)) return false;
          } else if (
            typeof condition === "object" &&
            condition !== null &&
            "not" in condition
          ) {
            // Exclusion filter
            const exclude = (condition as { not: unknown }).not;
            if (Array.isArray(exclude)) {
              if (exclude.includes(value)) return false;
            } else if (value === exclude) {
              return false;
            }
          } else if (value !== condition) {
            return false;
          }
        }
        return true;
      });
    }

    if (panel.limit) {
      filtered = filtered.slice(0, panel.limit);
    }

    return filtered;
  }

  // -------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------

  /**
   * Register a callback for when the user wants to view a file.
   * The host (ProjectContext) uses this to switch to workspace mode
   * and load the file in the markdown viewer.
   */
  onViewFile(callback: (path: string) => void): void {
    this.onViewFileCallback = callback;
  }

  private handleAction(action: DashboardAction): void {
    // Client-side actions
    if (action.action === "view_file") {
      const path = String(action.patch?.["path"] ?? "");
      if (path && this.onViewFileCallback) {
        this.onViewFileCallback(path);
      }
      return;
    }

    this.ws.send({
      type: MessageType.DASHBOARD_ACTION,
      ...action,
    });
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  private showEmpty(): void {
    this.headerEl.style.display = "none";
    this.viewNavEl.style.display = "none";
    this.contentEl.style.display = "none";
    this.emptyEl.style.display = "";
  }

  private disposeComponents(): void {
    for (const component of this.activeComponents.values()) {
      try {
        component.dispose();
      } catch {
        // Ignore disposal errors
      }
    }
    this.activeComponents.clear();
  }

  dispose(): void {
    this.disposeComponents();
  }
}
