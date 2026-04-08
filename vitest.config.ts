import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    exclude: [
      "**/node_modules/**",
      "**/.vercel/output/**",
      "**/.output/**",
      "**/.nitro/**",
      "**/dist/**",
      "**/coverage/**",
      "**/convex/_generated/**",
      "packages/clawhub/**",
      "e2e/**",
      "**/*.e2e.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
      include: [
        "src/lib/**/*.{ts,tsx}",
        "convex/lib/skills.ts",
        "convex/lib/skillZip.ts",
        "convex/lib/tokens.ts",
        "convex/httpApi.ts",
        "packages/schema/src/**/*.ts",
      ],
      exclude: [
        "node_modules/",
        ".vercel/output/",
        ".output/",
        ".nitro/",
        "dist/",
        "coverage/",
        "convex/_generated/",
        "packages/clawhub/**",
        "packages/schema/dist/",
        "e2e/**",
      ],
    },
  },
});
