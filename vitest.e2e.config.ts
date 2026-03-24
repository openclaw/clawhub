import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.vercel/output/**",
      "**/.output/**",
      "**/dist/**",
      "**/coverage/**",
      "**/convex/_generated/**",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
