import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  applyGitHubSkillSourceSyncHandler,
  applyGitHubSkillVerificationResultHandler,
  sourceSnapshotValidator,
} from "./githubSkillSync";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import { assertSkillsShFixtureEnvironmentAllowed } from "./lib/skillsShCatalogEnvironment";
import { skillsShMirrorPublicationFlags } from "./lib/skillsShPublicVisibility";

const FIRST_CLAIM_CONFIRM = {
  pass: "pass-skills-sh-test-claim",
  fail: "fail-skills-sh-test-claim",
} as const;

const NATIVE_FOLLOWUP_CONFIRM = {
  pass: "pass-skills-sh-test-native-followup",
  fail: "fail-skills-sh-test-native-followup",
} as const;

type BeginSkillsShClaimArgs = {
  externalId: string;
  ownerPublisherId: Id<"publishers">;
  githubSourceId: Id<"githubSkillSources">;
  githubPath: string;
  githubCommit: string;
  githubContentHash: string;
  now?: number;
};

type TestClaimVerdictArgs = {
  externalId: string;
  phase: "first-claim" | "native-followup";
  verdict: "pass" | "fail";
  confirm: string;
  now?: number;
};

function normalizeExternalId(value: string) {
  return value.trim().toLowerCase();
}

function normalizePath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function sameExactSource(
  value: {
    path?: string;
    commit?: string;
    contentHash?: string;
  },
  expected: { path: string; commit: string; contentHash: string },
) {
  return (
    value.path === expected.path &&
    value.commit?.toLowerCase() === expected.commit &&
    value.contentHash?.toLowerCase() === expected.contentHash
  );
}

async function findExactClaimSkill(
  ctx: MutationCtx,
  args: {
    ownerPublisherId: Id<"publishers">;
    githubSourceId: Id<"githubSkillSources">;
    path: string;
    commit: string;
    contentHash: string;
  },
) {
  const currentSkills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.githubSourceId))
    .filter((q) => q.eq(q.field("githubPath"), args.path))
    .take(2);
  const currentMatches = currentSkills.filter(
    (skill) =>
      skill.ownerPublisherId === args.ownerPublisherId &&
      skill.githubCurrentStatus === "present" &&
      sameExactSource(
        {
          path: skill.githubPath,
          commit: skill.githubCurrentCommit,
          contentHash: skill.githubCurrentContentHash,
        },
        args,
      ),
  );
  const pendingCandidates = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_github_source_and_lifecycle_status", (q) =>
      q.eq("githubSourceId", args.githubSourceId).eq("lifecycleStatus", "pending"),
    )
    .take(501);
  if (pendingCandidates.length > 500) {
    throw new ConvexError("skills.sh claim source has too many pending candidates");
  }
  const candidateMatches: Array<{
    skill: Doc<"skills">;
    candidate: Doc<"githubSkillCandidates">;
  }> = [];
  for (const candidate of pendingCandidates) {
    if (
      !sameExactSource(
        {
          path: candidate.githubPath,
          commit: candidate.githubCommit,
          contentHash: candidate.githubContentHash,
        },
        args,
      )
    ) {
      continue;
    }
    const skill = await ctx.db.get(candidate.skillId);
    if (
      skill?.ownerPublisherId === args.ownerPublisherId &&
      skill.githubPendingCandidateId === candidate._id
    ) {
      candidateMatches.push({ skill, candidate });
    }
  }
  const matches = [
    ...currentMatches.map((skill) => ({ skill, candidate: null })),
    ...candidateMatches,
  ];
  const bySkill = new Map(matches.map((match) => [match.skill._id, match]));
  if (bySkill.size !== 1) {
    throw new ConvexError("Exact skills.sh claim target was not found");
  }
  return [...bySkill.values()][0]!;
}

export async function beginSkillsShClaimHandler(ctx: MutationCtx, args: BeginSkillsShClaimArgs) {
  const externalId = normalizeExternalId(args.externalId);
  const path = normalizePath(args.githubPath);
  const commit = args.githubCommit.trim().toLowerCase();
  const contentHash = args.githubContentHash.trim().toLowerCase();
  const digest = await ctx.db
    .query("skillsShMirrorDigests")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
  const source = await ctx.db.get(args.githubSourceId);
  if (
    !digest ||
    digest.sourceType !== "github" ||
    digest.externalId !== externalId ||
    digest.githubPath !== path ||
    digest.githubCommit?.toLowerCase() !== commit ||
    digest.sourceContentHash?.toLowerCase() !== contentHash ||
    !source ||
    source.ownerPublisherId !== args.ownerPublisherId
  ) {
    throw new ConvexError("Exact skills.sh claim source no longer matches");
  }
  const target = await findExactClaimSkill(ctx, {
    ownerPublisherId: args.ownerPublisherId,
    githubSourceId: args.githubSourceId,
    path,
    commit,
    contentHash,
  });
  if (digest.claimStatus === "promoted") {
    if (
      digest.claimSkillId !== target.skill._id ||
      digest.claimPublisherId !== args.ownerPublisherId
    ) {
      throw new ConvexError("skills.sh claim is already promoted to another owner");
    }
    return {
      ok: true as const,
      phase: "native-followup" as const,
      attempt: digest.claimAttempt ?? 1,
      skillId: target.skill._id,
    };
  }
  if (
    digest.claimStatus === "pending" &&
    digest.claimSkillId === target.skill._id &&
    digest.claimPublisherId === args.ownerPublisherId &&
    digest.claimGithubSourceId === args.githubSourceId &&
    digest.claimGithubPath === path &&
    digest.claimGithubCommit === commit &&
    digest.claimGithubContentHash === contentHash
  ) {
    return {
      ok: true as const,
      phase: "first-claim" as const,
      attempt: digest.claimAttempt ?? 1,
      skillId: target.skill._id,
    };
  }
  if (
    digest.claimStatus === "failed" &&
    digest.claimGithubCommit === commit &&
    digest.claimGithubContentHash === contentHash
  ) {
    throw new ConvexError("A failed skills.sh claim requires a corrected exact candidate");
  }
  if (digest.claimPublisherId && digest.claimPublisherId !== args.ownerPublisherId) {
    throw new ConvexError("skills.sh claim is already bound to another publisher");
  }
  const now = args.now ?? Date.now();
  const attempt = (digest.claimAttempt ?? 0) + 1;
  const claimPatch = {
    claimStatus: "pending" as const,
    claimSkillId: target.skill._id,
    claimPublisherId: args.ownerPublisherId,
    claimGithubSourceId: args.githubSourceId,
    claimGithubPath: path,
    claimGithubCommit: commit,
    claimGithubContentHash: contentHash,
    claimAttempt: attempt,
    claimStartedAt: now,
    claimFailedAt: undefined,
    active: attempt === 1,
    updatedAt: now,
  };
  await ctx.db.patch(digest._id, {
    ...claimPatch,
    ...skillsShMirrorPublicationFlags({ ...digest, ...claimPatch }),
  });
  return {
    ok: true as const,
    phase: "first-claim" as const,
    attempt,
    skillId: target.skill._id,
  };
}

async function insertDeterministicTestScan(
  ctx: MutationCtx,
  args: {
    digest: Doc<"skillsShMirrorDigests">;
    skill: Doc<"skills">;
    candidate: Doc<"githubSkillCandidates"> | null;
    now: number;
  },
) {
  const target = args.candidate
    ? {
        githubSourceId: args.candidate.githubSourceId,
        path: args.candidate.githubPath,
        commit: args.candidate.githubCommit,
        contentHash: args.candidate.githubContentHash,
      }
    : {
        githubSourceId: args.skill.githubSourceId,
        path: args.skill.githubPath,
        commit: args.skill.githubCurrentCommit,
        contentHash: args.skill.githubCurrentContentHash,
      };
  if (!target.githubSourceId || !target.path || !target.commit || !target.contentHash) {
    throw new ConvexError("Exact Test claim candidate is incomplete");
  }
  const existing = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", args.skill._id).eq("contentHash", target.contentHash!),
    )
    .unique();
  const runId = `skills-sh-test-claim:${args.digest.externalId}:${args.digest.claimAttempt ?? 1}`;
  if (existing) {
    await ctx.db.patch(existing._id, {
      githubSourceId: target.githubSourceId,
      path: target.path,
      commit: target.commit,
      status: "clean",
      skillScanRequestId: undefined,
      runId,
      completedAt: args.now,
      updatedAt: args.now,
    });
    return existing._id;
  }
  return await ctx.db.insert("githubSkillScans", {
    skillId: args.skill._id,
    githubSourceId: target.githubSourceId,
    path: target.path,
    commit: target.commit,
    contentHash: target.contentHash,
    status: "clean",
    runId,
    completedAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function applySkillsShTestClaimVerdictHandler(
  ctx: MutationCtx,
  args: TestClaimVerdictArgs,
  environment: Parameters<typeof assertSkillsShFixtureEnvironmentAllowed>[0] = process.env,
) {
  assertSkillsShFixtureEnvironmentAllowed(environment);
  const expectedConfirm =
    args.phase === "first-claim"
      ? FIRST_CLAIM_CONFIRM[args.verdict]
      : NATIVE_FOLLOWUP_CONFIRM[args.verdict];
  if (args.confirm !== expectedConfirm) {
    throw new ConvexError("skills.sh Test claim verdict confirmation is invalid");
  }
  const digest = await ctx.db
    .query("skillsShMirrorDigests")
    .withIndex("by_external_id", (q) => q.eq("externalId", normalizeExternalId(args.externalId)))
    .unique();
  if (!digest?.claimSkillId) throw new ConvexError("skills.sh claim binding was not found");
  const skill = await ctx.db.get(digest.claimSkillId);
  if (!skill) throw new ConvexError("skills.sh claimed skill was not found");
  const candidate = skill.githubPendingCandidateId
    ? await ctx.db.get(skill.githubPendingCandidateId)
    : null;
  if (args.phase === "first-claim" && digest.claimStatus !== "pending") {
    if (args.verdict === "pass" && digest.claimStatus === "promoted") {
      return { ok: true as const, promoted: true as const, idempotent: true as const };
    }
    throw new ConvexError("skills.sh first claim is not pending");
  }
  if (args.phase === "native-followup") {
    if (digest.claimStatus !== "promoted" || !candidate) {
      throw new ConvexError("skills.sh native follow-up candidate was not found");
    }
  }
  const now = args.now ?? Date.now();
  const contentHash = candidate?.githubContentHash ?? skill.githubCurrentContentHash;
  if (!contentHash) throw new ConvexError("skills.sh claim content hash was not found");
  const scanId =
    args.verdict === "pass"
      ? await insertDeterministicTestScan(ctx, { digest, skill, candidate, now })
      : undefined;
  const result = await applyGitHubSkillVerificationResultHandler(ctx, {
    skillId: skill._id,
    contentHash,
    ...(scanId ? { githubSkillScanId: scanId } : {}),
    scanStatus: args.verdict === "pass" ? "clean" : "failed",
    now,
  });
  if (args.phase === "native-followup") {
    return { ...result, phase: "native-followup" as const };
  }
  if (args.verdict === "fail") {
    await ctx.db.patch(digest._id, {
      claimStatus: "failed",
      claimFailedAt: now,
      active: false,
      publicVisible: false,
      installable: false,
      updatedAt: now,
    });
    return { ...result, phase: "first-claim" as const };
  }
  if (!("promoted" in result) || result.promoted !== true) {
    throw new ConvexError("Deterministic skills.sh Test claim did not promote the exact candidate");
  }
  const promotedSkill = await ctx.db.get(skill._id);
  if (!promotedSkill) throw new ConvexError("Promoted skills.sh skill was not found");
  const metricPatch = {
    statsSkillsShInstalls: digest.upstreamInstalls,
    updatedAt: now,
  };
  await ctx.db.patch(promotedSkill._id, metricPatch);
  await syncSkillSearchDigestForSkill(ctx, { ...promotedSkill, ...metricPatch });
  await ctx.db.patch(digest._id, {
    claimStatus: "promoted",
    claimedAt: now,
    claimFailedAt: undefined,
    active: false,
    publicVisible: false,
    installable: false,
    updatedAt: now,
  });
  return { ...result, phase: "first-claim" as const };
}

export const applyClaimedGitHubSkillSourceSyncInternal = internalMutation({
  args: {
    sourceId: v.optional(v.id("githubSkillSources")),
    repo: v.string(),
    ownerUserId: v.id("users"),
    ownerPublisherId: v.id("publishers"),
    githubRepositoryId: v.optional(v.string()),
    githubOwnerId: v.optional(v.string()),
    expectedSourceUpdatedAt: v.optional(v.union(v.number(), v.null())),
    skillsShClaimPath: v.optional(v.string()),
    skillsShClaim: v.object({
      externalId: v.string(),
      path: v.string(),
      commit: v.string(),
      contentHash: v.string(),
    }),
    snapshot: sourceSnapshotValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const claimPath = normalizePath(args.skillsShClaim.path);
    if (args.skillsShClaimPath && normalizePath(args.skillsShClaimPath) !== claimPath) {
      throw new ConvexError("skills.sh claim verification suppression must match the claim path");
    }
    const result = await applyGitHubSkillSourceSyncHandler(ctx, {
      sourceId: args.sourceId,
      repo: args.repo,
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId,
      githubRepositoryId: args.githubRepositoryId,
      githubOwnerId: args.githubOwnerId,
      expectedSourceUpdatedAt: args.expectedSourceUpdatedAt,
      ...(args.skillsShClaimPath ? { skillsShClaimPath: claimPath } : {}),
      snapshot: args.snapshot,
      now: args.now,
    });
    if (result.skipped === "stale-source-observation") return result;
    if (!result.sourceId) throw new ConvexError("skills.sh claim source was not created");
    const claim = await beginSkillsShClaimHandler(ctx, {
      externalId: args.skillsShClaim.externalId,
      ownerPublisherId: args.ownerPublisherId,
      githubSourceId: result.sourceId,
      githubPath: claimPath,
      githubCommit: args.skillsShClaim.commit,
      githubContentHash: args.skillsShClaim.contentHash,
      now: args.now,
    });
    return { ...result, claim };
  },
});

export const applyTestVerdictInternal = internalMutation({
  args: {
    externalId: v.string(),
    phase: v.union(v.literal("first-claim"), v.literal("native-followup")),
    verdict: v.union(v.literal("pass"), v.literal("fail")),
    confirm: v.string(),
    now: v.optional(v.number()),
  },
  handler: applySkillsShTestClaimVerdictHandler,
});
