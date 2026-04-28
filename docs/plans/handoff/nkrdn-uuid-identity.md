---
title: nkrdn UUID-keyed entity identity (Phase 1a of agent-memory)
created: 2026-04-28
status: in-flight
---

# Resume: finish UUID-keyed identity migration in nkrdn so memory edges survive code rename/move

## Active plans

- **Phase plan**: `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — load-bearing for all later phases. The "Phase 1 — nkrdn schema changes" section now contains the concrete design decisions made in this session.
- **Evidence base**: `/home/gary/projects/cade/docs/reference/agent-memory-systems.md`, `/home/gary/projects/cade/docs/future/agent-memory.md`.

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Execute** — read this file first, then resume the Next actions below.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

Phase 1a is functionally complete in nkrdn: schema columns, migration helper, UUID minting in DB upserts, within-file rename matcher, **and the graph layer now emits stable-id-keyed URIs end-to-end** (task #11 from the previous session — done). All in-process URI sites in graph_constructor + summary_generation_service + entity_processing_service now prefer `stable_id` and fall back to FQN-keyed URIs only for pre-migration databases. The reconstruction-from-FQN fallback in cross_reference_builder is removed.

Open work for Phase 1b / closeout:

- **#6 Soft tombstoning**: `delete_symbols_not_in` still hard-deletes. Schema column is in place; switching to `tombstoned_at` UPDATE requires auditing every `select(symbols)` site so dead rows don't leak into RDF projection.
- **#7 Sanity-check `nkrdn lookup`**: queries `rdfs:label` / `code:fullyQualifiedName` properties not URIs, so it should still work — but verify against a freshly-rebuilt graph.
- **#8 `nkrdn delta show` memory_affected section**: surface which mem:* edges (when they exist) are touched by a rebuild's delta.
- **#9 Migration doc**: CHANGELOG / README note that existing graphs need `nkrdn rebuild --force` once.
- **Cross-file move (tier 2)**: deferred. Needs a coordinator that sees all files in one rebuild pass.

## Worktree / branch

- Path: `/home/gary/projects/nkrdn` (changes are in nkrdn repo, NOT cade — the plan doc edited in this session lives in cade)
- Branch: nkrdn = current default; cade = `main`
- Last commit (nkrdn): `fa62c44 nkrdn: structural embeddings, incremental fix, test fixes, docs reorganise`
- Last commit (cade): `d06c2b2 Modes registry, nested-agent orchestration, reference docs`

## Shipped this session

Nothing committed. All work is in working tree across both repos.

## Shipped previous session (URI migration end-to-end, task #11)

All in nkrdn working tree; nothing committed yet.

- `src/nkrdn/graph/builder/graph_constructor.py` — `_symbols_to_triples` now picks the module URI from `file_info["stable_id"]` (legacy FQN fallback retained); builds a per-file `local_fqn_to_stable_id` map and threads it into `_symbol_to_triples` so parent-class and parent-namespace URIs use stable_ids; `_symbol_to_triples` emits the symbol URI from `symbol["stable_id"]`. `build_cross_references` now also pulls `stable_id` for every file + non-import symbol up-front, builds `module_stable_ids` (module_fqn → stable_id) and `symbol_stable_ids` ((kind, fqn) → stable_id), and emits all 6 cross-file URIs (C++ include target + module-pair, Python import target + module-pair) via local `_module_uri()` / `_symbol_uri()` helpers.
- `src/nkrdn/graph/builder/summary_generation_service.py` — `_summarize_class` and `_get_module_uri` prefer `entity["stable_id"]` for class + module URIs. Package URI unchanged (packages don't carry `stable_id` in Phase 1a).
- `src/nkrdn/graph/builder/entity_processing_service.py` — rolled-back stable_id branch restored at the top of `get_entity_uri`. Legacy FQN path retained for pre-migration DBs.
- `src/nkrdn/graph/builder/cross_reference_builder.py` — strategy 3 (FQN reconstruction at the old lines 617–645) deleted; replaced with a short comment + cache-miss return. Strategies 1 (SPARQL by `rdfs:label`) and 2 (FQN containment) still work because they query whatever URI is actually in the graph.
- `tests/graph/builder/test_uri_identity_across_rename.py` — NEW. Two tests: (1) symbol URI survives `m.foo → m.fooz` rename via `carry_stable_ids_forward`; (2) module URI is stable across rebuilds with churning symbol set.

Validation: 874 passed, 8 skipped, 4 xfailed, 82 xpassed across `tests/graph/builder/` + `tests/parsers/code/` (the 82 xpasses are pre-existing SPARQL-injection tests unrelated to this change). The two new identity tests pass.

## In flight (uncommitted work)

**nkrdn** (`/home/gary/projects/nkrdn`):
- `src/nkrdn/parsers/code/storage/schema.py` — added `stable_id`, `first_seen`, `tombstoned_at` to `files`; added `stable_id`, `first_seen`, `previous_fqn`, `moved_from_file_id`, `tombstoned_at` to `symbols`. All nullable, indexed where appropriate.
- `src/nkrdn/parsers/code/storage/db.py` — added `_new_stable_id()`, `_now_iso()`, `migrate_identity_columns()`, `_ensure_identity_fields()`, `get_active_symbols_for_file()`, `_signature_shape()`, `carry_stable_ids_forward()`. Updated `upsert_file`, `upsert_symbol`, `_upsert_symbols_bulk_postgresql`, `_upsert_symbols_bulk_sqlite` to mint/preserve `stable_id`. `delete_symbols_not_in` still hard-deletes (deferred).
- `src/nkrdn/parsers/code/storage/__init__.py` — re-exported `migrate_identity_columns`, `carry_stable_ids_forward`.
- `src/nkrdn/parsers/code/file_processor.py` — imports new helpers; calls `migrate_identity_columns(self.engine)` in `__init__`; runs `carry_stable_ids_forward()` before `delete_symbols_not_in()` + `upsert_symbols_bulk()`; expanded `_SCHEMA_KEYS` allowlist to include identity columns.
- `src/nkrdn/parsers/code/symbol_table_builder.py` — `initialize_database()` now calls `migrate_identity_columns()`.
- `src/nkrdn/graph/builder/uri_factory.py` — added `create_entity_uri(type, stable_id)` (UUID-keyed) and `create_uri_from_row(type, row)` (prefers stable_id, falls back to FQN). Legacy `create_uri(type, identifier)` retained.
- `tests/parsers/code/test_stable_identity.py` — NEW. 6 tests covering mint/preserve/rename/dissimilar/migration-idempotency/signature-shape robustness.

**cade** (`/home/gary/projects/cade`):
- `docs/plans/nkrdn-agent-memory.md` — added "Design decisions" subsection under Phase 1 with concrete decisions made this session (UUID4, URI shape, name-index location, matcher tier scope, signature-shape definition, deferred items).

## Next actions (ordered)

URI migration (the previous session's task #11) is done. Remaining work:

1. **Commit and push.** Two repos to handle separately:
   - nkrdn working tree spans the Phase 1a foundation (storage/db.py, file_processor, schema, URIFactory) **plus** the URI migration just shipped (graph_constructor, summary_generation_service, entity_processing_service, cross_reference_builder, plus the new `tests/graph/builder/test_uri_identity_across_rename.py`). One coherent commit per logical phase, or one bundled "Phase 1a: stable identity end-to-end" — caller's choice.
   - cade working tree edits live only in `docs/plans/nkrdn-agent-memory.md` (design decisions section) and the doc reorg (`docs/future/agent-memory.md`, `docs/reference/agent-memory-systems.md`, `docs/reference/README.md`, deletion of the old per-phase folder). Plus this handoff file.

2. **Sanity-check `nkrdn lookup` against a real rebuilt graph.** Pick any nkrdn-indexed repo, force-rebuild it, then run `nkrdn lookup <SymbolName>` and confirm it still returns hits. The query is `?s rdfs:label "..."` — the property is unchanged, so this should be a formality, but it's worth eyeballing.

3. **Phase 1b — soft tombstoning.** Switch `delete_symbols_not_in` from a DELETE to an UPDATE that sets `tombstoned_at = now`. Then audit every `select(symbols)` site (grep across `src/nkrdn/`) and add `WHERE tombstoned_at IS NULL` so tombstoned rows never reach the RDF projection. The schema column already exists and is indexed.

4. **Migration doc.** A short note in `nkrdn/CHANGELOG.md` (or README) telling existing users to run `nkrdn rebuild --force` once after upgrading to pick up stable-id URIs. No `mem:*` edges exist yet so no data is at risk — only the URIs change.

5. **`nkrdn delta show` memory_affected section.** When `mem:*` edges land in a later phase, the delta viewer should surface which memory edges are touched. Out of scope for Phase 1a but logged here so it isn't lost.

6. **Cross-file move detector (tier 2).** Today the matcher only catches within-file renames. Cross-file moves need a coordinator with all-files visibility — out of scope for `file_processor`. Defer until there's a concrete user need.

7. **Graduate this handoff.** Once steps 1–4 ship, the handoff has served its purpose. Lift any durable design knowledge into `docs/architecture/` (in nkrdn or cade as appropriate) and `rm` this file.

## Key design decisions

- **UUID4 random hex**, not content-hash — content-hash defeats the purpose; identity must survive content edits.
- **URI shape**: `<ns>repo/{repo}/{type}/{uuid}>` — keeps the type segment for grep-ability of raw turtle output.
- **Name index lives in the symbols table itself** — adding `stable_id` as a column on the existing `(repo, fqn)` unique-indexed table means lookup is a SQL query on the existing index. No new table, no second source of truth.
- **Matcher runs before delete, not after** — that's why hard-delete is still acceptable in Phase 1a. The rename matcher (`carry_stable_ids_forward`) snapshots active rows for the file, matches new FQNs against soon-to-be-deleted ones by `(kind, param_count, return_type)`, carries `stable_id` forward into the upsert payload. Delete then runs against rows that have already had their identity transferred.
- **Tombstoning deferred to Phase 1b** — switching `delete_symbols_not_in` to a `tombstoned_at` UPDATE requires auditing every `select(symbols)` site so dead rows don't leak into RDF projection. Schema column is in place for the future flip.
- **Cross-file move (tier 2 with module change) deferred** — needs a higher-level coordinator that sees all files in one rebuild pass; per-file `file_processor` doesn't have that view. Tier 1 (exact match), tier 3 (within-file rename), tier 4 (mint new) are live.
- **"Similar signature"** = `(parameter_count, return_type_name)` from `signature_json`. `_signature_shape()` parses both `parameters`/`params` and `return_type`/`returnTypeName` keys (nkrdn extractors are inconsistent across languages).
- **Migration is non-destructive** — `migrate_identity_columns()` ALTER-TABLE-ADD-COLUMN with `PRAGMA table_info` to detect missing columns. Idempotent. Postgres path is a no-op (assume Alembic in real deployments).

## Files touched / to touch

- nkrdn schema/DB:
  - `/home/gary/projects/nkrdn/src/nkrdn/parsers/code/storage/schema.py` — done
  - `/home/gary/projects/nkrdn/src/nkrdn/parsers/code/storage/db.py` — done
  - `/home/gary/projects/nkrdn/src/nkrdn/parsers/code/storage/__init__.py` — done
- nkrdn pipeline:
  - `/home/gary/projects/nkrdn/src/nkrdn/parsers/code/file_processor.py` — done
  - `/home/gary/projects/nkrdn/src/nkrdn/parsers/code/symbol_table_builder.py` — done
- nkrdn URI / graph:
  - `/home/gary/projects/nkrdn/src/nkrdn/graph/builder/uri_factory.py` — done; `create_entity_uri` / `create_uri_from_row` added and callers use them
  - `/home/gary/projects/nkrdn/src/nkrdn/graph/builder/graph_constructor.py` — done; module URI from `file_info["stable_id"]`, symbol URI from `symbol["stable_id"]`, parent class/namespace URIs via per-file `local_fqn_to_stable_id`, cross-ref URIs via `_module_uri` / `_symbol_uri` helpers backed by `module_stable_ids` + `symbol_stable_ids`
  - `/home/gary/projects/nkrdn/src/nkrdn/graph/builder/summary_generation_service.py` — done; `_summarize_class` and `_get_module_uri` flipped
  - `/home/gary/projects/nkrdn/src/nkrdn/graph/builder/entity_processing_service.py` — done; rollback restored
  - `/home/gary/projects/nkrdn/src/nkrdn/graph/builder/cross_reference_builder.py` — done; strategy 3 reconstruction removed
- Tests:
  - `/home/gary/projects/nkrdn/tests/parsers/code/test_stable_identity.py` — done (6 tests, from previous session)
  - `/home/gary/projects/nkrdn/tests/graph/builder/test_uri_identity_across_rename.py` — done (2 tests covering symbol URI survival across rename + module URI stability across rebuilds)
- Plan:
  - `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — done; design decisions captured (previous session)

## Build & verify

The project venv at `~/.local/share/nkrdn-venv/` has `rdflib` installed, so the graph builder tests can run there. System python3 with `PYTHONPATH=src` works for parser/storage tests but errors out on graph imports.

```
# Full parser + graph suites (in project venv)
cd /home/gary/projects/nkrdn && \
~/.local/share/nkrdn-venv/bin/python -m pytest tests/graph/builder/ tests/parsers/code/ --no-header -q

# Just the new identity tests
~/.local/share/nkrdn-venv/bin/python -m pytest \
  tests/graph/builder/test_uri_identity_across_rename.py \
  tests/parsers/code/test_stable_identity.py -v
```

Currently green: 874 passed across both suites (previous session validated 230 in the parser-only subset). The 82 xpasses are pre-existing SPARQL-injection tests, unrelated.

## Gotchas encountered

- **SQLAlchemy `executemany` requires uniform key sets across rows in the batch.** When the matcher populates `previous_fqn` on one row but not others, the bulk INSERT fails with `InvalidRequestError: A value is required for bind parameter 'previous_fqn'`. Fix: `_ensure_identity_fields()` pads `previous_fqn`, `moved_from_file_id`, `first_seen`, `tombstoned_at` to `None` on every row before the batch executes.
- **`hatch` is not installed in the default shell** — CLAUDE.md says nkrdn uses hatch but `hatch run python …` fails. The project venv at `~/.local/share/nkrdn-venv/bin/python` has `rdflib` installed and is the right environment for running graph-builder tests.
- **Half-migrating URI generation breaks the system silently.** If `entity_processing_service.get_entity_uri` emits UUID URIs but `graph_constructor` still emits FQN URIs, AI summaries get attached to URIs with no entity. This was the rollback we had in place pre-task-#11; it has now been re-flipped together with the graph_constructor migration. **If you re-introduce a half-migration, expect to see "no triples to attach to" warnings rather than overt failures.**
- **`cross_reference_builder.py` strategy 3 (FQN reconstruction)** has been removed. It can't reconstruct UUID URIs by definition. Strategies 1 (`rdfs:label`) and 2 (FQN containment) still work because they query the graph for whatever URI is actually stored.
- **Parent-class / parent-namespace URIs are looked up via a per-file map**, not the repo-wide identity index. This is fine because containment is always within-file in nkrdn's model — but if the model ever extends to cross-file containment, the map will need to widen.
