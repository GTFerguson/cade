/**
 * Swipe-right gesture handler for mobile back navigation.
 *
 * Detects horizontal swipes starting from the left edge and calls
 * the onBack callback when a swipe threshold is exceeded.
 */

const EDGE_ZONE = 40; // px from left edge where swipe can start
const SWIPE_THRESHOLD = 80; // px horizontal distance to trigger back

interface SwipeState {
  startX: number;
  startY: number;
  tracking: boolean;
}

/**
 * Set up swipe-right-to-go-back gesture on an element.
 * Returns a cleanup function to remove event listeners.
 */
export function setupSwipeBack(
  el: HTMLElement,
  onBack: () => void
): () => void {
  const state: SwipeState = {
    startX: 0,
    startY: 0,
    tracking: false,
  };

  function handleTouchStart(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;

    // Only track swipes starting from left edge
    if (touch.clientX <= EDGE_ZONE) {
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.tracking = true;
    }
  }

  function handleTouchMove(e: TouchEvent): void {
    if (!state.tracking) return;

    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - state.startX;
    const dy = Math.abs(touch.clientY - state.startY);

    // Cancel if vertical movement exceeds horizontal (user is scrolling)
    if (dy > Math.abs(dx)) {
      state.tracking = false;
      return;
    }

    // Prevent scroll while swiping horizontally
    if (dx > 10) {
      e.preventDefault();
    }
  }

  function handleTouchEnd(e: TouchEvent): void {
    if (!state.tracking) return;

    const touch = e.changedTouches[0];
    if (!touch) {
      state.tracking = false;
      return;
    }

    const dx = touch.clientX - state.startX;

    if (dx >= SWIPE_THRESHOLD) {
      onBack();
    }

    state.tracking = false;
  }

  el.addEventListener("touchstart", handleTouchStart, { passive: true });
  el.addEventListener("touchmove", handleTouchMove, { passive: false });
  el.addEventListener("touchend", handleTouchEnd, { passive: true });

  return () => {
    el.removeEventListener("touchstart", handleTouchStart);
    el.removeEventListener("touchmove", handleTouchMove);
    el.removeEventListener("touchend", handleTouchEnd);
  };
}
