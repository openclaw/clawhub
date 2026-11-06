/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => {
    const admin = await ctx.db.insert("users", { role: "admin" });
    const user = await ctx.db.insert("users", { role: "user" });
    const moderator = await ctx.db.insert("users", { role: "moderator" });
    const deactivated = await ctx.db.insert("users", { role: "admin", deactivatedAt: 1 });
    await ctx.db.insert("globalStats", {
      key: "default",
      activeSkillsCount: 0,
      activePluginsCount: 0,
      updatedAt: 1,
    });
    // Eleven rows force continuation past the internal minimum batch size of ten.
    for (let index = 0; index < 11; index += 1) {
      const name = `@backfill-proof/plugin-${index}`;
      const verification = {
        tier: "structural" as const,
        scope: "artifact-only" as const,
        scanStatus: "malicious" as const,
      };
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: name,
        ownerUserId: admin,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        verification,
        scanStatus: "malicious",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "Fixture",
        distTags: ["latest"],
        files: [],
        integritySha256: "a".repeat(64),
        verification,
        llmAnalysis: { status: "clean", checkedAt: 1 },
        createdBy: admin,
        createdAt: 1,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        tags: { latest: releaseId },
        latestVersionSummary: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Fixture",
          verification,
        },
      });
      const pkg = await ctx.db.get(packageId);
      if (!pkg) throw new Error("Missing fixture package");
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(pkg));
    }
    return { admin, user, moderator, deactivated };
  });
  const snapshot = () =>
    t.run(async (ctx) => ({
      packages: await ctx.db.query("packages").collect(),
      releases: await ctx.db.query("packageReleases").collect(),
      digests: await ctx.db.query("packageSearchDigest").collect(),
      categories: await ctx.db.query("packagePluginCategorySearchDigest").collect(),
      topics: await ctx.db.query("packageTopicSearchDigest").collect(),
      stats: await ctx.db.query("globalStats").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
  return { t, users, snapshot };
}

beforeEach(() => {
  vi.stubEnv("CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE", "");
  vi.stubEnv("CLAW_HUB_ENABLE_DEV_IMPERSONATION", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("latest package scan-status backfill authorization", () => {
  it("rejects anonymous, non-admin and inactive callers without writes or scheduling", async () => {
    const { t, users, snapshot } = await fixture();
    const before = await snapshot();
    const callers = [
      { client: t, error: "Unauthorized" },
      { client: t.withIdentity({ subject: users.user }), error: "Forbidden" },
      { client: t.withIdentity({ subject: users.moderator }), error: "Forbidden" },
      { client: t.withIdentity({ subject: users.deactivated }), error: "User not found" },
    ];
    for (const { client, error } of callers) {
      await expect(
        client.action(api.packages.backfillLatestPackageScanStatus, { batchSize: 10 }),
      ).rejects.toThrow(error);
      expect(await snapshot()).toEqual(before);
    }
  });

  it("allows an active admin and completes internal continuation without caller identity", async () => {
    const { t, users, snapshot } = await fixture();
    vi.useFakeTimers();
    const first = await t
      .withIdentity({ subject: users.admin })
      .action(api.packages.backfillLatestPackageScanStatus, { batchSize: 10 });
    expect(first).toEqual({ patched: 10, scanned: 10, isDone: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await snapshot();
    expect(after.packages).toHaveLength(11);
    expect(after.releases).toHaveLength(11);
    expect(after.digests).toHaveLength(11);
    for (const pkg of after.packages) {
      expect(pkg.scanStatus).toBe("clean");
      expect(pkg.verification?.scanStatus).toBe("clean");
      expect(pkg.latestVersionSummary?.verification?.scanStatus).toBe("clean");
    }
    expect(after.releases.every((release) => release.verification?.scanStatus === "clean")).toBe(
      true,
    );
    expect(after.digests.every((digest) => digest.scanStatus === "clean")).toBe(true);
    expect(after.scheduled.length).toBeGreaterThan(0);
    expect(after.scheduled.every((job) => job.state.kind === "success")).toBe(true);
  });
});
