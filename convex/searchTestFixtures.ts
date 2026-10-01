import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { assertTestSeedAllowed } from "./lib/testSeed";

const CONFIRM = "manage-claw-577-canonical-search-test-fixture";
const EXTERNAL_ID = "clawhub-test/claw-577/search-popularity-decoy";
const SNAPSHOT_ID = "claw-577-canonical-search-proof-v1";
const SNAPSHOT_HASH = "claw-577-canonical-search-proof-v1-owned";
const ACTOR = "CLAW-577 Test workflow";

const confirmArgs = { confirm: v.literal(CONFIRM) };

function assertOwnedRun(run: Doc<"skillsShMirrorRuns">) {
  if (
    run.snapshotId !== SNAPSHOT_ID ||
    run.sourceView !== "leaderboard" ||
    run.sourceSnapshotHash !== SNAPSHOT_HASH ||
    run.actor !== ACTOR ||
    run.status !== "completed" ||
    run.counts.scansPlanned !== 0 ||
    run.counts.scansAdmitted !== 0
  ) {
    throw new Error("CLAW-577 Test fixture run ownership mismatch");
  }
}

function assertOwnedDigest(digest: Doc<"skillsShMirrorDigests">) {
  if (
    digest.externalId !== EXTERNAL_ID ||
    digest.sourceSnapshotId !== SNAPSHOT_ID ||
    digest.observationFingerprint !== SNAPSHOT_ID ||
    digest.sourceUrl !== `https://skills.sh/${EXTERNAL_ID}` ||
    digest.sourceType !== "github" ||
    digest.owner !== "clawhub-test" ||
    digest.repo !== "claw-577" ||
    digest.slug !== "search-popularity-decoy" ||
    digest.upstreamInstalls !== 9_000_000 ||
    !digest.active ||
    !digest.publicVisible ||
    !digest.installable ||
    digest.sourceFreshnessStatus !== "observed-only" ||
    digest.detailStatus !== "missing"
  ) {
    throw new Error("CLAW-577 Test fixture digest ownership mismatch");
  }
}

async function findOwnedRun(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db
    .query("skillsShMirrorRuns")
    .withIndex("by_source_view_and_status_and_source_snapshot_hash", (q) =>
      q
        .eq("sourceView", "leaderboard")
        .eq("status", "completed")
        .eq("sourceSnapshotHash", SNAPSHOT_HASH),
    )
    .unique();
}

async function readOwnedFixture(ctx: Pick<QueryCtx, "db">) {
  const digest = await ctx.db
    .query("skillsShMirrorDigests")
    .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
    .unique();
  if (!digest) {
    if (await findOwnedRun(ctx)) throw new Error("CLAW-577 Test fixture has partial state");
    return null;
  }
  assertOwnedDigest(digest);
  const run: Doc<"skillsShMirrorRuns"> | null = await ctx.db.get(
    "skillsShMirrorRuns",
    digest.lastObservedRunId,
  );
  if (!run) throw new Error("CLAW-577 Test fixture is missing its owned run");
  assertOwnedRun(run);
  return { digest, run };
}

export const seedCanonicalSearchTestFixture = internalMutation({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const existing = await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
      .unique();
    if (existing) {
      assertOwnedDigest(existing);
      const run = await ctx.db.get("skillsShMirrorRuns", existing.lastObservedRunId);
      if (!run) throw new Error("CLAW-577 Test fixture is missing its owned run");
      assertOwnedRun(run);
      return { ok: true as const, digestId: existing._id, runId: run._id, created: false };
    }
    if (await findOwnedRun(ctx)) throw new Error("CLAW-577 Test fixture has partial state");

    const now = Date.now();
    const runId = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: SNAPSHOT_ID,
      sourceView: "leaderboard",
      sourceSnapshotHash: SNAPSHOT_HASH,
      sourceCaptureWrites: 0,
      status: "completed",
      sourceTotal: 1,
      sourcePageSize: 1,
      sourceMeasuredAt: new Date(now).toISOString(),
      sourceDurationMs: 0,
      page: 1,
      offset: 0,
      counts: {
        observed: 1,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        quarantined: 0,
        quarantinedPreserved: 0,
        conflicts: 0,
        detailsInserted: 0,
        detailsUpdated: 0,
        detailsUnchanged: 0,
        detailsMissing: 1,
        detailsTruncated: 0,
        tombstoned: 0,
        reactivated: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
      operations: {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 2,
        sourceRequests: 0,
        sourceBytes: 0,
      },
      actor: ACTOR,
      reason: "Owned synthetic row for CLAW-577 permanent-Test search order proof.",
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    });
    const digestId = await ctx.db.insert("skillsShMirrorDigests", {
      externalId: EXTERNAL_ID,
      sourceType: "github",
      upstreamSourceType: "github",
      owner: "clawhub-test",
      repo: "claw-577",
      slug: "search-popularity-decoy",
      normalizedSlug: "search popularity decoy",
      normalizedSlugFirstToken: "search",
      displayName: "Search Popularity Decoy",
      normalizedDisplayName: "search popularity decoy",
      normalizedDisplayNameFirstToken: "search",
      searchSummary: "Gifgrep search decoy with deliberately irrelevant lifetime popularity.",
      searchText:
        "Search Popularity Decoy search-popularity-decoy gifgrep search animated gifs irrelevant lifetime popularity",
      sourceUrl: `https://skills.sh/${EXTERNAL_ID}`,
      canonicalRepoUrl: "https://github.com/clawhub-test/claw-577",
      githubPath: "skills/search-popularity-decoy",
      githubCommit: "0000000000000000000000000000000000000000",
      upstreamInstalls: 9_000_000,
      upstreamScanners: {
        genAgentTrustHub: { status: "unavailable" },
        socket: { status: "unavailable" },
        snyk: { status: "unavailable" },
      },
      inferredCategories: ["search"],
      inferredTopics: ["gif-search"],
      sourceFreshnessStatus: "observed-only",
      detailStatus: "missing",
      observationFingerprint: SNAPSHOT_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      lastObservedRunId: runId,
      active: true,
      publicVisible: true,
      installable: true,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true as const, digestId, runId, created: true };
  },
});

export const readCanonicalSearchTestFixture = internalQuery({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const fixture = await readOwnedFixture(ctx);
    if (!fixture) return { present: false as const };
    return {
      present: true as const,
      externalId: fixture.digest.externalId,
      digestId: fixture.digest._id,
      runId: fixture.run._id,
      upstreamInstalls: fixture.digest.upstreamInstalls,
      publicVisible: fixture.digest.publicVisible,
      installable: fixture.digest.installable,
      scansPlanned: fixture.run.counts.scansPlanned,
      scansAdmitted: fixture.run.counts.scansAdmitted,
    };
  },
});

export const cleanupCanonicalSearchTestFixture = internalMutation({
  args: {
    ...confirmArgs,
    digestId: v.id("skillsShMirrorDigests"),
    runId: v.id("skillsShMirrorRuns"),
  },
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    const [digest, run] = await Promise.all([
      ctx.db.get("skillsShMirrorDigests", args.digestId),
      ctx.db.get("skillsShMirrorRuns", args.runId),
    ]);
    if (!digest && !run) {
      const [replacement, replacementRun] = await Promise.all([
        ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
          .unique(),
        findOwnedRun(ctx),
      ]);
      if (replacement || replacementRun) {
        throw new Error("CLAW-577 newer fixture occupies the owned identity");
      }
      return { ok: true as const, removed: false as const };
    }
    if (!digest || !run) throw new Error("CLAW-577 Test fixture cleanup found partial state");
    assertOwnedDigest(digest);
    assertOwnedRun(run);
    if (digest._id !== args.digestId || digest.lastObservedRunId !== args.runId) {
      throw new Error("CLAW-577 Test fixture cleanup ID ownership mismatch");
    }

    const [details, facets, conflicts] = await Promise.all([
      ctx.db
        .query("skillsShMirrorDetails")
        .withIndex("by_digest_id", (q) => q.eq("digestId", args.digestId))
        .take(1),
      ctx.db
        .query("skillsShMirrorFacets")
        .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", args.digestId))
        .take(1),
      ctx.db
        .query("skillsShMirrorConflicts")
        .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
        .take(1),
    ]);
    if (details.length > 0 || facets.length > 0 || conflicts.length > 0) {
      throw new Error("CLAW-577 Test fixture cleanup refused dependent rows");
    }

    await ctx.db.delete("skillsShMirrorDigests", args.digestId);
    await ctx.db.delete("skillsShMirrorRuns", args.runId);
    return { ok: true as const, removed: true as const };
  },
});
