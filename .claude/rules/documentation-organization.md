# Documentation Organization Rules

This project uses a structured documentation system with clear separation of concerns. Follow these rules to maintain consistency.

## Directory Structure

### `docs/technical/` - Technical Documentation

For **implemented** systems and features. Contains API references, architecture docs, and developer guides.

**Structure:**

```
docs/technical/
├── README.md           # Navigation hub
├── core/               # Essential developer docs
├── reference/          # API documentation
└── design/             # Design rationale (the "why")
```

**When to add here:**
- System is implemented and working
- API is stable and documented
- Design decisions are finalized

### `docs/future/` - Future Development

For **planned** features, improvements, and roadmap items.

**Key Files:**
- `README.md` - Main roadmap overview
- `blocking-issues.md` - Critical issues that block development progress
- Feature-specific planning docs

**When to add here:**
- Large features pushed to future development
- System improvements not immediately planned
- Features awaiting design finalization

### `docs/user/` - User Documentation

For **end-user** documentation.

**Purpose:**
- Usage guides and tutorials
- Feature explanations for users
- How-to guides

**When to add here:**
- Documentation meant for end users, not developers
- Explanations of features and workflows
- User-facing documentation

### `docs/README.md` - Root Navigation

The root `docs/README.md` serves as the **main entry point** for all documentation:
- Links to all major sections
- Overview of documentation structure
- Quick navigation for different audiences (users vs developers)

### `docs/plans/` - Active Development

For **active planning** and development tasks.

**When to use:**
- Quick planning during active development
- Work-in-progress design documents
- Brainstorming and exploration
- Sprint-level task planning

**Lifecycle:**
1. Create plan in `docs/plans/` during development
2. When complete -> integrate into `docs/technical/`
3. If large/deferred -> move to `docs/future/`
4. Delete completed/obsolete plans

## Keeping Docs Maintained

Docs are maintained as part of the work, with no approval step (Gary, 25 Nov 2026: "docs should always be maintained, but when its actually built, not before, plans are for before, then they get real docs").

- **When something is built, document it.** Write or update the doc in `docs/technical/` in the same piece of work as the code, and `docs/user/` when users are affected. Do not ask first and do not leave it for a later session.
- **Only what is built.** A doc in `docs/technical/` describes code that exists. Intent, designs and work not yet started belong in `docs/plans/`. When the code lands, the plan's durable content moves to the real doc and the plan shrinks or is deleted.
- **Say what was not verified.** If something is built but has not yet run in the real app, the doc can say so; that is still documenting what exists.
- **The roadmap's direction is Gary's.** Recording in `docs/future/` that something shipped, or moving its detail out, needs no approval. Adding a major feature to the roadmap, dropping one or changing priorities is a product decision: raise it with him.

## Key Principles

### 1. Separation of Concerns

Each document should focus on ONE system or area:
- Don't mix unrelated topics in one doc
- Group related issues in appropriate docs

### 2. Document Lifecycle

```
                docs/plans/                     docs/future/
                (active dev)                    (deferred)
                     |                            |
                     | complete                   | large feature
                     v                            | deferred
              docs/technical/  <------------------+
              (implemented)        when implemented
```

### 3. Blocking Issues

`docs/future/blocking-issues.md` is special:
- Contains issues that **must be resolved** before roadmap progress
- Should include detailed implementation plans
- Clear priority and impact for each issue
- Once fixed -> remove from blocking issues

### 4. Roadmap Changes

The main roadmap (`docs/future/README.md`) is updated freely to reflect what has shipped. What it plans (new major features, priorities, removals) is Gary's decision; see [[#Keeping Docs Maintained]].

## Formatting Standards

### File Naming

- Use kebab-case: `cli-conventions.md`
- Be descriptive: `tmux-integration-design.md`
- Avoid numbers unless for explicit ordering: `01-architecture.md`

### Document Structure

Each document should have:
1. YAML frontmatter (title, created, updated, status, tags)
2. Overview section
3. Clear sections by topic
4. "See Also" with cross-references

### Obsidian Compatibility

- Blank line before all tables
- Use `[[internal-links]]` for cross-references
- Use callouts: `> [!NOTE]`, `> [!WARNING]`
- Include proper frontmatter

## Cross-References

### When to Link

- Related systems that interact
- Prerequisites for understanding
- Implementation details in code

### Link Format

- Internal docs: `[[path/to/file]]` or `[[path/to/file#section]]`
- Source code: `[FileName](relative/path/file.ext:line)`

## Maintenance

### Regular Reviews

- Check `docs/plans/` for completed items -> move or delete
- Check `blocking-issues.md` for resolved issues -> remove
- Update cross-references when files move

### Before Adding Content

Ask:
1. Is this implemented? -> `docs/technical/`
2. Is this active development? -> `docs/plans/`
3. Is this future work? -> `docs/future/`
4. Does a relevant doc already exist? -> Add to it
5. Does this belong with other similar issues? -> Group appropriately
