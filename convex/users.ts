import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./functions";
import {
  assertAdmin,
  assertModerator,
  getOptionalActiveAuthUserId,
  requireUser,
} from "./lib/access";
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import { syncGitHubProfile } from "./lib/githubAccount";
import { hasOfficialPublisherRow } from "./lib/officialPublishers";
import { toPublicUser } from "./lib/public";
import {
  formatReservedPublicOwnerHandleMessage,
  isReservedOpenClawExtensionHandle,
  isReservedPublicOwnerHandle,
} from "./lib/publicRouteReservations";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getPublisherByHandle,
  getPublisherMembership,
  getPersonalPublisherForUser,
  getPersonalPublisherForUserOrFallback,
  getUserByHandleOrPersonalPublisher,
  isReservedOpenClawPublisherHandle,
} from "./lib/publishers";
import {
  getPackagePublisherContribution,
  getSkillPublisherContribution,
} from "./lib/publisherStats";
import {
  getLatestActiveReservedHandle,
  isHandleReservedForAnotherUser,
  normalizeReservedHandle,
  upsertReservedHandleForRightfulOwner,
} from "./lib/reservedHandles";
import { buildUserSearchResults } from "./lib/userSearch";

const DEFAULT_ROLE = "user";
const ADMIN_HANDLE = "steipete";
const MAX_USER_LIST_LIMIT = 200;
const MAX_USER_SEARCH_SCAN = 5_000;
const MIN_USER_SEARCH_SCAN = 500;
const DEV_PERSONA_GITHUB_CREATED_AT = Date.UTC(2020, 0, 1);
const AUTOBAN_AUDIT_MATCH_WINDOW_MS = 5_000;
const BAN_AUDIT_ACTIONS = new Set([
  "user.ban",
  "user.autoban.malware",
  "user.autoban.publisher_abuse",
]);
const BAN_APPEAL_AUTH_ACCOUNT_MATCH_LIMIT = 20;
const MALICIOUS_ARTIFACT_FINDING_ACTION = "user.malicious_artifact.finding";
const MALICIOUS_ARTIFACT_DISTINCT_BAN_THRESHOLD = 2;
const MALICIOUS_ARTIFACT_ATTEMPT_BAN_THRESHOLD = 3;
const MALICIOUS_ARTIFACT_AUDIT_LOOKBACK = 100;
const DEV_PERSONA_BANNED_REAUTH_MESSAGE =
  "This account has been banned and cannot sign in. If you believe this is a mistake, appeal this decision: https://appeals.openclaw.ai/.";
const ACCOUNT_RECOVERY_PURGE_LIMIT_DEFAULT = 25;
const ACCOUNT_RECOVERY_PURGE_LIMIT_MAX = 100;
const HOVER_STATS_COMPATIBILITY_ROW_LIMIT = 200;
const MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_SCAN = 100;
const MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_READS = 2_000;
const STAFF_PUBLISHER_MANAGER_ROLES = ["owner", "admin"] as const;
const accountRecoveryPurgeModeValidator = v.optional(
  v.union(v.literal("deactivated"), v.literal("legacyDeleted")),
);
type DeletedAccountCleanupResult = {
  authAccounts: number;
  authVerificationCodes: number;
  authSessions: number;
  authRefreshTokens: number;
  apiTokens: number;
  personalPublisherDeleted: boolean;
  publisherFollows: number;
  publisherFollowsCleanupScheduled: boolean;
};
type AccountRecoveryPurgeEligibilityReason =
  | "self_delete_audit"
  | "auth_locked_purged_user"
  | "auth_locked_legacy_deleted_user";
type AccountRecoveryPurgeEligibility =
  | {
      eligible: true;
      reason: AccountRecoveryPurgeEligibilityReason;
      selfDeleteAuditLog: Doc<"auditLogs"> | null;
      authAccountCount: number | null;
    }
  | {
      eligible: false;
      selfDeleteAuditLog: null;
    };
type AccountRecoveryPurgeCandidate = {
  userId: Id<"users">;
  eligibilityReason: AccountRecoveryPurgeEligibilityReason;
  handle: string | null;
  displayName: string | null;
  emailPresent: boolean;
  personalPublisherId: Id<"publishers"> | null;
  authAccountCount: number | null;
  deletedAt: number | null;
  deactivatedAt: number | null;
  purgedAt: number | null;
  selfDeleteAuditLogId: Id<"auditLogs"> | null;
  selfDeleteAuditCreatedAt: number | null;
};

type BanEmailTarget = Pick<Doc<"users">, "_id" | "email" | "handle">;
type MaliciousArtifactKind = "skill" | "plugin";
type MaliciousArtifactFinding = {
  artifactKind: MaliciousArtifactKind;
  artifactName: string;
};
type PublisherAbuseAutobanNomination = Doc<"publisherAbuseReviewNominations">;
type PublisherAbuseAutobanNominationCheck =
  | { ok: true; nomination: PublisherAbuseAutobanNomination }
  | {
      ok: false;
      reason: "nomination_not_actionable";
    };
type ApplyUserBanArgs = {
  target: Doc<"users">;
  targetUserId: Id<"users">;
  actorUserId: Id<"users">;
  deletedByRole: "admin" | "moderator" | "user";
  auditAction: "user.ban" | "user.autoban.publisher_abuse";
  emailSource: "manual" | "autoban";
  reasonRaw?: string;
  hiddenBy?: Id<"users">;
  emailTrigger?: string;
  auditMetadata?: Record<string, unknown>;
};

async function scheduleBanNotificationEmail(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    target: BanEmailTarget;
    bannedAt: number;
    source: "manual" | "autoban";
    reason?: string;
    trigger?: string;
    artifact?: { kind: "skill" | "plugin"; name: string };
    hiddenArtifacts?: number;
  },
) {
  const to = args.target.email?.trim();
  if (!to) return;

  await ctx.scheduler.runAfter(0, internal.emailsNode.sendBanNotificationInternal, {
    userId: args.target._id,
    bannedAt: args.bannedAt,
    to,
    handle: args.target.handle,
    source: args.source,
    reason: args.reason,
    trigger: args.trigger,
    artifact: args.artifact,
    hiddenArtifacts: args.hiddenArtifacts,
  });
}

async function scheduleRestoredAccountNotificationEmail(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    target: BanEmailTarget;
    restoredAt: number;
    restoredListings?: Array<{ kind: "skill" | "plugin"; name: string }>;
    skillsRestored?: number;
    packagesRestored?: number;
  },
) {
  const to = args.target.email?.trim();
  if (!to) return;

  await ctx.scheduler.runAfter(0, internal.emailsNode.sendRestoredAccountNotificationInternal, {
    userId: args.target._id,
    restoredAt: args.restoredAt,
    to,
    handle: args.target.handle,
    restoredListings: args.restoredListings,
    skillsRestored: args.skillsRestored,
    packagesRestored: args.packagesRestored,
  });
}

async function scheduleMaliciousArtifactNotificationEmail(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    target: BanEmailTarget;
    findingAt: number;
    artifact: { kind: MaliciousArtifactKind; name: string };
    version?: string;
    trigger?: string;
    findingSummary?: string;
  },
) {
  const to = args.target.email?.trim();
  if (!to) return;

  await ctx.scheduler.runAfter(0, internal.emailsNode.sendMaliciousArtifactNotificationInternal, {
    userId: args.target._id,
    findingAt: args.findingAt,
    to,
    handle: args.target.handle,
    artifact: args.artifact,
    version: args.version,
    trigger: args.trigger,
    findingSummary: args.findingSummary,
  });
}

async function getActionablePublisherAbuseAutobanNomination(
  ctx: Pick<MutationCtx, "db">,
  args: {
    nominationId: Id<"publisherAbuseReviewNominations">;
    scoreId: Id<"publisherAbuseScores">;
    ownerUserId: Id<"users">;
  },
): Promise<PublisherAbuseAutobanNominationCheck> {
  const nomination = await ctx.db.get(args.nominationId);
  if (!nomination) return { ok: false, reason: "nomination_not_actionable" };
  if (nomination.status !== "pending") return { ok: false, reason: "nomination_not_actionable" };
  if (nomination.label !== "potential_ban_candidate") {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  if (nomination.latestScoreId !== args.scoreId) {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  if (nomination.ownerUserId !== args.ownerUserId) {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  if (!nomination.ownerPublisherId) return { ok: false, reason: "nomination_not_actionable" };
  const publisher = await ctx.db.get(nomination.ownerPublisherId);
  if (
    !publisher ||
    publisher.deletedAt ||
    publisher.deactivatedAt ||
    publisher.linkedUserId !== args.ownerUserId
  ) {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  if (await hasOfficialPublisherRow(ctx, publisher._id)) {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  if (publisher.kind === "org" && (await hasStaffPublisherManager(ctx, publisher._id))) {
    return { ok: false, reason: "nomination_not_actionable" };
  }
  return { ok: true, nomination };
}

async function hasStaffPublisherManager(
  ctx: Pick<MutationCtx, "db">,
  publisherId: Id<"publishers">,
) {
  let remainingDocReads = MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_READS;
  for (const role of STAFF_PUBLISHER_MANAGER_ROLES) {
    let cursor: string | null = null;
    do {
      if (remainingDocReads <= 1) return true;
      const page = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher_and_role", (q) =>
          q.eq("publisherId", publisherId).eq("role", role),
        )
        .paginate({
          cursor,
          numItems: Math.min(
            MAX_STAFF_PUBLISHER_MANAGER_EXCLUSION_SCAN,
            Math.floor(remainingDocReads / 2),
          ),
        });
      remainingDocReads -= page.page.length;

      for (const member of page.page) {
        if (remainingDocReads <= 0) return true;
        remainingDocReads -= 1;
        const user = await ctx.db.get(member.userId);
        if (user?.role === "admin" || user?.role === "moderator") return true;
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
  }
  return false;
}

async function markPublisherAbuseAutobanNominationBanned(
  ctx: Pick<MutationCtx, "db">,
  args: {
    nomination: PublisherAbuseAutobanNomination;
    reason: string;
    now: number;
  },
) {
  await ctx.db.patch(args.nomination._id, {
    status: "banned",
    reviewedByUserId: undefined,
    reviewedAt: args.now,
    notes: args.reason,
    updatedAt: args.now,
  });
  await ctx.db.insert("publisherAbuseReviewEvents", {
    nominationId: args.nomination._id,
    ownerKey: args.nomination.ownerKey,
    scoreId: args.nomination.latestScoreId,
    eventType: "triage_status_changed",
    previousStatus: args.nomination.status,
    nextStatus: "banned",
    notes: args.reason,
    createdAt: args.now,
  });
}

async function purgeAuthStateForUser(ctx: MutationCtx, userId: Id<"users">) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  let authVerificationCodes = 0;
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    authVerificationCodes += codes.length;
    for (const code of codes) await ctx.db.delete(code._id);
    await ctx.db.delete(account._id);
  }

  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  let authRefreshTokens = 0;
  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    authRefreshTokens += refreshTokens.length;
    for (const refreshToken of refreshTokens) await ctx.db.delete(refreshToken._id);
    await ctx.db.delete(session._id);
  }

  return {
    authAccounts: accounts.length,
    authVerificationCodes,
    authSessions: sessions.length,
    authRefreshTokens,
  };
}

async function hardDeleteSelfDeletedAccountState(
  ctx: MutationCtx,
  user: Doc<"users">,
  deletedAt: number,
): Promise<DeletedAccountCleanupResult> {
  const tokens = await ctx.db
    .query("apiTokens")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const token of tokens) await ctx.db.delete(token._id);

  const deletedFollows = await ctx.runMutation(
    internal.publisherFollows.deletePublisherFollowsForFollowerInternal,
    { followerUserId: user._id },
  );

  const personalPublisher = user.personalPublisherId
    ? await ctx.db.get(user.personalPublisherId)
    : await getPersonalPublisherForUser(ctx, user._id);
  let personalPublisherDeleted = false;
  if (personalPublisher) {
    const publisherDeletedAt = personalPublisher.deletedAt ?? deletedAt;
    if (!personalPublisher.deletedAt || !personalPublisher.deactivatedAt) {
      await ctx.db.patch(personalPublisher._id, {
        deletedAt: publisherDeletedAt,
        deactivatedAt: publisherDeletedAt,
        updatedAt: deletedAt,
      });
    }
    await ctx.runMutation(internal.skills.applyPublisherDeletionToOwnedSkillsBatchInternal, {
      ownerPublisherId: personalPublisher._id,
      actorUserId: user._id,
      deletedAt: publisherDeletedAt,
      cursor: undefined,
    });
    await ctx.runMutation(internal.packages.applyPublisherDeletionToOwnedPackagesBatchInternal, {
      ownerPublisherId: personalPublisher._id,
      actorUserId: user._id,
      deletedAt: publisherDeletedAt,
      cursor: undefined,
    });
    await ctx.runMutation(internal.publishers.hardDeletePublisherRowsInternal, {
      publisherId: personalPublisher._id,
    });
    personalPublisherDeleted = true;
  }

  await ctx.runMutation(internal.packages.applyAccountDeletionToOwnedPackagesBatchInternal, {
    ownerUserId: user._id,
    deletedAt,
    cursor: undefined,
  });
  await ctx.runMutation(internal.skills.applyAccountDeletionToOwnedSkillsBatchInternal, {
    ownerUserId: user._id,
    hiddenBy: user._id,
    deletedAt,
    cursor: undefined,
  });
  await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId: user._id });
  const authState = await purgeAuthStateForUser(ctx, user._id);
  return {
    ...authState,
    apiTokens: tokens.length,
    personalPublisherDeleted,
    publisherFollows: deletedFollows.deleted,
    publisherFollowsCleanupScheduled: deletedFollows.scheduled,
  };
}

async function scrubDeletedUserTombstone(ctx: MutationCtx, user: Doc<"users">, deletedAt: number) {
  await ctx.db.patch(user._id, {
    deactivatedAt: user.deactivatedAt ?? deletedAt,
    purgedAt: user.purgedAt ?? deletedAt,
    deletedAt: undefined,
    banReason: undefined,
    role: "user",
    handle: undefined,
    displayName: undefined,
    name: undefined,
    image: undefined,
    email: undefined,
    emailVerificationTime: undefined,
    phone: undefined,
    phoneVerificationTime: undefined,
    isAnonymous: undefined,
    bio: undefined,
    githubCreatedAt: undefined,
    updatedAt: deletedAt,
  });
}
const DEV_PERSONAS = {
  owner: {
    handle: "local",
    displayName: "Local Owner",
    role: "user",
  },
  user: {
    handle: "local-user",
    displayName: "Local User",
    role: "user",
  },
  admin: {
    handle: "local-admin",
    displayName: "Local Admin",
    role: "admin",
  },
  officialOrgMember: {
    handle: "local-official-member",
    displayName: "Local Official Org Member",
    role: "user",
  },
  abusePublisher: {
    handle: "local-abuse",
    displayName: "Local Abuse Test Publisher",
    email: "local-abuse@example.test",
    role: "user",
  },
} as const;

const DEV_OFFICIAL_ORG = {
  handle: "local-official-org",
  displayName: "Local Official Org",
  reason: "dev-persona.official-org-member",
} as const;

type DevPersona = keyof typeof DEV_PERSONAS;

async function hasBlockingBanAudit(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const banRecords = await ctx.db
    .query("auditLogs")
    .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", userId.toString()))
    .collect();
  return banRecords.some((record) => BAN_AUDIT_ACTIONS.has(record.action));
}

export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => toPublicUser(await ctx.db.get(args.userId)),
});

export const getByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
});

export const upsertDevPersonaInternal = internalMutation({
  args: {
    persona: v.union(
      v.literal("owner"),
      v.literal("user"),
      v.literal("admin"),
      v.literal("officialOrgMember"),
      v.literal("abusePublisher"),
    ),
    devAuthSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    if (!isLocalDevAuthEnabled(process.env, args.devAuthSecret)) {
      throw new Error("Dev auth is disabled");
    }

    const persona = DEV_PERSONAS[args.persona as DevPersona];
    const now = Date.now();
    const existing = await getUserByHandleOrPersonalPublisher(ctx, persona.handle);
    const patch = {
      handle: persona.handle,
      displayName: persona.displayName,
      name: persona.handle,
      email: "email" in persona ? persona.email : undefined,
      role: persona.role,
      githubCreatedAt: DEV_PERSONA_GITHUB_CREATED_AT,
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
      banReason: undefined,
      updatedAt: now,
    };
    if (
      existing &&
      (existing.deletedAt || existing.deactivatedAt) &&
      (await hasBlockingBanAudit(ctx, existing._id))
    ) {
      throw new ConvexError(DEV_PERSONA_BANNED_REAUTH_MESSAGE);
    }
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        ...patch,
        createdAt: now,
      }));
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Dev persona was not created");
    await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: user._id,
      source: "dev_persona.upsert",
    });
    if (args.persona === "officialOrgMember") {
      await ensureDevOfficialOrgMembership(ctx, user, now);
    }
    return userId;
  },
});

async function ensureDevOfficialOrgMembership(ctx: MutationCtx, user: Doc<"users">, now: number) {
  let publisher = await getPublisherByHandle(ctx, DEV_OFFICIAL_ORG.handle);
  let publisherId = publisher?._id;

  if (!publisherId) {
    publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: DEV_OFFICIAL_ORG.handle,
      displayName: DEV_OFFICIAL_ORG.displayName,
      bio: undefined,
      image: undefined,
      linkedUserId: undefined,
      trustedPublisher: undefined,
      createdAt: now,
      updatedAt: now,
    });
  } else if (publisher?.deletedAt || publisher?.deactivatedAt) {
    await ctx.db.patch(publisherId, {
      displayName: DEV_OFFICIAL_ORG.displayName,
      deletedAt: undefined,
      deactivatedAt: undefined,
      updatedAt: now,
    });
  }

  const existingOfficial = await ctx.db
    .query("officialPublishers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .unique();
  if (!existingOfficial) {
    await ctx.db.insert("officialPublishers", {
      publisherId,
      reason: DEV_OFFICIAL_ORG.reason,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
  }

  const membership = await getPublisherMembership(ctx, publisherId, user._id);
  if (!membership) {
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId: user._id,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });
  } else if (membership.role === "publisher") {
    await ctx.db.patch(membership._id, { role: "admin", updatedAt: now });
  }
}

export const getByHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await getUserByHandleOrPersonalPublisher(ctx, args.handle);
  },
});

export const getBanAppealContextByGitHubProviderAccountIdInternal = internalQuery({
  args: { providerAccountId: v.string() },
  handler: async (ctx, args) => {
    const providerAccountId = args.providerAccountId.trim();
    if (!/^\d+$/.test(providerAccountId)) {
      return { ok: true as const, action: "moderated" as const, userId: null };
    }

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "github").eq("providerAccountId", providerAccountId),
      )
      .take(BAN_APPEAL_AUTH_ACCOUNT_MATCH_LIMIT);
    if (accounts.length === 0) {
      return { ok: true as const, action: "moderated" as const, userId: null };
    }

    let fallbackUser: Doc<"users"> | null = null;
    for (const account of accounts) {
      const user = await ctx.db.get(account.userId);
      if (!user) continue;
      fallbackUser ??= user;
      if (!user.deletedAt || user.deactivatedAt) continue;

      const banLog = await getCurrentBanAuditLog(ctx, user._id, user.deletedAt);
      if (banLog) return toBanAppealContextResult(user, banLog);
    }

    if (!fallbackUser) return { ok: true as const, action: "moderated" as const, userId: null };
    return toBanAppealContextResult(fallbackUser, null);
  },
});

function toBanAppealContextResult(user: Doc<"users">, banLog: Doc<"auditLogs"> | null) {
  const banned = Boolean(user.deletedAt && !user.deactivatedAt && banLog);
  const metadata = banLog?.metadata as { reason?: string } | undefined;

  return {
    ok: true as const,
    action: banned ? ("banned" as const) : ("moderated" as const),
    userId: user._id,
    handle: user.handle ?? null,
    displayName: user.displayName ?? user.name ?? null,
    banReason: banned ? (user.banReason ?? metadata?.reason ?? null) : null,
    bannedAt: banned ? (user.deletedAt ?? null) : null,
    auditAction: banLog?.action ?? null,
    auditActorUserId: banLog?.actorUserId ?? null,
  };
}

async function getCurrentBanAuditLog(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
  bannedAt: number,
) {
  const logs = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_createdAt", (q) =>
      q
        .eq("targetType", "user")
        .eq("targetId", userId.toString())
        .gte("createdAt", bannedAt - AUTOBAN_AUDIT_MATCH_WINDOW_MS)
        .lte("createdAt", bannedAt + AUTOBAN_AUDIT_MATCH_WINDOW_MS),
    )
    .order("desc")
    .take(20);
  return logs.find((log) => BAN_AUDIT_ACTIONS.has(log.action)) ?? null;
}

export const searchInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("Unauthorized");
    assertAdmin(actor);

    const limit = clampInt(args.limit ?? 20, 1, MAX_USER_LIST_LIMIT);
    const exactHandleUser = args.query
      ? await getUserByHandleOrPersonalPublisher(ctx, args.query)
      : null;
    const result = await queryUsersForAdminList(ctx, {
      limit,
      search: args.query,
      exactUserId: exactHandleUser?._id,
    });
    const dedupedUsers = exactHandleUser
      ? [exactHandleUser, ...result.items.filter((user) => user._id !== exactHandleUser._id)]
      : result.items;
    const total = exactHandleUser
      ? result.total + (result.containsExactUser ? 0 : 1)
      : result.total;
    const items = dedupedUsers.slice(0, limit).map((user) => ({
      userId: user._id,
      handle: user.handle ?? null,
      displayName: user.displayName ?? null,
      name: user.name ?? null,
      role: user.role ?? null,
    }));
    return { items, total };
  },
});

export const setGitHubCreatedAtInternal = internalMutation({
  args: {
    userId: v.id("users"),
    githubCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubCreatedAt: args.githubCreatedAt,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Sync the user's GitHub profile (username, avatar) when it changes.
 * This handles the case where a user renames their GitHub account.
 */
export const syncGitHubProfileInternal = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    image: v.optional(v.string()),
    profileName: v.optional(v.string()),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) return;
    const canClaimNewHandle = await canUserClaimHandle(ctx, args.name, args.userId);

    const updates: Partial<Doc<"users">> = { githubProfileSyncedAt: args.syncedAt };
    let didChangeProfile = false;

    if (user.name !== args.name) {
      updates.name = args.name;
      didChangeProfile = true;
    }

    // Update handle if it was derived from the old username
    if (user.handle === user.name && user.name !== args.name && canClaimNewHandle) {
      updates.handle = args.name;
      didChangeProfile = true;
    }

    // Update displayName if it was derived from the old username
    if (
      (user.displayName === user.name || user.displayName === user.handle) &&
      user.name !== args.name &&
      canClaimNewHandle
    ) {
      updates.displayName = args.name;
      didChangeProfile = true;
    }

    // If displayName is derived/missing, prefer the GitHub profile "name" (full name).
    const profileName = args.profileName?.trim();
    if (profileName && profileName !== args.name) {
      const currentDisplay = user.displayName?.trim();
      const currentHandle = user.handle?.trim();
      const currentLogin = user.name?.trim();
      const isDerivedOrMissing =
        !currentDisplay || currentDisplay === currentHandle || currentDisplay === currentLogin;
      if (isDerivedOrMissing && currentDisplay !== profileName) {
        updates.displayName = profileName;
        didChangeProfile = true;
      }
    }

    // Update avatar if provided
    if (args.image && args.image !== user.image) {
      updates.image = args.image;
      didChangeProfile = true;
    }

    if (didChangeProfile) {
      updates.updatedAt = Date.now();
    }
    await ctx.db.patch(args.userId, updates);
    if (didChangeProfile) {
      await ctx.db.insert("auditLogs", {
        actorUserId: args.userId,
        action: "user.profile.sync",
        targetType: "user",
        targetId: args.userId,
        metadata: {
          source: "github",
          previous: {
            name: user.name ?? null,
            handle: user.handle ?? null,
            displayName: user.displayName ?? null,
            image: user.image ?? null,
          },
          next: {
            name: updates.name ?? user.name ?? null,
            handle: updates.handle ?? user.handle ?? null,
            displayName: updates.displayName ?? user.displayName ?? null,
            image: updates.image ?? user.image ?? null,
          },
        },
        createdAt: updates.updatedAt ?? args.syncedAt,
      });
    }
    const nextUser = didChangeProfile ? ({ ...user, ...updates } as Doc<"users">) : user;
    await ensurePersonalPublisherForUser(ctx, nextUser, {
      actorUserId: args.userId,
      source: "user.profile.sync",
    });
  },
});

/**
 * Internal action to sync GitHub profile from the GitHub API.
 * This is called after login to ensure the username is up-to-date.
 */
export const syncGitHubProfileAction = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx: ActionCtx, args) => {
    await syncGitHubProfile(ctx, args.userId);
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const ensure = mutation({
  args: {},
  handler: ensureHandler,
});

function normalizeHandle(handle: string | undefined) {
  const normalized = handle?.trim();
  return normalized ? normalized : undefined;
}

function deriveHandle(args: { existingHandle?: string; githubLogin?: string; email?: string }) {
  // Prefer the GitHub login; only fall back to email-derived handle when we don't already have one.
  if (args.githubLogin) return args.githubLogin;
  if (!args.existingHandle && args.email) return args.email.split("@")[0]?.trim() || undefined;
  return undefined;
}

function appendHandleSuffix(base: string, suffix: number) {
  const suffixText = suffix <= 1 ? "" : `-${suffix}`;
  const maxBaseLength = Math.max(2, 40 - suffixText.length);
  return `${base.slice(0, maxBaseLength)}${suffixText}`;
}

function getSafePersonalHandleFallbackBase(handle: string | undefined) {
  return isReservedOpenClawPublisherHandle(handle) ? "user" : handle;
}

async function resolveAvailableHandle(
  ctx: MutationCtx,
  preferredHandle: string | undefined,
  userId: Id<"users">,
) {
  const normalizedHandle = normalizeReservedHandle(preferredHandle);
  if (!normalizedHandle) return undefined;
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = appendHandleSuffix(normalizedHandle, suffix);
    if (await canUserClaimHandle(ctx, candidate, userId)) return candidate;
  }
  return undefined;
}

async function canUserClaimHandle(
  ctx: MutationCtx,
  handle: string | undefined,
  userId: Id<"users">,
) {
  const normalizedHandle = normalizeReservedHandle(handle);
  if (!normalizedHandle) return false;
  if (isReservedPublicOwnerHandle(normalizedHandle)) return false;
  if (isReservedOpenClawPublisherHandle(normalizedHandle)) return false;
  if (await isHandleReservedForAnotherUser(ctx, normalizedHandle, userId)) return false;

  const publisher = await getPublisherByHandle(ctx, normalizedHandle);
  if (isReservedOpenClawExtensionHandle(normalizedHandle)) {
    const existingUser = await getUserByHandleOrPersonalPublisher(ctx, normalizedHandle);
    return existingUser?._id === userId;
  }
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return true;
  return publisher.kind === "user" && publisher.linkedUserId === userId;
}

async function computeEnsureUpdates(ctx: MutationCtx, user: Doc<"users">) {
  const updates: Record<string, unknown> = {};

  const existingHandle = normalizeHandle(user.handle);
  const existingHandleClaimable = existingHandle
    ? await canUserClaimHandle(ctx, existingHandle, user._id)
    : false;
  const githubLogin = normalizeHandle(user.name);
  const requestedHandle = deriveHandle({
    existingHandle,
    githubLogin,
    email: user.email,
  });
  let derivedHandle =
    requestedHandle && (await canUserClaimHandle(ctx, requestedHandle, user._id))
      ? requestedHandle
      : undefined;
  if (!derivedHandle && (!existingHandle || !existingHandleClaimable)) {
    const emailFallback = normalizeHandle(user.email?.split("@")[0]);
    const safeEmailFallback = getSafePersonalHandleFallbackBase(emailFallback);
    const emailFallbackHandle =
      emailFallback && emailFallback !== requestedHandle
        ? await resolveAvailableHandle(ctx, safeEmailFallback, user._id)
        : undefined;
    const preferredFallbackBase = requestedHandle ?? existingHandle ?? githubLogin ?? emailFallback;
    const fallbackBase = isReservedOpenClawPublisherHandle(preferredFallbackBase)
      ? (safeEmailFallback ?? "user")
      : preferredFallbackBase;
    derivedHandle =
      (await resolveAvailableHandle(ctx, fallbackBase, user._id)) ?? emailFallbackHandle;
  }
  const baseHandle = derivedHandle ?? (existingHandleClaimable ? existingHandle : undefined);

  if (derivedHandle && existingHandle !== derivedHandle) {
    updates.handle = derivedHandle;
  }

  const displayName = normalizeHandle(user.displayName);
  if (!displayName && baseHandle) {
    updates.displayName = baseHandle;
  } else if (derivedHandle && displayName === existingHandle) {
    updates.displayName = derivedHandle;
  }

  if (!user.role) {
    updates.role = baseHandle === ADMIN_HANDLE ? "admin" : DEFAULT_ROLE;
  }

  if (!user.createdAt) updates.createdAt = user._creationTime;

  return updates;
}

export async function ensureHandler(ctx: MutationCtx) {
  const { userId, user } = await requireUser(ctx);
  const updates = await computeEnsureUpdates(ctx, user);

  const hasUpdates = Object.keys(updates).length > 0;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = Date.now();
    await ctx.db.patch(userId, updates);
  }
  const ensuredUser = hasUpdates
    ? ({ ...user, ...updates } as Doc<"users">)
    : ((await ctx.db.get(userId)) ?? user);
  await ensurePersonalPublisherForUser(
    ctx,
    ensuredUser,
    {
      actorUserId: userId,
      source: "user.ensure",
    },
    { handleConflict: "skip" },
  );
  if (hasUpdates) {
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.profile.ensure",
      targetType: "user",
      targetId: userId,
      metadata: {
        changedFields: Object.keys(updates).filter((field) => field !== "updatedAt"),
      },
      createdAt: updates.updatedAt as number,
    });
  }
  return await ctx.db.get(userId);
}

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    const now = Date.now();
    const displayName = args.displayName.trim();
    const bio = args.bio?.trim();
    await ctx.db.patch(userId, {
      displayName,
      bio,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.profile.update",
      targetType: "user",
      targetId: userId,
      metadata: {
        previous: {
          displayName: user?.displayName ?? null,
          bio: user?.bio ?? null,
        },
        next: {
          displayName,
          bio: bio ?? null,
        },
      },
      createdAt: now,
    });
    const nextUser = await ctx.db.get(userId);
    if (nextUser) {
      await ensurePersonalPublisherForUser(
        ctx,
        nextUser,
        {
          actorUserId: userId,
          source: "user.profile.update",
        },
        { handleConflict: "skip" },
      );
    }
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const now = Date.now();
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    await ctx.runMutation(internal.publishers.deleteSoleOwnerOrgsForAccountDeletionInternal, {
      actorUserId: userId,
      deletedAt: now,
    });
    const cleanup = await hardDeleteSelfDeletedAccountState(ctx, user, now);

    await ctx.db.patch(userId, {
      deactivatedAt: now,
      purgedAt: now,
      deletedAt: undefined,
      banReason: undefined,
      role: "user",
      handle: undefined,
      displayName: undefined,
      name: undefined,
      image: undefined,
      email: undefined,
      emailVerificationTime: undefined,
      phone: undefined,
      phoneVerificationTime: undefined,
      isAnonymous: undefined,
      bio: undefined,
      githubCreatedAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      metadata: {
        previous: {
          handle: user?.handle ?? null,
          displayName: user?.displayName ?? null,
          name: user?.name ?? null,
          image: user?.image ?? null,
          emailPresent: Boolean(user?.email),
          personalPublisherId: user?.personalPublisherId ?? null,
        },
        cleanup,
      },
      createdAt: now,
    });
  },
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalPublisherId(value: unknown): Id<"publishers"> | null {
  return typeof value === "string" && value.startsWith("publishers:")
    ? (value as Id<"publishers">)
    : null;
}

function getSelfDeletePreviousMetadata(log: Doc<"auditLogs"> | null) {
  return asRecord(asRecord(log?.metadata)?.previous);
}

function buildAccountRecoveryPurgeCandidate(
  user: Doc<"users">,
  eligibility: {
    reason: AccountRecoveryPurgeEligibilityReason;
    selfDeleteAuditLog: Doc<"auditLogs"> | null;
    authAccountCount: number | null;
  },
): AccountRecoveryPurgeCandidate {
  const previous = getSelfDeletePreviousMetadata(eligibility.selfDeleteAuditLog);
  return {
    userId: user._id,
    eligibilityReason: eligibility.reason,
    handle: optionalString(user.handle) ?? optionalString(previous?.handle),
    displayName:
      optionalString(user.displayName) ??
      optionalString(user.name) ??
      optionalString(previous?.displayName) ??
      optionalString(previous?.name),
    emailPresent: Boolean(user.email) || previous?.emailPresent === true,
    personalPublisherId:
      user.personalPublisherId ?? optionalPublisherId(previous?.personalPublisherId),
    authAccountCount: eligibility.authAccountCount,
    deletedAt: user.deletedAt ?? null,
    deactivatedAt: user.deactivatedAt ?? null,
    purgedAt: user.purgedAt ?? null,
    selfDeleteAuditLogId: eligibility.selfDeleteAuditLog?._id ?? null,
    selfDeleteAuditCreatedAt: eligibility.selfDeleteAuditLog?.createdAt ?? null,
  };
}

async function getSelfDeletedAccountEligibility(
  ctx: MutationCtx,
  user: Doc<"users">,
): Promise<AccountRecoveryPurgeEligibility> {
  const hasModernTombstone = Boolean(user.deactivatedAt && user.purgedAt && !user.deletedAt);
  const hasLegacySelfDeleteMarker = Boolean(user.deletedAt && !user.banReason);
  if ((!hasModernTombstone && !hasLegacySelfDeleteMarker) || user.banReason) {
    return { eligible: false, selfDeleteAuditLog: null };
  }
  const logs = await ctx.db
    .query("auditLogs")
    .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", user._id.toString()))
    .collect();
  const selfDeleteAuditLog =
    logs.find((log) => log.action === "user.delete" && log.actorUserId === user._id) ?? null;
  const hasBanAudit = logs.some((log) => BAN_AUDIT_ACTIONS.has(log.action));
  const hasRecoveryPurgeAudit = logs.some((log) => log.action === "user.recovery_purge");
  const selfDeleteAuditAlreadyCleaned = Boolean(
    asRecord(selfDeleteAuditLog?.metadata)?.cleanup || hasRecoveryPurgeAudit,
  );
  if (selfDeleteAuditLog && !hasBanAudit && !selfDeleteAuditAlreadyCleaned) {
    return {
      eligible: true,
      reason: "self_delete_audit" as const,
      selfDeleteAuditLog,
      authAccountCount: null,
    };
  }
  if (hasBanAudit) {
    return { eligible: false, selfDeleteAuditLog: null };
  }

  const authAccounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
    .collect();
  if (authAccounts.length === 0) return { eligible: false, selfDeleteAuditLog: null };

  if (hasLegacySelfDeleteMarker) {
    return {
      eligible: true,
      reason: "auth_locked_legacy_deleted_user" as const,
      selfDeleteAuditLog: null,
      authAccountCount: authAccounts.length,
    };
  }

  if (!hasModernTombstone) return { eligible: false, selfDeleteAuditLog: null };

  const profileIdentityScrubbed = !user.handle && !user.email && !user.name && !user.displayName;
  if (!profileIdentityScrubbed) return { eligible: false, selfDeleteAuditLog: null };

  return {
    eligible: true,
    reason: "auth_locked_purged_user" as const,
    selfDeleteAuditLog: null,
    authAccountCount: authAccounts.length,
  };
}

export const purgeSelfDeletedAccountRecoveryBatchInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    mode: accountRecoveryPurgeModeValidator,
  },
  handler: async (ctx, args) => {
    const limit = clampInt(
      args.limit ?? ACCOUNT_RECOVERY_PURGE_LIMIT_DEFAULT,
      1,
      ACCOUNT_RECOVERY_PURGE_LIMIT_MAX,
    );
    const dryRun = args.dryRun !== false;
    const mode = args.mode ?? "deactivated";
    const { page, isDone, continueCursor } =
      mode === "legacyDeleted"
        ? await ctx.db
            .query("users")
            .withIndex("by_ban_reason_deleted_at", (q) =>
              q.eq("banReason", undefined).gte("deletedAt", 0),
            )
            .paginate({ cursor: args.cursor ?? null, numItems: limit })
        : await ctx.db
            .query("users")
            .withIndex("by_deactivated_purged_at", (q) => q.gte("deactivatedAt", 0))
            .paginate({ cursor: args.cursor ?? null, numItems: limit });

    let eligible = 0;
    let purged = 0;
    const skipped: Array<{ userId: Id<"users">; reason: string }> = [];
    const candidates: AccountRecoveryPurgeCandidate[] = [];
    const cleaned: Array<
      DeletedAccountCleanupResult & { userId: Id<"users">; deactivatedAt: number }
    > = [];

    for (const user of page) {
      const eligibility = await getSelfDeletedAccountEligibility(ctx, user);
      if (!eligibility.eligible) {
        skipped.push({ userId: user._id, reason: "not_self_deleted_or_security_blocked" });
        continue;
      }
      eligible += 1;
      candidates.push(buildAccountRecoveryPurgeCandidate(user, eligibility));
      if (dryRun) continue;
      const deletedAt = user.deactivatedAt ?? user.deletedAt ?? Date.now();
      const cleanup = await hardDeleteSelfDeletedAccountState(ctx, user, deletedAt);
      await scrubDeletedUserTombstone(ctx, user, deletedAt);
      await ctx.db.insert("auditLogs", {
        actorUserId: user._id,
        action: "user.recovery_purge",
        targetType: "user",
        targetId: user._id,
        metadata: {
          deactivatedAt: user.deactivatedAt,
          purgedAt: user.purgedAt,
          deletedAt: user.deletedAt,
          cleanup,
          mode,
          source: "backfill",
        },
        createdAt: Date.now(),
      });
      cleaned.push({ userId: user._id, deactivatedAt: deletedAt, ...cleanup });
      purged += 1;
    }

    return {
      ok: true as const,
      dryRun,
      mode,
      scanned: page.length,
      eligible,
      purged,
      skipped,
      candidates,
      cleaned,
      isDone,
      cursor: isDone ? null : continueCursor,
    };
  },
});

export const list = query({
  args: { limit: v.optional(v.number()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const limit = clampInt(args.limit ?? 50, 1, MAX_USER_LIST_LIMIT);
    const exactHandleUser = args.search
      ? await getUserByHandleOrPersonalPublisher(ctx, args.search)
      : null;
    const result = await queryUsersForAdminList(ctx, {
      limit,
      search: args.search,
      exactUserId: exactHandleUser?._id,
    });
    const dedupedUsers = exactHandleUser
      ? [exactHandleUser, ...result.items.filter((entry) => entry._id !== exactHandleUser._id)]
      : result.items;
    const total = exactHandleUser
      ? result.total + (result.containsExactUser ? 0 : 1)
      : result.total;
    return {
      items: dedupedUsers.slice(0, limit),
      total,
    };
  },
});

export const listPublic = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 40, 1, 100);
    const result = await queryUsersForPublicList(ctx, {
      limit,
    });
    return {
      items: result.items
        .map((user) => toPublicUser(user))
        .filter((user): user is NonNullable<ReturnType<typeof toPublicUser>> => Boolean(user)),
      total: result.total,
    };
  },
});

function normalizeSearchQuery(search?: string) {
  const trimmed = search?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function computeUserSearchScanLimit(limit: number) {
  return clampInt(limit * 10, MIN_USER_SEARCH_SCAN, MAX_USER_SEARCH_SCAN);
}

async function queryUsersForAdminList(
  ctx: Pick<QueryCtx, "db">,
  args: { limit: number; search?: string; exactUserId?: Id<"users"> },
) {
  const normalizedSearch = normalizeSearchQuery(args.search);
  const orderedUsers = ctx.db.query("users").order("desc");

  if (!normalizedSearch) {
    const items = await orderedUsers.take(args.limit);
    return { items, total: items.length, containsExactUser: false };
  }

  const scannedUsers = await orderedUsers.take(computeUserSearchScanLimit(args.limit));
  const result = buildUserSearchResults(scannedUsers, normalizedSearch);
  return {
    items: result.items.slice(0, args.limit),
    total: result.total,
    containsExactUser: args.exactUserId
      ? result.items.some((user) => user._id === args.exactUserId)
      : false,
  };
}

async function queryUsersForPublicList(
  ctx: Pick<QueryCtx, "db">,
  args: { limit: number; search?: string },
) {
  const normalizedSearch = normalizeSearchQuery(args.search);
  const scanLimit = normalizedSearch
    ? computeUserSearchScanLimit(args.limit)
    : clampInt(args.limit * 6, args.limit, MAX_USER_SEARCH_SCAN);
  const scannedUsers = await ctx.db
    .query("users")
    .withIndex("by_active_handle", (q) =>
      q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
    )
    .order("desc")
    .take(scanLimit);
  const activeUsers = scannedUsers.filter((user) => Boolean(user.handle));
  const result = buildUserSearchResults(activeUsers, normalizedSearch);
  return {
    items: result.items.slice(0, args.limit),
    total: result.total,
  };
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return toPublicUser(await getActiveUserByHandleOrPersonalPublisher(ctx, args.handle));
  },
});

async function getPublisherInstallFallback(
  ctx: Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
  ownerUserId: Id<"users">,
) {
  // Publisher aggregates are the normal path; keep legacy hover recovery bounded.
  const [publisherSkills, publisherPackages, ownerSkills, ownerPackages] = await Promise.all([
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .take(HOVER_STATS_COMPATIBILITY_ROW_LIMIT),
    ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .take(HOVER_STATS_COMPATIBILITY_ROW_LIMIT),
    ctx.db
      .query("skills")
      .withIndex("by_owner_active_updated", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .take(HOVER_STATS_COMPATIBILITY_ROW_LIMIT),
    ctx.db
      .query("packages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .take(HOVER_STATS_COMPATIBILITY_ROW_LIMIT),
  ]);

  const legacyOwnerRowsForPublisher = <T extends { ownerPublisherId?: Id<"publishers"> }>(
    rows: T[],
  ) => rows.filter((row) => !row.ownerPublisherId || row.ownerPublisherId === publisherId);
  const skills = new Map(
    [...publisherSkills, ...legacyOwnerRowsForPublisher(ownerSkills)].map((skill) => [
      skill._id,
      skill,
    ]),
  );
  const packages = new Map(
    [...publisherPackages, ...legacyOwnerRowsForPublisher(ownerPackages)].map((pkg) => [
      pkg._id,
      pkg,
    ]),
  );

  return [
    ...Array.from(skills.values(), getSkillPublisherContribution),
    ...Array.from(packages.values(), getPackagePublisherContribution),
  ].reduce((total, contribution) => total + contribution.totalInstalls, 0);
}

/** Lightweight aggregate stats for user hover tooltips. */
export const getHoverStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const publisher = user ? await getPersonalPublisherForUserOrFallback(ctx, user) : null;
    const totalInstalls =
      user && publisher
        ? (publisher.totalInstalls ??
          (await getPublisherInstallFallback(ctx, publisher._id, user._id)))
        : 0;
    const totalDownloads = publisher?.totalDownloads ?? user?.totalDownloads ?? totalInstalls;

    return {
      publishedSkills: publisher?.publishedSkills ?? user?.publishedSkills ?? 0,
      totalStars: publisher?.totalStars ?? user?.totalStars ?? 0,
      // Older cached frontend bundles still read this field during rollout.
      totalDownloads,
      totalInstalls,
    };
  },
});

export const getReservedHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await getLatestActiveReservedHandle(ctx, args.handle);
  },
});

export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return setRoleWithActor(ctx, user, args.userId, args.role);
  },
});

export const reserveHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    rightfulOwnerUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId);
    if (!rightfulOwner || rightfulOwner.deletedAt || rightfulOwner.deactivatedAt) {
      throw new Error("Rightful owner not found");
    }

    const normalizedHandle = normalizeReservedHandle(args.handle);
    if (!normalizedHandle) throw new Error("Handle required");

    const existingUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", normalizedHandle))
      .unique();
    if (existingUser && existingUser._id !== args.rightfulOwnerUserId) {
      throw new Error("Handle already claimed by another user");
    }

    const now = Date.now();
    await upsertReservedHandleForRightfulOwner(ctx, {
      handle: normalizedHandle,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      reason: args.reason,
      now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "handle.reserve",
      targetType: "handle",
      targetId: normalizedHandle,
      metadata: {
        handle: normalizedHandle,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        reason: args.reason || undefined,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      handle: normalizedHandle,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
    };
  },
});

export const setRoleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return setRoleWithActor(ctx, actor, args.targetUserId, args.role);
  },
});

async function setRoleWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  role: "admin" | "moderator" | "user",
) {
  assertAdmin(actor);
  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  const now = Date.now();
  await ctx.db.patch(targetUserId, { role, updatedAt: now });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "role.change",
    targetType: "user",
    targetId: targetUserId,
    metadata: { role },
    createdAt: now,
  });
  return { ok: true as const, role };
}

export const banUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return banUserWithActor(ctx, user, args.userId, args.reason);
  },
});

export const banUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return banUserWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

export const unbanUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return unbanUserWithActor(ctx, user, args.userId, args.reason);
  },
});

export const unbanUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return unbanUserWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

export const unbanUserForBanAppealServiceInternal = internalMutation({
  args: {
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
    reviewerDiscordId: v.string(),
  },
  handler: async (ctx, args) => {
    return unbanUserForBanAppealService(ctx, args);
  },
});

export const reclassifyBanInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("User not found");
    if (target.deactivatedAt || target.purgedAt) {
      throw new Error("Cannot reclassify a deactivated account");
    }
    if (!target.deletedAt) {
      throw new Error("User is not currently banned");
    }

    const nextReason = args.reason.trim();
    if (!nextReason) throw new Error("Reason required");
    if (nextReason.length > 500) throw new Error("Reason too long (max 500 chars)");

    const previousReason = target.banReason ?? null;
    const changed = previousReason !== nextReason;
    const dryRun = args.dryRun !== false;

    if (!dryRun && changed) {
      const now = Date.now();
      await ctx.db.patch(args.targetUserId, {
        banReason: nextReason,
        updatedAt: now,
      });
      await ctx.db.insert("auditLogs", {
        actorUserId: actor._id,
        action: "user.ban.reclassify",
        targetType: "user",
        targetId: args.targetUserId,
        metadata: {
          previousReason,
          nextReason,
        },
        createdAt: now,
      });
    }

    return {
      ok: true as const,
      dryRun,
      userId: args.targetUserId,
      handle: target.handle ?? null,
      previousReason,
      nextReason,
      changed,
    };
  },
});

async function banUserWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertModerator(actor);

  if (targetUserId === actor._id) throw new Error("Cannot ban yourself");

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && actor.role !== "admin") {
    throw new Error("Forbidden");
  }

  return applyUserBan(ctx, {
    target,
    targetUserId,
    actorUserId: actor._id,
    deletedByRole: actor.role === "admin" ? "admin" : "moderator",
    auditAction: "user.ban",
    emailSource: "manual",
    reasonRaw,
    hiddenBy: actor._id,
  });
}

async function applyUserBan(ctx: MutationCtx, args: ApplyUserBanArgs) {
  const now = Date.now();
  const reason = args.reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }
  if (args.target.deactivatedAt) {
    return {
      ok: true as const,
      alreadyBanned: true,
      deletedSkills: 0,
      deletedSkillComments: 0,
    };
  }
  if (args.target.deletedAt) {
    await ctx.runMutation(internal.packages.applyBanToOwnedPackagesBatchInternal, {
      ownerUserId: args.targetUserId,
      bannedAt: args.target.deletedAt,
      deletedBy: args.actorUserId,
      deletedByRole: args.deletedByRole,
      cursor: undefined,
    });
    return {
      ok: true as const,
      alreadyBanned: true,
      deletedSkills: 0,
      deletedSkillComments: 0,
    };
  }

  const banSkillsResult = (await ctx.runMutation(
    internal.skills.applyBanToOwnedSkillsBatchInternal,
    {
      ownerUserId: args.targetUserId,
      bannedAt: now,
      ...(args.hiddenBy ? { hiddenBy: args.hiddenBy } : {}),
      cursor: undefined,
    },
  )) as { hiddenCount?: number; scheduled?: boolean };
  const hiddenCount = banSkillsResult.hiddenCount ?? 0;
  const scheduledSkills = banSkillsResult.scheduled ?? false;

  const tokens = await ctx.db
    .query("apiTokens")
    .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
    .collect();
  for (const token of tokens) {
    if (!token.revokedAt) {
      await ctx.db.patch(token._id, { revokedAt: now });
    }
  }

  await ctx.db.patch(args.targetUserId, {
    deletedAt: now,
    role: "user",
    updatedAt: now,
    banReason: reason || undefined,
  });

  const banPackagesResult = ((await ctx.runMutation(
    internal.packages.applyBanToOwnedPackagesBatchInternal,
    {
      ownerUserId: args.targetUserId,
      bannedAt: now,
      deletedBy: args.actorUserId,
      deletedByRole: args.deletedByRole,
      cursor: undefined,
    },
  )) ?? {}) as { deletedCount?: number; revokedTokenCount?: number; scheduled?: boolean };
  const deletedPackageCount = banPackagesResult.deletedCount ?? 0;
  const revokedPackagePublishTokens = banPackagesResult.revokedTokenCount ?? 0;
  const scheduledPackages = banPackagesResult.scheduled ?? false;

  await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, {
    userId: args.targetUserId,
  });

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: args.auditAction,
    targetType: "user",
    targetId: args.targetUserId,
    metadata: {
      ...args.auditMetadata,
      hiddenSkills: hiddenCount,
      deletedPackages: deletedPackageCount,
      revokedPackagePublishTokens,
      scheduledPackages,
      deletedSkillComments: 0,
      reason: reason || undefined,
    },
    createdAt: now,
  });

  await scheduleBanNotificationEmail(ctx, {
    target: args.target,
    bannedAt: now,
    source: args.emailSource,
    reason,
    trigger: args.emailTrigger,
    hiddenArtifacts:
      scheduledSkills || scheduledPackages ? undefined : hiddenCount + deletedPackageCount,
  });

  return {
    ok: true as const,
    alreadyBanned: false,
    deletedSkills: hiddenCount,
    deletedSkillComments: 0,
    scheduledSkills,
  };
}

async function unbanUserForBanAppealService(
  ctx: MutationCtx,
  args: { targetUserId: Id<"users">; reason?: string; reviewerDiscordId: string },
) {
  const target = await ctx.db.get(args.targetUserId);
  if (!target) throw new Error("User not found");
  if (target.deactivatedAt) {
    throw new Error("Cannot unban a permanently deleted account");
  }
  if (!target.deletedAt) {
    return { ok: true as const, alreadyUnbanned: true };
  }

  const reason = args.reason?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }

  const now = Date.now();
  const bannedAt = target.deletedAt;
  const banLog = await getCurrentBanAuditLog(ctx, args.targetUserId, bannedAt);
  if (!banLog) {
    throw new Error("Cannot unban account without a matching ban record");
  }

  await ctx.db.patch(args.targetUserId, {
    deletedAt: undefined,
    banReason: undefined,
    role: "user",
    updatedAt: now,
  });

  const restoreSkillsResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForUnbanBatchInternal,
    {
      ownerUserId: args.targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean };
  const restoredSkillCount = restoreSkillsResult.restoredCount ?? 0;
  const scheduledSkills = restoreSkillsResult.scheduled ?? false;

  const restorePackagesResult = ((await ctx.runMutation(
    internal.packages.restoreOwnedPackagesForUnbanBatchInternal,
    {
      ownerUserId: args.targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) ?? {}) as { restoredCount?: number; scheduled?: boolean };
  const restoredPackageCount = restorePackagesResult.restoredCount ?? 0;
  const scheduledPackages = restorePackagesResult.scheduled ?? false;

  await ctx.db.insert("auditLogs", {
    action: "user.unban",
    targetType: "user",
    targetId: args.targetUserId,
    metadata: {
      reason: reason || undefined,
      restoredSkills: restoredSkillCount,
      restoredPackages: restoredPackageCount,
      scheduledPackages,
      source: "ban_appeal.service",
      reviewerDiscordId: args.reviewerDiscordId,
    },
    createdAt: now,
  });

  await scheduleRestoredAccountNotificationEmail(ctx, {
    target,
    restoredAt: now,
    skillsRestored: scheduledSkills ? undefined : restoredSkillCount,
    packagesRestored: scheduledPackages ? undefined : restoredPackageCount,
  });

  return {
    ok: true as const,
    alreadyUnbanned: false,
    restoredSkills: restoredSkillCount,
    scheduledSkills,
    restoredPackages: restoredPackageCount,
    scheduledPackages,
  };
}

async function unbanUserWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertAdmin(actor);
  if (targetUserId === actor._id) throw new Error("Cannot unban yourself");

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.deactivatedAt) {
    throw new Error("Cannot unban a permanently deleted account");
  }
  if (!target.deletedAt) {
    return { ok: true as const, alreadyUnbanned: true };
  }

  const reason = reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }

  const now = Date.now();
  const bannedAt = target.deletedAt;
  await ctx.db.patch(targetUserId, {
    deletedAt: undefined,
    banReason: undefined,
    role: "user",
    updatedAt: now,
  });

  const restoreSkillsResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForUnbanBatchInternal,
    {
      ownerUserId: targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean };
  const restoredCount = restoreSkillsResult.restoredCount ?? 0;
  const scheduledSkills = restoreSkillsResult.scheduled ?? false;

  const restorePackagesResult = ((await ctx.runMutation(
    internal.packages.restoreOwnedPackagesForUnbanBatchInternal,
    {
      actorUserId: actor._id,
      ownerUserId: targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) ?? {}) as { restoredCount?: number; scheduled?: boolean };
  const restoredPackageCount = restorePackagesResult.restoredCount ?? 0;
  const scheduledPackages = restorePackagesResult.scheduled ?? false;

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "user.unban",
    targetType: "user",
    targetId: targetUserId,
    metadata: {
      reason: reason || undefined,
      restoredSkills: restoredCount,
      restoredPackages: restoredPackageCount,
      scheduledPackages,
    },
    createdAt: now,
  });

  await scheduleRestoredAccountNotificationEmail(ctx, {
    target,
    restoredAt: now,
    skillsRestored: scheduledSkills ? undefined : restoredCount,
    packagesRestored: scheduledPackages ? undefined : restoredPackageCount,
  });

  return {
    ok: true as const,
    alreadyUnbanned: false,
    restoredSkills: restoredCount,
    scheduledSkills,
  };
}

// ---------------------------------------------------------------------------
// Moderation hold management
// ---------------------------------------------------------------------------

/**
 * Admin-only: lift the moderation hold placed on a user after a false-positive
 * malicious upload detection.
 *
 * When the static scanner flags a skill as malicious, the publisher is placed
 * under a moderation hold (`requiresModerationAt` set). This hides all their
 * skills and causes all future publishes to start hidden. The hold has no
 * self-service release path -- only an admin can lift it.
 *
 * This mutation:
 * 1. Clears `requiresModerationAt` and `requiresModerationReason` on the user
 * 2. Restores skills that were hidden due to the moderation hold
 * 3. Creates an audit log entry
 */
export const liftModerationHold = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return liftModerationHoldWithActor(ctx, user, args.userId, args.reason);
  },
});

export const liftModerationHoldInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return liftModerationHoldWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

async function liftModerationHoldWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertAdmin(actor);

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.deletedAt || target.deactivatedAt) {
    throw new Error("Cannot lift hold on a deleted or deactivated account");
  }
  if (!target.requiresModerationAt) {
    return { ok: true as const, alreadyCleared: true, restoredSkills: 0, scheduledSkills: false };
  }

  const reason = reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }

  const holdPlacedAt = target.requiresModerationAt;
  const now = Date.now();

  // Clear the moderation hold on the user
  await ctx.db.patch(targetUserId, {
    requiresModerationAt: undefined,
    requiresModerationReason: undefined,
    updatedAt: now,
  });

  // Restore skills that were hidden due to the moderation hold.
  // The batch handler checks if the user has been re-held between pages
  // and aborts if so (race condition safety).
  const restoreResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForModerationLiftBatchInternal,
    {
      ownerUserId: targetUserId,
      holdPlacedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean };
  const restoredCount = restoreResult.restoredCount ?? 0;
  const scheduledSkills = restoreResult.scheduled ?? false;

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "user.moderation.lift",
    targetType: "user",
    targetId: targetUserId,
    metadata: {
      reason: reason || undefined,
      holdPlacedAt,
      restoredSkills: restoredCount,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    alreadyCleared: false,
    restoredSkills: restoredCount,
    scheduledSkills,
  };
}

/**
 * Admin-only: set or unset the trustedPublisher flag for a user.
 * Trusted publishers bypass the pending.scan auto-hide for new skill publishes.
 */
export const setTrustedPublisher = mutation({
  args: {
    userId: v.id("users"),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");

    const now = Date.now();
    await ctx.db.patch(args.userId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.trusted ? "user.trusted.set" : "user.trusted.unset",
      targetType: "user",
      targetId: args.userId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    });

    return { ok: true as const, trusted: args.trusted };
  },
});

export const setTrustedPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("User not found");

    const now = Date.now();
    await ctx.db.patch(args.targetUserId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: args.trusted ? "user.trusted.set" : "user.trusted.unset",
      targetType: "user",
      targetId: args.targetUserId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    });

    return { ok: true as const, trusted: args.trusted };
  },
});

async function ensurePublisherHandleWithActor(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    displayName?: string;
    trusted?: boolean;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
  assertAdmin(actor);

  const normalizedHandle = normalizeReservedHandle(args.handle);
  if (!normalizedHandle) throw new Error("Handle required");
  if (isReservedPublicOwnerHandle(normalizedHandle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(normalizedHandle));
  }

  const existing = await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", normalizedHandle))
    .unique();
  if (existing?.deletedAt || existing?.deactivatedAt) {
    throw new Error("Handle belongs to a deleted or deactivated user");
  }
  if (!existing && isReservedOpenClawExtensionHandle(normalizedHandle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(normalizedHandle));
  }

  const now = Date.now();
  const displayName = args.displayName?.trim() || normalizedHandle;
  const trusted = args.trusted === false ? undefined : true;
  const userId =
    existing?._id ??
    (await ctx.db.insert("users", {
      handle: normalizedHandle,
      displayName,
      role: "user",
      trustedPublisher: trusted,
      createdAt: now,
      updatedAt: now,
    }));

  if (existing) {
    const nextDisplayName =
      args.displayName?.trim() &&
      (!existing.displayName || existing.displayName === existing.handle)
        ? displayName
        : existing.displayName;
    await ctx.db.patch(existing._id, {
      displayName: nextDisplayName,
      trustedPublisher: trusted,
      updatedAt: now,
    });
  }

  await upsertReservedHandleForRightfulOwner(ctx, {
    handle: normalizedHandle,
    rightfulOwnerUserId: userId,
    reason: "shared publisher",
    now,
  });

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "user.publisher.ensure",
    targetType: "user",
    targetId: userId,
    metadata: {
      handle: normalizedHandle,
      trusted: trusted === true,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    userId,
    handle: normalizedHandle,
    created: !existing,
    trusted: trusted === true,
  };
}

export const ensurePublisherHandle = mutation({
  args: {
    handle: v.string(),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return await ensurePublisherHandleWithActor(ctx, {
      actorUserId: user._id,
      handle: args.handle,
      displayName: args.displayName,
      trusted: args.trusted,
    });
  },
});

export const ensurePublisherHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await ensurePublisherHandleWithActor(ctx, args),
});

function normalizeMaliciousArtifactName(name: string) {
  return name.trim().toLowerCase();
}

function readMaliciousArtifactFindingFromAudit(
  log: Doc<"auditLogs">,
): MaliciousArtifactFinding | null {
  if (log.action !== MALICIOUS_ARTIFACT_FINDING_ACTION) return null;
  const metadata = log.metadata as
    | {
        artifactKind?: unknown;
        artifactName?: unknown;
      }
    | undefined;
  const artifactKind = metadata?.artifactKind;
  const artifactName = typeof metadata?.artifactName === "string" ? metadata.artifactName : "";
  if ((artifactKind !== "skill" && artifactKind !== "plugin") || !artifactName.trim()) {
    return null;
  }
  return { artifactKind, artifactName };
}

function getMaliciousArtifactEscalationReason(findings: MaliciousArtifactFinding[]) {
  const distinctArtifacts = new Set<string>();
  const attemptsByArtifact = new Map<string, number>();

  for (const finding of findings) {
    const artifactKey = `${finding.artifactKind}:${normalizeMaliciousArtifactName(
      finding.artifactName,
    )}`;
    distinctArtifacts.add(artifactKey);
    attemptsByArtifact.set(artifactKey, (attemptsByArtifact.get(artifactKey) ?? 0) + 1);
  }

  if (distinctArtifacts.size >= MALICIOUS_ARTIFACT_DISTINCT_BAN_THRESHOLD) {
    return "distinct_artifact_threshold" as const;
  }
  for (const attempts of attemptsByArtifact.values()) {
    if (attempts >= MALICIOUS_ARTIFACT_ATTEMPT_BAN_THRESHOLD) {
      return "attempt_threshold" as const;
    }
  }
  return null;
}

export const recordMaliciousArtifactFindingInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    artifactKind: v.union(v.literal("skill"), v.literal("plugin")),
    artifactName: v.string(),
    version: v.optional(v.string()),
    trigger: v.optional(v.string()),
    sha256hash: v.optional(v.string()),
    findingSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false as const, reason: "user_not_found" as const };
    if (target.deletedAt || target.deactivatedAt) return { ok: true as const, alreadyBanned: true };

    const artifactName = args.artifactName.trim();
    if (!artifactName) {
      return { ok: false as const, reason: "missing_artifact" as const };
    }
    const now = Date.now();
    const trigger = args.trigger?.trim() || "scanner.malicious";
    const version = args.version?.trim() || undefined;
    const sha256hash = args.sha256hash?.trim() || undefined;
    const findingSummary = args.findingSummary?.trim() || undefined;
    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: MALICIOUS_ARTIFACT_FINDING_ACTION,
      targetType: "user",
      targetId: args.ownerUserId,
      metadata: {
        artifactKind: args.artifactKind,
        artifactName,
        version,
        trigger,
        sha256hash,
        findingSummary,
      },
      createdAt: now,
    });

    if (target.role === "admin" || target.role === "moderator") {
      await scheduleMaliciousArtifactNotificationEmail(ctx, {
        target,
        findingAt: now,
        artifact: { kind: args.artifactKind, name: artifactName },
        version,
        trigger,
        findingSummary,
      });
      return { ok: true as const, escalated: false as const, reason: "protected_role" as const };
    }

    const auditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", args.ownerUserId))
      .order("desc")
      .take(MALICIOUS_ARTIFACT_AUDIT_LOOKBACK);
    const priorFindings = auditLogs
      .map(readMaliciousArtifactFindingFromAudit)
      .filter((finding): finding is MaliciousArtifactFinding => Boolean(finding));
    const escalationReason = getMaliciousArtifactEscalationReason(priorFindings);
    if (!escalationReason) {
      await scheduleMaliciousArtifactNotificationEmail(ctx, {
        target,
        findingAt: now,
        artifact: { kind: args.artifactKind, name: artifactName },
        version,
        trigger,
        findingSummary,
      });
      return { ok: true as const, escalated: false as const };
    }

    await ctx.runMutation(internal.users.autobanMalwareAuthorInternal, {
      ownerUserId: args.ownerUserId,
      slug: artifactName,
      trigger,
      ...(sha256hash ? { sha256hash } : {}),
      artifactKind: args.artifactKind,
      artifactName,
    });

    return { ok: true as const, escalated: true as const, reason: escalationReason };
  },
});

/**
 * Auto-ban a user whose skill was flagged malicious by a scanner.
 * Skips moderators/admins. No actor required — this is a system-level action.
 */
export const autobanMalwareAuthorInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    sha256hash: v.optional(v.string()),
    slug: v.string(),
    trigger: v.optional(v.string()),
    artifactKind: v.optional(v.union(v.literal("skill"), v.literal("plugin"))),
    artifactName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false, reason: "user_not_found" };
    if (target.deletedAt || target.deactivatedAt) return { ok: true, alreadyBanned: true };

    // Never auto-ban moderators or admins
    if (target.role === "admin" || target.role === "moderator") {
      console.log(`[autoban] Skipping ${target.handle ?? args.ownerUserId}: role=${target.role}`);
      return { ok: false, reason: "protected_role" };
    }

    const now = Date.now();

    const banSkillsResult = (await ctx.runMutation(
      internal.skills.applyBanToOwnedSkillsBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        bannedAt: now,
        cursor: undefined,
      },
    )) as { hiddenCount?: number; scheduled?: boolean };
    const hiddenCount = banSkillsResult.hiddenCount ?? 0;
    const scheduledSkills = banSkillsResult.scheduled ?? false;

    // Revoke all API tokens
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.ownerUserId))
      .collect();
    for (const token of tokens) {
      if (!token.revokedAt) {
        await ctx.db.patch(token._id, { revokedAt: now });
      }
    }

    // Ban the user
    await ctx.db.patch(args.ownerUserId, {
      deletedAt: now,
      role: "user",
      updatedAt: now,
      banReason: "malware auto-ban",
    });

    const banPackagesResult = ((await ctx.runMutation(
      internal.packages.applyBanToOwnedPackagesBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        bannedAt: now,
        deletedBy: args.ownerUserId,
        deletedByRole: "user",
        cursor: undefined,
      },
    )) ?? {}) as { deletedCount?: number; revokedTokenCount?: number; scheduled?: boolean };
    const deletedPackageCount = banPackagesResult.deletedCount ?? 0;
    const revokedPackagePublishTokens = banPackagesResult.revokedTokenCount ?? 0;
    const scheduledPackages = banPackagesResult.scheduled ?? false;

    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, {
      userId: args.ownerUserId,
    });

    const metadata: Record<string, unknown> = {
      trigger: args.trigger?.trim() || "scanner.malicious",
      slug: args.slug,
      hiddenSkills: hiddenCount,
      deletedPackages: deletedPackageCount,
      revokedPackagePublishTokens,
      scheduledPackages,
      deletedSkillComments: 0,
    };
    if (args.sha256hash?.trim()) {
      metadata.sha256hash = args.sha256hash.trim();
    }

    // Audit log -- use the target as actor since there's no human actor
    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: "user.autoban.malware",
      targetType: "user",
      targetId: args.ownerUserId,
      metadata,
      createdAt: now,
    });

    const trigger = args.trigger?.trim() || "scanner.malicious";
    const artifactKind = args.artifactKind ?? "skill";
    const artifactName = args.artifactName?.trim() || args.slug;
    await scheduleBanNotificationEmail(ctx, {
      target,
      bannedAt: now,
      source: "autoban",
      reason: trigger,
      trigger,
      artifact: { kind: artifactKind, name: artifactName },
      hiddenArtifacts:
        scheduledSkills || scheduledPackages ? undefined : hiddenCount + deletedPackageCount,
    });

    console.warn(
      `[autoban] Banned ${target.handle ?? args.ownerUserId} — malicious skill: ${args.slug}`,
    );

    return {
      ok: true,
      alreadyBanned: false,
      deletedSkills: hiddenCount,
      deletedSkillComments: 0,
      scheduledSkills,
    };
  },
});

/**
 * Auto-ban a user whose publisher abuse nomination reached the potential-ban bucket.
 * Skips moderators/admins. No actor required — this is a system-level action.
 */
export const autobanPublisherAbuseOwnerInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    nominationId: v.id("publisherAbuseReviewNominations"),
    scoreId: v.id("publisherAbuseScores"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false as const, reason: "user_not_found" as const };
    const reason = args.reason.trim();
    if (!reason) return { ok: false as const, reason: "missing_reason" as const };
    if (reason.length > 500) return { ok: false as const, reason: "reason_too_long" as const };

    const nominationCheck = await getActionablePublisherAbuseAutobanNomination(ctx, args);
    if (!nominationCheck.ok) {
      return { ok: false as const, reason: nominationCheck.reason };
    }
    const nomination = nominationCheck.nomination;

    const now = Date.now();
    if (target.deactivatedAt) {
      await markPublisherAbuseAutobanNominationBanned(ctx, { nomination, reason, now });
      return { ok: true as const, alreadyBanned: true };
    }
    if (target.deletedAt) {
      await ctx.runMutation(internal.packages.applyBanToOwnedPackagesBatchInternal, {
        ownerUserId: args.ownerUserId,
        bannedAt: target.deletedAt,
        deletedBy: args.ownerUserId,
        deletedByRole: "user",
        cursor: undefined,
      });
      await markPublisherAbuseAutobanNominationBanned(ctx, { nomination, reason, now });
      return { ok: true as const, alreadyBanned: true };
    }

    if (target.role === "admin" || target.role === "moderator") {
      console.log(
        `[autoban] Skipping publisher abuse candidate ${target.handle ?? args.ownerUserId}: role=${target.role}`,
      );
      return { ok: false as const, reason: "protected_role" as const };
    }

    const result = await applyUserBan(ctx, {
      target,
      targetUserId: args.ownerUserId,
      actorUserId: args.ownerUserId,
      deletedByRole: "user",
      auditAction: "user.autoban.publisher_abuse",
      emailSource: "autoban",
      reasonRaw: reason,
      emailTrigger: "publisher_abuse",
      auditMetadata: {
        nominationId: args.nominationId,
        scoreId: args.scoreId,
      },
    });

    console.warn(
      `[autoban] Banned ${target.handle ?? args.ownerUserId} — publisher abuse nomination ${args.nominationId}`,
    );

    await markPublisherAbuseAutobanNominationBanned(ctx, { nomination, reason, now });

    return result;
  },
});

export const placeUserUnderModerationInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    slug: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false, reason: "user_not_found" as const };
    if (target.deletedAt || target.deactivatedAt) {
      return { ok: true, alreadyModerated: true as const, hiddenSkills: 0 };
    }
    if (target.role === "admin" || target.role === "moderator") {
      console.log(
        `[moderation] Skipping ${target.handle ?? args.ownerUserId}: role=${target.role}`,
      );
      return { ok: false, reason: "protected_role" as const };
    }

    const now = Date.now();
    const alreadyModerated = Boolean(target.requiresModerationAt);
    const moderationReason = `Auto-held for moderation after malicious upload (${args.reason})`;

    if (!alreadyModerated) {
      await ctx.db.patch(args.ownerUserId, {
        requiresModerationAt: now,
        requiresModerationReason: moderationReason,
        updatedAt: now,
      });
    }

    const hideSkillsResult = (await ctx.runMutation(
      internal.skills.applyUserModerationToOwnedSkillsBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        hiddenAt: now,
        cursor: undefined,
      },
    )) as { hiddenCount?: number; scheduled?: boolean };

    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: "user.moderation.auto",
      targetType: "user",
      targetId: args.ownerUserId,
      metadata: {
        trigger: "moderation.hold",
        slug: args.slug,
        reason: args.reason,
        hiddenSkills: hideSkillsResult.hiddenCount ?? 0,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      alreadyModerated,
      hiddenSkills: hideSkillsResult.hiddenCount ?? 0,
      scheduledSkills: hideSkillsResult.scheduled ?? false,
    };
  },
});

export const recordStaffEmailAttemptAuditInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    toEmail: v.string(),
    recipientUserId: v.optional(v.id("users")),
    recipientHandle: v.optional(v.string()),
    subject: v.string(),
    template: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) {
      throw new Error("Unauthorized");
    }
    assertAdmin(actor);
    const auditLogId = await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "staff.email.send",
      targetType: args.recipientUserId ? "user" : "email",
      targetId: args.recipientUserId ?? args.toEmail,
      metadata: {
        toEmail: args.toEmail,
        recipientHandle: args.recipientHandle ?? null,
        subject: args.subject,
        template: args.template ?? "raw",
        providerId: null,
        status: "attempted",
        source: "clawhub-admin.email",
      },
      createdAt: Date.now(),
    });
    return { ok: true as const, auditLogId };
  },
});

export const recordStaffEmailSentAuditInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    auditLogId: v.id("auditLogs"),
    providerId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) {
      throw new Error("Unauthorized");
    }
    assertAdmin(actor);
    const auditLog = await ctx.db.get(args.auditLogId);
    if (!auditLog || auditLog.action !== "staff.email.send") {
      throw new Error("Staff email audit log not found");
    }
    const metadata =
      auditLog.metadata &&
      typeof auditLog.metadata === "object" &&
      !Array.isArray(auditLog.metadata)
        ? auditLog.metadata
        : {};
    await ctx.db.patch(args.auditLogId, {
      metadata: {
        ...metadata,
        providerId: args.providerId ?? null,
        status: "sent",
      },
    });
    return { ok: true as const };
  },
});
