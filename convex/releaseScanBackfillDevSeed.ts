import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import { isLocalDevAuthEnabled } from "./lib/devAuth";

function assertIsolatedProof() {
  const deployment = process.env.CONVEX_DEPLOYMENT || process.env.DEV_AUTH_CONVEX_DEPLOYMENT || "";
  if (
    !/^(local|anonymous):/.test(deployment) ||
    !isLocalDevAuthEnabled(process.env) ||
    process.env.CLAWHUB_DISABLE_CRONS !== "1" ||
    process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION === "1" ||
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE ||
    process.env.VT_API_KEY ||
    process.env.SECURITY_SCAN_EVENT_DISPATCH_ENABLED === "1"
  ) {
    throw new Error(
      "Release scan proof requires isolated local dev-auth without external scan dispatch",
    );
  }
}

// Internal-only fixtures: real user tokens call the public action under test.
export const setActorState = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("moderator"), v.literal("admin")),
    inactive: v.boolean(),
    deleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertIsolatedProof();
    const user = await ctx.db.get(args.userId);
    if (!user || !["local-user", "local-admin"].includes(user.handle ?? "")) {
      throw new Error("Only local dev-auth personas may be changed");
    }
    await ctx.db.patch(args.userId, {
      role: args.role,
      deactivatedAt: args.inactive ? Date.now() : undefined,
      deletedAt: args.deleted ? Date.now() : undefined,
    });
  },
});

export const seed = internalMutation({
  args: { userId: v.id("users"), phase: v.union(v.literal("public"), v.literal("internal")) },
  handler: async (ctx, { userId, phase }) => {
    assertIsolatedProof();
    // Fail closed on a reused/populated database instead of traversing unrelated releases.
    const existing = await ctx.db.query("packages").take(3);
    if (
      existing.some((pkg) => !pkg.name.startsWith("release-scan-proof-")) ||
      existing.length >= 2
    ) {
      throw new Error("Release scan proof requires a fresh disposable package catalog");
    }
    const name = `release-scan-proof-${phase}`;
    if (existing.some((pkg) => pkg.name === name)) throw new Error("Fixture phase already seeded");
    const now = Date.now();
    const packageId = await ctx.db.insert("packages", {
      name,
      normalizedName: name,
      displayName: name,
      ownerUserId: userId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      compatibility: {},
      verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
      stats: { downloads: 0, installs: 0, stars: 0, versions: phase === "public" ? 10 : 2 },
      createdAt: now,
      updatedAt: now,
    });
    const releaseIds = [];
    for (let index = 0; index < (phase === "public" ? 10 : 2); index += 1) {
      releaseIds.push(
        await ctx.db.insert("packageReleases", {
          packageId,
          version: `1.0.${index}`,
          changelog: "",
          distTags: [],
          files: [],
          integritySha256: `${phase}-${index}`.padEnd(64, "0"),
          compatibility: {},
          verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
          vtAnalysis: { status: "clean", checkedAt: now },
          staticScan: {
            status: "clean",
            reasonCodes: [],
            findings: [],
            summary: "fixture",
            engineVersion: "fixture",
            checkedAt: now,
          },
          source: {},
          createdBy: userId,
          publishActor: { kind: "user", userId },
          createdAt: now,
        }),
      );
    }
    // Missing LLM analysis causes real queue writes; no paid scan worker is started.
    return releaseIds;
  },
});

export const state = internalQuery({
  args: { releaseIds: v.array(v.id("packageReleases")) },
  handler: async (ctx, { releaseIds }) => {
    assertIsolatedProof();
    if (releaseIds.length > 12) throw new Error("Fixture limited to twelve releases");
    const scheduled = await ctx.db.system.query("_scheduled_functions").order("desc").take(256);
    if (scheduled.length === 256) throw new Error("Proof scheduler snapshot exceeded its bound");
    const queues = await Promise.all(
      releaseIds.map(async (releaseId) => ({
        releaseId,
        jobs: await ctx.db
          .query("securityScanJobs")
          .withIndex("by_package_release", (q) => q.eq("packageReleaseId", releaseId))
          .take(8),
      })),
    );
    if (queues.some(({ jobs }) => jobs.length === 8))
      throw new Error("Proof queue exceeded its bound");
    return {
      releases: await Promise.all(releaseIds.map((id) => ctx.db.get(id))),
      packages: await ctx.db.query("packages").take(3),
      queues,
      scheduled: scheduled.filter((job) =>
        /backfillPackageReleaseScansInternal|scanPackageReleaseStaticallyInternal|scanPackageReleaseWithVirusTotal/.test(
          job.name,
        ),
      ),
    };
  },
});
