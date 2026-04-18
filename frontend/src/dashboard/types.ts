/**
 * Dashboard config types — mirrors backend/dashboard/config.py
 */

export interface EntityConfig {
  id_field: string;
  statuses: string[];
  transitions: Record<string, string[]>;
}

export interface DataSourceConfig {
  name: string;
  type: string;
  endpoint?: string;
  path?: string;
  parse?: string;
  entity?: EntityConfig;
  headers?: Record<string, string>;
}

export interface StatConfig {
  id: string;
  label: string;
  source: string;
  format?: string;
}

export interface PanelConfig {
  component: string;
  id?: string;
  title?: string;
  source?: string | Record<string, unknown>;
  fields: string[];
  columns: (string | Record<string, unknown>)[];
  badges: string[];
  filter: Record<string, unknown>;
  limit?: number;
  layout?: string;
  sortable: boolean;
  filterable: string[];
  searchable: string[];
  inline_edit: string[];
  expandable?: Record<string, unknown>;
  options: Record<string, unknown>;
  detail?: Record<string, unknown>;
  on_click?: string | Record<string, unknown>;
  on_check?: Record<string, unknown>;
  on_move?: Record<string, unknown>;
  extra: Record<string, unknown>;
}

export interface ViewConfig {
  id: string;
  title: string;
  layout?: string;
  hidden?: boolean;
  group?: string;
  panels: PanelConfig[];
  sidebar_filters: Record<string, unknown>[];
  tab_filter?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  actions_by_status?: Record<string, Record<string, unknown>[]>;
}

export interface DashboardMeta {
  title: string;
  subtitle?: string;
  theme?: string;
}

export interface DashboardConfig {
  dashboard: DashboardMeta;
  data_sources: Record<string, DataSourceConfig>;
  views: ViewConfig[];
  stats: StatConfig[];
}

// Component rendering contract
export interface DashboardComponentProps {
  panel: PanelConfig;
  data: Record<string, unknown>[];
  /**
   * Full map of declared source name → fetched rows. Components usually
   * only need their own `data`, but panels that interact across sources
   * (e.g. barter reading a wallet source for affordability) read from
   * here. Keyed by source name as declared in `data_sources`.
   */
  allData: Record<string, Record<string, unknown>[]>;
  config: DashboardConfig;
  onAction: (action: DashboardAction) => void;
}

export interface DashboardComponent {
  render(container: HTMLElement, props: DashboardComponentProps): void;
  update(props: DashboardComponentProps): void;
  dispose(): void;
}

export interface DashboardAction {
  action: string;
  source: string;
  entityId?: string;
  patch?: Record<string, unknown>;
  // Used by `provider_message` actions — freeform frame forwarded
  // through the active provider to the engine.
  message?: Record<string, unknown>;
}
