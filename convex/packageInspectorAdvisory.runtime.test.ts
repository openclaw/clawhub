/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const artifactSha256 = "b".repeat(64);
const workerToken = "inspector-advisory-test-worker";

async function fixture() {
  vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", workerToken);
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "advisory-owner", role: "user" });
    const packageId = await ctx.db.insert("packages", {
      name: "advisory-plugin",
      normalizedName: "advisory-plugin",
      displayName: "Advisory plugin",
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
      publicationStatus: "pending",
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
    return { packageId, releaseId, ownerUserId };
  });

  const finalizeWithFollowup = async (followup: Record<string, unknown>) => {
    const attemptId = await t.run((ctx) =>
      ctx.db.insert("publishAttempts", {
        kind: "package",
        status: "ready_to_finalize",
        userId: ids.ownerUserId,
        packageId: ids.packageId,
        packageReleaseId: ids.releaseId,
        slug: "advisory-plugin",
        displayName: "Advisory plugin",
        version: "1.0.0",
        idempotencyKey: "advisory-inspector-publish",
        artifactFingerprint: artifactSha256,
        files: [],
        checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
        packageFollowup: {
          ownerUserId: ids.ownerUserId,
          packageName: "advisory-plugin",
          version: "1.0.0",
          ...followup,
        },
        createdAt: 1,
        updatedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
    );
    const result = await t.action(internal.packages.finalizePackagePublishAttemptInternal, {
      attemptId,
    });
    return { attemptId, result };
  };

  const scanStates = () =>
    t.run((ctx) =>
      ctx.db
        .query("packageInspectorScanStates")
        .withIndex("by_release_and_completed_at", (q) => q.eq("releaseId", ids.releaseId))
        .collect(),
    );
  const findings = () =>
    t.run((ctx) =>
      ctx.db
        .query("packageInspectorWarnings")
        .withIndex("by_release", (q) => q.eq("releaseId", ids.releaseId))
        .collect(),
    );

  return { t, ...ids, finalizeWithFollowup, scanStates, findings };
}

afterEach(() => vi.unstubAllEnvs());

describe("advisory Plugin Inspector outcomes", () => {
  it("schedules targeted Inspector monitoring only after the release is accepted", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
    const { t, packageId, releaseId, finalizeWithFollowup, scanStates } = await fixture();

    const { result } = await finalizeWithFollowup({});

    expect(result).toMatchObject({ ok: true, packageId, releaseId });
    expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
      publicationStatus: "published",
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      scheduled.filter((job) => job.name.includes("dispatchPluginInspectorReleaseScanInternal")),
    ).toEqual([expect.objectContaining({ args: [{ releaseId, retryCount: 0 }] })]);
    // Monitoring has not run yet, so nothing is recorded against the release.
    expect(await scanStates()).toEqual([]);
  });

  // Attempts staged before Inspector left the publish request still carry its result.
  it("finalizes a release whose publish-time Inspector ran out of memory and records a tool failure", async () => {
    const { t, packageId, releaseId, finalizeWithFollowup, scanStates, findings } = await fixture();

    const { attemptId, result } = await finalizeWithFollowup({
      inspectorWarnings: [],
      inspectorMetadata: { inspectorVersion: "0.4.3" },
      inspectorOutcome: {
        outcome: "tool_failure",
        failure: {
          stage: "action",
          reason: "out_of_memory",
          message: "Node.js action execution ran out of memory",
        },
      },
    });

    expect(result).toMatchObject({ ok: true, packageId, releaseId });
    expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "finalized" });
    expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
      publicationStatus: "published",
    });
    expect(await scanStates()).toEqual([
      expect.objectContaining({
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "unresolved",
        outcome: "tool_failure",
        scanSource: "publish",
        failure: expect.objectContaining({ reason: "out_of_memory" }),
      }),
    ]);
    expect(await findings()).toEqual([]);
  });

  it("records a publish-time timeout without findings", async () => {
    const { finalizeWithFollowup, scanStates, findings } = await fixture();

    await finalizeWithFollowup({
      // Even if a caller staged findings, a failed run never stores them as plugin findings.
      inspectorWarnings: [
        {
          code: "missing-expected-seam",
          level: "breakage",
          message: "stale",
          authorRemediation: { summary: "x" },
        },
      ],
      inspectorMetadata: { inspectorVersion: "0.4.3" },
      inspectorOutcome: {
        outcome: "timeout",
        failure: { stage: "publish", reason: "timeout", message: "did not finish" },
      },
    });

    expect(await scanStates()).toEqual([
      expect.objectContaining({ outcome: "timeout", scanSource: "publish" }),
    ]);
    expect(await findings()).toEqual([]);
  });

  it("stores real publish-time breakages as error findings without emailing the owner", async () => {
    const { finalizeWithFollowup, scanStates, findings, t } = await fixture();

    await finalizeWithFollowup({
      inspectorWarnings: [
        {
          code: "unknown-hook-name",
          severity: "P0",
          level: "breakage",
          message: "plugin registers an unknown hook",
          authorRemediation: { summary: "Register a supported hook name." },
        },
      ],
      inspectorMetadata: { inspectorVersion: "0.4.3", targetOpenClawVersion: "2026.10.5" },
      inspectorOutcome: { outcome: "findings" },
    });

    expect(await findings()).toEqual([
      expect.objectContaining({
        code: "unknown-hook-name",
        findingKind: "error",
        scanSource: "publish",
      }),
    ]);
    expect(await scanStates()).toEqual([
      expect.objectContaining({
        outcome: "findings",
        scanSource: "publish",
        targetOpenClawVersion: "2026.10.5",
      }),
    ]);
    expect(
      await t.run((ctx) => ctx.db.query("packageInspectorFindingNotifications").collect()),
    ).toEqual([]);
  });

  it("finalizes a legacy staged attempt without an Inspector outcome as before", async () => {
    const { finalizeWithFollowup, scanStates, findings } = await fixture();

    const { result } = await finalizeWithFollowup({
      inspectorWarnings: [
        {
          code: "manifest-name-missing",
          level: "warning",
          message: "manifest display name is missing",
          authorRemediation: { summary: "Add a display name." },
        },
      ],
      inspectorMetadata: { inspectorVersion: "0.4.3", targetOpenClawVersion: "2026.10.5" },
    });

    expect(result).toMatchObject({ ok: true });
    expect(await findings()).toEqual([
      expect.objectContaining({ code: "manifest-name-missing", findingKind: "warning" }),
    ]);
    expect(await scanStates()).toEqual([]);
  });

  it("keeps a completed nightly verdict and its findings when a rescan of the same target fails", async () => {
    const { t, packageId, releaseId, scanStates, findings } = await fixture();
    await t.run((ctx) => ctx.db.patch(releaseId, { publicationStatus: "published" }));
    const ingest = (body: Record<string, unknown>) =>
      t.fetch("/api/v1/package-inspector/results", {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          packageId,
          releaseId,
          inspectorVersion: "0.4.3",
          targetOpenClawVersion: "2026.11.1-beta.1",
          notifyOwners: false,
          ...body,
        }),
      });

    expect(
      (
        await ingest({
          findings: [
            {
              code: "unknown-hook-name",
              level: "breakage",
              message: "plugin registers an unknown hook",
              authorRemediation: { summary: "Register a supported hook name." },
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await ingest({
          findings: [],
          inspectionFailed: true,
          failure: { stage: "bulk scan", reason: "out_of_memory", message: "heap out of memory" },
        })
      ).status,
    ).toBe(200);

    expect(await scanStates()).toEqual([
      expect.objectContaining({
        outcome: "findings",
        scanSource: "nightly",
        failure: expect.objectContaining({ reason: "out_of_memory" }),
      }),
    ]);
    expect(await findings()).toEqual([
      expect.objectContaining({ code: "unknown-hook-name", scanSource: "nightly" }),
    ]);
  });

  it("records nightly scan timeouts as monitoring data and keeps the release eligible for rescans", async () => {
    const { t, packageId, releaseId, scanStates, findings } = await fixture();
    await t.run((ctx) => ctx.db.patch(releaseId, { publicationStatus: "published" }));

    const response = await t.fetch("/api/v1/package-inspector/results", {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        packageId,
        releaseId,
        inspectorVersion: "0.4.3",
        targetOpenClawVersion: "2026.11.1-beta.1",
        artifactSha256,
        notifyOwners: false,
        inspectionFailed: true,
        failure: { stage: "bulk scan", reason: "timeout", message: "timed out" },
        findings: [],
      }),
    });
    expect(response.status).toBe(200);
    expect(await scanStates()).toEqual([
      expect.objectContaining({ outcome: "timeout", scanSource: "nightly" }),
    ]);
    expect(await findings()).toEqual([]);

    const batch = await t.query(internal.packages.previewPackageInspectorScanBatchInternal, {
      inspectorVersion: "0.4.3",
      targetOpenClawVersion: "2026.11.1-beta.1",
    });
    expect(batch.items.map((item: { releaseId: string }) => item.releaseId)).toEqual([releaseId]);
  });
});
