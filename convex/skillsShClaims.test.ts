/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { applySkillsShTestClaimVerdictHandler, beginSkillsShClaimHandler } from "./skillsShClaims";

const modules = import.meta.glob("./**/*.ts");
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);
const EXTERNAL_ID = "patrick-erichsen/skills/html";
const TEST_ENV = {
  CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
} as const;

beforeEach(() => {
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
});

afterEach(() => vi.unstubAllEnvs());

async function seedPendingFirstClaim(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      handle: "patrick",
      createdAt: 1,
      updatedAt: 1,
    });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    const sourceId = await ctx.db.insert("githubSkillSources", {
      repo: "patrick-erichsen/skills",
      ownerPublisherId: publisherId,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      authorizationStatus: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const runId = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: "snapshot-a",
      sourceView: "leaderboard",
      status: "completed",
      sourceTotal: 1,
      sourcePageSize: 1,
      sourceMeasuredAt: "2026-07-30T00:00:00.000Z",
      page: 2,
      offset: 0,
      counts: {
        observed: 1,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        conflicts: 0,
        detailsInserted: 1,
        detailsUpdated: 0,
        detailsUnchanged: 0,
        detailsMissing: 0,
        detailsTruncated: 0,
        tombstoned: 0,
        reactivated: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
      operations: {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 1,
        sourceRequests: 1,
        sourceBytes: 1,
      },
      actor: "test",
      reason: "claim lifecycle fixture",
      startedAt: 1,
      completedAt: 2,
      updatedAt: 2,
    });
    const mirrorId = await ctx.db.insert("skillsShMirrorDigests", {
      externalId: EXTERNAL_ID,
      sourceType: "github",
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
      normalizedSlug: "html",
      normalizedSlugFirstToken: "html",
      displayName: "HTML",
      normalizedDisplayName: "html",
      normalizedDisplayNameFirstToken: "html",
      searchText: "html",
      sourceUrl: `https://skills.sh/${EXTERNAL_ID}`,
      canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
      githubPath: "skills/html",
      githubCommit: COMMIT_A,
      sourceContentHash: HASH_A,
      upstreamInstalls: 77,
      upstreamScanners: {
        genAgentTrustHub: { status: "pass" },
        socket: { status: "warn" },
        snyk: { status: "unknown" },
      },
      sourceFreshnessStatus: "observed-only",
      detailStatus: "available",
      observationFingerprint: "a",
      sourceSnapshotId: "snapshot-a",
      lastObservedRunId: runId,
      active: true,
      publicVisible: true,
      installable: true,
      firstObservedAt: 1,
      lastObservedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    });
    const skillId = await ctx.db.insert("skills", {
      slug: "html",
      displayName: "HTML",
      ownerUserId,
      ownerPublisherId: publisherId,
      installKind: "github",
      githubSourceId: sourceId,
      githubCurrentRepo: "patrick-erichsen/skills",
      githubPath: "skills/html",
      githubHasSkillCard: false,
      githubCurrentCommit: COMMIT_A,
      githubCurrentContentHash: HASH_A,
      githubCurrentStatus: "present",
      githubCurrentCheckedAt: 2,
      githubScanStatus: "pending",
      tags: {},
      statsDownloads: 9,
      statsStars: 5,
      statsInstallsCurrent: 3,
      statsInstallsAllTime: 4,
      stats: {
        downloads: 9,
        stars: 5,
        installsCurrent: 3,
        installsAllTime: 4,
        versions: 0,
        comments: 0,
      },
      moderationStatus: "active",
      moderationReason: "pending.scan",
      moderationFlags: [],
      isSuspicious: false,
      createdAt: 2,
      updatedAt: 2,
    });
    return { mirrorId, ownerUserId, publisherId, sourceId, skillId };
  });
}

describe("skills.sh first-claim lifecycle", () => {
  it("rolls back an unbound claimed sync instead of suppressing normal verification", async () => {
    const t = convexTest(schema, modules);
    const { ownerUserId, publisherId } = await t.run(async (ctx) => ({
      ownerUserId: await ctx.db.insert("users", {
        handle: "patrick",
        createdAt: 1,
        updatedAt: 1,
      }),
      publisherId: await ctx.db.insert("publishers", {
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        createdAt: 1,
        updatedAt: 1,
      }),
    }));

    await expect(
      t.mutation(internal.skillsShClaims.applyClaimedGitHubSkillSourceSyncInternal, {
        repo: "patrick-erichsen/skills",
        ownerUserId,
        ownerPublisherId: publisherId,
        githubRepositoryId: "100",
        githubOwnerId: "200",
        skillsShClaimPath: "skills/html",
        skillsShClaim: {
          externalId: EXTERNAL_ID,
          path: "skills/html",
          commit: COMMIT_A,
          contentHash: HASH_A,
        },
        snapshot: {
          repo: "patrick-erichsen/skills",
          defaultBranch: "main",
          commit: COMMIT_A,
          manifestStatus: "missing",
          skills: [
            {
              slug: "html",
              displayName: "HTML",
              path: "skills/html",
              skillMarkdownPath: "skills/html/SKILL.md",
              contentHash: HASH_A,
            },
          ],
        },
        now: 10,
      }),
    ).rejects.toThrow("Exact skills.sh claim source no longer matches");

    const residue = await t.run(async (ctx) => ({
      sources: await ctx.db.query("githubSkillSources").collect(),
      skills: await ctx.db.query("skills").collect(),
      scans: await ctx.db.query("githubSkillScans").collect(),
      requests: await ctx.db.query("skillScanRequests").collect(),
      jobs: await ctx.db.query("securityScanJobs").collect(),
    }));
    expect(residue).toEqual({ sources: [], skills: [], scans: [], requests: [], jobs: [] });
  });

  it("keeps attempt one visible, hides a failure, and promotes a corrected retry without paid scans", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedPendingFirstClaim(t);

    await t.run(async (ctx) =>
      beginSkillsShClaimHandler(ctx as never, {
        externalId: EXTERNAL_ID,
        ownerPublisherId: ids.publisherId,
        githubSourceId: ids.sourceId,
        githubPath: "skills/html",
        githubCommit: COMMIT_A,
        githubContentHash: HASH_A,
        now: 10,
      }),
    );
    expect(await t.run(async (ctx) => ctx.db.get(ids.mirrorId))).toMatchObject({
      claimStatus: "pending",
      claimAttempt: 1,
      claimSkillId: ids.skillId,
      publicVisible: true,
      installable: true,
    });

    await t.run(async (ctx) =>
      applySkillsShTestClaimVerdictHandler(
        ctx as never,
        {
          externalId: EXTERNAL_ID,
          phase: "first-claim",
          verdict: "fail",
          confirm: "fail-skills-sh-test-claim",
          now: 20,
        },
        TEST_ENV,
      ),
    );
    expect(await t.run(async (ctx) => ctx.db.get(ids.mirrorId))).toMatchObject({
      claimStatus: "failed",
      claimFailedAt: 20,
      active: false,
      publicVisible: false,
      installable: false,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(ids.mirrorId, {
        githubCommit: COMMIT_B,
        sourceContentHash: HASH_B,
        observationFingerprint: "b",
        updatedAt: 30,
      });
      await ctx.db.patch(ids.skillId, {
        githubCurrentCommit: COMMIT_B,
        githubCurrentContentHash: HASH_B,
        githubScanStatus: "pending",
        moderationStatus: "active",
        moderationReason: "pending.scan",
        updatedAt: 30,
      });
    });
    await t.run(async (ctx) =>
      beginSkillsShClaimHandler(ctx as never, {
        externalId: EXTERNAL_ID,
        ownerPublisherId: ids.publisherId,
        githubSourceId: ids.sourceId,
        githubPath: "skills/html",
        githubCommit: COMMIT_B,
        githubContentHash: HASH_B,
        now: 31,
      }),
    );
    expect(await t.run(async (ctx) => ctx.db.get(ids.mirrorId))).toMatchObject({
      claimStatus: "pending",
      claimAttempt: 2,
      active: false,
      publicVisible: false,
      installable: false,
    });

    await t.run(async (ctx) =>
      applySkillsShTestClaimVerdictHandler(
        ctx as never,
        {
          externalId: EXTERNAL_ID,
          phase: "first-claim",
          verdict: "pass",
          confirm: "pass-skills-sh-test-claim",
          now: 40,
        },
        TEST_ENV,
      ),
    );
    const [mirror, native, scans, requests, jobs] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(ids.mirrorId),
        ctx.db.get(ids.skillId),
        ctx.db.query("githubSkillScans").collect(),
        ctx.db.query("skillScanRequests").collect(),
        ctx.db.query("securityScanJobs").collect(),
      ]),
    );
    expect(mirror).toMatchObject({
      claimStatus: "promoted",
      claimedAt: 40,
      active: false,
      publicVisible: false,
      installable: false,
    });
    expect(native).toMatchObject({
      githubCurrentCommit: COMMIT_B,
      githubCurrentContentHash: HASH_B,
      githubScanStatus: "clean",
      moderationStatus: "active",
      statsDownloads: 9,
      statsStars: 5,
      statsSkillsShInstalls: 77,
    });
    expect(scans).toEqual([
      expect.objectContaining({
        status: "clean",
        runId: `skills-sh-test-claim:${EXTERNAL_ID}:2`,
      }),
    ]);
    expect(requests).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });

  it("keeps the last passing native candidate live when a scan-free Test follow-up fails", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedPendingFirstClaim(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.mirrorId, {
        claimStatus: "promoted",
        claimSkillId: ids.skillId,
        claimPublisherId: ids.publisherId,
        claimGithubSourceId: ids.sourceId,
        claimGithubPath: "skills/html",
        claimGithubCommit: COMMIT_A,
        claimGithubContentHash: HASH_A,
        claimAttempt: 1,
        claimedAt: 10,
        active: false,
        publicVisible: false,
        installable: false,
      });
      await ctx.db.patch(ids.skillId, {
        githubScanStatus: "clean",
        moderationStatus: "active",
        moderationReason: undefined,
      });
      const candidateId = await ctx.db.insert("githubSkillCandidates", {
        skillId: ids.skillId,
        githubSourceId: ids.sourceId,
        githubRepo: "patrick-erichsen/skills",
        githubPath: "skills/html",
        githubHasSkillCard: false,
        githubCommit: COMMIT_B,
        githubContentHash: HASH_B,
        displayName: "HTML v2",
        skillMarkdownPath: "skills/html/SKILL.md",
        skillMarkdown: "# HTML v2\n",
        scanStatus: "pending",
        lifecycleStatus: "pending",
        createdAt: 20,
        updatedAt: 20,
      });
      await ctx.db.patch(ids.skillId, { githubPendingCandidateId: candidateId });
    });

    await t.run(async (ctx) =>
      applySkillsShTestClaimVerdictHandler(
        ctx as never,
        {
          externalId: EXTERNAL_ID,
          phase: "native-followup",
          verdict: "fail",
          confirm: "fail-skills-sh-test-native-followup",
          now: 30,
        },
        TEST_ENV,
      ),
    );
    const { skill, candidate, requests, jobs } = await t.run(async (ctx) => {
      const persistedSkill = await ctx.db.get(ids.skillId);
      return {
        skill: persistedSkill,
        candidate: persistedSkill?.githubPendingCandidateId
          ? await ctx.db.get(persistedSkill.githubPendingCandidateId)
          : null,
        requests: await ctx.db.query("skillScanRequests").collect(),
        jobs: await ctx.db.query("securityScanJobs").collect(),
      };
    });
    expect(skill).toMatchObject({
      githubCurrentCommit: COMMIT_A,
      githubCurrentContentHash: HASH_A,
      githubScanStatus: "clean",
      moderationStatus: "active",
    });
    expect(candidate).toMatchObject({
      githubCommit: COMMIT_B,
      githubContentHash: HASH_B,
      scanStatus: "failed",
      lifecycleStatus: "failed",
    });
    expect(requests).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });
});
