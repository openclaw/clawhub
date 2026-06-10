import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const APPLY_CONFIRMATION = "APPLY_GITHUB_IDENTITY_REMEDIATION";

type AuthAccountSummary = {
  _id: Id<"authAccounts">;
  provider: string;
  providerAccountId: string;
  userId: Id<"users">;
  _creationTime: number;
};

function summarizeAuthAccount(account: Doc<"authAccounts">): AuthAccountSummary {
  return {
    _id: account._id,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    userId: account.userId,
    _creationTime: account._creationTime,
  };
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export const remediateGitHubAccountLinks = internalMutation({
  args: {
    dryRun: v.boolean(),
    confirmation: v.optional(v.string()),
    targetUserId: v.id("users"),
    canonicalProviderAccountId: v.string(),
    removeProviderAccountIds: v.array(v.string()),
    expectedCurrentProviderAccountIds: v.optional(v.array(v.string())),
    expireSessions: v.boolean(),
    revokeActiveApiTokens: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const provider = "github";

    const removeProviderAccountIds = [...new Set(args.removeProviderAccountIds)];
    if (removeProviderAccountIds.length !== args.removeProviderAccountIds.length) {
      throw new ConvexError("Duplicate remove provider account ids are not allowed");
    }
    if (removeProviderAccountIds.includes(args.canonicalProviderAccountId)) {
      throw new ConvexError("Cannot remove the canonical provider account id");
    }
    if (!args.dryRun && args.confirmation !== APPLY_CONFIRMATION) {
      throw new ConvexError("Apply mode requires confirmation");
    }

    const user = await ctx.db.get(args.targetUserId);
    if (!user) throw new ConvexError("Target user not found");

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.targetUserId).eq("provider", provider),
      )
      .collect();
    const currentProviderAccountIds = accounts
      .map((account) => account.providerAccountId)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    if (
      args.expectedCurrentProviderAccountIds &&
      !sameStringSet(currentProviderAccountIds, args.expectedCurrentProviderAccountIds)
    ) {
      throw new ConvexError("Current provider account ids do not match expected ids");
    }

    const canonicalAccounts = accounts.filter(
      (account) => account.providerAccountId === args.canonicalProviderAccountId,
    );
    if (canonicalAccounts.length !== 1) {
      throw new ConvexError("Expected exactly one canonical provider account");
    }

    const removeAccounts = accounts.filter((account) =>
      removeProviderAccountIds.includes(account.providerAccountId),
    );
    const foundRemoveIds = new Set(removeAccounts.map((account) => account.providerAccountId));
    const missingRemoveProviderAccountIds = removeProviderAccountIds.filter(
      (providerAccountId) => !foundRemoveIds.has(providerAccountId),
    );
    if (missingRemoveProviderAccountIds.length > 0) {
      throw new ConvexError("One or more remove provider account ids were not found");
    }

    let authVerificationCodesDeleted = 0;
    for (const account of removeAccounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      authVerificationCodesDeleted += codes.length;
      if (!args.dryRun) {
        for (const code of codes) await ctx.db.delete(code._id);
      }
    }

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.targetUserId))
      .collect();
    let authRefreshTokensDeleted = 0;
    for (const session of sessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      authRefreshTokensDeleted += refreshTokens.length;
      if (!args.dryRun && args.expireSessions) {
        for (const refreshToken of refreshTokens) await ctx.db.delete(refreshToken._id);
        await ctx.db.delete(session._id);
      }
    }

    const apiTokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();
    const activeApiTokens = apiTokens.filter((token) => token.revokedAt === undefined);

    if (!args.dryRun) {
      for (const account of removeAccounts) {
        await ctx.db.delete(account._id);
      }
      if (args.revokeActiveApiTokens) {
        for (const token of activeApiTokens) {
          await ctx.db.patch(token._id, { revokedAt: now });
        }
      }
      await ctx.db.insert("auditLogs", {
        actorUserId: undefined,
        action: "user.auth_identity.remediate",
        targetType: "user",
        targetId: args.targetUserId,
        metadata: {
          provider,
          reason: args.reason ?? null,
          canonicalProviderAccountId: args.canonicalProviderAccountId,
          removedProviderAccountIds: removeProviderAccountIds,
          expiredSessions: args.expireSessions,
          revokedActiveApiTokens: args.revokeActiveApiTokens,
        },
        createdAt: now,
      });
    }

    return {
      dryRun: args.dryRun,
      applied: !args.dryRun,
      targetUserId: args.targetUserId,
      handle: user.handle ?? null,
      provider,
      currentProviderAccountIds,
      canonicalAccount: summarizeAuthAccount(canonicalAccounts[0]),
      removeAccounts: removeAccounts.map(summarizeAuthAccount),
      authAccountsDeleted: args.dryRun ? 0 : removeAccounts.length,
      authVerificationCodesDeleted: args.dryRun ? 0 : authVerificationCodesDeleted,
      sessionsDeleted: !args.dryRun && args.expireSessions ? sessions.length : 0,
      authRefreshTokensDeleted: !args.dryRun && args.expireSessions ? authRefreshTokensDeleted : 0,
      activeApiTokensRevoked:
        !args.dryRun && args.revokeActiveApiTokens ? activeApiTokens.length : 0,
      planned: {
        authAccountsToDelete: removeAccounts.length,
        authVerificationCodesToDelete: authVerificationCodesDeleted,
        sessionsToDelete: args.expireSessions ? sessions.length : 0,
        authRefreshTokensToDelete: args.expireSessions ? authRefreshTokensDeleted : 0,
        activeApiTokensToRevoke: args.revokeActiveApiTokens ? activeApiTokens.length : 0,
      },
    };
  },
});
