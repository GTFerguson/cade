import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "../core/frontend"),
      // core/frontend imports Tauri packages installed under frontend/.
      // Resolving from core/ won't find them, so map the subpaths explicitly
      // (mirrors vite.config.ts). The imports are dynamic and gated on
      // isTauri(), so they never execute under test — they just need to resolve.
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
    },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "../core/frontend/**/*.test.ts",
    ],
    environment: "node",
    environmentMatchGlobs: [
      ["../core/frontend/chat/**/*.test.ts", "jsdom"],
    ],
  },
});
