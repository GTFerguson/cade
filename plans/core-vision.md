---
title: Core Vision
created: 2026-01-16
updated: 2026-01-16
status: active
tags: [vision, architecture, planning]
---

# Core Vision

Build a portable terminal IDE with Claude Code at its center.

## Core Problem

**Working with Claude Code in a terminal offers limited visibility into what's happening.**

Pain points:
- Can't easily see what files Claude is creating/modifying
- No visual file tree to understand project structure
- Have to manually open files to see changes
- Context switching between terminal, editor, and file browser
- Hard to follow along as Claude works

**ccplus solves this by giving both user and Claude better visibility into the work.**

## The Idea

Build a unified environment around Claude Code that provides:

1. **File tree visibility** - See project structure, watch files change in real-time
2. **Rendered markdown** - Claude's output beautifully formatted, not raw terminal
3. **Integrated file viewer/editor** - Open files without leaving the environment
4. **Pane management** - Multiple views visible simultaneously
5. **Portability** - Works locally, can run on remote servers

## Why Not Just tmux + vim + Claude Code?

The existing approach works, but:
- **No visibility** - Can't see file tree or what's being created
- Requires separate installation/configuration of each tool
- Tools don't know about each other
- Context switching between them is manual
- No unified keybinding/UX philosophy
- Platform inconsistencies (especially Windows)

## What "Unified" Means

Instead of three separate programs that happen to run in the same terminal:

```
┌─────────────────────────────────────────┐
│ ccplus                                  │
├─────────────────┬───────────────────────┤
│                 │                       │
│  [vim-like     │  [Claude Code         │
│   editor]      │   interface]          │
│                 │                       │
│                 │                       │
├─────────────────┴───────────────────────┤
│ [shell / output pane]                   │
└─────────────────────────────────────────┘
```

One application that provides all three capabilities with:
- Shared context (Claude knows what file you're editing)
- Unified keybindings
- Seamless pane management
- Single configuration

## Built-in Markdown Renderer

Claude outputs markdown. Rather than showing raw syntax, ccplus should render it properly.

### Requirements

- **Streaming support** - Render as Claude outputs, not just after completion
- **Code blocks** - Syntax highlighting
- **KaTeX** - Math notation rendering in terminal
- **Mermaid** - Diagram rendering (as ASCII/unicode? or image in capable terminals?)
- **Tables, lists, headers** - Standard markdown

### mertex.md

Previous work on a streaming markdown renderer with KaTeX and Mermaid support. Potential foundation for ccplus rendering.

*TODO: Assess mertex.md for integration - language, architecture, terminal rendering approach*

### Terminal Rendering Challenges

- KaTeX in terminal: Unicode math symbols? Image protocol (Kitty/iTerm2)?
- Mermaid diagrams: ASCII box drawing? Sixel graphics? External preview?
- Graceful degradation for limited terminals

## Portability Goals

### Multi-Platform Backends

"Portable" means the core can run in different contexts:

```
                    ┌─────────────────────────────────────┐
                    │         ccplus core                 │
                    │  (pane management, routing, state)  │
                    └─────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │   Terminal   │      │  Desktop App │      │   Web App    │
    │  (pure TUI)  │      │ (Tauri/Electron)│   │  (browser)   │
    └──────────────┘      └──────────────┘      └──────────────┘
```

### Key Insight: Embedded Terminal

Instead of building everything as a terminal app, build an application that *contains* a terminal:

- **Claude Code runs in embedded terminal** (xterm.js, or native PTY)
- **Markdown viewer is rich HTML/CSS** (mertex.md works directly!)
- **Pane management is GUI-native** (more flexible than terminal cells)
- **Editor can be Monaco, CodeMirror, or embedded neovim**

This gives us:
- Full rendering capabilities (images, diagrams, math)
- Proper window/pane management
- Still authentic terminal experience for CC
- Path to Obsidian/Notion integration

### Platform Targets

| Platform | Technology | Notes |
|----------|------------|-------|
| Desktop (Win/Mac/Linux) | Tauri (Rust+Web) or Electron | Embedded terminal + rich UI |
| Web | Browser app | Terminal via WebSocket to backend |
| Pure Terminal | TUI fallback | For SSH, minimal environments |

### Future Integrations

- **Obsidian** - Sync notes, use vault as context, render with Obsidian themes
- **Notion** - Similar knowledge management integration
- **VS Code** - Extension that embeds ccplus?

## Built-in Vim-Like Editor

Options change based on platform:

**Desktop/Web:**
- Monaco Editor (VS Code's editor) with vim keybindings
- CodeMirror 6 with vim mode
- Embedded neovim (neovim has GUI frontends)

**Pure Terminal:**
1. **Embed neovim** - libneovim as a library
2. **Use a vim-like library** - libvim, or Rust/Go equivalents
3. **Build minimal vim subset** - Just the features we need
4. **Adopt existing terminal editor** - micro, kakoune, helix as base

## TMUX Features to Replicate

Core features (must have):
- Horizontal/vertical splits
- Pane navigation (hjkl style)
- Pane resize
- Multiple "windows" (tabs)

Nice to have:
- Session persistence (detach/reattach)
- Copy mode
- Synchronized panes

Probably skip:
- Full tmux compatibility
- tmux config file parsing

## Input Routing & Keybinding Conflicts

This is a critical design challenge. Three systems that all want keyboard input:

### The Conflict

```
User presses 'j'
   │
   ├─► vim: move cursor down
   ├─► Claude input: type letter 'j'
   └─► pane nav: move to pane below (if in nav mode)
```

### Traditional Solutions

**tmux approach:** Prefix key
- Press `C-b` to enter "tmux mode", then command key
- All other input passes through to active pane
- Downside: extra keystroke for every pane operation

**vim approach:** Modal
- Normal mode: keys are commands
- Insert mode: keys are text
- Explicit mode switching (`i`, `Esc`)
- Downside: mode confusion, learning curve

### Possible Approaches for ccplus

**Option A: Hierarchical Modes**
```
┌─────────────────────────────────────┐
│ PANE MODE (global prefix, e.g. C-a)│
│   - split, navigate, resize panes   │
│   - single keystrokes after prefix  │
└─────────────────────────────────────┘
         │ (focus a pane)
         ▼
┌─────────────────────────────────────┐
│ PANE-SPECIFIC MODE                  │
│   - Editor pane: vim modes apply    │
│   - Claude pane: insert-style input │
│   - Shell pane: pass-through        │
└─────────────────────────────────────┘
```

**Option B: Context-Aware Routing**
- System knows pane types
- Same key does different things based on focused pane
- Risk: unpredictable behavior

**Option C: Unified Modal System**
- One mode system across all panes
- `Esc` always returns to "command mode"
- Consistent but may fight vim users' muscle memory

### Specific Conflicts to Resolve

| Key | vim | tmux (C-b prefix) | Claude Code |
|-----|-----|-------------------|-------------|
| `C-c` | -- | (after prefix) | Cancel/interrupt |
| `C-d` | Scroll down | Detach | EOF/exit |
| `C-z` | Suspend | -- | Undo? Suspend? |
| `Esc` | Exit insert | -- | Cancel? |
| `:` | Command mode | -- | -- |

### Interaction Nuances

**Claude editing a file while you watch:**
- Claude is writing to editor buffer
- Do you see changes live?
- Can you scroll/navigate while Claude writes?
- What if you want to interrupt?

**Switching context:**
- You're in vim, Claude finishes a response
- Notification? Auto-focus? Stay in vim?

**Shared clipboard:**
- Yank in vim → paste in Claude prompt?
- Claude output → vim register?

**Command execution:**
- Claude runs a shell command
- Which pane shows output?
- Can you interact with it?

### Design Principles (proposed)

1. **Predictable prefix** - Global pane operations always start with same key
2. **Pane autonomy** - Once focused, pane controls its own input
3. **Escape hatch** - One key always returns to known state
4. **Visual mode indicator** - Always clear what mode/context you're in

## Open Questions

1. **What language?**
   - Rust: Good TUI ecosystem (ratatui), single binary, cross-platform
   - Go: Simple, good stdlib, cross-platform
   - Zig: Ultimate portability, but younger ecosystem
   - Python: Rapid prototyping, but portability challenges

2. **How does Claude Code integrate?**
   - Spawn as subprocess?
   - Embed the SDK?
   - Communicate via API directly?

3. **How much vim compatibility?**
   - Basic motions (hjkl, w, b, e, etc.)
   - Common commands (:w, :q, :e)
   - Registers and macros?
   - Plugin compatibility?

4. **What's the MVP?**
   - Pane splitting + editor + shell?
   - Just editor + Claude integration?

## Future: Code Understanding Layer (nkrdn)

Long-term potential: integrate nkrdn, a knowledge graph-based code understanding system.

### What This Could Enable

- **Structured codebase context** - Not just file contents, but relationships
- **Call graphs** - What calls what, dependency chains
- **Type hierarchies** - Inheritance, implementations
- **Symbol resolution** - Jump to definition, find references
- **Smarter Claude context** - Feed graph data instead of raw files

### Integration Questions

- How does nkrdn build its graph? (Static analysis? LSP? Tree-sitter?)
- What's the query interface?
- Can it update incrementally as files change?
- How to surface this to Claude without overwhelming context?

### Complexity Warning

This is a significant addition. Keep as future phase - don't let it block MVP.

*TODO: Assess nkrdn architecture and integration feasibility*

## Existing Projects Assessment

### mertex.md (JavaScript)

**What it does:**
- Streaming markdown renderer with KaTeX and Mermaid
- Browser-focused, outputs HTML to DOM
- Has `createStreamRenderer()` for real-time rendering

**Relevant features:**
- Math protection (protects LaTeX from markdown processing)
- Streaming support for incremental rendering
- Syntax highlighting via highlight.js

**Challenge for ccplus:**
- Outputs HTML, designed for browsers
- Options:
  1. Run in embedded browser view (electron-like approach)
  2. Adapt to output ANSI terminal codes instead of HTML
  3. Use terminal with HTML/image support (kitty, wezterm sixel)
  4. Rewrite core logic in target language (Rust/Go)

**Assessment:** The streaming architecture and math protection logic are valuable. May need adaptation rather than direct integration.

### nkrdn (Python)

**What it does:**
- Neuro-symbolic code understanding framework
- Static analysis builds dependency graph (deterministic kernel)
- LLM enrichment adds semantic meaning
- Uses Jena Fuseki (RDF graph database)
- Web interface for exploration

**Architecture:**
```
nkrdn/
├── knowledge_builder/  # Static analysis (deterministic)
├── agent/              # LLM reasoning layer
├── graph/              # SPARQL/graph operations
└── code_explorer/      # Web UI
```

**Relevant for ccplus:**
- Could provide structured codebase context to Claude
- Symbol extraction, call graphs, dependencies
- Already has code retrieval functionality

**Challenge:**
- Heavy dependencies (Docker, Fuseki, Python)
- Web-based, not terminal-native
- Integration would be significant work

**Assessment:** Long-term goal. The knowledge_builder kernel could potentially be extracted or reimplemented.

## Architecture Decision (Finalized)

**Approach: Web-first local app → Tauri desktop → Pure terminal**

```
Phase 1 (MVP)                    Phase 2                      Phase 3
─────────────────────────────    ─────────────────────────    ─────────────────
Local web app                    Tauri desktop app            Pure terminal mode

$ ccplus                         Click icon → opens           $ ccplus --tui
  → browser opens                Native window                  → works over SSH
  → ready to work                Same codebase                  Fallback mode
```

**Rationale:**
- Primary use: local machine (desktop/web works great)
- Secondary use: SSH/EC2 (web can serve remotely; pure terminal later)
- Key priority: easy to run, quick to start working
- mertex.md is already JS, works immediately
- xterm.js is mature terminal emulator
- Fast iteration with web tech

**Tech Stack:**

| Component | Technology |
|-----------|------------|
| Backend | FastAPI (Python) |
| Frontend | TypeScript, HTML/CSS |
| Terminal | xterm.js |
| PTY | pexpect / pywinpty |
| Markdown | mertex.md |
| File watching | watchfiles |
| Editor | Monaco or CodeMirror (later) |
| Desktop wrapper | Tauri (Phase 2) |

**Why hybrid:** FastAPI is familiar, portable, and makes nkrdn integration easier later. Frontend stays TypeScript for mertex.md compatibility.

## MVP Priorities

### Priority 1: Markdown Viewer + Terminal Pane

**Goal:** Claude Code in one pane, rendered markdown in another.

**Scope:**
- xterm.js running Claude Code
- mertex.md rendering Claude's output
- Basic split layout (side-by-side or stacked)
- Stream rendering as Claude outputs

See [[mvp-scope]] for detailed requirements.

### Priority 2: Pane Management

**Scope:**
- Horizontal/vertical splits
- Pane navigation (keyboard shortcuts)
- Pane resize
- Multiple tabs/workspaces

### Priority 3: Editor Integration

**Scope:**
- Monaco or CodeMirror with vim keybindings
- File editing within ccplus
- Integration with Claude context

### Priority 4+ (Future)

- nkrdn integration for code understanding
- Session persistence
- Configuration system
- Obsidian/Notion integration
- Tauri desktop wrapper
- Pure terminal mode

## Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| Core Vision | `plans/core-vision.md` | High-level goals and decisions |
| MVP Scope | `plans/mvp-scope.md` | What's in/out for MVP |
| Architecture | `plans/architecture-spec.md` | Technical architecture details |
| CLI Conventions | `plans/cli-conventions-brainstorm.md` | Brainstorming |
| Testing | `plans/testing-conventions-brainstorm.md` | Brainstorming |
| Config | `plans/config-file-standards-brainstorm.md` | Brainstorming |
