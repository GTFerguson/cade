import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Backend port for WebSocket proxy (default: 3001 for dev)
const backendPort = process.env.BACKEND_PORT || "3001";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      "mertex.md": resolve(__dirname, "../mertex.md/dist/mertex.esm.js"),
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
