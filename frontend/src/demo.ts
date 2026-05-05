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

// ── Mock browse API for LocalProjectSelector ────────────────────────
// Mirrors what /api/browse returns so the file picker works in demo mode.

const MOCK_FS: Record<string, string[]> = {
  "/home/gary/projects": [
    "admin-dash", "business-manager", "cade", "clann", "cognetic-site",
    "common-knowledge", "cv-site", "dream-decks", "EcoSim", "goodlet",
    "job-finder", "menshun-site", "misc", "money-printer", "nkrdn",
    "padarax", "scout-engine", "skillcracked", "socials", "tensyl",
  ],
};

const MOCK_TILDE_ROOT = "/home/gary/projects";

function resolveMockPath(path: string): string {
  if (path === "~" || path === "~/projects" || path === "~/projects/") return MOCK_TILDE_ROOT;
  if (path.startsWith("~/")) return `/home/gary/${path.slice(2)}`;
  return path;
}

(window as any).__MOCK_BROWSE__ = (path: string) => {
  const resolved = resolveMockPath(path);
  const names = MOCK_FS[resolved] ?? [];
  return {
    path: resolved,
    children: names.map((name) => ({
      name,
      path: `${resolved}/${name}`,
      type: "directory",
    })),
  };
};

// ── Scenario registry ────────────────────────────────────────────────

interface Scenario {
  /** Fire once on load */
  initial: unknown;
  /** If set, cycle through these payloads on the given interval (ms) */
  walk?: { payloads: unknown[]; intervalMs: number };
}

const VIEWER_MD = `# The Dockside Inn

A low fire mutters in the hearth. Rex Halverson sits at the bar nursing something dark.

## Recent Events

- The crate in the alley was moved overnight
- Someone has been watching the market lane
- Rex won't talk about the Crossing

## Notes

> "There are questions that don't get asked twice in Niverport."

\`\`\`python
def solve_mystery():
    clues = gather_clues()
    return interrogate(clues)
\`\`\`
`;

// ── Phase 5 memory graph fixture ─────────────────────────────────────

const PHASE5_GRAPH = {
  type: "nkrdn-graph" as const,
  stats: { symbols: 247, memories: 12, orphans: 2 },
  modules: [
    {
      name: "backend",
      path: "backend",
      children: [
        {
          name: "auth",
          path: "backend/auth",
          children: [
            {
              uuid: "8f2e7a3c",
              name: "AuthService",
              fqn: "backend.auth.auth_service.AuthService",
              kind: "class" as const,
              file: "backend/auth/auth_service.py",
              line_start: 24,
              line_end: 180,
              memories: [
                {
                  uuid: "mem-001",
                  type: "decision" as const,
                  title: "use Result<T, AuthError> over throwing",
                  body: "Explicit error types beat throwing for auth: callers can pattern-match, errors don't unwind across async boundaries, and the type system documents what can go wrong at each call site. Telemetry gets structured error variants instead of stringified stack traces.",
                  date: "2026-01-31",
                  authored_by: "agent:claude",
                  session: "2026-01-31",
                  tags: ["error-handling", "auth", "api-shape"],
                  evidence: [
                    { kind: "doc" as const, uri: "docs/architecture/error-handling.md#auth-module" },
                    { kind: "doc" as const, uri: "docs/reference/result-types.md" },
                    { kind: "code" as const, uri: "code:entity/3a91f0d2 · TokenSigner.sign()" },
                    { kind: "external" as const, uri: "https://blog.burntsushi.net/rust-error-handling/" },
                  ],
                  rejected_alternatives: [
                    { label: "panic!", reason: "too aggressive for recoverable failures like bad credentials" },
                    { label: "Box<dyn>", reason: "loses the structured information needed for telemetry" },
                  ],
                },
                {
                  uuid: "mem-002",
                  type: "attempt" as const,
                  title: "async pipeline for token refresh — abandoned (race conditions)",
                  body: "Tried wiring TokenSigner through an async refresh pipeline so the verify path could lazily renew expired tokens. Two threads ended up signing simultaneously when a request arrived just after expiry, producing valid-but-mutually-stale token pairs. Reverted to synchronous refresh on the request path.",
                  date: "2026-01-15",
                  authored_by: "agent:claude",
                  session: "2026-01-15",
                  evidence: [
                    { kind: "code" as const, uri: "code:entity/8f2e7a3c · AuthService.refresh_token()" },
                  ],
                },
                {
                  uuid: "mem-003",
                  type: "note" as const,
                  title: "all handler methods follow verb_resource naming pattern",
                  body: "Pattern recurs across the module: authenticate_user, refresh_token, verify_signature, revoke_session. Worth preserving when adding new methods.",
                  date: "2026-02-04",
                  authored_by: "agent:claude",
                },
                {
                  uuid: "mem-004",
                  type: "decision" as const,
                  title: "throw on bad credentials, log inside service",
                  date: "2026-01-12",
                  superseded_by: "mem-001",
                },
              ],
              children: [
                {
                  uuid: "fn-001", name: "authenticate", fqn: "backend.auth.auth_service.AuthService.authenticate",
                  kind: "function" as const, file: "backend/auth/auth_service.py", line_start: 42, line_end: 78,
                  memories: [
                    {
                      uuid: "mem-005", type: "note" as const,
                      title: "rate limit bucket is per-IP, not per-user (intentional)",
                      date: "2026-04-29", authored_by: "agent:claude",
                    },
                  ],
                },
                {
                  uuid: "fn-002", name: "refresh_token", fqn: "backend.auth.auth_service.AuthService.refresh_token",
                  kind: "function" as const, file: "backend/auth/auth_service.py", line_start: 80, line_end: 110,
                  memories: [],
                },
                {
                  uuid: "fn-003", name: "verify_signature", fqn: "backend.auth.auth_service.AuthService.verify_signature",
                  kind: "function" as const, file: "backend/auth/auth_service.py", line_start: 112, line_end: 145,
                  memories: [],
                },
              ],
            },
            {
              uuid: "1c2d3e4f",
              name: "TokenSigner",
              fqn: "backend.auth.token_signer.TokenSigner",
              kind: "class" as const,
              file: "backend/auth/token_signer.py",
              line_start: 14,
              line_end: 92,
              memories: [],
            },
            {
              uuid: "5a6b7c8d",
              name: "UserStore",
              fqn: "backend.auth.user_store.UserStore",
              kind: "class" as const,
              file: "backend/auth/user_store.py",
              line_start: 22,
              line_end: 168,
              memories: [],
            },
          ],
        },
        {
          name: "users",
          path: "backend/users",
          children: [
            {
              uuid: "9e8d7c6b",
              name: "UserGateway",
              fqn: "backend.users.gateway.UserGateway",
              kind: "class" as const,
              file: "backend/users/gateway.py",
              line_start: 42,
              line_end: 120,
              memories: [
                {
                  uuid: "mem-006", type: "note" as const,
                  title: "duplicate-email race solved by unique index",
                  date: "2026-03-08", authored_by: "agent:claude",
                },
              ],
            },
          ],
        },
        {
          name: "memory",
          path: "backend/memory",
          children: [],
        },
      ],
    },
  ],
  tombstoned: [
    {
      uuid: "c40b9a18",
      name: "LegacyAuthService",
      fqn: "backend.auth.legacy_auth_service.LegacyAuthService",
      kind: "class" as const,
      file: "backend/auth/legacy_auth_service.py",
      tombstoned: true,
      deleted_at: "2026-03-15",
      previous_name: "AuthV1",
      memories: [
        {
          uuid: "mem-007", type: "decision" as const,
          title: "throw on bad credentials, log inside service",
          body: "Original auth pattern — superseded by current AuthService policy of returning Result<T, AuthError>. Kept here as historical context.",
          date: "2026-01-12", authored_by: "agent:claude",
        },
        {
          uuid: "mem-008", type: "attempt" as const,
          title: "tried sharing a connection pool with the gateway — caused deadlocks",
          body: "Deadlocked under load when both services wanted exclusive locks on overlapping users. Backed out; each service now manages its own pool.",
          date: "2025-11-20", authored_by: "agent:claude",
        },
      ],
    },
    {
      uuid: "deadbeef",
      name: "OldTokenService",
      fqn: "backend.auth.old_token_service.OldTokenService",
      kind: "class" as const,
      tombstoned: true,
      deleted_at: "2026-02-22",
      memories: [],
    },
  ],
  orphans: [
    {
      uuid: "mem-orphan-1",
      type: "decision" as const,
      title: "throw on bad credentials, log inside service",
      date: "2026-01-12",
      applies_to_name: "LegacyAuthService",
      candidates: [
        { uuid: "8f2e7a3c", name: "AuthService", fqn: "backend.auth.auth_service.AuthService", file: "backend/auth/auth_service.py", line: 24, confidence: 0.92 },
        { uuid: "5a6b7c8d", name: "UserStore",   fqn: "backend.auth.user_store.UserStore",       file: "backend/auth/user_store.py",   line: 22, confidence: 0.41 },
        { uuid: "9e8d7c6b", name: "UserGateway", fqn: "backend.users.gateway.UserGateway",        file: "backend/users/gateway.py",      line: 42, confidence: 0.18 },
      ],
    },
    {
      uuid: "mem-orphan-2",
      type: "attempt" as const,
      title: "tried sharing a connection pool with the gateway",
      date: "2025-11-20",
      applies_to_name: "LegacyAuthService",
      candidates: [
        { uuid: "9e8d7c6b", name: "UserGateway", fqn: "backend.users.gateway.UserGateway", file: "backend/users/gateway.py", line: 42, confidence: 0.41 },
      ],
    },
  ],
};

const PHASE5_CHAT = [
  { role: "user" as const, content: "let's add rate limiting to the auth service" },
  { role: "assistant" as const, content: "Looking at AuthService — there's a Decision attached from Jan 31 about using Result<T, AuthError> throughout this module. Rate-limit errors should follow the same pattern rather than throwing — keeps callers able to match on AuthError::RateLimited." },
  { role: "user" as const, content: "good plan" },
  { role: "assistant" as const, content: "I'll add a RateLimiter in backend/auth/rate_limiter.py, wire it into authenticate(), and surface AuthError::RateLimited as a Result variant. After that I'll record the decision so future sessions see the rationale." },
];

const SCENARIOS: Record<string, Scenario> = {
  "phase5-memory": {
    initial: PHASE5_GRAPH,
  },
  "viewer": {
    initial: {
      sources: {},
    },
  },
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
      workingDir: "/demo",
      resumed: true,
      providers: [{ name: "padarax", type: "api", model: "demo", capabilities: { streaming: false, tool_use: false, vision: false } }],
      defaultProvider: "padarax",
    });

    if (key === "phase5-memory") {
      ws.injectEvent("nkrdn-graph", PHASE5_GRAPH as any);
      ws.injectEvent("file-tree", { type: "file-tree", data: [] });
      ws.injectEvent("chat-history", { type: "chat-history", messages: PHASE5_CHAT });
      return;
    }

    ws.injectEvent("dashboard-data", scenario.initial);
    ws.injectEvent("chat-history", { type: "chat-history", messages: DEMO_CHAT });

    if (key === "viewer") {
      ws.injectEvent("dashboard-config", {
        type: "dashboard-config",
        config: {
          dashboard: { title: "Demo" },
          data_sources: {},
          views: [],
          stats: [],
          extra_roots: [
            { name: "common-knowledge", path: "../common-knowledge", label: "common-knowledge", default: true },
            { name: "padarax", path: "../padarax", label: "padarax" },
            { name: "design-system", path: "../design-system", label: "design-system" },
            { name: "shared-types", path: "../shared-types", label: "shared-types" },
          ],
        },
      });
      ws.injectEvent("file-tree", { type: "file-tree", data: [] });
      ws.injectEvent("file-content", {
        type: "file-content",
        path: "docs/dockside-inn.md",
        content: VIEWER_MD,
        fileType: "markdown",
      });
    }

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
