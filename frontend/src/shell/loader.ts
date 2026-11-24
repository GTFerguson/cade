/**
 * Desktop shell loader.
 *
 * The desktop window opens this page instead of the interface built into the
 * app. It fetches the interface from the local backend and writes it into
 * this document, so the JS and CSS always match the backend that is running:
 * after the backend upgrades itself in place, a reload brings the new
 * interface with no app restart.
 *
 * The document stays on the shell's own origin rather than navigating to the
 * backend. The backend's port changes every launch, so its origin does too,
 * and localStorage (saved tabs, theme) would start empty each time.
 *
 * This file is compiled into the app binary, so it is the one piece of
 * frontend that cannot upgrade live. Keep it small and free of app imports.
 */

const SHELL_GLOBALS_KEY = "cade-shell-globals";
const EMBEDDED_PAGE = "index.html";

export const FETCH_ATTEMPTS = 10;
export const FETCH_RETRY_MS = 500;
const BACKEND_URL_POLL_MS = 50;

/**
 * Only a backend on this machine may supply the interface. A remote backend
 * is a different trust level: its page would run with the shell's native
 * commands (ssh tunnels, opening URLs) in reach.
 */
export function isLocalBackend(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

/**
 * Point the page's root-relative asset references at the backend. Relative
 * to this document they would resolve to the copy built into the app, whose
 * hashed filenames no longer exist after an upgrade.
 */
export function rewriteAssetUrls(html: string, origin: string): string {
  return html.replace(/\b(src|href)=(["'])\/(?!\/)/g, `$1=$2${origin}/`);
}

/**
 * Prepare the backend's page for this document: absolute asset URLs, plus the
 * globals the app reads to find chunks it loads later (__ASSET_ORIGIN__, see
 * renderBuiltUrl in vite.config.ts) and to know its page is served by the
 * backend, which is what makes reloading on an upgrade worthwhile.
 */
export function prepareLivePage(html: string, backendUrl: string): string {
  const origin = new URL(backendUrl).origin;
  const globals =
    `<script>window.__ASSET_ORIGIN__=${JSON.stringify(origin)};` +
    `window.__LIVE_FRONTEND__=true;</script>`;
  const rewritten = rewriteAssetUrls(html, origin);
  return /<head[^>]*>/i.test(rewritten)
    ? rewritten.replace(/<head[^>]*>/i, (m) => m + globals)
    : globals + rewritten;
}

function readBackendUrl(): string | null {
  const injected = (window as any).__BACKEND_URL__;
  if (typeof injected === "string" && injected) return injected;
  // On a reload the shell's one-time injection is gone; the app mirrors it
  // to sessionStorage (syncShellGlobals in config/config.ts).
  try {
    const saved = window.sessionStorage.getItem(SHELL_GLOBALS_KEY);
    const url = saved ? (JSON.parse(saved) as Record<string, unknown>)["__BACKEND_URL__"] : null;
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForBackendUrl(): Promise<string> {
  // The shell injects the address once its backend answers, which at app
  // start is some seconds after this page loads. If the backend never comes
  // up the shell exits, so there is no timeout to fall back from here.
  for (;;) {
    const url = readBackendUrl();
    if (url) return url;
    await sleep(BACKEND_URL_POLL_MS);
  }
}

export async function fetchLivePage(
  backendUrl: string,
  fetchFn: typeof fetch = fetch,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<string | null> {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(`${new URL(backendUrl).origin}/`, { cache: "no-store" });
      if (res.ok) {
        const html = await res.text();
        // A login redirect or error page is not the app; don't write it in.
        if (html.includes('id="tab-content"')) return html;
      }
    } catch {
      // Backend restarting (mid-upgrade) or not listening yet; retry.
    }
    await wait(FETCH_RETRY_MS);
  }
  return null;
}

export async function boot(): Promise<void> {
  const backendUrl = await waitForBackendUrl();
  const html = isLocalBackend(backendUrl) ? await fetchLivePage(backendUrl) : null;
  if (html === null) {
    // Remote backend, or the local one would not serve its page: run the
    // interface built into the app, as the shell did before this loader.
    window.location.replace(EMBEDDED_PAGE);
    return;
  }
  document.open();
  document.write(prepareLivePage(html, backendUrl));
  document.close();
}
