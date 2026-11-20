/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));

const nativeFindings = [
  {
    id: "demo:package-json-missing",
    code: "package-json-missing",
    level: "warning",
    message: "fixture has no package.json to describe install and plugin entrypoint metadata",
    authorRemediation: { summary: "Add a package.json to the plugin package." },
  },
  {
    id: "demo:package-openclaw-entry-missing",
    code: "package-openclaw-entry-missing",
    level: "warning",
    message: "package openclaw metadata does not declare plugin entrypoints",
    authorRemediation: { summary: "Declare OpenClaw package entrypoints." },
  },
];

// Posts a worker result to the shipped results route and reads back what was stored.
async function scanThroughResultsRoute(
  family: "bundle-plugin" | "code-plugin",
  findings: unknown[],
) {
  vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "family-findings-test-worker");
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "demo-owner", role: "user" });
    const packageId = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo plugin",
      family,
      ownerUserId,
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      changelog: "",
      distTags: [],
      files: [],
      integritySha256: "a".repeat(64),
      createdAt: 1,
      createdBy: ownerUserId,
      publicationStatus: "published",
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
    return { packageId, releaseId };
  });
  const response = await t.fetch("/api/v1/package-inspector/results", {
    method: "POST",
    headers: {
      authorization: "Bearer family-findings-test-worker",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...ids,
      inspectorVersion: "0.4.6",
      targetOpenClawVersion: "2026.10.14",
      notifyOwners: false,
      findings,
    }),
  });
  const stored = await t.run(async (ctx) => ({
    warnings: (
      await ctx.db
        .query("packageInspectorWarnings")
        .withIndex("by_release", (q) => q.eq("releaseId", ids.releaseId))
        .collect()
    )
      .map((warning) => warning.code)
      .sort(),
    outcomes: (await ctx.db.query("packageInspectorScanStates").collect()).map(
      (state) => state.outcome,
    ),
  }));
  return { status: response.status, ...stored };
}

describe("package inspector results route and package family", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores a configuration-only bundle scan as clean when only native findings fired", async () => {
    await expect(scanThroughResultsRoute("bundle-plugin", nativeFindings)).resolves.toEqual({
      status: 200,
      warnings: [],
      outcomes: ["clean"],
    });
  });

  it("keeps the native findings for a code plugin", async () => {
    await expect(scanThroughResultsRoute("code-plugin", nativeFindings)).resolves.toEqual({
      status: 200,
      warnings: ["package-json-missing", "package-openclaw-entry-missing"],
      outcomes: ["findings"],
    });
  });
});
