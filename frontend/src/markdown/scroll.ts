import { getUserConfig, matchesKeybinding } from "../config/user-config";

const SCROLL_LINE_HEIGHT = 40;
const SCROLL_PAGE_FACTOR = 0.8;

export interface ScrollState {
  lastGPress: number;
}

export function createScrollState(): ScrollState {
  return { lastGPress: 0 };
}

/**
 * Handle view mode scroll keys.
 * Returns true if the key was handled.
 */
export function handleViewModeScroll(
  e: KeyboardEvent,
  container: HTMLElement,
  state: ScrollState,
  scrollCodeBlocks: (direction: "left" | "right") => void
): boolean {
  const nav = getUserConfig().keybindings.navigation;

  switch (e.key) {
    case "j":
    case "ArrowDown":
      container.scrollBy(0, SCROLL_LINE_HEIGHT);
      return true;
    case "k":
    case "ArrowUp":
      container.scrollBy(0, -SCROLL_LINE_HEIGHT);
      return true;
    case "h":
      scrollCodeBlocks("left");
      return true;
    case "l":
      scrollCodeBlocks("right");
      return true;
    case "d":
      if (e.ctrlKey) {
        container.scrollBy(0, container.clientHeight * SCROLL_PAGE_FACTOR);
        return true;
      }
      return false;
    case "u":
      if (e.ctrlKey) {
        container.scrollBy(0, -container.clientHeight * SCROLL_PAGE_FACTOR);
        return true;
      }
      return false;
  }

  // Navigation keybindings (configurable)
  if (matchesKeybinding(e, nav.scrollToTop)) {
    return handleScrollToTopKey(container, state);
  }
  if (matchesKeybinding(e, nav.scrollToBottom)) {
    container.scrollTo(0, container.scrollHeight);
    return true;
  }

  return false;
}

/**
 * Handle scroll-to-top key for double-tap detection (like vim's gg).
 */
function handleScrollToTopKey(container: HTMLElement, state: ScrollState): boolean {
  const now = Date.now();
  if (now - state.lastGPress < 500) {
    container.scrollTo(0, 0);
    state.lastGPress = 0;
    return true;
  }
  state.lastGPress = now;
  return true;
}

/**
 * Scroll visible code blocks horizontally within a content container.
 */
export function scrollCodeBlocksHorizontally(
  contentContainer: HTMLElement | null,
  direction: "left" | "right"
): void {
  const SCROLL_AMOUNT = 40;
  const delta = direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT;

  if (!contentContainer) return;

  // Code viewer mode: scroll the content container itself
  if (contentContainer.classList.contains("code-viewer")) {
    contentContainer.scrollLeft += delta;
    return;
  }

  // Markdown mode: scroll visible pre blocks
  const codeBlocks = contentContainer.querySelectorAll("pre");
  if (!codeBlocks) return;

  codeBlocks.forEach((block) => {
    const rect = block.getBoundingClientRect();
    const containerRect = contentContainer.getBoundingClientRect();

    const isVisible =
      rect.top < containerRect.bottom &&
      rect.bottom > containerRect.top;

    if (isVisible) {
      block.scrollLeft += delta;
    }
  });
}
