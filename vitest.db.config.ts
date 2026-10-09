import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/db/**/*.test.ts"], environment: "node", testTimeout: 30000, fileParallelism: false },
});
