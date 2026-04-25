/**
 * Pre-fetch the bundled monospace font so glyphs are available before
 * either the terminal (xterm) or the chat measures/rasterises them.
 *
 * @font-face uses font-display: block (3s blocking window) to keep
 * xterm's WebGL atlas from baking fallback metrics on init. The same
 * face is used by chat and viewer code spans via var(--font-mono).
 * Browsers only fetch a web font when something requests it, and on
 * platforms without JetBrains Mono installed locally (e.g. fresh
 * Ubuntu) chat will render against a system fallback — or, under
 * WebKitGTK + Mesa, produce malformed glyphs from synthesising weights
 * we don't have — until the fetch completes.
 *
 * preloadMonoFonts() must be called from app startup (main.ts) so the
 * fetch begins before any UI mounts. xterm's atlas is still rebuilt by
 * WebglRenderer on document.fonts 'loadingdone' for the late-arrival
 * case.
 */

const MONO_FONT_FACES = [
  '400 14px "JetBrains Mono"',
  'italic 400 14px "JetBrains Mono"',
  '500 14px "JetBrains Mono"',
  'italic 500 14px "JetBrains Mono"',
  '600 14px "JetBrains Mono"',
  'italic 600 14px "JetBrains Mono"',
  '700 14px "JetBrains Mono"',
  'italic 700 14px "JetBrains Mono"',
];

let kicked = false;

export function preloadMonoFonts(): void {
  if (kicked) return;
  kicked = true;
  if (typeof document === "undefined" || !document.fonts) return;
  for (const face of MONO_FONT_FACES) {
    document.fonts.load(face).catch(() => {
      // Ignore — if a face is unavailable, the browser falls back. The
      // WebglRenderer will not get a 'loadingdone' for a face that
      // never started loading, so this fails open without retry storms.
    });
  }
}

export const kickFontLoad = preloadMonoFonts;
