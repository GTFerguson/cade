import { viewerRegistry } from "../markdown/viewer-registry";
import type { ViewerFactory } from "../markdown/viewer-registry";
import { NpcViewer } from "./npc-viewer";
import { WorldViewer } from "./world-viewer";
import { EntityDetailComponent } from "../dashboard/components/entity-detail";
import { enrichedDirForPath } from "./knowledge-refs";
import type { DashboardComponentProps, DashboardConfig, PanelConfig } from "../dashboard/types";

interface ViewerSpec {
  pattern: string;
  viewer: string;
}

const HISTORY_SECTIONS = [
  { type: "header",     fields: ["name", "{year_start} – {year_end}", "{year} {era}", "type"] },
  { type: "cross_refs", field: "cross_refs" },
  { type: "claims",     field: "claims" },
] as const;

const EMPTY_CONFIG: DashboardConfig = {
  dashboard: { title: "" },
  data_sources: {},
  views: [],
  stats: [],
};

function makePanel(options: Record<string, unknown>): PanelConfig {
  return {
    component: "entity_detail",
    fields:      [],
    columns:     [],
    badges:      [],
    filter:      {},
    filterable:  [],
    searchable:  [],
    inline_edit: [],
    sortable:    false,
    options,
    extra:       {},
  };
}

const VIEWER_FACTORIES: Record<string, ViewerFactory> = {
  npc: (container, data, navigateTo) => {
    const v = new NpcViewer();
    v.render(container, data, navigateTo);
    return { dispose: () => { container.innerHTML = ""; } };
  },
  world: (container, data) => {
    const v = new WorldViewer();
    v.render(container, data);
    return { dispose: () => { container.innerHTML = ""; } };
  },
  history: (container, data, navigateTo, path) => {
    const comp = new EntityDetailComponent();
    const props: DashboardComponentProps = {
      panel:    makePanel({ sections: HISTORY_SECTIONS, path }),
      data:     [data],
      allData:  {},
      config:   EMPTY_CONFIG,
      onAction: ({ action, patch }) => {
        if (action === "view_file") {
          const p = String(patch?.["path"] ?? "");
          if (p) navigateTo(p);
        } else if (action === "entity_ref_click") {
          const id  = String(patch?.["ref_id"]   ?? "");
          const p   = `${enrichedDirForPath(path ?? "")}/${id}.json`;
          if (id) navigateTo(p);
        }
      },
    };
    comp.render(container, props);
    return { dispose: () => comp.dispose() };
  },
};

export function registerParadraxViewers(specs: ViewerSpec[]): void {
  for (const { pattern, viewer } of specs) {
    const factory = VIEWER_FACTORIES[viewer];
    if (!factory) {
      console.warn(`[padarax] unknown viewer name: "${viewer}"`);
      continue;
    }
    viewerRegistry.register(new RegExp(pattern), viewer, factory);
  }
}
