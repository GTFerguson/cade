import { viewerRegistry } from "../markdown/viewer-registry";
import type { ViewerFactory } from "../markdown/viewer-registry";
import { NpcViewer } from "./npc-viewer";
import { WorldViewer } from "./world-viewer";

interface ViewerSpec {
  pattern: string;
  viewer: string;
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
