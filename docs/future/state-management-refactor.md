---
title: Frontend State Management Refactor
created: 2026-01-18
updated: 2026-01-18
status: planned
tags: [refactor, frontend, state-management, testing]
---

# Frontend State Management Refactor

Extract state management logic from UI components into pure, testable state machines.

## Motivation

Currently, frontend components (FileTree, TabManager, etc.) mix state logic with DOM manipulation. This makes:

- **Testing difficult** - Need DOM mocking to test business logic
- **Bugs harder to find** - State transitions scattered across methods
- **Reasoning complex** - Can't understand state flow without reading DOM code

## Proof of Concept: FileTree

`file-tree-state.ts` demonstrates the pattern:

```typescript
// Pure state type
interface FileTreeState {
  tree: FileNode[];
  expandedPaths: Set<string>;
  selectedIndex: number;
  searchMode: "off" | "typing" | "navigating";
  searchQuery: string;
  flatList: FlatNode[];
}

// Pure transition functions
function enterSearchMode(state: FileTreeState): FileTreeState
function moveSelection(state: FileTreeState, delta: number): FileTreeState
function handleKey(state: FileTreeState, key: string): KeyResult
```

Tests run without DOM (~23ms for 56 tests).

## Current State

| Component | State Extracted | Tests |
|-----------|-----------------|-------|
| FileTree | ✓ `file-tree-state.ts` | ✓ 56 tests |
| TabManager | ✗ | ✗ |
| KeybindingManager | ✗ | ✗ |
| TerminalManager | ✗ | ✗ |

FileTree still uses its own internal state implementation. The extracted state machine serves as a tested specification but isn't wired into the component yet.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    UI Components                         │
│  FileTree, TabManager, Terminal, Viewer                 │
│  - Render based on state                                │
│  - Dispatch actions on user input                       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   State Machines                         │
│  file-tree-state.ts, tab-state.ts, etc.                │
│  - Pure functions: (state, action) → state             │
│  - Fully testable without DOM                          │
└─────────────────────────────────────────────────────────┘
```

## Components to Refactor

### FileTree (partial - needs wiring)

State machine exists, need to:
- Wire `FileTree` class to use `file-tree-state.ts`
- Remove duplicated logic from class

### TabManager

Current state:
- `tabs: TabState[]`
- `activeTabId: string`
- `nextTabId: number`

Extract:
- Tab CRUD operations
- Tab switching logic
- Session restore logic

### KeybindingManager

Current state:
- `mode: "normal" | "prefix"`
- `prefixTimeout`
- `focusedPane`

Extract:
- Mode transitions
- Key chord detection
- Pane focus management

### TerminalManager

Current state:
- Terminal instances per tab
- Resize state
- WebGL renderer state

Extract:
- Terminal lifecycle
- Resize calculations

## Implementation Plan

1. **Extract state types** - Define interfaces for each component's state
2. **Write transition functions** - Pure functions for each action
3. **Add tests** - Cover all transitions before touching UI
4. **Wire to components** - Replace internal state with calls to state machines
5. **Remove duplication** - Delete old implementations from components

## Benefits

- **Testable** - 100% of state logic testable without DOM
- **Debuggable** - State transitions are explicit and traceable
- **Replayable** - Could implement time-travel debugging
- **Type-safe** - TypeScript ensures valid state transitions

## Open Questions

1. Use a state management library (Zustand, XState) or keep it simple?
2. Should state be global or per-component?
3. How to handle async operations (WebSocket messages)?

## See Also

- [[../technical/core/frontend-architecture|Frontend Architecture]]
- `frontend/src/file-tree-state.ts` - Reference implementation
- `frontend/src/file-tree-state.test.ts` - Test patterns
