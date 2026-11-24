// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  FETCH_ATTEMPTS,
  fetchLivePage,
  isLocalBackend,
  prepareLivePage,
  rewriteAssetUrls,
} from "./loader";

const PAGE = `<!DOCTYPE html><html><head>
<link rel="icon" href="/icons/icon-192.png" />
<script type="module" crossorigin src="/assets/main-abc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/main-abc.css">
</head><body><div id="tab-content"></div>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script src="//cdn.example/x.js"></script>
</body></html>`;

const BACKEND = "http://127.0.0.1:41234";

describe("isLocalBackend", () => {
  it.each(["http://127.0.0.1:41234", "http://localhost:3001"])("accepts %s", (url) => {
    expect(isLocalBackend(url)).toBe(true);
  });

  it.each([
    "https://clann.example/cade",
    "http://10.0.0.5:3030",
    "http://127.0.0.1.evil.example:80",
    "file:///etc/passwd",
    "",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isLocalBackend(url)).toBe(false);
  });
});

describe("rewriteAssetUrls", () => {
  const out = rewriteAssetUrls(PAGE, BACKEND);

  it("points root-relative assets at the backend", () => {
    expect(out).toContain(`src="${BACKEND}/assets/main-abc.js"`);
    expect(out).toContain(`href="${BACKEND}/assets/main-abc.css"`);
    expect(out).toContain(`href="${BACKEND}/icons/icon-192.png"`);
  });

  it("leaves absolute and protocol-relative URLs alone", () => {
    expect(out).toContain('src="https://accounts.google.com/gsi/client"');
    expect(out).toContain('src="//cdn.example/x.js"');
  });
});

describe("prepareLivePage", () => {
  it("sets the asset origin and live flag before any app script", () => {
    const out = prepareLivePage(PAGE, `${BACKEND}/`);
    const globals = out.indexOf("__ASSET_ORIGIN__");
    expect(globals).toBeGreaterThan(-1);
    expect(globals).toBeLessThan(out.indexOf("main-abc.js"));
    expect(out).toContain(`window.__ASSET_ORIGIN__="${BACKEND}"`);
    expect(out).toContain("window.__LIVE_FRONTEND__=true");
  });
});

describe("fetchLivePage", () => {
  const noWait = () => Promise.resolve();
  const ok = (body: string) => ({ ok: true, text: () => Promise.resolve(body) }) as Response;

  it("returns the app page from the backend root, uncached", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(PAGE));
    expect(await fetchLivePage(BACKEND, fetchFn, noWait)).toBe(PAGE);
    expect(fetchFn).toHaveBeenCalledWith(`${BACKEND}/`, { cache: "no-store" });
  });

  it("retries while the backend is restarting", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValue(ok(PAGE));
    expect(await fetchLivePage(BACKEND, fetchFn, noWait)).toBe(PAGE);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt limit so the shell can fall back", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("connection refused"));
    expect(await fetchLivePage(BACKEND, fetchFn, noWait)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(FETCH_ATTEMPTS);
  });

  it("refuses a page that is not the app, such as a login form", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok("<html><body><form>login</form></body></html>"));
    expect(await fetchLivePage(BACKEND, fetchFn, noWait)).toBeNull();
  });
});
