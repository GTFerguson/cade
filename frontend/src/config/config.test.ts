// @vitest-environment happy-dom
/**
 * The desktop shell hands the page its backend address by setting globals on
 * `window` once. These tests cover the page surviving a reload, which wipes
 * those globals without the shell setting them again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigModule = typeof import("./config");

const SHELL_GLOBALS = ["__BACKEND_URL__", "__TAURI__", "__HOME_DIR__"] as const;

function shellInjects(): void {
  const w = window as any;
  w.__BACKEND_URL__ = "http://127.0.0.1:38535";
  w.__TAURI__ = true;
  w.__HOME_DIR__ = "/home/someone";
}

/** A reload: every global is gone and the page's modules evaluate again. */
async function reloadPage(): Promise<ConfigModule> {
  for (const key of SHELL_GLOBALS) delete (window as any)[key];
  vi.resetModules();
  return import("./config");
}

beforeEach(() => {
  window.sessionStorage.clear();
  for (const key of SHELL_GLOBALS) delete (window as any)[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of SHELL_GLOBALS) delete (window as any)[key];
});

describe("desktop shell globals", () => {
  it("uses the injected backend address once it arrives", async () => {
    const { config } = await import("./config");
    shellInjects();
    expect(config.wsUrl).toBe("ws://127.0.0.1:38535/ws");
    expect(config.wsUrlPending).toBe(false);
  });

  it("still knows the backend after a reload wipes the injected globals", async () => {
    const first = await import("./config");
    shellInjects();
    expect(first.config.wsUrl).toBe("ws://127.0.0.1:38535/ws");

    const { config, isTauri } = await reloadPage();
    expect(config.wsUrl).toBe("ws://127.0.0.1:38535/ws");
    expect(config.wsUrlPending).toBe(false);
    expect(isTauri()).toBe(true);
    expect((window as any).__HOME_DIR__).toBe("/home/someone");
  });

  it("prefers a fresh injection over what an earlier page remembered", async () => {
    const first = await import("./config");
    shellInjects();
    void first.config.wsUrl;

    const { config } = await reloadPage();
    (window as any).__BACKEND_URL__ = "http://127.0.0.1:40001";
    expect(config.wsUrl).toBe("ws://127.0.0.1:40001/ws");

    const again = await reloadPage();
    expect(again.config.wsUrl).toBe("ws://127.0.0.1:40001/ws");
  });

  it("invents nothing in a plain browser", async () => {
    const { config, isTauri } = await import("./config");
    expect(isTauri()).toBe(false);
    expect((window as any).__BACKEND_URL__).toBeUndefined();
    expect(config.wsUrl).toContain(window.location.host);
  });
});

describe("apiBase", () => {
  it("is the page's own path in a browser, where the backend serves the page", async () => {
    const { apiBase, basePath } = await import("./config");
    expect(apiBase()).toBe(basePath);
  });

  it("is the backend's address in the desktop window, whose page the shell serves", async () => {
    shellInjects();
    const { apiBase } = await import("./config");
    expect(apiBase()).toBe("http://127.0.0.1:38535");
  });

  it("still reaches the backend after a reload has wiped the shell's globals", async () => {
    shellInjects();
    (await import("./config")).apiBase();
    const { apiBase } = await reloadPage();
    expect(apiBase()).toBe("http://127.0.0.1:38535");
  });
});
