/**
 * Padarax world section handlers for entity_detail.
 *
 * Register at startup via padarax/register.ts. Ports logic from
 * world-viewer.ts and world-detail.ts. Expects the record to be an
 * enriched world JSON with _sibling map data injected.
 */

import type { SectionRenderer } from "../../dashboard/components/entity-detail";

interface MapRoom    { id: string; title: string; x: number; y: number; z: number; }
interface MapExit    { from: string; to: string; direction: string; non_euclidean: boolean; }
interface MapBounds  { min_x: number; max_x: number; min_y: number; max_y: number; }
interface MapSibling { rooms: MapRoom[]; exits: MapExit[]; bounds: MapBounds; }
interface RoomExit   { direction: string; target_room_id: string; }
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

function appendInline(parent: HTMLElement, text: string): void {
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tag = m[1] !== undefined ? "strong" : "em";
    const node = document.createElement(tag);
    node.textContent = (m[1] ?? m[2]) as string;
    parent.appendChild(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

// ─── world_map ────────────────────────────────────────────────────────────────

export const worldMapSection: SectionRenderer = (container, _section, record, ctx) => {
  const sibling = record["_sibling"] as MapSibling | undefined;
  if (!sibling?.rooms || !sibling.bounds) {
    container.appendChild(
      ctx.el("div", "world-v-map-empty", "No map data — open via the Worlds dashboard to load map."),
    );
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

  // Initial selected room from _room_id meta (injected by link-click handler)
  let selectedRoomId: string | null = (record["_room_id"] as string | undefined) ?? null;

  const mapWrap = ctx.el("div", "world-v-map-wrap");
  const roomDetailEl = ctx.el("div", "world-v-room-detail");

  const renderMap = (): void => {
    mapWrap.innerHTML = "";
    const grid = ctx.el("div", "gg-grid");
    grid.style.gridTemplateColumns = colTpl;
    grid.style.gridTemplateRows    = rowTpl;

    for (const node of rooms) {
      if (node.z !== 0) continue;
      const col = (node.x - min_x) * 2 + 1;
      const row = (node.y - min_y) * 2 + 1;

      const isSelected = node.id === selectedRoomId;
      const tile = ctx.el("div", `gg-node${isSelected ? " gg-node--active" : " gg-node--reachable"}`);
      tile.style.gridColumn = String(col);
      tile.style.gridRow    = String(row);
      tile.title    = node.title;
      tile.role     = "button";
      tile.tabIndex = 0;
      tile.appendChild(ctx.el("span", "gg-node-label", shortLabel(node.title)));

      const nodeId = node.id;
      tile.addEventListener("click", () => {
        selectedRoomId = nodeId;
        renderMap();
        renderRoomDetail(nodeId);
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
      const conn = ctx.el("div", "gg-connector", CONN_CHAR[dir] ?? "·");
      conn.style.gridColumn = String(col);
      conn.style.gridRow    = String(row);
      grid.appendChild(conn);
    }

    mapWrap.appendChild(grid);
  };

  const renderRoomDetail = (roomId: string | null): void => {
    roomDetailEl.innerHTML = "";
    if (!roomId) {
      roomDetailEl.appendChild(ctx.el("div", "world-v-room-hint", "[ click a room to view details ]"));
      return;
    }

    const worldRooms = (record["rooms"] ?? []) as WorldRoom[];
    const room = worldRooms.find(r => r.id === roomId) ?? null;
    if (!room) {
      roomDetailEl.appendChild(ctx.el("div", "world-v-room-hint", `[ no room data for ${roomId} ]`));
      return;
    }

    const header = ctx.el("div", "world-v-room-header");
    header.appendChild(ctx.el("span", "world-v-room-title", room.title));
    header.appendChild(ctx.el("span", "world-v-room-id", room.id));
    roomDetailEl.appendChild(header);

    if (room.description) {
      for (const para of room.description.split(/\n\s*\n/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const p = ctx.el("p", "world-v-room-desc");
        appendInline(p, trimmed);
        roomDetailEl.appendChild(p);
      }
    }

    const exits = room.exits ?? [];
    if (exits.length > 0) {
      roomDetailEl.appendChild(ctx.el("div", "world-v-section-head", "Exits"));
      for (const exit of exits) {
        const row = ctx.el("div", "world-v-exit-row");
        row.appendChild(ctx.el("span", "world-v-exit-dir", exit.direction));
        row.appendChild(ctx.el("span", "world-v-exit-target", exit.target_room_id.replace(/_/g, " ")));
        const targetId = exit.target_room_id;
        row.addEventListener("click", () => {
          selectedRoomId = targetId;
          renderMap();
          renderRoomDetail(targetId);
        });
        roomDetailEl.appendChild(row);
      }
    }
  };

  renderMap();
  renderRoomDetail(selectedRoomId);

  container.appendChild(mapWrap);
  container.appendChild(roomDetailEl);
};

// ─── room_detail ──────────────────────────────────────────────────────────────

export const roomDetailSection: SectionRenderer = (container, _section, record, ctx) => {
  // Renders a standalone room from the rooms data-source (flat room records,
  // not embedded in a world file). Expects record to have id, title,
  // description, exits fields directly.
  const title       = String(record["title"] ?? record["id"] ?? "");
  const id          = String(record["id"] ?? "");
  const description = String(record["description"] ?? "");
  const exits       = (record["exits"] ?? []) as Array<{ direction: string; target_room_id: string }>;

  const header = ctx.el("div", "world-v-room-header");
  header.appendChild(ctx.el("span", "world-v-room-title", title));
  header.appendChild(ctx.el("span", "world-v-room-id", id));
  container.appendChild(header);

  if (description) {
    for (const para of description.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const p = ctx.el("p", "world-v-room-desc");
      appendInline(p, trimmed);
      container.appendChild(p);
    }
  }

  if (exits.length > 0) {
    container.appendChild(ctx.el("div", "world-v-section-head", "Exits"));
    for (const exit of exits) {
      const row = ctx.el("div", "world-v-exit-row");
      row.appendChild(ctx.el("span", "world-v-exit-dir", exit.direction));
      row.appendChild(ctx.el("span", "world-v-exit-target", exit.target_room_id.replace(/_/g, " ")));
      container.appendChild(row);
    }
  }
};
