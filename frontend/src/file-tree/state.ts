/**
 * Pure state machine for file tree navigation and search.
 * Extracted for testability - no DOM or side effects.
 */

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export interface FlatNode {
  node: FileNode;
  depth: number;
  parentPath: string | null;
}

// Search has three modes: off, typing (input focused), navigating (vim keys work)
export type SearchMode = "off" | "typing" | "navigating";

export interface FileTreeState {
  // Tree data
  tree: FileNode[];
  expandedPaths: Set<string>;

  // Selection
  selectedIndex: number;
  selectedPath: string | null;
  openPath: string | null;

  // Search
  searchMode: SearchMode;
  searchQuery: string;

  // Derived (recomputed on state change)
  flatList: FlatNode[];
}

export function createInitialState(): FileTreeState {
  return {
    tree: [],
    expandedPaths: new Set(),
    selectedIndex: 0,
    selectedPath: null,
    openPath: null,
    searchMode: "off",
    searchQuery: "",
    flatList: [],
  };
}

/**
 * Build flat list of visible nodes for keyboard navigation.
 * Pure function - depends only on tree, expandedPaths, searchMode, and searchQuery.
 */
export function buildFlatList(
  tree: FileNode[],
  expandedPaths: Set<string>,
  searchMode: SearchMode,
  searchQuery: string
): FlatNode[] {
  const result: FlatNode[] = [];
  const searchLower = searchQuery.toLowerCase();
  const isSearching = searchMode !== "off" && searchLower.length > 0;

  const traverse = (
    nodes: FileNode[],
    depth: number,
    parentPath: string | null
  ): void => {
    for (const node of nodes) {
      // If searching, filter by name match
      if (isSearching && !node.name.toLowerCase().includes(searchLower)) {
        // Still recurse into directories to find matching children
        if (node.type === "directory" && node.children) {
          traverse(node.children, depth + 1, node.path);
        }
        continue;
      }

      result.push({ node, depth, parentPath });

      // In normal mode, only show children of expanded directories
      // In search mode, show all matching nodes flat
      if (!isSearching && node.type === "directory" && expandedPaths.has(node.path) && node.children) {
        traverse(node.children, depth + 1, node.path);
      }
    }
  };

  traverse(tree, 0, null);
  return result;
}

/**
 * Sync selectedIndex with flatList after state changes.
 */
export function syncSelection(state: FileTreeState): FileTreeState {
  let { selectedIndex, selectedPath } = state;
  const { flatList } = state;

  // Try to find selectedPath in new flatList
  if (selectedPath) {
    const idx = flatList.findIndex((f) => f.node.path === selectedPath);
    if (idx >= 0) {
      selectedIndex = idx;
    }
  }

  // Clamp to valid range
  if (flatList.length === 0) {
    selectedIndex = 0;
    selectedPath = null;
  } else if (selectedIndex >= flatList.length) {
    selectedIndex = flatList.length - 1;
    selectedPath = flatList[selectedIndex]?.node.path ?? null;
  }

  return { ...state, selectedIndex, selectedPath };
}

/**
 * Rebuild flatList and sync selection. Call after any state change that affects visible nodes.
 */
export function rebuildAndSync(state: FileTreeState): FileTreeState {
  const flatList = buildFlatList(
    state.tree,
    state.expandedPaths,
    state.searchMode,
    state.searchQuery
  );
  return syncSelection({ ...state, flatList });
}

// ============================================================================
// Search State Transitions
// ============================================================================

export function enterSearchMode(state: FileTreeState): FileTreeState {
  return rebuildAndSync({
    ...state,
    searchMode: "typing",
    searchQuery: "",
  });
}

export function setSearchQuery(state: FileTreeState, query: string): FileTreeState {
  return rebuildAndSync({
    ...state,
    searchQuery: query.toLowerCase(),
  });
}

export function selectFirstSearchResult(state: FileTreeState): FileTreeState {
  const { flatList } = state;
  if (flatList.length === 0) {
    return { ...state, searchMode: "navigating" };
  }

  const firstItem = flatList[0];
  const isFile = firstItem?.node.type === "file";

  return {
    ...state,
    searchMode: "navigating",
    selectedIndex: 0,
    selectedPath: firstItem?.node.path ?? null,
    openPath: isFile ? firstItem?.node.path ?? null : state.openPath,
  };
}

export function exitSearchMode(state: FileTreeState): FileTreeState {
  return rebuildAndSync({
    ...state,
    searchMode: "off",
    searchQuery: "",
  });
}

// ============================================================================
// Navigation State Transitions
// ============================================================================

export function moveSelection(state: FileTreeState, delta: number): FileTreeState {
  const { flatList, selectedIndex } = state;
  if (flatList.length === 0) {
    return state;
  }

  const newIndex = Math.max(0, Math.min(flatList.length - 1, selectedIndex + delta));
  const item = flatList[newIndex];

  return {
    ...state,
    selectedIndex: newIndex,
    selectedPath: item?.node.path ?? null,
  };
}

export function jumpToTop(state: FileTreeState): FileTreeState {
  const { flatList } = state;
  if (flatList.length === 0) {
    return state;
  }

  return {
    ...state,
    selectedIndex: 0,
    selectedPath: flatList[0]?.node.path ?? null,
  };
}

export function jumpToBottom(state: FileTreeState): FileTreeState {
  const { flatList } = state;
  if (flatList.length === 0) {
    return state;
  }

  const lastIndex = flatList.length - 1;
  return {
    ...state,
    selectedIndex: lastIndex,
    selectedPath: flatList[lastIndex]?.node.path ?? null,
  };
}

export interface ExpandOrOpenResult {
  state: FileTreeState;
  fileSelected: string | null; // Path of file to open, if any
}

export function expandOrOpen(state: FileTreeState): ExpandOrOpenResult {
  const { flatList, selectedIndex, expandedPaths } = state;
  const item = flatList[selectedIndex];

  if (!item) {
    return { state, fileSelected: null };
  }

  if (item.node.type === "directory") {
    // Expand directory if not already expanded
    if (!expandedPaths.has(item.node.path)) {
      const newExpanded = new Set(expandedPaths);
      newExpanded.add(item.node.path);
      const newState = rebuildAndSync({ ...state, expandedPaths: newExpanded });
      return { state: newState, fileSelected: null };
    }
    return { state, fileSelected: null };
  } else {
    // Open file
    return {
      state: { ...state, openPath: item.node.path },
      fileSelected: item.node.path,
    };
  }
}

export interface CollapseResult {
  state: FileTreeState;
  collapsed: boolean;
}

export function collapseOrParent(state: FileTreeState): CollapseResult {
  const { flatList, selectedIndex, expandedPaths } = state;
  const item = flatList[selectedIndex];

  if (!item) {
    return { state, collapsed: false };
  }

  // If it's an expanded directory, collapse it
  if (item.node.type === "directory" && expandedPaths.has(item.node.path)) {
    const newExpanded = new Set(expandedPaths);
    newExpanded.delete(item.node.path);
    const newState = rebuildAndSync({ ...state, expandedPaths: newExpanded });
    return { state: newState, collapsed: true };
  }

  // Otherwise navigate to parent
  if (item.parentPath) {
    const parentIndex = flatList.findIndex((f) => f.node.path === item.parentPath);
    if (parentIndex >= 0) {
      return {
        state: {
          ...state,
          selectedIndex: parentIndex,
          selectedPath: item.parentPath,
        },
        collapsed: false,
      };
    }
  }

  return { state, collapsed: false };
}

export function toggleFolder(state: FileTreeState, path: string): FileTreeState {
  const newExpanded = new Set(state.expandedPaths);
  if (newExpanded.has(path)) {
    newExpanded.delete(path);
  } else {
    newExpanded.add(path);
  }
  return rebuildAndSync({ ...state, expandedPaths: newExpanded });
}

export function setTree(state: FileTreeState, tree: FileNode[]): FileTreeState {
  return rebuildAndSync({ ...state, tree });
}

// ============================================================================
// Keyboard Event Handling
// ============================================================================

export type KeyResult =
  | { handled: false }
  | { handled: true; state: FileTreeState; fileSelected?: string };

/**
 * Handle a keyboard event. Returns new state if handled, or { handled: false } if not.
 */
export function handleKey(state: FileTreeState, key: string, lastGPress: number): KeyResult & { lastGPress: number } {
  const { searchMode } = state;

  // In typing mode - only handle Escape
  if (searchMode === "typing") {
    if (key === "Escape") {
      return { handled: true, state: exitSearchMode(state), lastGPress };
    }
    return { handled: false, lastGPress };
  }

  // In navigating mode or off - vim keys work
  switch (key) {
    case "j":
    case "ArrowDown":
      return { handled: true, state: moveSelection(state, 1), lastGPress };

    case "k":
    case "ArrowUp":
      return { handled: true, state: moveSelection(state, -1), lastGPress };

    case "l":
    case "Enter": {
      const result = expandOrOpen(state);
      if (result.fileSelected) {
        return { handled: true, state: result.state, fileSelected: result.fileSelected, lastGPress };
      }
      return { handled: true, state: result.state, lastGPress };
    }

    case "h": {
      const result = collapseOrParent(state);
      return { handled: true, state: result.state, lastGPress };
    }

    case "g": {
      const now = Date.now();
      if (now - lastGPress < 500) {
        return { handled: true, state: jumpToTop(state), lastGPress: 0 };
      }
      return { handled: true, state, lastGPress: now };
    }

    case "G":
      return { handled: true, state: jumpToBottom(state), lastGPress };

    case "/":
      return { handled: true, state: enterSearchMode(state), lastGPress };

    case "Escape":
      if (searchMode === "navigating") {
        return { handled: true, state: exitSearchMode(state), lastGPress };
      }
      return { handled: false, lastGPress };

    default:
      return { handled: false, lastGPress };
  }
}
