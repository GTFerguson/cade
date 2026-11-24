import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Backend port for WebSocket proxy (default: 3001 for dev)
const backendPort = process.env.BACKEND_PORT || "3001";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        // Desktop shell loader page (see src/shell/loader.ts).
        shell: resolve(__dirname, "shell.html"),
      },
    },
  },
  experimental: {
    // Chunks and assets the app loads at runtime (lazy imports, their CSS,
    // worker scripts) are addressed from the document by default. In the
    // desktop shell the document is the app's built-in page but the code
    // comes from the backend, so those lookups must go to the backend too:
    // the shell loader sets __ASSET_ORIGIN__ and everything else leaves it
    // unset, which keeps the usual base-relative URL.
    renderBuiltUrl(filename, { hostType }) {
      if (hostType !== "js") return undefined;
      return {
        runtime: `(globalThis.__ASSET_ORIGIN__||"")+${JSON.stringify(base + filename)}`,
      };
    },
  },
  resolve: {
    alias: {
      "mertex.md": resolve(__dirname, "../mertex.md/dist/mertex.esm.js"),
      "@core": resolve(__dirname, "../core/frontend"),
      // core/frontend files live outside frontend/, so Rollup's default
      // node_modules walk from core/ won't find Tauri packages installed
      // here. Map them explicitly.
      "@tauri-apps/plugin-dialog": resolve(
        __dirname,
        "node_modules/@tauri-apps/plugin-dialog"
      ),
      "@tauri-apps/api/window": resolve(
        __dirname,
        "node_modules/@tauri-apps/api/window.js"
      ),
      "@tauri-apps/api/core": resolve(
        __dirname,
        "node_modules/@tauri-apps/api/core.js"
      ),
      "@tauri-apps/api/webview": resolve(
        __dirname,
        "node_modules/@tauri-apps/api/webview.js"
      ),
      marked: resolve(__dirname, "node_modules/marked"),
      "highlight.js": resolve(__dirname, "node_modules/highlight.js"),
      "katex/contrib/auto-render": resolve(
        __dirname,
        "node_modules/katex/dist/contrib/auto-render.mjs"
      ),
      "katex/dist/katex.min.css": resolve(
        __dirname,
        "node_modules/katex/dist/katex.min.css"
      ),
      katex: resolve(__dirname, "node_modules/katex"),
      mermaid: resolve(__dirname, "node_modules/mermaid"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
