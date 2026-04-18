import { BaseDashboardComponent } from "./base-component";

interface MapRoom   { id: string; title: string; x: number; y: number; z: number; }
interface MapExit   { from: string; to: string; direction: string; non_euclidean: boolean; }
interface MapBounds { min_x: number; max_x: number; min_y: number; max_y: number; }
interface MapSibling {
  world_id: string;
  rooms: MapRoom[];
  exits: MapExit[];
  bounds: MapBounds;
}

interface RoomExit  { direction: string; target_room_id: string; description?: string; }
interface WorldRoom { id: string; title: string; description?: string; exits?: RoomExit[]; }
interface WorldMeta { id?: string; title?: string; default_entry_room?: string; }

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

function appendInline(parent: HTMLElement, text: string): void {
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tag = m[1] !== undefined ? "strong" : "em";
    const inner = m[1] ?? m[2] ?? "";
    const node = document.createElement(tag);
    node.textContent = inner;
    parent.appendChild(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

export class WorldDetailComponent extends BaseDashboardComponent {
  private selectedWorld: Record<string, unknown> | null = null;
  private selectedRoomId: string | null = null;
  private mapEl: HTMLElement | null = null;
  private roomDetailEl: HTMLElement | null = null;
  private listRowsEl: HTMLElement | null = null;

  protected build(): void {
    if (!this.container || !this.props) return;

    const shell = this.el("div", "dash-world-shell");

    // Left: world list
    const listPane = this.el("div", "dash-world-list-pane");
    const listHead = this.el("div", "dash-world-list-head", "Worlds");
    const listRows = this.el("div", "dash-world-list-rows");
    this.listRowsEl = listRows;
    listPane.appendChild(listHead);
    listPane.appendChild(listRows);

    // Right: map + room detail stacked
    const detailPane = this.el("div", "dash-world-detail-pane");
    const mapArea = this.el("div", "dash-world-map-area");
    const roomDetail = this.el("div", "dash-world-room-detail");
    this.mapEl = mapArea;
    this.roomDetailEl = roomDetail;
    detailPane.appendChild(mapArea);
    detailPane.appendChild(roomDetail);

    shell.appendChild(listPane);
    shell.appendChild(detailPane);
    this.container.appendChild(shell);

    if (!this.selectedWorld && this.props.data.length > 0) {
      this.selectedWorld = this.props.data[0] ?? null;
    }

    this.renderWorldList();
    this.renderMap();
    this.renderRoomDetail(null);
  }

  private renderWorldList(): void {
    const el = this.listRowsEl;
    if (!el || !this.props) return;
    el.innerHTML = "";

    for (const item of this.props.data) {
      const meta = (item["world"] ?? {}) as WorldMeta;
      const row = this.el("div", "dash-world-list-row");
      if (item === this.selectedWorld) row.classList.add("dash-world-list-row--selected");

      const title = String(meta.title ?? item["_filename"] ?? item["id"] ?? "");
      const id    = String(meta.id    ?? item["_filename"] ?? "");
      row.appendChild(this.el("div", "dash-world-list-title", title));
      row.appendChild(this.el("div", "dash-world-list-id", id));

      row.addEventListener("click", () => {
        this.selectedWorld = item;
        this.selectedRoomId = null;
        this.renderWorldList();
        this.renderMap();
        this.renderRoomDetail(null);
      });
      el.appendChild(row);
    }
  }

  private renderMap(): void {
    const el = this.mapEl;
    if (!el) return;
    el.innerHTML = "";

    if (!this.selectedWorld) return;

    const sibling = this.selectedWorld["_sibling"] as MapSibling | undefined;
    if (!sibling?.rooms || !sibling.bounds) {
      el.appendChild(this.el("div", "dash-world-map-empty", "No map data available."));
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

    const grid = this.el("div", "gg-grid");
    grid.style.gridTemplateColumns = colTpl;
    grid.style.gridTemplateRows    = rowTpl;

    for (const node of rooms) {
      if (node.z !== 0) continue;
      const col = (node.x - min_x) * 2 + 1;
      const row = (node.y - min_y) * 2 + 1;

      const isSelected = node.id === this.selectedRoomId;
      const tile = this.el("div", `gg-node${isSelected ? " gg-node--active" : " gg-node--reachable"}`);
      tile.style.gridColumn = String(col);
      tile.style.gridRow    = String(row);
      tile.title = node.title;
      tile.role  = "button";
      tile.tabIndex = 0;
      tile.appendChild(this.el("span", "gg-node-label", shortLabel(node.title)));

      const nodeId = node.id;
      tile.addEventListener("click", () => {
        this.selectedRoomId = nodeId;
        this.renderMap();
        const worldRooms = (this.selectedWorld?.["rooms"] ?? []) as WorldRoom[];
        this.renderRoomDetail(worldRooms.find(r => r.id === nodeId) ?? null);
      });
      grid.appendChild(tile);
    }

    // Connectors
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
      const conn = this.el("div", "gg-connector", CONN_CHAR[dir] ?? "·");
      conn.style.gridColumn = String(col);
      conn.style.gridRow    = String(row);
      grid.appendChild(conn);
    }

    el.appendChild(grid);
  }

  private renderRoomDetail(room: WorldRoom | null): void {
    const el = this.roomDetailEl;
    if (!el) return;
    el.innerHTML = "";

    if (!room) {
      el.appendChild(this.el("div", "dash-world-room-empty", "[ select a room ]"));
      return;
    }

    const header = this.el("div", "dash-world-room-header");
    header.appendChild(this.el("div", "dash-world-room-title", room.title));
    header.appendChild(this.el("div", "dash-world-room-id", room.id));
    el.appendChild(header);

    const body = this.el("div", "dash-world-room-body");

    if (room.description) {
      for (const para of room.description.split(/\n\s*\n/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const p = this.el("p", "dash-world-room-desc");
        appendInline(p, trimmed);
        body.appendChild(p);
      }
    }

    const exits = room.exits ?? [];
    if (exits.length > 0) {
      body.appendChild(this.el("div", "dash-world-room-section-head", "Exits"));
      for (const exit of exits) {
        const row = this.el("div", "dash-world-exit-row");
        row.appendChild(this.el("span", "dash-world-exit-dir", exit.direction));
        row.appendChild(this.el("span", "dash-world-exit-target", exit.target_room_id.replace(/_/g, " ")));

        const targetId = exit.target_room_id;
        row.addEventListener("click", () => {
          this.selectedRoomId = targetId;
          this.renderMap();
          const worldRooms = (this.selectedWorld?.["rooms"] ?? []) as WorldRoom[];
          this.renderRoomDetail(worldRooms.find(r => r.id === targetId) ?? null);
        });
        body.appendChild(row);
      }
    }

    el.appendChild(body);
  }
}
