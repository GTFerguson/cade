/**
 * Pre-fetch the terminal monospace font so xterm measures glyphs against
 * the resolved font face, not a fallback. The browser only fetches a web
 * font when something requests it; calling document.fonts.load() is the
 * cheapest way to trigger that fetch up-front.
 *
 * Late-arriving fonts are still handled by WebglRenderer, which rebuilds
 * the texture atlas on document.fonts 'loadingdone'. This utility just
 * shrinks the visible-corruption window from "until next loadingdone" to
 * "before first paint" on machines with a working font load.
 */

const TERMINAL_FONT_FACES = [
  '14px "JetBrains Mono"',
  '600 14px "JetBrains Mono"',
];

let kicked = false;

export function kickFontLoad(): void {
  if (kicked) return;
  kicked = true;
  if (typeof document === "undefined" || !document.fonts) return;
  for (const face of TERMINAL_FONT_FACES) {
    document.fonts.load(face).catch(() => {
      // Ignore — if the font is unavailable, xterm uses a fallback. The
      // WebglRenderer will not get a 'loadingdone' for a face that never
      // started loading, so this fails open without retry storms.
    });
  }
}
