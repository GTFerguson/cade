---
title: nkrdn agent-memory Phase 2 — Markdown ingestion
created: 2026-04-28
status: in-flight
---

# Resume: ingest `.cade/memory/*.md` files as `mem:*` triples in the nkrdn graph

## Active plans

- **Phase plan**: `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — Phase 2 spec (Markdown ingestion section). Phase 1a+1b are marked shipped; Phase 2 is the next block.
- **Evidence base**: `/home/gary/projects/cade/docs/reference/agent-memory-systems.md`

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Execute** — read this file first, then resume the Next actions below.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

Phase 2 shipped in nkrdn commit `bbb6712`. Three new modules:

- `src/nkrdn/parsers/memory/parser.py` — frontmatter → mem:* triples
- `src/nkrdn/parsers/memory/resolver.py` — wiki-link → symbol UUID
- `src/nkrdn/parsers/memory/__init__.py` — `ingest_memory_triples()` entry point
- `src/nkrdn/cli/rebuild.py` — Phase 2.5 pass wired in before `backend._save()`
- `tests/parsers/memory/` — 24 tests, all passing

Key design detail: the docs frontmatter parser strips `[[Name]]` outer brackets into a list item `[Name]`; the `_extract_wikilink_names` function handles both `[[Name]]` and `[Name]` forms.

## Worktree / branch

- nkrdn path: `/home/gary/projects/nkrdn` (main branch, 21 commits ahead of origin — not yet pushed)
- cade path: `/home/gary/projects/cade` (main branch, 11 commits ahead of origin — not yet pushed)
- nkrdn last commit: `1b30581 nkrdn: hoist and_ import to module scope in graph_constructor`
- cade last commit: `4dbc5a3 Docs: graduate Phase 1a/1b handoff — mark shipped in plan, delete handoff`

## Shipped this session (context for where Phase 1 left off)

nkrdn:
- `0d52287` Phase 1a: stable identity end-to-end (UUID-keyed entities, within-file rename matcher)
- `264127f` CHANGELOG migration note
- `36da615` Phase 1b: soft tombstoning
- `1b30581` Fix: hoist `and_` import to module scope in graph_constructor

cade:
- `7bc5cf4` Plan + reference docs reorg, handoff doc
- `4dbc5a3` Graduate Phase 1a/1b handoff; mark shipped in plan

## In flight (uncommitted work)

None. Both repos are clean.

## Next actions (ordered)

1. ~~Orient with the existing docs parser~~ ✓
2. ~~Define the `.cade/memory/` file format~~ ✓
3. ~~Implement `parsers/memory/parser.py` in nkrdn~~ ✓
4. ~~Wire wiki-link resolution~~ ✓
5. ~~Integrate into rebuild pipeline~~ ✓
6. ~~Tests (24 unit tests)~~ ✓
7. **Update CHANGELOG** — add Phase 2 entry to `nkrdn/CHANGELOG.md`.
8. **Smoke test** — create a `.cade/memory/` test file, run `nkrdn workspace rebuild nkrdn --full`, verify `mem:*` triples appear in graph (`NKRDN_GRAPH_FILE=~/.nkrdn/workspace/repos/nkrdn/graph.ttl nkrdn lookup <something>`).
9. **Graduate plan** — once smoke tested: extract design decisions to `docs/architecture/`, delete this handoff.

## Key design decisions (from plan; to be validated/revised during Phase 2)

- **Storage location**: `.cade/memory/` (gitignored by default). Files belong to the repo but aren't committed unless the user opts in.
- **Wiki-link resolution via name index**: Phase 1 name index = `symbols` table `(repository_name, fqn)`. Look up `[[Name]]` by `rdfs:label` in graph, or by FQN suffix match in DB. Store resolved UUID as `mem:resolvedTarget`; keep raw link text for human readability.
- **Ambiguous names**: log + store `mem:unresolvedLink` literal; attempt re-resolution on every rebuild (the plan doc is explicit about this).
- **Triple namespace**: `http://nkrdn.knowledge/memory#` (prefix: `mem:`). Already defined in the plan; don't change without updating the plan.
- **Ingestion as a separate pass** (not interleaved with code parse) — code graph must be stable before memory links can resolve.

## Files touched / to touch

nkrdn — new:
- `/home/gary/projects/nkrdn/src/nkrdn/parsers/memory/__init__.py`
- `/home/gary/projects/nkrdn/src/nkrdn/parsers/memory/parser.py` — frontmatter → triples
- `/home/gary/projects/nkrdn/src/nkrdn/parsers/memory/resolver.py` — wiki-link → UUID

nkrdn — existing, to extend:
- `/home/gary/projects/nkrdn/src/nkrdn/parsers/docs/parser.py` — `parse_frontmatter()` (reuse or wrap)
- `/home/gary/projects/nkrdn/src/nkrdn/cli/rebuild.py` — add memory ingestion pass after graph build

nkrdn — tests:
- `/home/gary/projects/nkrdn/tests/parsers/memory/` — new directory

cade (CADE writes the memory files; nkrdn reads them):
- `/home/gary/projects/cade/.cade/memory/` — runtime dir, gitignored; no code changes yet

## Build & verify

```bash
# Run full parser + graph suites (project venv)
cd /home/gary/projects/nkrdn && \
~/.local/share/nkrdn-venv/bin/python -m pytest tests/graph/builder/ tests/parsers/ --no-header -q

# Smoke test after implementing: force-rebuild nkrdn itself
nkrdn workspace rebuild nkrdn --full
NKRDN_GRAPH_FILE=~/.nkrdn/workspace/repos/nkrdn/graph.ttl nkrdn lookup <SymbolName>
```

## Gotchas

- **`hatch` not installed** in default shell. Use `~/.local/share/nkrdn-venv/bin/python` for all test runs.
- **Graph builder tests need rdflib** — system python3 errors on graph imports; use the project venv.
- **`and_` import in graph_constructor** was only locally available in one method; now hoisted to module scope (`from sqlalchemy import select, and_`). Don't regress this — add module-level imports, not local ones.
- **`nkrdn lookup` reads the local `.nkrdn/graph.ttl` first** (if it exists) — use `NKRDN_GRAPH_FILE=~/.nkrdn/workspace/repos/<repo>/graph.ttl` to point at the workspace graph when local graph is stale.
