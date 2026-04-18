/**
 * Flat viewer-native renderer for World JSON files.
 *
 * Renders directly into the viewer content area: frontmatter at the top,
 * then the map grid at full width, then room detail below on selection.
 * No shell/pane wrapper — enhances the existing map view in parsed mode.
 */


interface MapRoom    { id: string; title: string; x: number; y: number; z: number; }
interface MapExit    { from: string; to: string; direction: string; non_euclidean: boolean; }
interface MapBounds  { min_x: number; max_x: number; min_y: number; max_y: number; }
interface MapSibling { world_id?: string; rooms: MapRoom[]; exits: MapExit[]; bounds: MapBounds; }
interface RoomExit   { direction: string; target_room_id: string; description?: string; }
interface WorldRoom  { id: string; title: string; description?: string; exits?: RoomExit[]; }

const TILE_W = 80, TILE_H = 28, CONN_W = 20, CONN_H = 16;
const CONN_CHAR: Record<string, string> = {
  north: "│", south: "│", east: "─", west: "─",
  northeast: "╱", northwest: "╲", southeast: "╲", southwest: "╱",
};
const DIR_OFFSET: Record<string, [number, number]> = {
  north: [0,-1], south: [0,1], east: [1,0], west: [-1,0],
  northeast: [1,-1], northwest: [-1,-1], southeast: [1,1], southwest: [-1,1],
};
const ARTICLES = /^(the|a|an)\s+/i;
function shortLabel(l: string): string {
  return l.replace(ARTICLES, "").split(/\s+/)[0] ?? l;
}

export class WorldViewer {
  private selectedRoomId: string | null = null;
  private mapEl: HTMLElement | null = null;
  private roomDetailEl: HTMLElement | null = null;
  private worldData: Record<string, unknown> = {};

  render(container: HTMLElement, world: Record<string, unknown>): void {
    this.worldData = world;
    container.innerHTML = "";

    // Map
    const mapWrap = el("div", "world-v-map-wrap");
    this.mapEl = mapWrap;
    container.appendChild(mapWrap);

    // Room detail
    const roomDetail = el("div", "world-v-room-detail");
    this.roomDetailEl = roomDetail;
    container.appendChild(roomDetail);

    this.renderMap();
    this.renderRoomDetail(null);
  }

  private renderMap(): void {
    const el_ = this.mapEl;
    if (!el_) return;
    el_.innerHTML = "";

    const sibling = this.worldData["_sibling"] as MapSibling | undefined;
    if (!sibling?.rooms || !sibling.bounds) {
      el_.appendChild(el("div", "world-v-map-empty", "No map data — open via the Worlds dashboard to load map."));
      return;
    }

    const { rooms, exits, bounds } = sibling;
    const { min_x, max_x, min_y, max_y } = bounds;

    const cols = (max_x - min_x) * 2 + 1;
    const rows = (max_y - min_y) * 2 + 1;

    const colTpl = Array.from({ length: cols }, (_, i) =>
      i % 2 === 0 ? `${TILE_W}px` : `${CONN_W}px`).join(" ");
    const rowTpl = Array.from({ length: rows }, (_, i) =>
      i % 2 === 0 ? `${TILE_H}px` : `${CONN_H}px`).join(" ");

    const grid = el("div", "gg-grid");
    grid.style.gridTemplateColumns = colTpl;
    grid.style.gridTemplateRows    = rowTpl;

    for (const node of rooms) {
      if (node.z !== 0) continue;
      const col = (node.x - min_x) * 2 + 1;
      const row = (node.y - min_y) * 2 + 1;

      const isSelected = node.id === this.selectedRoomId;
      const tile = el("div", `gg-node${isSelected ? " gg-node--active" : " gg-node--reachable"}`);
      tile.style.gridColumn = String(col);
      tile.style.gridRow    = String(row);
      tile.title    = node.title;
      tile.role     = "button";
      tile.tabIndex = 0;
      tile.appendChild(el("span", "gg-node-label", shortLabel(node.title)));

      const nodeId = node.id;
      tile.addEventListener("click", () => {
        this.selectedRoomId = nodeId;
        this.renderMap();
        const worldRooms = (this.worldData["rooms"] ?? []) as WorldRoom[];
        this.renderRoomDetail(worldRooms.find(r => r.id === nodeId) ?? null);
      });
      grid.appendChild(tile);
    }

    const placed = new Set<string>();
    for (const exit of exits) {
      if (exit.non_euclidean) continue;
      const from = rooms.find(r => r.id === exit.from);
      if (!from || from.z !== 0) continue;
      const dir = exit.direction.toLowerCase();
      const off = DIR_OFFSET[dir];
      if (!off) continue;
      const col = (from.x - min_x) * 2 + 1 + off[0];
      const row = (from.y - min_y) * 2 + 1 + off[1];
      const key = `${col},${row}`;
      if (placed.has(key)) continue;
      placed.add(key);
      const conn = el("div", "gg-connector", CONN_CHAR[dir] ?? "·");
      conn.style.gridColumn = String(col);
      conn.style.gridRow    = String(row);
      grid.appendChild(conn);
    }

    el_.appendChild(grid);
  }

  private renderRoomDetail(room: WorldRoom | null): void {
    const el_ = this.roomDetailEl;
    if (!el_) return;
    el_.innerHTML = "";

    if (!room) {
      el_.appendChild(el("div", "world-v-room-hint", "[ click a room to view details ]"));
      return;
    }

    const header = el("div", "world-v-room-header");
    header.appendChild(el("span", "world-v-room-title", room.title));
    header.appendChild(el("span", "world-v-room-id", room.id));
    el_.appendChild(header);

    if (room.description) {
      el_.appendChild(el("p", "world-v-room-desc", room.description));
    }

    const exits = room.exits ?? [];
    if (exits.length > 0) {
      el_.appendChild(el("div", "world-v-section-head", "Exits"));
      for (const exit of exits) {
        const row = el("div", "world-v-exit-row");
        row.appendChild(el("span", "world-v-exit-dir", exit.direction));
        row.appendChild(el("span", "world-v-exit-target", exit.target_room_id.replace(/_/g, " ")));

        const targetId = exit.target_room_id;
        row.addEventListener("click", () => {
          this.selectedRoomId = targetId;
          this.renderMap();
          const worldRooms = (this.worldData["rooms"] ?? []) as WorldRoom[];
          this.renderRoomDetail(worldRooms.find(r => r.id === targetId) ?? null);
        });
        el_.appendChild(row);
      }
    }
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
