# nkrdn — Code Knowledge Graph

nkrdn indexes code structure (symbols, relationships, inheritance) and project documentation into a queryable knowledge graph. A unified workspace graph at `~/.nkrdn/workspace/graph.ttl` covers all indexed repos. Use it to orient before reading source.

## When to Use

| Question type | Do this |
|---|---|
| **Design/conceptual** — "How does X work?", "Why is X designed this way?" | `nkrdn search "X" --source docs` → read the design doc → verify in code |
| **Structure/relationships** — "What depends on X?", "What would break if I changed X?", "What does X inherit?", "How is the code organized?" | `nkrdn lookup X` → then `usages`, `details`, `tree`, or `scope` as needed |
| **Cross-project** — "What repos use this?", "What changed across projects?" | `nkrdn workspace diff --since 7d` or query the workspace graph directly |
| **Location/implementation** — "Find where X is", "How is X implemented?" | Grep or Read directly — nkrdn has structure, not code |

## Commands

| Command | Purpose |
|---|---|
| `search "query"` | Search code symbols + documentation |
| `search "query" --source docs` | Search documentation only |
| `search "query" --source code` | Search code symbols only |
| `lookup <name>` | Find symbols by name (returns URIs) |
| `details <uri>` | Relationships, inheritance, containment for a symbol |
| `usages <uri>` | Everything that depends on a symbol |
| `scope <name>` | Explore a namespace or package (auto-detects) |
| `module <name>` | List contents of a module |
| `tree <uri>` | Full inheritance hierarchy |
| `stats` | Entity counts and graph overview |
| `context <filepath>` | Code structure + related docs for a file |

## Workspace Commands

| Command | Purpose |
|---|---|
| `workspace init <root>` | Discover git repos under a directory, create workspace config |
| `workspace rebuild` | Rebuild all repos (incremental by default) |
| `workspace rebuild <name>` | Rebuild a single repo |
| `workspace rebuild --full` | Force full rebuild (ignore caches) |
| `workspace diff --since 7d` | Changes across all repos (accepts durations: 7d, 24h, 2w or ISO dates: 2026-03-15) |
| `workspace diff --since 7d --json` | JSON output for programmatic use |
| `workspace list` | Show repos and their index status |

The workspace graph is one graph with per-repo named graphs. Running `nkrdn` from inside a project queries the workspace graph but prioritises the current repo's symbols. Cross-repo dependency edges are resolved transparently.

## Budget

1-3 nkrdn calls for orientation, then switch to Grep/Read for the rest. Spending more than ~25% of your turns on nkrdn calls means you're over-exploring the graph.
