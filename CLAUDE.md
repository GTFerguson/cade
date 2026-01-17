# Agent Onboarding Guide

Quick orientation for AI agents working on ccplus. This is a signpost document - detailed information lives in the referenced docs.

> [!NOTE]
> "ccplus" is a working name. The project will be renamed once the vision is clearer.

## Project Identity

ccplus is a unified terminal environment combining tmux, vim, and Claude Code into a cohesive development experience. The goal is to create a seamless CLI/TUI workflow where these tools integrate naturally rather than operating as separate programs.

## Codebase Orientation

```
ccplus/
├── docs/                    # Maintained documentation (approval required)
│   ├── README.md            # Navigation hub
│   ├── technical/           # Implemented systems
│   │   ├── core/            # Architecture, getting started
│   │   ├── reference/       # API documentation
│   │   └── design/          # Design rationale
│   ├── future/              # Roadmap & planned features
│   └── user/                # End-user documentation
├── plans/                   # Active development notes (no approval needed)
├── .roo/rules/              # Project-specific conventions
└── CLAUDE.md                # This file
```

## Documentation Navigation

| Need to understand... | Read |
|-----------------------|------|
| Documentation structure | `docs/README.md` |
| Technical architecture | `docs/technical/README.md` |
| Future plans/roadmap | `docs/future/README.md` |
| User-facing guides | `docs/user/README.md` |

## Conventions

Rules are defined in `.roo/rules/` - read these files for full details:

- **documentation-organization.md** - Doc structure and approval workflow

Global rules (apply to all projects) are in `~/.claude/rules/`:

- **markdown-formatting.md** - Obsidian.md compatibility standards
- **code-comments.md** - Comment quality guidelines (WHY not WHAT)

## Development Workflow

### `plans/` - Working documents
- Create, modify, delete freely during development
- For active planning, brainstorming, and work-in-progress
- Delete or migrate when complete

### `docs/` - Curated documentation
- **Requires user approval** for content changes
- Minor fixes (typos, broken links) allowed without approval
- Prompt user at milestones: "Would you like me to update the documentation?"

### Lifecycle

```
plans/ (active) --> docs/technical/ (complete)
                --> docs/future/ (deferred)
```

## Git Commits

- **Do NOT include `Co-Authored-By` lines** in commit messages
- Write clear, concise commit messages describing what changed and why
- Follow existing commit style (see `git log --oneline`)

## Build Commands

*To be added once build system is established.*

## Quick Reference

| Task | Location |
|------|----------|
| Brainstorm CLI conventions | `plans/cli-conventions-brainstorm.md` |
| Brainstorm testing approach | `plans/testing-conventions-brainstorm.md` |
| Brainstorm config standards | `plans/config-file-standards-brainstorm.md` |
