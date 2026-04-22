/**
 * Dev-only demo mode — activated by ?demo=<scenario> in the URL.
 *
 * Scenarios fire synthetic dashboard-data events into the WS client
 * so the real mobile UI code runs against fake game state without a
 * server. Only imported when import.meta.env.DEV is true.
 *
 * Usage:
 *   ?demo=mobile-npc      toolbar: "talking to Rex", exits n/e/down
 *   ?demo=mobile-explore  toolbar: "exploring Dockside Inn", same exits
 *   ?demo=mobile-walk     cycles through three rooms every 2.5 s
 *   ?demo=mobile-noexits  The Sealed Vault — no exits
 */

import type { WebSocketClient } from "./platform/websocket";
import { applySavedTheme } from "./config/themes";

// ── Shared world fixture ─────────────────────────────────────────────

// Coordinates match the BFS direction vectors used by generate_world_map.py:
//   north=(0,-1,0)  south=(0,1,0)  east=(1,0,0)  west=(-1,0,0)
//   up=(0,0,1)  down=(0,0,-1)
const ROOMS = [
  { id: "room-inn",     title: "Dockside Inn",  x: 0, y:  0, z:  0 },
  { id: "room-alley",   title: "Back Alley",    x: 0, y: -1, z:  0 },
  { id: "room-harbour", title: "Harbour Front", x: 1, y:  0, z:  0 },
  { id: "room-cellar",  title: "The Cellar",    x: 0, y:  0, z: -1 },
  { id: "room-market",  title: "Salt Market",   x: 1, y: -1, z:  0 },
];

const EXITS = [
  { from: "room-inn",     to: "room-alley",   direction: "north", non_euclidean: false },
  { from: "room-inn",     to: "room-harbour", direction: "east",  non_euclidean: false },
  { from: "room-inn",     to: "room-cellar",  direction: "down",  non_euclidean: false },
  { from: "room-alley",   to: "room-inn",     direction: "south", non_euclidean: false },
  { from: "room-alley",   to: "room-market",  direction: "east",  non_euclidean: false },
  { from: "room-harbour", to: "room-inn",     direction: "west",  non_euclidean: false },
  { from: "room-harbour", to: "room-alley",   direction: "north", non_euclidean: false },
  { from: "room-market",  to: "room-alley",   direction: "west",  non_euclidean: false },
  { from: "room-market",  to: "room-harbour", direction: "south", non_euclidean: false },
  { from: "room-cellar",  to: "room-inn",     direction: "up",    non_euclidean: false },
];

const REX = { id: "npc-rex", name: "Rex Halverson" };

// ── Demo chat history ────────────────────────────────────────────────

const DEMO_CHAT = [
  { role: "assistant", content: "The Dockside Inn smells of salt water and cheap tallow. A low fire mutters in the hearth. Rex Halverson sits at the bar nursing something dark, his Admiralty coat folded over the stool beside him — as if he's saving it for someone who isn't coming." },
  { role: "user",      content: "Ask Rex about the harbour" },
  { role: "assistant", content: 'Rex turns the cup in his hands. "Harbour\'s quiet this time of year. Too quiet." He doesn\'t look at you when he says it. "Ships don\'t stay long. Not since the Crossing."' },
  { role: "user",      content: "What happened at the Crossing?" },
  { role: "assistant", content: 'A long pause. He finally sets the cup down. "Six years ago. You weren\'t here." It lands like a door closing. "Ask someone older. Or don\'t — most of them don\'t talk about it either."' },
  { role: "user",      content: "go north" },
  { role: "assistant", content: "You step out through the inn's rear door into the Back Alley. Cobblestones slick with last night's rain. Somewhere above, a gull shrieks once and goes quiet." },
  { role: "user",      content: "look around" },
  { role: "assistant", content: "The alley runs east toward the market and south back to the inn. A wooden crate has been pushed against the wall — recently, by the look of the scrape marks. Whatever was in it is gone." },
  { role: "user",      content: "examine the crate" },
  { role: "assistant", content: "Rough pine boards, salt-stained. The lid has been pried off and discarded nearby. Inside: nothing. But the base is damp in a way the sides aren't, and there's a faint smell — tar and something medicinal. Whatever was packed here was packed carefully." },
  { role: "user",      content: "go back to the inn" },
  { role: "assistant", content: "Rex hasn't moved. He glances at the door when you come in, then back to his cup. The fire has burned lower. The barkeep is wiping down glasses at the far end, not listening, or pretending not to." },
  { role: "user",      content: "Ask Rex about the crate in the alley" },
  { role: "assistant", content: 'His jaw tightens slightly. "Didn\'t see any crate." He takes a slow sip. "Alleys collect junk. Always have." He\'s not asking you to drop it. He\'s telling you.' },
  { role: "user",      content: "Press him on it" },
  { role: "assistant", content: 'Rex sets the cup down with a soft click that somehow sounds final. He turns to look at you for the first time. "You\'re new here," he says. Not unfriendly. Almost careful. "There are questions that don\'t get asked twice in Niverport. That\'s one of them." He picks the cup back up. "Drink something. Relax."' },
  { role: "user",      content: "Ask the barkeep instead" },
  { role: "assistant", content: 'The barkeep — a wide man with a close-trimmed beard going grey at the edges — sets a glass down without looking up. "Passing trade," he says quietly. "Move on." He\'s already moved to the other end of the bar.' },
  { role: "user",      content: "go east" },
  { role: "assistant", content: "The market lane is busier than the alley. Stalls selling rope, dried fish, lamp oil. A woman with ink-stained hands argues with a merchant over a ledger. Nobody looks your way. The smell of tar follows you from the alley." },
  { role: "user",      content: "look for anyone watching" },
  { role: "assistant", content: "Hard to say. The lane is full enough that watching wouldn't look like watching. A boy sitting on a barrel near the rope stall has been still for a while. Could be nothing. The ink-stained woman glances up once, then back to her argument with real-seeming irritation." },
];

function dashboardPayload(
  roomId: string,
  npcs: { id: string; name: string }[] = [],
) {
  const room = ROOMS.find((r) => r.id === roomId)!;
  return {
    sources: {
      game_room: [{ room_id: room.id, title: room.title }],
      game_npcs_in_room: npcs,
      game_map: [{ rooms: ROOMS, exits: EXITS, active_node: roomId }],
    },
  };
}

// ── Scenario registry ────────────────────────────────────────────────

interface Scenario {
  /** Fire once on load */
  initial: unknown;
  /** If set, cycle through these payloads on the given interval (ms) */
  walk?: { payloads: unknown[]; intervalMs: number };
}

const SCENARIOS: Record<string, Scenario> = {
  "mobile-npc": {
    initial: dashboardPayload("room-inn", [REX]),
  },
  "mobile-explore": {
    initial: dashboardPayload("room-inn"),
  },
  "mobile-noexits": {
    initial: {
      sources: {
        game_room: [{ room_id: "room-vault", title: "The Sealed Vault" }],
        game_npcs_in_room: [],
        game_map: [{ rooms: [{ id: "room-vault", title: "The Sealed Vault" }], exits: [] }],
      },
    },
  },
  "mobile-walk": {
    initial: dashboardPayload("room-inn"),
    walk: {
      intervalMs: 2500,
      payloads: [
        dashboardPayload("room-inn"),
        dashboardPayload("room-alley"),
        dashboardPayload("room-market"),
        dashboardPayload("room-harbour"),
      ],
    },
  },
};

// ── Activation ───────────────────────────────────────────────────────

export function activateDemoMode(ws: WebSocketClient): void {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("demo");
  if (!key) return;

  const scenario = SCENARIOS[key];
  if (!scenario) {
    console.warn(`[demo] unknown scenario "${key}". Available:`, Object.keys(SCENARIOS));
    return;
  }

  console.info(`[demo] activating scenario "${key}"`);

  // Force the Padarax theme regardless of whatever is in localStorage.
  localStorage.setItem("cade-theme", "padarax");
  applySavedTheme();

  // Delay all injections until context.initialize() has fully returned and
  // registered its WS handlers. There's an `await import("../dashboard")` in
  // initialize() that yields control; if we inject here (synchronously) the
  // project-context `connected` handler won't be registered yet and
  // setMode("chat") is never called, so the ChatPane never receives
  // chat-history. 400 ms is also enough for the padarax-dashboard.json fetch.
  setTimeout(() => {
    ws.injectEvent("connected", {
      type: "connected",
      workingDir: "",
      resumed: true,
      // Tells project-context to call terminalManager.setMode("chat") so the
      // ChatPane is created before we inject chat-history below.
      providers: [{ name: "padarax", type: "api", model: "demo", capabilities: { streaming: false, tool_use: false, vision: false } }],
      defaultProvider: "padarax",
    });

    ws.injectEvent("dashboard-data", scenario.initial);
    ws.injectEvent("chat-history", { type: "chat-history", messages: DEMO_CHAT });

    if (scenario.walk) {
      const { payloads, intervalMs } = scenario.walk;
      let idx = 0;
      setInterval(() => {
        idx = (idx + 1) % payloads.length;
        ws.injectEvent("dashboard-data", payloads[idx]);
      }, intervalMs);
    }
  }, 400);
}
