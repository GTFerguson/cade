/**
 * Graph component — renders a 2D tile-grid graph from node/edge data.
 *
 * Data source (preferred — push-based):
 *   panel.source        — data source name; engine pushes world-map JSON
 *                         with an extra active_node field. format: "world-map"
 *                         is assumed when rooms/exits are present.
 *
 * Panel config options (static fallback):
 *   options.src         — URL to a graph JSON file
 *   options.format      — "world-map" to auto-convert Padarax world-map JSON
 *   options.active_node — initial active node ID (string)
 *
 * Native graph format:
 *   { nodes: [{id, label, x, y, z}], edges: [{from, to, label, traversable}],
 *     bounds: {min_x, max_x, min_y, max_y, min_z, max_z} }
 *
 * Clicking a reachable node emits a "node_click" action with entityId = nodeId.
 */

import { BaseDashboardComponent } from "./base-component";

const TILE_W = 80;
const TILE_H = 30;
const CONN_W = 22;
const CONN_H = 18;

const LABEL_OFFSET: Record<string, [number, number]> = {
  north:     [ 0, -1], south:     [ 0,  1],
  east:      [ 1,  0], west:      [-1,  0],
  northeast: [ 1, -1], northwest: [-1, -1],
  southeast: [ 1,  1], southwest: [-1,  1],
};

const CONN_CHAR: Record<string, string> = {
  north: "│", south: "│", east: "─", west: "─",
  northeast: "╱", northwest: "╲", southeast: "╲", southwest: "╱",
};

interface GraphNode { id: string; label: string; x: number; y: number; z: number; }
interface GraphEdge { from: string; to: string; label: string; traversable: boolean; }
interface GraphBounds { min_x: number; max_x: number; min_y: number; max_y: number; }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; bounds: GraphBounds; }

const ARTICLES = /^(the|a|an)\s+/i;
function shortLabel(label: string): string {
  return label.replace(ARTICLES, "").split(/\s+/)[0] ?? label;
}

function fromWorldMap(raw: Record<string, unknown>): GraphData {
  const rooms = raw.rooms as Array<Record<string, unknown>>;
  const exits  = raw.exits  as Array<Record<string, unknown>>;
  return {
    nodes: rooms.map(r => ({
      id: String(r.id), label: String(r.title),
      x: Number(r.x), y: Number(r.y), z: Number(r.z),
    })),
    edges: exits.map(e => ({
      from: String(e.from), to: String(e.to),
      label: String(e.direction), traversable: !e.non_euclidean,
    })),
    bounds: raw.bounds as GraphBounds,
  };
}

export class GraphComponent extends BaseDashboardComponent {
  private graphData: GraphData | null = null;
  private activeNode: string | null   = null;

  protected build(): void {
    if (!this.container || !this.props) return;

    // Push-based: engine sends world-map JSON + active_node via dashboard_data.
    if (this.props.data?.length) {
      const row = this.props.data[0] as Record<string, unknown>;
      if (row.active_node != null) {
        this.activeNode = String(row.active_node);
      }
      if (row.rooms != null) {
        this.graphData = fromWorldMap(row);
      } else if (row.nodes != null) {
        this.graphData = row as unknown as GraphData;
      }
      if (this.graphData) {
        this.#renderGrid();
        return;
      }
    }

    // Static fallback: load from options.src via HTTP.
    const format = String(this.props.panel.options?.format ?? "world-map");
    this.container.innerHTML = '<div class="gg-loading">Loading…</div>';

    this.#loadFromOptions()
      .then((raw: Record<string, unknown>) => {
        this.graphData = format === "world-map" ? fromWorldMap(raw) : (raw as unknown as GraphData);
        if (!this.activeNode && this.graphData.nodes[0]) {
          this.activeNode = this.graphData.nodes[0].id;
        }
        this.#renderGrid();
      })
      .catch((err: Error) => {
        if (this.container) {
          this.container.innerHTML =
            `<div class="dashboard-component-error">graph: ${err.message}</div>`;
        }
      });
  }

  #loadFromOptions(): Promise<Record<string, unknown>> {
    const src = String(this.props?.panel.options?.src ?? "");
    if (!src) return Promise.reject(new Error("options.src is required for static graph panels"));
    this.activeNode = String(this.props?.panel.options?.active_node ?? "");
    return fetch(src).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<Record<string, unknown>>;
    });
  }

  #reachable(): Map<string, string> {
    const out = new Map<string, string>();
    if (!this.graphData || !this.activeNode) return out;
    for (const edge of this.graphData.edges) {
      if (edge.from === this.activeNode && edge.traversable !== false) {
        out.set(edge.to, edge.label);
      }
    }
    return out;
  }

  #renderGrid(): void {
    if (!this.container || !this.graphData) return;

    const { nodes, edges, bounds } = this.graphData;
    const { min_x, max_x, min_y, max_y } = bounds;
    const reach   = this.#reachable();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const cols = (max_x - min_x) * 2 + 1;
    const rows = (max_y - min_y) * 2 + 1;

    const colTpl = Array.from({ length: cols }, (_, i) =>
      i % 2 === 0 ? `${TILE_W}px` : `${CONN_W}px`).join(" ");
    const rowTpl = Array.from({ length: rows }, (_, i) =>
      i % 2 === 0 ? `${TILE_H}px` : `${CONN_H}px`).join(" ");

    const grid = this.el("div", "gg-grid");
    grid.style.gridTemplateColumns = colTpl;
    grid.style.gridTemplateRows    = rowTpl;

    for (const node of nodes) {
      if (node.z !== 0) continue;

      const col = (node.x - min_x) * 2 + 1;
      const row = (node.y - min_y) * 2 + 1;

      const isActive    = node.id === this.activeNode;
      const edgeLabel   = reach.get(node.id);
      const isReachable = edgeLabel != null;

      const tile = this.el("div",
        "gg-node" +
        (isActive    ? " gg-node--active"    : "") +
        (isReachable ? " gg-node--reachable" : "") +
        (!isActive && !isReachable ? " gg-node--distant" : "")
      );
      tile.style.gridColumn = String(col);
      tile.style.gridRow    = String(row);
      tile.title = node.label;

      if (isReachable && edgeLabel != null) {
        tile.role     = "button";
        tile.tabIndex = 0;
        tile.setAttribute("aria-label", `Go to ${node.label} (${edgeLabel})`);
        const id = node.id;
        tile.addEventListener("click", () => {
          this.activeNode = id;
          this.#renderGrid();
          this.props?.onAction({ action: "node_click", source: (this.props.panel.source as string) ?? "", entityId: id });
        });
      } else if (isActive) {
        tile.setAttribute("aria-current", "location");
      }

      const span = this.el("span", "gg-node-label", shortLabel(node.label));
      tile.appendChild(span);
      grid.appendChild(tile);
    }

    const placed = new Set<string>();
    for (const edge of edges) {
      if (!edge.traversable) continue;
      const from = nodeMap.get(edge.from);
      if (!from || from.z !== 0) continue;

      const dir = edge.label.toLowerCase();
      const off = LABEL_OFFSET[dir];
      if (!off) continue;

      const col = (from.x - min_x) * 2 + 1 + off[0];
      const row = (from.y - min_y) * 2 + 1 + off[1];
      const key = `${col},${row}`;
      if (placed.has(key)) continue;
      placed.add(key);

      const conn = this.el("div", "gg-connector", CONN_CHAR[dir] ?? "·");
      conn.style.gridColumn = String(col);
      conn.style.gridRow    = String(row);
      grid.appendChild(conn);
    }

    this.container.innerHTML = "";
    this.container.appendChild(grid);
  }
}
