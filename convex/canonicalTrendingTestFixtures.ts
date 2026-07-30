import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";
import { assertTestSeedAllowed } from "./lib/testSeed";

const CONFIRM = "manage-claw-590-canonical-trending-test-proof";
const PROOF_SNAPSHOT_PATTERN = /^claw-590-proof-[0-9a-f]{40}$/;
const CLEANUP_BATCH_SIZE = 200;
const CLEANUP_MAX_BATCHES = 100;
const SAMPLE_SIZE = 20;
const SOURCE_FIXTURE_ID = "claw-590-canonical-trending-source-v1";
const SOURCE_FIXTURE_ACTOR = "CLAW-590 Test workflow";
const NATIVE_COUNT = 12;
const NATIVE_PUBLISHER_COUNT = 6;
const EXTERNAL_COUNT = 8;

const internalRefs = internal as unknown as {
  canonicalTrendingTestFixtures: {
    cleanupCanonicalTrendingProofBatch: unknown;
  };
};

const proofArgs = {
  confirm: v.literal(CONFIRM),
  snapshotId: v.string(),
};

const confirmArgs = { confirm: v.literal(CONFIRM) };

function fixtureOrdinal(index: number) {
  return String(index + 1).padStart(2, "0");
}

function nativeOwnerHandle(index: number) {
  return `claw-590-proof-owner-${fixtureOrdinal(index % NATIVE_PUBLISHER_COUNT)}`;
}

function nativeSlug(index: number) {
  return `claw-590-proof-native-${fixtureOrdinal(index)}`;
}

function externalOwner(index: number) {
  return `clawhub-test-${fixtureOrdinal(index)}`;
}

function externalFixtureId(index: number) {
  return `${externalOwner(index)}/claw-590/trending-${fixtureOrdinal(index)}`;
}

function emptySkillStats() {
  return {
    downloads: 0,
    installsCurrent: 0,
    installsAllTime: 0,
    stars: 0,
    versions: 1,
    comments: 0,
  };
}

function cleanVersionScans(now: number) {
  return {
    vtAnalysis: {
      status: "clean",
      verdict: "clean",
      analysis: "Owned CLAW-590 permanent-Test fixture.",
      source: SOURCE_FIXTURE_ID,
      checkedAt: now,
    },
    llmAnalysis: {
      status: "clean",
      verdict: "clean",
      confidence: "high",
      summary: "Owned CLAW-590 permanent-Test fixture.",
      model: SOURCE_FIXTURE_ID,
      checkedAt: now,
    },
    staticScan: {
      status: "clean" as const,
      reasonCodes: [],
      findings: [],
      summary: "Owned CLAW-590 permanent-Test fixture.",
      engineVersion: SOURCE_FIXTURE_ID,
      checkedAt: now,
    },
  };
}

function assertOwnedUser(user: Doc<"users">, index: number) {
  if (
    user.handle !== nativeOwnerHandle(index) ||
    user.name !== `CLAW-590 Proof Owner ${fixtureOrdinal(index)}`
  ) {
    throw new Error("CLAW-590 source fixture user ownership mismatch");
  }
}

function assertOwnedSkill(skill: Doc<"skills">, index: number, ownerId: Id<"users">) {
  if (
    skill.slug !== nativeSlug(index) ||
    skill.ownerUserId !== ownerId ||
    skill.batch !== SOURCE_FIXTURE_ID ||
    skill.displayName !== `CLAW-590 Native ${fixtureOrdinal(index)}` ||
    skill.stats.versions !== 1 ||
    !skill.latestVersionId
  ) {
    throw new Error("CLAW-590 source fixture skill ownership mismatch");
  }
}

function assertOwnedVersion(
  version: Doc<"skillVersions">,
  skillId: Id<"skills">,
  ownerId: Id<"users">,
) {
  if (
    version.skillId !== skillId ||
    version.createdBy !== ownerId ||
    version.version !== "1.0.0" ||
    version.changelog !== SOURCE_FIXTURE_ID ||
    version.files.length !== 0 ||
    version.vtAnalysis?.source !== SOURCE_FIXTURE_ID ||
    version.llmAnalysis?.model !== SOURCE_FIXTURE_ID ||
    version.staticScan?.engineVersion !== SOURCE_FIXTURE_ID
  ) {
    throw new Error("CLAW-590 source fixture version ownership mismatch");
  }
}

function assertOwnedNativeDigest(
  digest: Doc<"skillSearchDigest">,
  index: number,
  skillId: Id<"skills">,
  ownerId: Id<"users">,
  versionId: Id<"skillVersions">,
) {
  if (
    digest.skillId !== skillId ||
    digest.ownerUserId !== ownerId ||
    digest.slug !== nativeSlug(index) ||
    digest.ownerHandle !== nativeOwnerHandle(index) ||
    digest.publicVersion?.status !== "available" ||
    digest.publicVersion.versionId !== versionId ||
    digest.latestVersionId !== versionId ||
    digest.latestVersionSkillId !== skillId ||
    digest.softDeletedAt !== undefined ||
    digest.isSuspicious !== false
  ) {
    throw new Error("CLAW-590 source fixture native digest ownership mismatch");
  }
}

function assertOwnedHourlyStat(
  stat: Doc<"skillHourlyStats">,
  index: number,
  skillId: Id<"skills">,
) {
  if (
    stat.skillId !== skillId ||
    stat.generation !== 0 ||
    stat.downloads !== 100_000 - index ||
    stat.installs !== 100_000 - index ||
    stat.bookmarks !== 10_000 - index
  ) {
    throw new Error("CLAW-590 source fixture metric ownership mismatch");
  }
}

function assertOwnedRun(run: Doc<"skillsShMirrorRuns">) {
  if (
    run.snapshotId !== SOURCE_FIXTURE_ID ||
    run.sourceView !== "trending" ||
    run.sourceSnapshotHash !== SOURCE_FIXTURE_ID ||
    run.status !== "completed" ||
    run.actor !== SOURCE_FIXTURE_ACTOR ||
    run.counts.scansPlanned !== 0 ||
    run.counts.scansAdmitted !== 0
  ) {
    throw new Error("CLAW-590 source fixture run ownership mismatch");
  }
}

function assertOwnedExternalDigest(
  digest: Doc<"skillsShMirrorDigests">,
  index: number,
  runId: Id<"skillsShMirrorRuns">,
) {
  const id = externalFixtureId(index);
  if (
    digest.externalId !== id ||
    digest.owner !== externalOwner(index) ||
    digest.repo !== "claw-590" ||
    digest.slug !== `trending-${fixtureOrdinal(index)}` ||
    digest.trendingRank !== index + 1 ||
    digest.trendingObservedRunId !== runId ||
    digest.sourceSnapshotId !== SOURCE_FIXTURE_ID ||
    digest.observationFingerprint !== `${SOURCE_FIXTURE_ID}-${fixtureOrdinal(index)}` ||
    !digest.active ||
    !digest.publicVisible ||
    !digest.installable ||
    digest.sourceFreshnessStatus !== "observed-only" ||
    digest.tombstonedAt !== undefined
  ) {
    throw new Error("CLAW-590 source fixture external digest ownership mismatch");
  }
}

async function findOwnedRun(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db
    .query("skillsShMirrorRuns")
    .withIndex("by_source_view_and_status_and_source_snapshot_hash", (q) =>
      q
        .eq("sourceView", "trending")
        .eq("status", "completed")
        .eq("sourceSnapshotHash", SOURCE_FIXTURE_ID),
    )
    .unique();
}

async function readOwnedSourceFixture(ctx: Pick<QueryCtx, "db">) {
  const users = [];
  for (let index = 0; index < NATIVE_PUBLISHER_COUNT; index += 1) {
    users.push(
      await ctx.db
        .query("users")
        .withIndex("handle", (q) => q.eq("handle", nativeOwnerHandle(index)))
        .unique(),
    );
  }
  const skills = [];
  for (let index = 0; index < NATIVE_COUNT; index += 1) {
    skills.push(
      await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", nativeSlug(index)))
        .unique(),
    );
  }
  const externalDigests = [];
  for (let index = 0; index < EXTERNAL_COUNT; index += 1) {
    externalDigests.push(
      await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", externalFixtureId(index)))
        .unique(),
    );
  }
  const run = await findOwnedRun(ctx);
  const roots = [...users, ...skills, ...externalDigests, run];
  if (roots.every((row) => row === null)) return null;
  if (roots.some((row) => row === null)) {
    throw new Error("CLAW-590 source fixture has partial root state");
  }

  const checkedUsers = users as Doc<"users">[];
  const checkedSkills = skills as Doc<"skills">[];
  const checkedExternalDigests = externalDigests as Doc<"skillsShMirrorDigests">[];
  const checkedRun = run as Doc<"skillsShMirrorRuns">;
  checkedUsers.forEach(assertOwnedUser);
  assertOwnedRun(checkedRun);
  checkedExternalDigests.forEach((digest, index) =>
    assertOwnedExternalDigest(digest, index, checkedRun._id),
  );

  const native = [];
  for (const [index, skill] of checkedSkills.entries()) {
    const owner = checkedUsers[index % NATIVE_PUBLISHER_COUNT]!;
    assertOwnedSkill(skill, index, owner._id);
    const [version, digest, stats] = await Promise.all([
      ctx.db.get(skill.latestVersionId!),
      ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .unique(),
      ctx.db
        .query("skillHourlyStats")
        .withIndex("by_skill_and_hour_and_generation", (q) => q.eq("skillId", skill._id))
        .collect(),
    ]);
    if (!version || !digest || stats.length !== 1) {
      throw new Error("CLAW-590 source fixture has partial native state");
    }
    assertOwnedVersion(version, skill._id, owner._id);
    assertOwnedNativeDigest(digest, index, skill._id, owner._id, version._id);
    assertOwnedHourlyStat(stats[0]!, index, skill._id);
    native.push({ owner, skill, version, digest, stat: stats[0]! });
  }

  return {
    users: checkedUsers,
    native,
    run: checkedRun,
    externalDigests: checkedExternalDigests,
  };
}

function assertProofSnapshotId(snapshotId: string) {
  if (!PROOF_SNAPSHOT_PATTERN.test(snapshotId)) {
    throw new Error("Invalid CLAW-590 proof snapshot ID");
  }
}

function assertOwnedSnapshot(snapshot: Doc<"canonicalTrendingSnapshots">, snapshotId: string) {
  if (
    snapshot.snapshotId !== snapshotId ||
    snapshot.kind !== "skills" ||
    snapshot.rankingVersion !== "skills-trending-v2" ||
    snapshot.windowHours !== 24
  ) {
    throw new Error("CLAW-590 proof snapshot ownership mismatch");
  }
}

export const seedCanonicalTrendingSourceFixture = internalMutation({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const existing = await readOwnedSourceFixture(ctx);
    if (existing) {
      return {
        ok: true as const,
        created: false as const,
        nativeCount: existing.native.length,
        externalCount: existing.externalDigests.length,
      };
    }

    const now = Date.now();
    const window = getCompletedRolling24HourWindow(now);
    const users: Id<"users">[] = [];
    for (let index = 0; index < NATIVE_PUBLISHER_COUNT; index += 1) {
      users.push(
        await ctx.db.insert("users", {
          handle: nativeOwnerHandle(index),
          name: `CLAW-590 Proof Owner ${fixtureOrdinal(index)}`,
          displayName: `CLAW-590 Proof Owner ${fixtureOrdinal(index)}`,
          role: "user",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    for (let index = 0; index < NATIVE_COUNT; index += 1) {
      const ownerUserId = users[index % NATIVE_PUBLISHER_COUNT]!;
      const slug = nativeSlug(index);
      const displayName = `CLAW-590 Native ${fixtureOrdinal(index)}`;
      const skillId = await ctx.db.insert("skills", {
        slug,
        displayName,
        summary: "Owned synthetic native candidate for permanent-Test Trending proof.",
        ownerUserId,
        tags: {},
        batch: SOURCE_FIXTURE_ID,
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 1_000 + index,
        stats: emptySkillStats(),
        createdAt: now - index,
        updatedAt: now - index,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: SOURCE_FIXTURE_ID,
        files: [],
        parsed: { frontmatter: {} },
        createdBy: ownerUserId,
        createdAt: now - index,
        ...cleanVersionScans(now),
      });
      await ctx.db.patch(skillId, {
        latestVersionId: versionId,
        latestVersionSummary: {
          version: "1.0.0",
          createdAt: now - index,
          changelog: SOURCE_FIXTURE_ID,
        },
        tags: { latest: versionId },
      });
      await ctx.db.insert("skillSearchDigest", {
        skillId,
        slug,
        normalizedSlug: slug,
        normalizedSlugFirstToken: "claw",
        displayName,
        normalizedDisplayName: displayName.toLowerCase(),
        normalizedDisplayNameFirstToken: "claw",
        summary: "Owned synthetic native candidate for permanent-Test Trending proof.",
        ownerUserId,
        ownerHandle: nativeOwnerHandle(index),
        ownerKind: "user",
        ownerName: `CLAW-590 Proof Owner ${fixtureOrdinal(index % NATIVE_PUBLISHER_COUNT)}`,
        ownerDisplayName: `CLAW-590 Proof Owner ${fixtureOrdinal(index % NATIVE_PUBLISHER_COUNT)}`,
        latestVersionId: versionId,
        latestVersionSkillId: skillId,
        publicVersion: { status: "available", versionId },
        latestVersionSummary: {
          version: "1.0.0",
          createdAt: now - index,
          changelog: SOURCE_FIXTURE_ID,
        },
        tags: { latest: versionId },
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 1_000 + index,
        stats: emptySkillStats(),
        isSuspicious: false,
        createdAt: now - index,
        updatedAt: now - index,
      });
      await ctx.db.insert("skillHourlyStats", {
        skillId,
        hour: window.endHour,
        generation: 0,
        downloads: 100_000 - index,
        installs: 100_000 - index,
        bookmarks: 10_000 - index,
        updatedAt: now,
        expiresAt: now + 72 * 60 * 60 * 1_000,
      });
    }

    const runId = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: SOURCE_FIXTURE_ID,
      sourceView: "trending",
      sourceSnapshotHash: SOURCE_FIXTURE_ID,
      sourceCaptureWrites: 0,
      status: "completed",
      sourceTotal: EXTERNAL_COUNT,
      sourcePageSize: EXTERNAL_COUNT,
      sourceMeasuredAt: new Date(now).toISOString(),
      sourceDurationMs: 0,
      page: 1,
      offset: EXTERNAL_COUNT,
      counts: {
        observed: EXTERNAL_COUNT,
        inserted: EXTERNAL_COUNT,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        quarantined: 0,
        quarantinedPreserved: 0,
        conflicts: 0,
        detailsInserted: 0,
        detailsUpdated: 0,
        detailsUnchanged: 0,
        detailsMissing: EXTERNAL_COUNT,
        detailsTruncated: 0,
        tombstoned: 0,
        reactivated: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
      operations: {
        functionCalls: 1,
        dbReads: 0,
        dbWrites: EXTERNAL_COUNT + 1,
        sourceRequests: 0,
        sourceBytes: 0,
      },
      actor: SOURCE_FIXTURE_ACTOR,
      reason: "Owned synthetic source corpus for CLAW-590 permanent-Test Trending proof.",
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < EXTERNAL_COUNT; index += 1) {
      const id = externalFixtureId(index);
      const slug = `trending-${fixtureOrdinal(index)}`;
      await ctx.db.insert("skillsShMirrorDigests", {
        externalId: id,
        sourceType: "github",
        upstreamSourceType: "github",
        owner: externalOwner(index),
        repo: "claw-590",
        slug,
        normalizedSlug: slug,
        normalizedSlugFirstToken: "trending",
        displayName: `CLAW-590 External ${fixtureOrdinal(index)}`,
        normalizedDisplayName: `claw-590 external ${fixtureOrdinal(index)}`,
        normalizedDisplayNameFirstToken: "claw",
        searchSummary: "Owned synthetic skills.sh candidate for permanent-Test Trending proof.",
        searchText: `claw 590 external trending ${fixtureOrdinal(index)}`,
        sourceUrl: `https://skills.sh/${id}`,
        canonicalRepoUrl: "https://github.com/clawhub-test/claw-590",
        githubPath: `skills/${slug}`,
        githubCommit: "0".repeat(40),
        sourceContentHash: "0".repeat(64),
        upstreamInstalls: 50_000 - index,
        trendingRank: index + 1,
        trendingLifetimeInstalls: 50_000 - index,
        trendingObservedAt: now,
        trendingSnapshotId: SOURCE_FIXTURE_ID,
        trendingObservedRunId: runId,
        upstreamScanners: {
          genAgentTrustHub: { status: "unavailable" },
          socket: { status: "unavailable" },
          snyk: { status: "unavailable" },
        },
        sourceFreshnessStatus: "observed-only",
        detailStatus: "missing",
        observationFingerprint: `${SOURCE_FIXTURE_ID}-${fixtureOrdinal(index)}`,
        sourceSnapshotId: SOURCE_FIXTURE_ID,
        lastObservedRunId: runId,
        active: true,
        publicVisible: true,
        installable: true,
        firstObservedAt: now,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      ok: true as const,
      created: true as const,
      nativeCount: NATIVE_COUNT,
      externalCount: EXTERNAL_COUNT,
    };
  },
});

export const readCanonicalTrendingSourceFixture = internalQuery({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const fixture = await readOwnedSourceFixture(ctx);
    if (!fixture) return { present: false as const };
    return {
      present: true as const,
      fixtureId: SOURCE_FIXTURE_ID,
      nativeCount: fixture.native.length,
      nativePublisherCount: fixture.users.length,
      externalCount: fixture.externalDigests.length,
      runId: fixture.run._id,
      scansPlanned: fixture.run.counts.scansPlanned,
      scansAdmitted: fixture.run.counts.scansAdmitted,
    };
  },
});

export const cleanupCanonicalTrendingSourceFixture = internalMutation({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const fixture = await readOwnedSourceFixture(ctx);
    if (!fixture) return { ok: true as const, removed: false as const };

    for (const digest of fixture.externalDigests) {
      const [details, facets] = await Promise.all([
        ctx.db
          .query("skillsShMirrorDetails")
          .withIndex("by_digest_id", (q) => q.eq("digestId", digest._id))
          .take(1),
        ctx.db
          .query("skillsShMirrorFacets")
          .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", digest._id))
          .take(1),
      ]);
      if (details.length > 0 || facets.length > 0) {
        throw new Error("CLAW-590 source fixture cleanup refused dependent mirror rows");
      }
      await ctx.db.delete(digest._id);
    }
    const conflicts = await ctx.db
      .query("skillsShMirrorConflicts")
      .withIndex("by_run_id", (q) => q.eq("runId", fixture.run._id))
      .take(1);
    if (conflicts.length > 0) {
      throw new Error("CLAW-590 source fixture cleanup refused dependent conflict rows");
    }

    for (const row of fixture.native) {
      await ctx.db.delete(row.stat._id);
      await ctx.db.delete(row.digest._id);
      await ctx.db.delete(row.version._id);
      await ctx.db.delete(row.skill._id);
    }
    for (const user of fixture.users) await ctx.db.delete(user._id);
    await ctx.db.delete(fixture.run._id);
    return {
      ok: true as const,
      removed: true as const,
      nativeDeleted: fixture.native.length,
      externalDeleted: fixture.externalDigests.length,
      usersDeleted: fixture.users.length,
    };
  },
});

export const readCanonicalTrendingProof = internalQuery({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    const items = await ctx.db
      .query("canonicalTrendingItems")
      .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", args.snapshotId))
      .take(SAMPLE_SIZE);
    if (!snapshot) {
      if (items.length > 0) throw new Error("CLAW-590 proof snapshot has orphaned items");
      return { present: false as const };
    }
    assertOwnedSnapshot(snapshot, args.snapshotId);
    const sample = await Promise.all(
      items.map(async (item) => {
        if (item.sourceRef.kind === "clawhub") {
          const skillId = item.sourceRef.skillId;
          const digest = await ctx.db
            .query("skillSearchDigest")
            .withIndex("by_skill", (q) => q.eq("skillId", skillId))
            .unique();
          if (!digest) throw new Error("CLAW-590 proof native source is missing");
          return {
            rank: item.position + 1,
            id: item.card.id,
            lane: item.lane,
            publisherKey: String(digest.ownerPublisherId ?? digest.ownerUserId),
            upstreamRank: null,
            metrics: item.card.metrics,
          };
        }
        const externalId = item.sourceRef.externalId;
        const digest = await ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
          .unique();
        if (!digest) throw new Error("CLAW-590 proof external source is missing");
        return {
          rank: item.position + 1,
          id: item.card.id,
          lane: item.lane,
          publisherKey: digest.owner ?? digest.sourceHost ?? digest.externalId,
          upstreamRank: digest.trendingRank ?? null,
          metrics: item.card.metrics,
        };
      }),
    );
    return {
      present: true as const,
      snapshotId: snapshot.snapshotId,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      completedAt: snapshot.completedAt ?? null,
      totalItems: snapshot.totalItems ?? null,
      writtenItems: snapshot.writtenItems,
      sourceCounts: snapshot.sourceCounts ?? null,
      operations: snapshot.operations ?? null,
      sample,
    };
  },
});

export const cleanupCanonicalTrendingProofBatch = internalMutation({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    const items = await ctx.db
      .query("canonicalTrendingItems")
      .withIndex("by_snapshot_id_and_position", (q) => q.eq("snapshotId", args.snapshotId))
      .take(CLEANUP_BATCH_SIZE);
    if (!snapshot) {
      if (items.length > 0) throw new Error("CLAW-590 cleanup found orphaned proof items");
      return { done: true as const, itemsDeleted: 0, snapshotDeleted: false };
    }
    assertOwnedSnapshot(snapshot, args.snapshotId);
    for (const item of items) await ctx.db.delete(item._id);
    const done = items.length < CLEANUP_BATCH_SIZE;
    if (done) await ctx.db.delete(snapshot._id);
    return { done, itemsDeleted: items.length, snapshotDeleted: done };
  },
});

export const cleanupCanonicalTrendingProof = internalAction({
  args: proofArgs,
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    assertProofSnapshotId(args.snapshotId);
    let itemsDeleted = 0;
    for (let batch = 1; batch <= CLEANUP_MAX_BATCHES; batch += 1) {
      const result = (await ctx.runMutation(
        internalRefs.canonicalTrendingTestFixtures.cleanupCanonicalTrendingProofBatch as never,
        args as never,
      )) as { done: boolean; itemsDeleted: number; snapshotDeleted: boolean };
      itemsDeleted += result.itemsDeleted;
      if (result.done) {
        return {
          ok: true as const,
          itemsDeleted,
          snapshotDeleted: result.snapshotDeleted,
          batches: batch,
        };
      }
    }
    throw new Error("CLAW-590 proof cleanup exceeded its bounded batch limit");
  },
});
