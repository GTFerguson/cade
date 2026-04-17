import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "../core/frontend"),
    },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "../core/frontend/**/*.test.ts",
    ],
    environment: "node",
  },
});
