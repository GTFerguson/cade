---
title: GM viewers — unified cross-refs backlog
created: 2026-05-04
updated: 2026-06-01
status: backlog
tags: [plan, gm-dashboard, crossrefs, cade]
---

# GM viewers — unified cross-refs backlog

The only still-live entry from the old 2026-05-04 work queue (the rest was
shipped work, now recorded in git + the architecture docs). Kept as a standalone
backlog because no dedicated plan doc survives for it.

> [!NOTE]
> **This is CADE-side work.** The cross-ref viewer lives in CADE's
> `frontend/src/dashboard/components/entity-detail.ts` and
> `frontend/src/padarax/knowledge-refs.ts`, not in this repo. The contract these
> items build against is [[../architecture/gm-dashboard-plugin-contract]]. If
> this backlog gets picked up, the implementation lands in `~/projects/cade/`
> and backports via the subtree mechanism — see the CLAUDE.md two-clients note.

## Remaining items

Item 1 (NPC location cross-ref) shipped and graduated to
[[../architecture/gm-dashboard-plugin-contract]]. What's left:

Item 4 (`#room=<id>` fragment focus) also shipped, out of order: `padarax/sections/npc.ts`
fires the fragment and `tabs/project-context.ts` parses it. What's left:

- **Item 0** — unified "related entities" cross-ref panel in existing panels.
- **Item 2** — item cross-ref: search an item → all entity references to it.
- **Item 3** — place cross-ref: search a place → all entity references to it.
- **Item 5** — extract shared cross-ref primitives to the shared frontend core.
- **Item 6** — pending-refs **mention-count** view: rank unresolved `@ref` stubs by how
  often they are referenced, so authoring can be prioritised by demand. A mention-count
  CLI report already exists in `tools/validate_content.py`; this is the dashboard surface
  over it. (Carried over from the retired `history-viewer-and-knowledge-query` plan, whose
  other scope shipped and graduated to `docs/architecture/npc-knowledge-access.md`.)

The stated "work the items in order" was never honoured (item 4 shipped before 0/2/3), so
treat the numbering as labels, not sequence. Design rationale is in the plugin-contract
architecture doc in the Padarax repo.
