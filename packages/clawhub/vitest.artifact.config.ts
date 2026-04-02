import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test-artifact/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
