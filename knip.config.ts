const convexRegisteredFunctionEntries = [
  "convex/*.{ts,tsx}!",
  "convex/httpApiV1/*.{ts,tsx}!",
] as const;

const includeTests = process.env.KNIP_INCLUDE_TESTS === "1";

const config = {
  ignore: [
    ".artifacts/**",
    ".nitro/**",
    ".output/**",
    ".tanstack/**",
    ".vercel/**",
    "coverage/**",
    "dist/**",
    "src/routeTree.gen.ts",
    "convex/_generated/**",
    "packages/*/dist/**",
    "packages/clawhub/test-artifact/**",
  ],
  ...(includeTests
    ? {}
    : {
        ignoreFiles: [
          "**/*.test.{ts,tsx,mjs,js}",
          "**/__tests__/**",
          "src/__tests__/helpers/**",
          "packages/clawhub/test/**",
          "vitest.setup.ts",
        ],
      }),
  workspaces: {
    ".": {
      entry: [
        "src/router.tsx!",
        "src/routes/**/*.{ts,tsx}!",
        "src/styles.css!",
        "server/**/*.{ts,tsx}!",
        "scripts/**/*.{ts,mjs,js}!",
        "*.{config,setup}.{ts,mjs,js}!",
        ...convexRegisteredFunctionEntries,
        ...(includeTests
          ? [
              "src/**/*.test.{ts,tsx}!",
              "src/__tests__/**/*.{ts,tsx}!",
              "convex/**/*.test.{ts,tsx}!",
              "scripts/**/*.test.{ts,mjs,js}!",
              "server/**/*.test.{ts,tsx}!",
            ]
          : []),
      ],
      ignoreDependencies: [
        "@fontsource/bricolage-grotesque",
        "@fontsource/ibm-plex-mono",
        "@fontsource/manrope",
        "tailwindcss",
        "tw-animate-css",
      ],
      project: [
        "src/**/*.{ts,tsx}!",
        "src/**/*.css!",
        "convex/**/*.{ts,tsx}!",
        "server/**/*.{ts,tsx}!",
        "scripts/**/*.{ts,mjs,js}!",
        "*.{config,setup}.{ts,mjs,js}!",
      ],
    },
    "packages/clawhub": {
      entry: [
        "bin/clawdhub.js!",
        "scripts/build.mjs!",
        "src/cli.ts!",
        "src/http.ts!",
        "vitest*.ts!",
        ...(includeTests
          ? ["src/**/*.test.ts!", "test/**/*.ts!", "test-artifact/**/*.ts!"]
          : []),
      ],
      project: [
        "bin/**/*.js!",
        "scripts/**/*.{mjs,js,ts}!",
        "src/**/*.ts!",
        "test/**/*.ts!",
        "vitest*.ts!",
      ],
    },
    "packages/schema": {
      entry: [
        "src/index.ts!",
        "src/licenseConstants.ts!",
        "src/routes.ts!",
        "src/textFiles.ts!",
        ...(includeTests ? ["src/**/*.test.ts!"] : []),
      ],
      project: ["src/**/*.ts!"],
    },
  },
} as const;

export default config;
