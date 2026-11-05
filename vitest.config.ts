import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const testingLibraryRequire = createRequire(require.resolve("@testing-library/react"));
const recordCiObservations = process.env.CLAWHUB_CI_TEST_OBSERVATIONS === "1";

export default defineConfig({
  ...(recordCiObservations ? { cacheDir: ".artifacts/ci-test-observations/cache" } : {}),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "react/jsx-dev-runtime",
        replacement: testingLibraryRequire.resolve("react/jsx-dev-runtime"),
      },
      {
        find: "react/jsx-runtime",
        replacement: testingLibraryRequire.resolve("react/jsx-runtime"),
      },
      { find: "react-dom/client", replacement: testingLibraryRequire.resolve("react-dom/client") },
      { find: "react-dom", replacement: testingLibraryRequire.resolve("react-dom") },
      { find: "react", replacement: testingLibraryRequire.resolve("react") },
    ],
  },
  test: {
    ...(recordCiObservations
      ? {
          experimental: { recordDependencies: true },
          reporters: ["default", "./scripts/ci-test-observations.mjs"],
        }
      : {}),
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    exclude: [
      "**/node_modules/**",
      "**/.artifacts/**",
      "artifacts/**",
      "**/.vercel/output/**",
      "**/.output/**",
      "**/.nitro/**",
      "**/dist/**",
      "**/coverage/**",
      "**/convex/_generated/**",
      ".github/scripts/catalog-feed-schema-version-guard.test.cjs",
      "packages/clawhub/**",
      "packages/clawhub-admin/**",
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
        ".artifacts/",
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
