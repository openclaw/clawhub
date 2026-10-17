/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { failedSdkUsageReport, type SdkUsageReport } from "./lib/packageSdkUsageContract";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const artifactSha256 = "a".repeat(64);
const key = "api-member:api.registerTool";

function entry(identity = "api.registerTool"): SdkUsageReport["entries"][number] {
  return {
    key: `api-member:${identity}`,
    kind: "api-member",
    identity,
    classification: "runtime",
    referenceKinds: ["call"],
    evidence: [{ path: "index.js", line: 3, snippet: `${identity}(tool);` }],
    deprecationCodes: [],
  };
}

function inventory(entries = [entry()]): SdkUsageReport {
  return {
    schemaVersion: 1,
    analysisVersion: "1",
    inputKind: "artifact",
    status: "complete",
    entries,
    unknowns: [],
    coverage: { filesDiscovered: 1, filesAnalyzed: 1, filesExcluded: 0 },
  };
}

async function fixture() {
  vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "sdk-usage-test-worker");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "sdk-owner", role: "user" });
    const packageId = await ctx.db.insert("packages", {
      name: "sdk-plugin",
      normalizedName: "sdk-plugin",
      displayName: "SDK plugin",
      family: "code-plugin",
      channel: "community",
      ownerUserId,
      isOfficial: false,
      scanStatus: "clean",
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      changelog: "",
      distTags: [],
      files: [],
      integritySha256: artifactSha256,
      createdAt: 1,
      createdBy: ownerUserId,
      publicationStatus: "published",
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
    return { packageId, releaseId, ownerUserId };
  });
  const ingest = (sdkUsage: unknown, overrides: Record<string, unknown> = {}) =>
    t.fetch("/api/v1/package-inspector/results", {
      method: "POST",
      headers: {
        authorization: "Bearer sdk-usage-test-worker",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...ids,
        inspectorVersion: "inventory-test",
        targetOpenClawVersion: "2026.10.14",
        artifactSha256,
        notifyOwners: false,
        findings: [],
        sdkUsage,
        ...overrides,
      }),
    });
  const lookup = async () =>
    (await t.fetch(`/api/v1/sdk-usage?key=${encodeURIComponent(key)}`)).json();
  return { t, ...ids, ingest, lookup };
}

afterEach(() => vi.unstubAllEnvs());

describe("public SDK usage from serialized Inspector reports", () => {
  it("filters consumers and coverage by latest release date, not a recent scan or listing edit", async () => {
    const { t, packageId, releaseId, ingest } = await fixture();
    const releasedSince = Date.parse("2026-07-16T12:00:00.000Z");
    await t.run(async (ctx) => {
      await ctx.db.patch(releaseId, { createdAt: releasedSince - 1 });
      await ctx.db.patch(packageId, { updatedAt: releasedSince + 1000 });
    });
    await ingest(inventory());
    const query = `/api/v1/sdk-usage?key=${encodeURIComponent(key)}&releasedSince=${releasedSince}`;
    const old = await (await t.fetch(query)).json();
    expect(old.items).toEqual([]);
    expect(old.coverage.counts.eligible).toBe(0);
    expect(old.releasedSince).toBe(releasedSince);
    expect(old.coverageUrl).toBe(`/api/v1/sdk-usage/coverage?releasedSince=${releasedSince}`);

    await t.run((ctx) => ctx.db.patch(releaseId, { createdAt: releasedSince }));
    const recent = await (await t.fetch(query)).json();
    expect(recent.items).toMatchObject([{ releaseId, releaseCreatedAt: releasedSince }]);
    expect(recent.coverage).toMatchObject({
      releasedSince,
      counts: { eligible: 1, complete: 1 },
      items: [{ releaseId, releaseCreatedAt: releasedSince }],
    });
    const plugin = await (await t.fetch("/api/v1/sdk-usage/plugin?package=sdk-plugin")).json();
    expect(plugin.releaseCreatedAt).toBe(releasedSince);
  });

  it("does not count a source-checkout scan as published-artifact coverage", async () => {
    const { ingest, lookup } = await fixture();
    const response = await ingest({ ...inventory(), inputKind: "source" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sdkUsage: { status: "incompatible", applied: false },
    });
    const result = await lookup();
    expect(result.items).toEqual([]);
    expect(result.coverage.counts).toMatchObject({ complete: 0, incompatible: 1 });
  });

  it("records malformed inventory as failed without retaining visible old usage", async () => {
    const { ingest, lookup, t } = await fixture();
    expect((await ingest(inventory())).status).toBe(200);
    const malformed = inventory([{ ...entry(), key: "api-member:wrong" }]);
    const response = await ingest(malformed);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sdkUsage: { status: "failed", applied: false } });
    expect((await lookup()).items).toEqual([]);
    expect(
      await (await t.fetch("/api/v1/sdk-usage/plugin?package=sdk-plugin")).json(),
    ).toMatchObject({ scan: { status: "failed" }, items: [] });
  });

  it("rejects invalid page sizes and malformed canonical keys", async () => {
    const { t } = await fixture();
    for (const url of [
      "/api/v1/sdk-usage?key=registerTool",
      `/api/v1/sdk-usage?key=${encodeURIComponent(key)}&limit=101`,
      "/api/v1/sdk-usage/coverage?limit=-1",
      "/api/v1/sdk-usage/plugin?package=sdk-plugin&limit=1.5",
    ]) {
      expect((await t.fetch(url)).status).toBe(400);
    }
  });

  it("rejects invalid release cutoffs on both public cohort endpoints", async () => {
    const { t } = await fixture();
    for (const value of ["", "-1", "1.5", "NaN", "Infinity", "8640000000000001"])
      for (const endpoint of [
        `/api/v1/sdk-usage?key=${encodeURIComponent(key)}&`,
        "/api/v1/sdk-usage/coverage?",
      ])
        expect((await t.fetch(`${endpoint}releasedSince=${value}`)).status).toBe(400);
  });

  it.each(["missing", "failed"])("keeps recent %s scans in filtered coverage", async (status) => {
    const { t, releaseId, ingest } = await fixture();
    await t.run((ctx) => ctx.db.patch(releaseId, { createdAt: 1000 }));
    if (status === "failed") await ingest({ ...inventory([]), status: "failed" });
    const result = await (await t.fetch("/api/v1/sdk-usage/coverage?releasedSince=1000")).json();
    expect(result).toMatchObject({
      releasedSince: 1000,
      counts: { eligible: 1, complete: 0, [status]: 1 },
      items: [{ releaseId, releaseCreatedAt: 1000, status }],
    });
  });
  it.each(["inline", "stored", "expired"])(
    "finalizes a warning-free publish with explicit inventory state (%s)",
    async (mode) => {
      const largeReport = mode !== "inline";
      const { t, packageId, releaseId, ownerUserId, lookup } = await fixture();
      const report = inventory(
        largeReport
          ? Array.from({ length: 1000 }, (_, index) => ({
              ...entry(index === 0 ? "api.registerTool" : `api.member${index}`),
              evidence: Array.from({ length: 3 }, () => ({
                path: "index.js",
                line: 3,
                snippet: "x".repeat(500),
              })),
            }))
          : undefined,
      );
      const serialized = JSON.stringify(report);
      if (largeReport)
        expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(1024 * 1024);
      const storageId = largeReport
        ? await t.run((ctx) =>
            ctx.storage.store(new Blob([serialized], { type: "application/json" })),
          )
        : undefined;
      const attemptId = await t.run(async (ctx) => {
        await ctx.db.patch(releaseId, { publicationStatus: "pending" });
        return ctx.db.insert("publishAttempts", {
          kind: "package",
          status: "ready_to_finalize",
          userId: ownerUserId,
          packageId,
          packageReleaseId: releaseId,
          slug: "sdk-plugin",
          displayName: "SDK plugin",
          version: "1.0.0",
          idempotencyKey: "sdk-inventory-publish",
          artifactFingerprint: artifactSha256,
          files: [],
          checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
          packageFollowup: {
            ownerUserId,
            packageName: "sdk-plugin",
            version: "1.0.0",
            inspectorWarnings: [],
            inspectorMetadata: {
              inspectorVersion: "inventory-test",
              targetOpenClawVersion: "2026.10.14",
            },
            ...(storageId
              ? { inspectorSdkUsageStorageId: storageId }
              : { inspectorSdkUsage: report }),
          },
          createdAt: 1,
          updatedAt: 1,
          expiresAt: Date.now() + 60_000,
        });
      });
      if (mode === "expired") {
        await t.mutation(internal.packageSdkUsage.deleteTemporaryReportInternal, {
          storageId: storageId!,
        });
        // Scheduled expiry is safe if the file was already consumed or removed.
        await t.mutation(internal.packageSdkUsage.deleteTemporaryReportInternal, {
          storageId: storageId!,
        });
      }
      const result = await t.action(internal.packages.finalizePackagePublishAttemptInternal, {
        attemptId,
      });
      expect(result).toMatchObject({ ok: true, packageId, releaseId });
      expect((await lookup()).counts.distinctPlugins).toBe(mode === "expired" ? 0 : 1);
      const publicInventory = await (
        await t.fetch("/api/v1/sdk-usage/plugin?package=sdk-plugin")
      ).json();
      expect(publicInventory.scan).toMatchObject({
        status: mode === "expired" ? "failed" : "complete",
        entryCount: mode === "expired" ? 0 : largeReport ? 1000 : 1,
      });
      expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "finalized" });
      if (storageId) expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    },
  );

  it("persists a warning-free inventory and returns one plugin with evidence and complete coverage", async () => {
    const { t, packageId, releaseId } = await fixture();
    const report = {
      status: "ok",
      sdkUsage: {
        schemaVersion: 1,
        analysisVersion: "1",
        inputKind: "artifact",
        status: "complete",
        entries: [
          {
            key,
            kind: "api-member",
            identity: "api.registerTool",
            classification: "runtime",
            referenceKinds: ["call"],
            evidence: [{ path: "index.js", line: 3, snippet: "api.registerTool(tool);" }],
            deprecationCodes: [],
          },
        ],
        unknowns: [],
        coverage: { filesDiscovered: 1, filesAnalyzed: 1, filesExcluded: 0 },
      },
    };
    const ingestion = await t.fetch("/api/v1/package-inspector/results", {
      method: "POST",
      headers: {
        authorization: "Bearer sdk-usage-test-worker",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        packageId,
        releaseId,
        inspectorVersion: "inventory-test",
        targetOpenClawVersion: "2026.10.14",
        artifactSha256,
        notifyOwners: false,
        findings: [],
        sdkUsage: report.sdkUsage,
      }),
    });
    expect(ingestion.status, await ingestion.clone().text()).toBe(200);
    expect((await ingestion.json()).sdkUsage).toMatchObject({
      status: "complete",
      applied: true,
      entryCount: 1,
    });
    const response = await t.fetch(`/api/v1/sdk-usage?key=${encodeURIComponent(key)}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        packageName: "sdk-plugin",
        version: "1.0.0",
        key,
        classification: "runtime",
        evidence: report.sdkUsage.entries[0].evidence,
      }),
    ]);
    expect(body.counts).toEqual({ scope: "page", distinctPlugins: 1 });
    expect(body.nextCursor).toBeNull();
    expect(body.coverage).toMatchObject({
      scope: "page",
      nextCursor: null,
      counts: { eligible: 1, complete: 1, partial: 0, failed: 0, missing: 0, incompatible: 0 },
      items: [
        {
          packageName: "sdk-plugin",
          version: "1.0.0",
          releaseId,
          status: "complete",
          unknownCount: 0,
        },
      ],
    });
  });

  it("deduplicates retries and replaces all relationships with an explicit completed-empty inventory", async () => {
    const { ingest, lookup } = await fixture();
    for (let i = 0; i < 2; i++)
      expect((await ingest(inventory([entry(), entry()]))).status).toBe(200);
    expect((await lookup()).counts.distinctPlugins).toBe(1);
    expect((await ingest(inventory([]))).status).toBe(200);
    const empty = await lookup();
    expect(empty.items).toEqual([]);
    expect(empty.coverage.counts).toMatchObject({ eligible: 1, complete: 1, missing: 0 });
  });

  it("requires a compatible applied inventory before the bulk scanner may skip a release", async () => {
    const { t, ingest } = await fixture();
    const claim = () =>
      t.query(internal.packages.previewPackageInspectorScanBatchInternal, {
        inspectorVersion: "inventory-test",
        targetOpenClawVersion: "2026.10.14",
        inventorySchemaVersion: 1,
        inventoryAnalysisVersion: "1",
        notifyOwners: false,
      });
    await ingest(undefined);
    expect((await claim()).items).toHaveLength(1);
    await ingest(inventory([]));
    expect(await claim()).toMatchObject({
      items: [],
      skippedUnchanged: 1,
      skipped: [
        { packageName: "sdk-plugin", version: "1.0.0", reason: "compatible-complete-inventory" },
      ],
    });
    await ingest({ ...inventory([]), status: "partial" });
    expect((await claim()).items).toHaveLength(1);
  });

  it("keeps a crashed Inspector run retryable and clears that mark after a later success", async () => {
    const { t, releaseId, ingest } = await fixture();
    const failed = await ingest(failedSdkUsageReport("inspector crashed"), {
      inspectorVersion: "0.4.3",
      targetOpenClawVersion: "2026.10.16",
      inspectionFailed: true,
    });
    expect(failed.status).toBe(200);
    const crashed = await t.run(async (ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
          q
            .eq("releaseId", releaseId)
            .eq("inspectorVersion", "0.4.3")
            .eq("targetOpenClawVersion", "2026.10.16"),
        )
        .unique(),
    );
    expect(crashed?.inspectionFailed).toBe(true);
    expect(crashed?.sdkUsage?.status).toBe("failed");
    expect(crashed?.notificationCompletedAt).toBeUndefined();
    const retry = await t.query(internal.packages.previewPackageInspectorScanBatchInternal, {
      inspectorVersion: "0.4.3",
      targetOpenClawVersion: "2026.10.16",
      inventorySchemaVersion: 1,
      inventoryAnalysisVersion: "1",
      notifyOwners: false,
    });
    expect(retry.items).toEqual([
      expect.objectContaining({ packageName: "sdk-plugin", version: "1.0.0" }),
    ]);
    expect(
      (
        await ingest(inventory([]), {
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: "2026.10.16",
        })
      ).status,
    ).toBe(200);
    const recovered = await t.run(async (ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
          q
            .eq("releaseId", releaseId)
            .eq("inspectorVersion", "0.4.3")
            .eq("targetOpenClawVersion", "2026.10.16"),
        )
        .unique(),
    );
    expect(recovered?.inspectionFailed).toBeUndefined();
    expect(recovered?.sdkUsage?.status).toBe("complete");
    const afterRecovery = await t.query(
      internal.packages.previewPackageInspectorScanBatchInternal,
      {
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.10.16",
        inventorySchemaVersion: 1,
        inventoryAnalysisVersion: "1",
        notifyOwners: false,
      },
    );
    expect(afterRecovery).toMatchObject({
      items: [],
      skippedUnchanged: 1,
      skipped: [
        { packageName: "sdk-plugin", version: "1.0.0", reason: "compatible-complete-inventory" },
      ],
    });
  });

  it("keeps stored findings in the validation report after the same tuple crashes", async () => {
    const { t, packageId, releaseId, ownerUserId, ingest } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const finding = {
      code: "missing-api",
      message: "Required API is unavailable",
      severity: "P0",
      authorRemediation: { summary: "Update the plugin." },
    };
    expect(
      (
        await ingest(inventory([]), {
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: "2026.10.16",
          findings: [finding],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await ingest(failedSdkUsageReport("inspector crashed"), {
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: "2026.10.16",
          inspectionFailed: true,
          findings: [],
        })
      ).status,
    ).toBe(200);
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        package: expect.objectContaining({ name: "sdk-plugin" }),
        scan: expect.objectContaining({
          status: "error",
          inspectorVersion: "0.4.3",
          target: { channel: "beta", version: "2026.10.16" },
        }),
        findings: [expect.objectContaining({ code: "missing-api", severity: "error" })],
      }),
    ]);
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
          q
            .eq("releaseId", releaseId)
            .eq("inspectorVersion", "0.4.3")
            .eq("targetOpenClawVersion", "2026.10.16"),
        )
        .unique(),
    );
    expect(stored?.inspectionFailed).toBe(true);
    expect(stored?.findingsCompletedAt).toEqual(expect.any(Number));
    expect(stored?.completedAt).toBeGreaterThan(stored?.findingsCompletedAt ?? 0);
    expect(report.items[0]?.scan.scannedAt).toBe(stored?.findingsCompletedAt);
  });

  it("still reports a legacy findings row that has no findingsCompletedAt", async () => {
    const { t, packageId, releaseId, ownerUserId } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        completedAt: 100,
      });
      await ctx.db.insert("packageInspectorWarnings", {
        packageId,
        releaseId,
        ownerUserId,
        packageName: "sdk-plugin",
        version: "1.0.0",
        scanSource: "nightly",
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        findingKind: "error",
        code: "missing-api",
        message: "Required API is unavailable",
        createdAt: 100,
      });
      for (let index = 0; index < 21; index += 1) {
        await ctx.db.insert("packageInspectorScanStates", {
          packageId,
          releaseId,
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: `2026.11.${index + 1}`,
          completedAt: 200 + index,
          inspectionFailed: true,
        });
      }
    });
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items[0]).toMatchObject({
      scan: { status: "error", scannedAt: 100, inspectorVersion: "0.4.2" },
      findings: [expect.objectContaining({ code: "missing-api", severity: "error" })],
    });
  });

  it("keeps a legacy findings time when that same tuple crashes after the upgrade", async () => {
    const { t, packageId, releaseId, ownerUserId, ingest } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.10.16",
        completedAt: 100,
      });
      await ctx.db.insert("packageInspectorWarnings", {
        packageId,
        releaseId,
        ownerUserId,
        packageName: "sdk-plugin",
        version: "1.0.0",
        scanSource: "nightly",
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.10.16",
        findingKind: "error",
        code: "missing-api",
        message: "Required API is unavailable",
        createdAt: 100,
      });
    });
    expect(
      (
        await ingest(failedSdkUsageReport("inspector crashed"), {
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: "2026.10.16",
          inspectionFailed: true,
          findings: [],
        })
      ).status,
    ).toBe(200);
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
          q
            .eq("releaseId", releaseId)
            .eq("inspectorVersion", "0.4.3")
            .eq("targetOpenClawVersion", "2026.10.16"),
        )
        .unique(),
    );
    expect(stored?.inspectionFailed).toBe(true);
    expect(stored?.findingsCompletedAt).toBe(100);
    expect(stored?.completedAt).toBeGreaterThan(100);
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items[0]).toMatchObject({
      scan: { status: "error", scannedAt: 100, inspectorVersion: "0.4.3" },
      findings: [expect.objectContaining({ code: "missing-api", severity: "error" })],
    });
  });

  it("keeps a newer legacy findings row ahead of an older tuple promoted by a crash", async () => {
    const { t, packageId, releaseId, ownerUserId, ingest } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        completedAt: 100,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.10.16",
        completedAt: 200,
      });
      await ctx.db.insert("packageInspectorWarnings", {
        packageId,
        releaseId,
        ownerUserId,
        packageName: "sdk-plugin",
        version: "1.0.0",
        scanSource: "nightly",
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.10.16",
        findingKind: "error",
        code: "missing-api",
        message: "Required API is unavailable",
        createdAt: 200,
      });
    });
    expect(
      (
        await ingest(failedSdkUsageReport("inspector crashed"), {
          inspectorVersion: "0.4.2",
          targetOpenClawVersion: "2026.10.01",
          inspectionFailed: true,
          findings: [],
        })
      ).status,
    ).toBe(200);
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
          q
            .eq("releaseId", releaseId)
            .eq("inspectorVersion", "0.4.2")
            .eq("targetOpenClawVersion", "2026.10.01"),
        )
        .unique(),
    );
    expect(stored?.inspectionFailed).toBe(true);
    expect(stored?.findingsCompletedAt).toBe(100);
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items[0]).toMatchObject({
      scan: { status: "error", scannedAt: 200, inspectorVersion: "0.4.3" },
      findings: [expect.objectContaining({ code: "missing-api", severity: "error" })],
    });
  });

  it("reads several legacy releases in one validation report page", async () => {
    const { t, packageId, releaseId, ownerUserId } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 2,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        completedAt: 100,
      });
      await ctx.db.insert("packageInspectorWarnings", {
        packageId,
        releaseId,
        ownerUserId,
        packageName: "sdk-plugin",
        version: "1.0.0",
        scanSource: "nightly",
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        findingKind: "error",
        code: "missing-api",
        message: "Required API is unavailable",
        createdAt: 100,
      });
      const otherPackageId = await ctx.db.insert("packages", {
        name: "sdk-plugin-b",
        normalizedName: "sdk-plugin-b",
        displayName: "SDK plugin B",
        family: "code-plugin",
        channel: "community",
        ownerUserId,
        isOfficial: false,
        scanStatus: "clean",
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const otherReleaseId = await ctx.db.insert("packageReleases", {
        packageId: otherPackageId,
        version: "1.0.0",
        changelog: "",
        distTags: [],
        files: [],
        integritySha256: artifactSha256,
        createdAt: 1,
        createdBy: ownerUserId,
        publicationStatus: "published",
        verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
      });
      await ctx.db.patch(otherPackageId, {
        latestReleaseId: otherReleaseId,
        tags: { latest: otherReleaseId },
      });
      await ctx.db.insert("packageSearchDigest", {
        packageId: otherPackageId,
        name: "sdk-plugin-b",
        normalizedName: "sdk-plugin-b",
        displayName: "SDK plugin B",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: expect.objectContaining({ name: "sdk-plugin" }),
          scan: expect.objectContaining({
            status: "error",
            scannedAt: 100,
            inspectorVersion: "0.4.2",
          }),
        }),
        expect.objectContaining({
          package: expect.objectContaining({ name: "sdk-plugin-b" }),
          scan: expect.objectContaining({ status: "not-scanned", scannedAt: null }),
        }),
      ]),
    );
  });

  it("keeps a legacy findings row behind more than twenty-five newer crashes", async () => {
    const { t, packageId, releaseId, ownerUserId } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("packageSearchDigest", {
        packageId,
        name: "sdk-plugin",
        normalizedName: "sdk-plugin",
        displayName: "SDK plugin",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        latestVersion: "1.0.0",
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("packageInspectorScanStates", {
        packageId,
        releaseId,
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        completedAt: 100,
      });
      await ctx.db.insert("packageInspectorWarnings", {
        packageId,
        releaseId,
        ownerUserId,
        packageName: "sdk-plugin",
        version: "1.0.0",
        scanSource: "nightly",
        inspectorVersion: "0.4.2",
        targetOpenClawVersion: "2026.10.01",
        findingKind: "error",
        code: "missing-api",
        message: "Required API is unavailable",
        createdAt: 100,
      });
      for (let index = 0; index < 26; index += 1) {
        await ctx.db.insert("packageInspectorScanStates", {
          packageId,
          releaseId,
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: `2026.12.${index + 1}`,
          completedAt: 200 + index,
          inspectionFailed: true,
        });
      }
    });
    const report = await t.query(internal.packages.listPluginValidationReportPageInternal, {
      numItems: 20,
    });
    expect(report.items[0]).toMatchObject({
      scan: { status: "error", scannedAt: 100, inspectorVersion: "0.4.2" },
      findings: [expect.objectContaining({ code: "missing-api", severity: "error" })],
    });
  });

  it("reports an unscanned new latest release as missing and ignores a late old-release scan", async () => {
    const { t, releaseId, packageId, ingest, lookup } = await fixture();
    await ingest(inventory());
    await t.run(async (ctx) => {
      const old = (await ctx.db.get(releaseId))!;
      const { _id, _creationTime, ...fields } = old;
      const latest = await ctx.db.insert("packageReleases", { ...fields, version: "2.0.0" });
      await ctx.db.patch(packageId, { latestReleaseId: latest, tags: { latest } });
    });
    await ingest(inventory());
    const result = await lookup();
    expect(result.items).toEqual([]);
    expect(result.coverage.counts).toMatchObject({ eligible: 1, complete: 0, missing: 1 });
    // Rolling back cannot revive rows whose scan metadata was overwritten by an unapplied late result.
    await t.run((ctx) =>
      ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } }),
    );
    expect((await lookup()).coverage.counts).toMatchObject({ complete: 0, missing: 1 });
  });

  it.each(["partial", "failed", "incompatible", "missing"])(
    "never treats %s as completed empty",
    async (status) => {
      const { ingest, lookup } = await fixture();
      if (status !== "missing")
        await ingest({
          ...inventory([]),
          status: status === "incompatible" ? "complete" : status,
          schemaVersion: status === "incompatible" ? 99 : 1,
        });
      const result = await lookup();
      expect(result.items).toEqual([]);
      expect(result.coverage.counts).toMatchObject({ eligible: 1, complete: 0, [status]: 1 });
    },
  );

  it.each([{ channel: "private" }, { softDeletedAt: 0 }, { scanStatus: "malicious" }] as const)(
    "withholds identities, evidence and coverage when a package becomes %j",
    async (patch) => {
      const { t, packageId, ingest, lookup } = await fixture();
      await ingest(inventory());
      await t.run((ctx) => ctx.db.patch(packageId, patch));
      const result = await lookup();
      expect(result.items).toEqual([]);
      expect(result.counts.distinctPlugins).toBe(0);
      expect(result.coverage.counts.eligible).toBe(0);
      expect(result.coverage.items).toEqual([]);
      await t.run((ctx) =>
        ctx.db.patch(packageId, {
          channel: "community",
          softDeletedAt: undefined,
          scanStatus: "clean",
        }),
      );
      expect((await lookup()).counts.distinctPlugins).toBe(1);
    },
  );

  it.each([
    { publicationStatus: "pending" },
    { softDeletedAt: 0 },
    { ownerDeletedAt: 0 },
    { verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "malicious" } },
  ] as const)(
    "withholds an excluded latest release (%j) and restores its evidence when eligible",
    async (patch) => {
      const { t, releaseId, ingest, lookup } = await fixture();
      await ingest(inventory());
      await t.run((ctx) => ctx.db.patch(releaseId, patch));
      expect((await lookup()).coverage.counts.eligible).toBe(0);
      expect((await lookup()).items).toEqual([]);
      await t.run((ctx) =>
        ctx.db.patch(releaseId, {
          publicationStatus: "published",
          softDeletedAt: undefined,
          ownerDeletedAt: undefined,
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
        }),
      );
      expect((await lookup()).counts.distinctPlugins).toBe(1);
    },
  );

  it.each([undefined, 50])(
    "finishes one-plugin coverage in one page regardless of release history (cutoff %s)",
    async (releasedSince) => {
      const { t, releaseId } = await fixture();
      await t.run(async (ctx) => {
        const { _id, _creationTime, ...release } = (await ctx.db.get(releaseId))!;
        for (let i = 1; i <= 105; i++) {
          await ctx.db.insert("packageReleases", {
            ...release,
            version: `0.0.${i}`,
            createdAt: i,
          });
        }
        await ctx.db.patch(releaseId, { createdAt: 1000 });
      });
      const filter = releasedSince === undefined ? "" : `&releasedSince=${releasedSince}`;
      const response = await t.fetch(`/api/v1/sdk-usage/coverage?limit=20${filter}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items).toMatchObject([{ releaseId, releaseCreatedAt: 1000, status: "missing" }]);
      expect(body.counts.eligible).toBe(1);
      expect(body.nextCursor).toBeNull();
    },
  );

  it.each([undefined, 1000])(
    "returns exact counts across all pages with release cutoff %s",
    async (releasedSince) => {
      const { t, packageId, releaseId } = await fixture();
      const ids = await t.run(async (ctx) => {
        const {
          _id: _packageId,
          _creationTime: _packageCreated,
          ...pkg
        } = (await ctx.db.get(packageId))!;
        const {
          _id: _releaseId,
          _creationTime: _releaseCreated,
          ...release
        } = (await ctx.db.get(releaseId))!;
        const items = [{ packageId, releaseId }];
        for (let i = 1; i < 105; i++) {
          const name = `sdk-plugin-${i}`;
          const nextPackageId = await ctx.db.insert("packages", {
            ...pkg,
            name,
            normalizedName: name,
            latestReleaseId: undefined,
            tags: {},
          });
          const nextReleaseId = await ctx.db.insert("packageReleases", {
            ...release,
            packageId: nextPackageId,
            createdAt: i < 45 ? 1 : 1000,
          });
          await ctx.db.patch(nextPackageId, {
            latestReleaseId: nextReleaseId,
            tags: { latest: nextReleaseId },
          });
          items.push({ packageId: nextPackageId, releaseId: nextReleaseId });
        }
        return items;
      });
      for (const item of ids)
        await t.mutation(internal.packages.ingestPackageInspectorScanResultsInternal, {
          ...item,
          inspectorVersion: "inventory-test",
          targetOpenClawVersion: "2026.10.14",
          artifactSha256,
          notifyOwners: false,
          findings: [],
          sdkUsage: inventory(),
        });
      for (const endpoint of [
        `/api/v1/sdk-usage?key=${encodeURIComponent(key)}`,
        "/api/v1/sdk-usage/coverage?",
      ]) {
        let cursor: string | null = null;
        const releases = new Set<string>();
        let count = 0;
        do {
          const filter = releasedSince === undefined ? "" : `&releasedSince=${releasedSince}`;
          const url = `${endpoint}&limit=40${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const response = await t.fetch(url);
          expect(response.status).toBe(200);
          const body = await response.json();
          for (const item of body.items) releases.add(item.releaseId);
          count += body.counts.distinctPlugins ?? body.counts.eligible;
          cursor = body.nextCursor;
        } while (cursor !== null);
        expect(releases.size).toBe(releasedSince === undefined ? 105 : 60);
        expect(count).toBe(releasedSince === undefined ? 105 : 60);
      }
    },
  );

  it("returns every API through a paginated per-plugin inventory, including more than 100 identities", async () => {
    const { t, ingest } = await fixture();
    const entries = Array.from({ length: 125 }, (_, i) => entry(`api.method${i}`));
    expect((await ingest(inventory(entries))).status).toBe(200);
    const observed = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ package: "sdk-plugin", limit: "40" });
      if (cursor) params.set("cursor", cursor);
      const response = await t.fetch(`/api/v1/sdk-usage/plugin?${params}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      observed.push(...body.items.map((item: { key: string }) => item.key));
      cursor = body.nextCursor;
    } while (cursor);
    expect(observed.sort((a, b) => a.localeCompare(b))).toEqual(
      entries.map((e) => e.key).sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each(["entries", "entry-bytes"])(
    "reports oversized %s as failed instead of silently truncating APIs",
    async (limit) => {
      const { ingest, lookup } = await fixture();
      const entries =
        limit === "entries"
          ? Array.from({ length: 2001 }, (_, i) => entry(`api.method${i}`))
          : [{ ...entry(), deprecationCodes: ["x".repeat(70 * 1024)] }];
      const response = await ingest(inventory(entries));
      expect(response.status).toBe(200);
      expect((await response.json()).sdkUsage).toMatchObject({
        status: "failed",
        applied: false,
        entryCount: entries.length,
      });
      const result = await lookup();
      expect(result.items).toEqual([]);
      expect(result.coverage.counts).toMatchObject({ eligible: 1, complete: 0, failed: 1 });
    },
  );

  it("removes usage relationships when the package is permanently deleted", async () => {
    const { t, packageId, ownerUserId, ingest, lookup } = await fixture();
    await ingest(inventory());
    await t.mutation(internal.packages.hardDeletePackageInternal, {
      packageId,
      actorUserId: ownerUserId,
      deletedAt: 2,
      source: "account.delete",
    });
    expect((await lookup()).coverage.items).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("packageSdkUsage").collect())).toEqual([]);
  });
});
