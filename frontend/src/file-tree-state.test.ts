import { describe, it, expect } from "vitest";
import {
  type FileNode,
  type FileTreeState,
  createInitialState,
  buildFlatList,
  rebuildAndSync,
  enterSearchMode,
  setSearchQuery,
  selectFirstSearchResult,
  exitSearchMode,
  moveSelection,
  jumpToTop,
  jumpToBottom,
  expandOrOpen,
  collapseOrParent,
  toggleFolder,
  setTree,
  handleKey,
} from "./file-tree-state";

// Test fixtures
const sampleTree: FileNode[] = [
  {
    name: "src",
    path: "src",
    type: "directory",
    children: [
      { name: "main.ts", path: "src/main.ts", type: "file" },
      { name: "utils.ts", path: "src/utils.ts", type: "file" },
      {
        name: "components",
        path: "src/components",
        type: "directory",
        children: [
          { name: "Button.tsx", path: "src/components/Button.tsx", type: "file" },
          { name: "Modal.tsx", path: "src/components/Modal.tsx", type: "file" },
        ],
      },
    ],
  },
  { name: "package.json", path: "package.json", type: "file" },
  { name: "README.md", path: "README.md", type: "file" },
];

function createStateWithTree(tree: FileNode[] = sampleTree): FileTreeState {
  return rebuildAndSync({ ...createInitialState(), tree });
}

// ============================================================================
// buildFlatList Tests
// ============================================================================

describe("buildFlatList", () => {
  it("returns empty list for empty tree", () => {
    const result = buildFlatList([], new Set(), "off", "");
    expect(result).toEqual([]);
  });

  it("returns only root nodes when nothing is expanded", () => {
    const result = buildFlatList(sampleTree, new Set(), "off", "");
    expect(result.map((n) => n.node.name)).toEqual(["src", "package.json", "README.md"]);
  });

  it("includes children of expanded directories", () => {
    const expanded = new Set(["src"]);
    const result = buildFlatList(sampleTree, expanded, "off", "");
    expect(result.map((n) => n.node.name)).toEqual([
      "src",
      "main.ts",
      "utils.ts",
      "components",
      "package.json",
      "README.md",
    ]);
  });

  it("includes deeply nested children when parent chain is expanded", () => {
    const expanded = new Set(["src", "src/components"]);
    const result = buildFlatList(sampleTree, expanded, "off", "");
    expect(result.map((n) => n.node.name)).toEqual([
      "src",
      "main.ts",
      "utils.ts",
      "components",
      "Button.tsx",
      "Modal.tsx",
      "package.json",
      "README.md",
    ]);
  });

  it("tracks correct depth for each node", () => {
    const expanded = new Set(["src", "src/components"]);
    const result = buildFlatList(sampleTree, expanded, "off", "");
    expect(result.map((n) => ({ name: n.node.name, depth: n.depth }))).toEqual([
      { name: "src", depth: 0 },
      { name: "main.ts", depth: 1 },
      { name: "utils.ts", depth: 1 },
      { name: "components", depth: 1 },
      { name: "Button.tsx", depth: 2 },
      { name: "Modal.tsx", depth: 2 },
      { name: "package.json", depth: 0 },
      { name: "README.md", depth: 0 },
    ]);
  });

  it("tracks parent path for each node", () => {
    const expanded = new Set(["src"]);
    const result = buildFlatList(sampleTree, expanded, "off", "");
    expect(result.map((n) => ({ name: n.node.name, parent: n.parentPath }))).toEqual([
      { name: "src", parent: null },
      { name: "main.ts", parent: "src" },
      { name: "utils.ts", parent: "src" },
      { name: "components", parent: "src" },
      { name: "package.json", parent: null },
      { name: "README.md", parent: null },
    ]);
  });
});

// ============================================================================
// Search Filtering Tests
// ============================================================================

describe("buildFlatList with search", () => {
  it("filters nodes by search query", () => {
    const result = buildFlatList(sampleTree, new Set(["src", "src/components"]), "typing", "main");
    expect(result.map((n) => n.node.name)).toEqual(["main.ts"]);
  });

  it("search is case-insensitive", () => {
    const result = buildFlatList(sampleTree, new Set(["src", "src/components"]), "typing", "MAIN");
    expect(result.map((n) => n.node.name)).toEqual(["main.ts"]);
  });

  it("finds files in unexpanded directories", () => {
    const result = buildFlatList(sampleTree, new Set(), "typing", "button");
    expect(result.map((n) => n.node.name)).toEqual(["Button.tsx"]);
  });

  it("matches partial names", () => {
    const result = buildFlatList(sampleTree, new Set(["src", "src/components"]), "typing", ".ts");
    expect(result.map((n) => n.node.name)).toEqual(["main.ts", "utils.ts", "Button.tsx", "Modal.tsx"]);
  });

  it("returns empty when no matches", () => {
    const result = buildFlatList(sampleTree, new Set(["src"]), "typing", "nonexistent");
    expect(result).toEqual([]);
  });

  it("empty query shows normal tree structure", () => {
    const result = buildFlatList(sampleTree, new Set(["src"]), "typing", "");
    expect(result.map((n) => n.node.name)).toEqual([
      "src",
      "main.ts",
      "utils.ts",
      "components",
      "package.json",
      "README.md",
    ]);
  });
});

// ============================================================================
// Search State Transitions Tests
// ============================================================================

describe("search state transitions", () => {
  describe("enterSearchMode", () => {
    it("transitions from off to typing", () => {
      const state = createStateWithTree();
      const result = enterSearchMode(state);

      expect(result.searchMode).toBe("typing");
      expect(result.searchQuery).toBe("");
    });

    it("clears previous search query", () => {
      let state = createStateWithTree();
      state = setSearchQuery(state, "old query");
      const result = enterSearchMode(state);

      expect(result.searchQuery).toBe("");
    });
  });

  describe("setSearchQuery", () => {
    it("updates query and rebuilds flat list", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "main");

      expect(state.searchQuery).toBe("main");
      expect(state.flatList.map((n) => n.node.name)).toEqual(["main.ts"]);
    });

    it("converts query to lowercase", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "MAIN");

      expect(state.searchQuery).toBe("main");
    });
  });

  describe("selectFirstSearchResult", () => {
    it("transitions from typing to navigating", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "main");
      state = selectFirstSearchResult(state);

      expect(state.searchMode).toBe("navigating");
    });

    it("selects first item and sets it as open if file", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "main");
      state = selectFirstSearchResult(state);

      expect(state.selectedIndex).toBe(0);
      expect(state.selectedPath).toBe("src/main.ts");
      expect(state.openPath).toBe("src/main.ts");
    });

    it("does not set openPath for directory", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "src");
      state = selectFirstSearchResult(state);

      expect(state.selectedPath).toBe("src");
      expect(state.openPath).toBeNull();
    });

    it("handles empty results gracefully", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "nonexistent");
      state = selectFirstSearchResult(state);

      expect(state.searchMode).toBe("navigating");
      expect(state.selectedPath).toBeNull();
    });
  });

  describe("exitSearchMode", () => {
    it("transitions back to off", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "main");
      state = exitSearchMode(state);

      expect(state.searchMode).toBe("off");
      expect(state.searchQuery).toBe("");
    });

    it("restores full tree view", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      const originalCount = state.flatList.length;

      state = enterSearchMode(state);
      state = setSearchQuery(state, "main");
      expect(state.flatList.length).toBe(1);

      state = exitSearchMode(state);
      expect(state.flatList.length).toBe(originalCount);
    });
  });

  describe("complete search flow", () => {
    it("off -> typing -> navigating -> off", () => {
      let state = createStateWithTree();
      expect(state.searchMode).toBe("off");

      // Press /
      state = enterSearchMode(state);
      expect(state.searchMode).toBe("typing");

      // Type search query
      state = setSearchQuery(state, "main");
      expect(state.searchMode).toBe("typing");
      expect(state.flatList.length).toBe(1);

      // Press Enter
      state = selectFirstSearchResult(state);
      expect(state.searchMode).toBe("navigating");
      expect(state.openPath).toBe("src/main.ts");

      // Press Escape
      state = exitSearchMode(state);
      expect(state.searchMode).toBe("off");
    });

    it("can refine search by pressing / again in navigating mode", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = setSearchQuery(state, "ts");
      state = selectFirstSearchResult(state);
      expect(state.searchMode).toBe("navigating");

      // Press / to refine
      state = enterSearchMode(state);
      expect(state.searchMode).toBe("typing");
      expect(state.searchQuery).toBe("");
    });
  });
});

// ============================================================================
// Navigation State Transitions Tests
// ============================================================================

describe("navigation state transitions", () => {
  describe("moveSelection", () => {
    it("moves down by delta", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);

      state = moveSelection(state, 1);
      expect(state.selectedIndex).toBe(1);
      expect(state.selectedPath).toBe("src/main.ts");

      state = moveSelection(state, 2);
      expect(state.selectedIndex).toBe(3);
      expect(state.selectedPath).toBe("src/components");
    });

    it("moves up by negative delta", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      state = { ...state, selectedIndex: 3, selectedPath: "src/components" };

      state = moveSelection(state, -1);
      expect(state.selectedIndex).toBe(2);
      expect(state.selectedPath).toBe("src/utils.ts");
    });

    it("clamps at top", () => {
      let state = createStateWithTree();
      state = moveSelection(state, -10);
      expect(state.selectedIndex).toBe(0);
    });

    it("clamps at bottom", () => {
      let state = createStateWithTree();
      state = moveSelection(state, 100);
      expect(state.selectedIndex).toBe(state.flatList.length - 1);
    });

    it("handles empty list", () => {
      const state = createInitialState();
      const result = moveSelection(state, 1);
      expect(result.selectedIndex).toBe(0);
    });
  });

  describe("jumpToTop", () => {
    it("moves to first item", () => {
      let state = createStateWithTree();
      state = { ...state, selectedIndex: 2, selectedPath: "README.md" };

      state = jumpToTop(state);
      expect(state.selectedIndex).toBe(0);
      expect(state.selectedPath).toBe("src");
    });
  });

  describe("jumpToBottom", () => {
    it("moves to last item", () => {
      let state = createStateWithTree();

      state = jumpToBottom(state);
      expect(state.selectedIndex).toBe(2);
      expect(state.selectedPath).toBe("README.md");
    });
  });

  describe("expandOrOpen", () => {
    it("expands collapsed directory", () => {
      let state = createStateWithTree();
      expect(state.expandedPaths.has("src")).toBe(false);

      const result = expandOrOpen(state);
      expect(result.state.expandedPaths.has("src")).toBe(true);
      expect(result.fileSelected).toBeNull();
    });

    it("does nothing on already expanded directory", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);

      const result = expandOrOpen(state);
      expect(result.state.expandedPaths.has("src")).toBe(true);
      expect(result.fileSelected).toBeNull();
    });

    it("opens file and returns path", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      state = { ...state, selectedIndex: 1, selectedPath: "src/main.ts" };

      const result = expandOrOpen(state);
      expect(result.state.openPath).toBe("src/main.ts");
      expect(result.fileSelected).toBe("src/main.ts");
    });
  });

  describe("collapseOrParent", () => {
    it("collapses expanded directory", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);

      const result = collapseOrParent(state);
      expect(result.state.expandedPaths.has("src")).toBe(false);
      expect(result.collapsed).toBe(true);
    });

    it("navigates to parent from file", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      state = { ...state, selectedIndex: 1, selectedPath: "src/main.ts" };

      const result = collapseOrParent(state);
      expect(result.state.selectedPath).toBe("src");
      expect(result.state.selectedIndex).toBe(0);
      expect(result.collapsed).toBe(false);
    });

    it("navigates to parent from collapsed subdirectory", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      // components is at index 3
      state = { ...state, selectedIndex: 3, selectedPath: "src/components" };

      const result = collapseOrParent(state);
      expect(result.state.selectedPath).toBe("src");
      expect(result.collapsed).toBe(false);
    });

    it("does nothing at root with no parent", () => {
      let state = createStateWithTree();

      const result = collapseOrParent(state);
      expect(result.state).toEqual(state);
      expect(result.collapsed).toBe(false);
    });
  });

  describe("toggleFolder", () => {
    it("expands collapsed folder", () => {
      let state = createStateWithTree();
      state = toggleFolder(state, "src");
      expect(state.expandedPaths.has("src")).toBe(true);
    });

    it("collapses expanded folder", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);

      state = toggleFolder(state, "src");
      expect(state.expandedPaths.has("src")).toBe(false);
    });
  });
});

// ============================================================================
// setTree Tests
// ============================================================================

describe("setTree", () => {
  it("replaces the tree and rebuilds flat list", () => {
    const state = createStateWithTree();
    const newTree: FileNode[] = [
      { name: "new-file.txt", path: "new-file.txt", type: "file" },
    ];

    const result = setTree(state, newTree);
    expect(result.tree).toEqual(newTree);
    expect(result.flatList.map((n) => n.node.name)).toEqual(["new-file.txt"]);
  });

  it("preserves expanded paths that still exist", () => {
    let state = createStateWithTree();
    state = { ...state, expandedPaths: new Set(["src"]) };
    state = rebuildAndSync(state);

    // New tree still has "src" directory
    const newTree: FileNode[] = [
      {
        name: "src",
        path: "src",
        type: "directory",
        children: [{ name: "index.ts", path: "src/index.ts", type: "file" }],
      },
    ];

    const result = setTree(state, newTree);
    expect(result.expandedPaths.has("src")).toBe(true);
    expect(result.flatList.map((n) => n.node.name)).toEqual(["src", "index.ts"]);
  });
});

// ============================================================================
// handleKey Tests
// ============================================================================

describe("handleKey", () => {
  describe("in off mode", () => {
    it("handles j for down", () => {
      const state = createStateWithTree();
      const result = handleKey(state, "j", 0);

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.selectedIndex).toBe(1);
      }
    });

    it("handles k for up", () => {
      let state = createStateWithTree();
      state = { ...state, selectedIndex: 1, selectedPath: "package.json" };
      const result = handleKey(state, "k", 0);

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.selectedIndex).toBe(0);
      }
    });

    it("handles / to enter search", () => {
      const state = createStateWithTree();
      const result = handleKey(state, "/", 0);

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.searchMode).toBe("typing");
      }
    });

    it("handles G for jump to bottom", () => {
      const state = createStateWithTree();
      const result = handleKey(state, "G", 0);

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.selectedIndex).toBe(2);
      }
    });

    it("handles gg for jump to top", () => {
      let state = createStateWithTree();
      state = { ...state, selectedIndex: 2 };

      // First g
      let result = handleKey(state, "g", 0);
      expect(result.handled).toBe(true);

      // Second g within 500ms
      result = handleKey(state, "g", result.lastGPress);
      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.selectedIndex).toBe(0);
      }
    });

    it("does not handle Escape in off mode", () => {
      const state = createStateWithTree();
      const result = handleKey(state, "Escape", 0);

      expect(result.handled).toBe(false);
    });
  });

  describe("in typing mode", () => {
    it("only handles Escape", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);

      const escapeResult = handleKey(state, "Escape", 0);
      expect(escapeResult.handled).toBe(true);
      if (escapeResult.handled) {
        expect(escapeResult.state.searchMode).toBe("off");
      }
    });

    it("does not handle navigation keys", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);

      expect(handleKey(state, "j", 0).handled).toBe(false);
      expect(handleKey(state, "k", 0).handled).toBe(false);
      expect(handleKey(state, "G", 0).handled).toBe(false);
      expect(handleKey(state, "g", 0).handled).toBe(false);
    });

    it("does not handle / (input should capture it)", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);

      expect(handleKey(state, "/", 0).handled).toBe(false);
    });
  });

  describe("in navigating mode", () => {
    it("handles navigation keys", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = selectFirstSearchResult(state);

      const jResult = handleKey(state, "j", 0);
      expect(jResult.handled).toBe(true);

      const kResult = handleKey(state, "k", 0);
      expect(kResult.handled).toBe(true);
    });

    it("handles Escape to exit search", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = selectFirstSearchResult(state);

      const result = handleKey(state, "Escape", 0);
      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.searchMode).toBe("off");
      }
    });

    it("handles / to refine search", () => {
      let state = createStateWithTree();
      state = enterSearchMode(state);
      state = selectFirstSearchResult(state);

      const result = handleKey(state, "/", 0);
      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.state.searchMode).toBe("typing");
      }
    });

    it("returns fileSelected when opening file with Enter", () => {
      let state = createStateWithTree();
      state = { ...state, expandedPaths: new Set(["src"]) };
      state = rebuildAndSync(state);
      state = { ...state, selectedIndex: 1, selectedPath: "src/main.ts" };

      const result = handleKey(state, "Enter", 0);
      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.fileSelected).toBe("src/main.ts");
      }
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("integration: search + navigation", () => {
  it("search filters, Enter selects, vim keys navigate filtered results", () => {
    let state = createStateWithTree();
    state = { ...state, expandedPaths: new Set(["src", "src/components"]) };
    state = rebuildAndSync(state);

    // Press /
    state = enterSearchMode(state);
    expect(state.searchMode).toBe("typing");

    // Type ".ts" to find TypeScript files
    state = setSearchQuery(state, ".ts");
    expect(state.flatList.map((n) => n.node.name)).toEqual([
      "main.ts",
      "utils.ts",
      "Button.tsx",
      "Modal.tsx",
    ]);

    // Press Enter to select first result
    state = selectFirstSearchResult(state);
    expect(state.searchMode).toBe("navigating");
    expect(state.selectedPath).toBe("src/main.ts");
    expect(state.openPath).toBe("src/main.ts");

    // Use j to navigate within filtered results
    let result = handleKey(state, "j", 0);
    expect(result.handled).toBe(true);
    if (result.handled) {
      state = result.state;
      expect(state.selectedPath).toBe("src/utils.ts");
    }

    // Use Enter to open selected file
    result = handleKey(state, "Enter", 0);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.fileSelected).toBe("src/utils.ts");
    }

    // Press Escape to clear search
    result = handleKey(state, "Escape", 0);
    expect(result.handled).toBe(true);
    if (result.handled) {
      state = result.state;
      expect(state.searchMode).toBe("off");
      expect(state.flatList.length).toBeGreaterThan(4);
    }
  });

  it("selection persists through tree changes when path still exists", () => {
    let state = createStateWithTree();
    state = { ...state, expandedPaths: new Set(["src"]) };
    state = rebuildAndSync(state);
    state = { ...state, selectedIndex: 1, selectedPath: "src/main.ts" };

    // Toggle components folder - should not affect main.ts selection
    state = toggleFolder(state, "src/components");
    expect(state.selectedPath).toBe("src/main.ts");
    expect(state.selectedIndex).toBe(1);
  });

  it("selection adjusts when selected item disappears", () => {
    let state = createStateWithTree();
    state = { ...state, expandedPaths: new Set(["src"]) };
    state = rebuildAndSync(state);
    state = { ...state, selectedIndex: 1, selectedPath: "src/main.ts" };

    // Collapse src - main.ts disappears
    state = toggleFolder(state, "src");
    expect(state.flatList.map((n) => n.node.name)).not.toContain("main.ts");
    // Selection should clamp to valid range
    expect(state.selectedIndex).toBeLessThan(state.flatList.length);
  });
});
