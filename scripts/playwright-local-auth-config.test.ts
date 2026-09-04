/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  buildLocalAuthBackendEnv,
  buildLocalAuthTrendingSnapshotArgs,
  resolveLocalAuthDeployment,
  resolveLocalAuthExternalNodeDependencies,
  resolveLocalAuthRunnerConfig,
} from "./playwright-local-auth-config";

describe("playwright local-auth runner config", () => {
  it("sets the backend transport timeout and bounded, cache-preferring npm fetches", () => {
    expect(buildLocalAuthBackendEnv()).toEqual({
      HTTP_SERVER_TIMEOUT_SECONDS: "900",
      npm_config_prefer_offline: "true",
      npm_config_fetch_timeout: "60000",
      npm_config_fetch_retries: "5",
    });
  });

  it("defaults local-auth Convex to the anonymous deployment marker", () => {
    expect(resolveLocalAuthDeployment(undefined, null)).toBe("anonymous:anonymous-agent");
    expect(resolveLocalAuthDeployment(undefined, undefined)).toBe("anonymous:anonymous-agent");
  });

  it("prefers explicit and discovered local-auth deployments before the default", () => {
    expect(resolveLocalAuthDeployment("anonymous:explicit-agent", "anonymous:local-agent")).toBe(
      "anonymous:explicit-agent",
    );
    expect(resolveLocalAuthDeployment(undefined, "anonymous:local-agent")).toBe(
      "anonymous:local-agent",
    );
  });

  it("does not inherit the generic CI Convex URL", () => {
    expect(
      resolveLocalAuthRunnerConfig({
        VITE_CONVEX_URL: "https://example.invalid",
        VITE_CONVEX_SITE_URL: "https://example.invalid",
      }),
    ).toMatchObject({
      convexSiteUrl: "http://127.0.0.1:3211",
      convexUrl: "http://127.0.0.1:3210",
    });
  });

  it("uses local-auth-specific Convex URL overrides", () => {
    expect(
      resolveLocalAuthRunnerConfig({
        PLAYWRIGHT_LOCAL_AUTH_CONVEX_SITE_URL: "http://127.0.0.1:4311",
        PLAYWRIGHT_LOCAL_AUTH_CONVEX_URL: "http://127.0.0.1:4310",
      }),
    ).toMatchObject({
      convexSiteUrl: "http://127.0.0.1:4311",
      convexUrl: "http://127.0.0.1:4310",
    });
  });

  it("passes explicit Playwright args and defaults to the local-auth suite", () => {
    expect(resolveLocalAuthRunnerConfig({}, ["--", "e2e/example.pw.test.ts"])).toMatchObject({
      playwrightArgs: ["--retries=1", "e2e/example.pw.test.ts"],
    });
    expect(resolveLocalAuthRunnerConfig({}).playwrightArgs).toEqual([
      "--retries=1",
      "--project=chromium",
      "e2e/local-auth",
    ]);
  });

  it("preserves an explicit Playwright retries override", () => {
    expect(
      resolveLocalAuthRunnerConfig({}, ["--", "--retries=0", "e2e/example.pw.test.ts"]),
    ).toMatchObject({
      playwrightArgs: ["--retries=0", "e2e/example.pw.test.ts"],
    });
    expect(
      resolveLocalAuthRunnerConfig({}, ["--", "--retries", "2", "e2e/example.pw.test.ts"]),
    ).toMatchObject({
      playwrightArgs: ["--retries", "2", "e2e/example.pw.test.ts"],
    });
  });

  it("builds a valid empty canonical snapshot for the isolated runtime", () => {
    expect(buildLocalAuthTrendingSnapshotArgs(86_400_000)).toEqual({
      start: {
        snapshotId: "local-auth-canonical-trending-v1",
        generatedAt: 86_400_000,
        expiresAt: 259_200_000,
        windowStartDay: 0,
        windowEndDay: 1,
      },
      finalize: {
        snapshotId: "local-auth-canonical-trending-v1",
        completedAt: 86_400_000,
        totalItems: 0,
        sourceCounts: {
          clawhubTrending: 0,
          clawhubRising: 0,
          skillsShTrending: 0,
        },
        operations: {
          documentsRead: 0,
          documentsWritten: 2,
          functionCalls: 2,
        },
      },
    });
  });
});

describe("local-auth external Node dependencies", () => {
  function resolveFromFiles(files: Record<string, unknown>) {
    return resolveLocalAuthExternalNodeDependencies({
      readFile: (path) => {
        if (!(path in files)) throw new Error(`Missing file: ${path}`);
        return JSON.stringify(files[path]);
      },
    });
  }

  it("pins explicit package names to their installed versions, including scoped packages", () => {
    expect(
      resolveFromFiles({
        "convex.json": { node: { externalPackages: ["sharp", "@example/native"] } },
        "node_modules/sharp/package.json": { version: "0.35.3" },
        "node_modules/@example/native/package.json": { version: "1.2.3" },
      }),
    ).toEqual([
      { name: "sharp", version: "0.35.3" },
      { name: "@example/native", version: "1.2.3" },
    ]);
  });

  it.each([
    { externalPackages: ["*"] },
    { externalPackages: ["sharp", "*"] },
    { externalPackages: ["sharp", 42] },
    { externalPackages: [null] },
    { externalPackages: [""] },
    { externalPackages: "sharp" },
  ])("skips non-explicit external package lists: $externalPackages", (node) => {
    expect(
      resolveFromFiles({
        "convex.json": { node },
        "node_modules/sharp/package.json": { version: "0.35.3" },
      }),
    ).toEqual([]);
  });

  it("returns no dependencies when convex.json is missing", () => {
    expect(resolveFromFiles({})).toEqual([]);
  });

  it.each([{}, { node: {} }, null])(
    "returns no dependencies without externalPackages: %j",
    (config) => {
      expect(resolveFromFiles({ "convex.json": config })).toEqual([]);
    },
  );

  it("skips a missing package.json while resolving the other installed packages", () => {
    expect(
      resolveFromFiles({
        "convex.json": { node: { externalPackages: ["missing", "sharp"] } },
        "node_modules/sharp/package.json": { version: "0.35.3" },
      }),
    ).toEqual([{ name: "sharp", version: "0.35.3" }]);
  });

  it.each([{}, { version: 42 }, { version: "" }, null])(
    "skips packages without a version: %j",
    (pkg) => {
      expect(
        resolveFromFiles({
          "convex.json": { node: { externalPackages: ["sharp"] } },
          "node_modules/sharp/package.json": pkg,
        }),
      ).toEqual([]);
    },
  );
});
