/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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

const retainedNativeFindings = nativeFindings.map(({ id: _id, ...finding }) => finding);

async function retainedFindingsFixture(family: "bundle-plugin" | "code-plugin") {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      handle: "retained-owner",
      email: "owner@example.com",
      role: "user",
    });
    const packageId = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      name: "retained-plugin",
      normalizedName: "retained-plugin",
      displayName: "Retained plugin",
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
    await ctx.db.insert("packageSearchDigest", {
      packageId,
      name: "retained-plugin",
      normalizedName: "retained-plugin",
      displayName: "Retained plugin",
      ownerUserId,
      family,
      channel: "community",
      isOfficial: false,
      latestVersion: "1.0.0",
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    return { packageId, releaseId, ownerUserId };
  });
  const owner = t.withIdentity({ subject: ids.ownerUserId });
  const add = (finding: Partial<Doc<"packageInspectorWarnings">> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("packageInspectorWarnings", {
        ...ids,
        packageName: "retained-plugin",
        version: "1.0.0",
        code: "valid-warning",
        level: "warning",
        message: "A real applicable finding",
        authorRemediation: { summary: "Repair the applicable problem." },
        createdAt: 1,
        ...finding,
      }),
    );
  const rows = () =>
    t.run((ctx) =>
      ctx.db
        .query("packageInspectorWarnings")
        .withIndex("by_release_created", (q) => q.eq("releaseId", ids.releaseId))
        .collect(),
    );
  const report = async () =>
    (await t.query(internal.packages.listPluginValidationReportPageInternal, { numItems: 10 }))
      .items[0];
  return { t, owner, ...ids, add, rows, report };
}

describe("retained Inspector finding applicability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["bundle-plugin", "code-plugin"] as const)(
    "selects applicable retained publish and legacy findings before the %s display limit",
    async (family) => {
      const { t, owner, packageId, releaseId, add, rows, report } =
        await retainedFindingsFixture(family);
      await add();
      await add({ ...retainedNativeFindings[0], scanSource: "publish", createdAt: 2 });
      await add({ ...retainedNativeFindings[1], createdAt: 3 });
      const before = await rows();
      const expectedCodes =
        family === "bundle-plugin"
          ? ["valid-warning"]
          : ["package-openclaw-entry-missing", "package-json-missing", "valid-warning"];
      const expected = expectedCodes.map((code) => expect.objectContaining({ code }));
      expect(
        await owner.query(api.packages.listPackageInspectorFindingsPublic, {
          name: "retained-plugin",
        }),
      ).toEqual(expected);
      expect(
        await owner.query(api.packages.listPackageInspectorWarningsForManager, {
          name: "retained-plugin",
          limit: 1,
        }),
      ).toEqual(expected.slice(0, 1));
      expect(
        await t.query(api.packages.getPackageInspectorValidationSummaryPublic, {
          name: "retained-plugin",
        }),
      ).toMatchObject({
        findingCount: expected.length,
        warningCount: expected.length,
        errorCount: 0,
      });
      expect((await owner.query(api.packages.list, {}))[0]).toMatchObject({
        inspectorWarningCount: expected.length,
        scanStatus: "clean",
      });
      expect((await report())?.findings.map((finding) => finding.code)).toEqual(
        family === "bundle-plugin"
          ? ["valid-warning"]
          : ["valid-warning", "package-json-missing", "package-openclaw-entry-missing"],
      );
      expect(await rows()).toEqual(before);
      expect(await t.run((ctx) => ctx.db.get(packageId))).toMatchObject({
        scanStatus: "clean",
        latestReleaseId: releaseId,
      });
      expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
        publicationStatus: "published",
        verification: { scanStatus: "clean" },
      });
    },
  );

  it("keeps retained rows out of bundle views after a successful native-only nightly reingest", async () => {
    const { t, owner, packageId, releaseId, add, rows, report } =
      await retainedFindingsFixture("bundle-plugin");
    await add({ ...retainedNativeFindings[0], scanSource: "publish" });
    await add({ ...retainedNativeFindings[1], createdAt: 2 });
    const before = await rows();
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "family-findings-test-worker");
    const response = await t.fetch("/api/v1/package-inspector/results", {
      method: "POST",
      headers: {
        authorization: "Bearer family-findings-test-worker",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        packageId,
        releaseId,
        inspectorVersion: "0.4.6",
        targetOpenClawVersion: "2026.10.14",
        notifyOwners: false,
        findings: nativeFindings,
      }),
    });
    expect(response.status).toBe(200);
    expect(
      await owner.query(api.packages.listPackageInspectorWarningsForManager, {
        name: "retained-plugin",
      }),
    ).toEqual([]);
    expect(await report()).toMatchObject({
      findings: [],
      scan: { status: "clean", inspectorVersion: "0.4.6", target: { version: "2026.10.14" } },
    });
    expect(await rows()).toEqual(before);
  });

  it.each([false, true])(
    "preserves failed scan metadata with legacy native evidence=%s",
    async (legacyEvidence) => {
      const { t, packageId, releaseId, add, rows, report } =
        await retainedFindingsFixture("bundle-plugin");
      const identity = { inspectorVersion: "legacy", targetOpenClawVersion: "2026.10.14" };
      if (legacyEvidence)
        await add({
          ...retainedNativeFindings[0],
          ...identity,
          scanSource: "nightly",
          createdAt: 10,
        });
      await t.run((ctx) =>
        ctx.db.insert("packageInspectorScanStates", {
          packageId,
          releaseId,
          ...identity,
          scanSource: "nightly",
          completedAt: 20,
          outcome: "timeout",
          inspectionFailed: true,
        }),
      );
      const before = await rows();
      expect(await report()).toMatchObject({
        findings: [],
        scan: legacyEvidence
          ? {
              status: "clean",
              scannedAt: 10,
              inspectorVersion: "legacy",
              target: { version: identity.targetOpenClawVersion },
              skipReason: null,
            }
          : {
              status: "skipped",
              scannedAt: null,
              inspectorVersion: null,
              target: null,
              skipReason: "inspector-timeout",
            },
      });
      expect(await rows()).toEqual(before);
    },
  );

  it.each(["bundle-plugin", "code-plugin"] as const)(
    "filters only inapplicable %s email context, including exact nightly reads",
    async (family) => {
      const { t, packageId, releaseId, add } = await retainedFindingsFixture(family);
      const identity = { inspectorVersion: "0.4.6", targetOpenClawVersion: "2026.10.14" };
      await add({
        ...retainedNativeFindings[0],
        findingKind: "error",
        ...identity,
        scanSource: "nightly",
      });
      const args = { packageId, releaseId };
      for (const queryArgs of [args, { ...args, ...identity }]) {
        const context = await t.query(
          internal.packages.getPackageInspectorEmailContextInternal,
          queryArgs,
        );
        if (family === "bundle-plugin") expect(context).toBeNull();
        else
          expect(context?.findings).toEqual([
            expect.objectContaining({ code: "package-json-missing" }),
          ]);
      }
      await add({
        code: "real-error",
        findingKind: "error",
        ...identity,
        scanSource: "nightly",
        createdAt: 2,
      });
      const context = await t.query(internal.packages.getPackageInspectorEmailContextInternal, {
        ...args,
        ...identity,
      });
      expect(context?.findings.map((finding) => finding.code)).toEqual(
        family === "bundle-plugin" ? ["real-error"] : ["real-error", "package-json-missing"],
      );
      expect(
        await t.run((ctx) => ctx.db.query("packageInspectorFindingNotifications").collect()),
      ).toEqual([]);
    },
  );
});
