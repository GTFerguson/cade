/**
 * Pure keybinding parsing and matching utilities.
 *
 * Binding string grammar: hyphen-separated modifier tokens followed by a
 * single key. Modifier tokens are case-insensitive:
 *   C  → Ctrl
 *   A  → Alt
 *   S  → Shift
 *   M  → Meta (Cmd on macOS, Super on Linux)
 *
 * Examples: "h", "C-h", "C-A-x", "S-?", "M-k".
 *
 * The key token is compared case-sensitively to `KeyboardEvent.key` so that
 * "G" matches Shift+g but "g" matches plain g. This mirrors how the DOM
 * reports `key`.
 */

export interface ParsedKeybinding {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parse a binding string into its modifier flags and key.
 */
export function parseKeybinding(binding: string): ParsedKeybinding {
  const result: ParsedKeybinding = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: "",
  };

  const parts = binding.split("-");

  for (let i = 0; i < parts.length - 1; i++) {
    const modifier = parts[i]?.toUpperCase();
    switch (modifier) {
      case "C":
        result.ctrl = true;
        break;
      case "A":
        result.alt = true;
        break;
      case "S":
        result.shift = true;
        break;
      case "M":
        result.meta = true;
        break;
    }
  }

  result.key = parts[parts.length - 1] ?? "";
  return result;
}

export interface MatchOptions {
  /**
   * When true, treat the event's Ctrl state as false during comparison.
   * Used when a held prefix key is supplying the Ctrl modifier itself, so
   * subsequent bindings should not require Ctrl to be re-pressed.
   */
  ignoreCtrl?: boolean;
}

/**
 * Return true if the KeyboardEvent matches the binding string.
 *
 * Shift semantics: only enforced when the binding explicitly includes
 * `S-`. Characters like `?`, `G`, `!` inherently require Shift to type, so
 * for a single-character binding without `S-` we don't require
 * `e.shiftKey` to be set.
 */
export function matchesKeybinding(
  e: KeyboardEvent,
  binding: string,
  options: MatchOptions = {}
): boolean {
  const parsed = parseKeybinding(binding);
  const effectiveCtrl = options.ignoreCtrl ? false : e.ctrlKey;
  const shiftMatches = parsed.shift ? e.shiftKey : true;

  return (
    effectiveCtrl === parsed.ctrl &&
    e.altKey === parsed.alt &&
    shiftMatches &&
    e.metaKey === parsed.meta &&
    e.key === parsed.key
  );
}
