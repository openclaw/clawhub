import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", "test-artifact/**"],
  },
});
