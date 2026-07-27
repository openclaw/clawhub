import GitHub from "@auth/core/providers/github";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import type { GenericMutationCtx } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import {
  GITHUB_ORG_MEMBERSHIP_SYNC_PROFILE_KEY,
  fetchActiveGitHubOrgMemberships,
  readGitHubOrgMembershipSync,
  replaceGitHubOrgMemberships,
} from "./lib/githubOrgMemberships";
import { shouldScheduleGitHubProfileSync } from "./lib/githubProfileSync";

export const BANNED_REAUTH_MESSAGE =
  "This account has been banned and cannot sign in. If you believe this is a mistake, appeal this decision: https://appeals.openclaw.ai/.";
export const DELETED_ACCOUNT_REAUTH_MESSAGE =
  "This account has been permanently deleted and cannot be restored.";

const REAUTH_BLOCKING_BAN_ACTIONS = new Set([
  "user.ban",
  "user.autoban.malware",
  "user.autoban.publisher_abuse",
]);
const DEV_PERSONAS = new Set(["owner", "user", "admin", "officialOrgMember", "abusePublisher"]);

export function normalizeGitHubProfileId(profileId: unknown) {
  const id =
    typeof profileId === "number" && Number.isSafeInteger(profileId)
      ? String(profileId)
      : typeof profileId === "string"
        ? profileId.trim()
        : null;

  if (!id || !/^\d+$/.test(id)) {
    throw new Error("GitHub OAuth profile is missing a valid numeric id");
  }

  return id;
}

export function createGitHubAuthProvider() {
  return GitHub({
    clientId: process.env.AUTH_GITHUB_ID ?? "",
    clientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
    authorization: {
      params: { scope: "read:user user:email read:org" },
    },
    // GitHub's OAuth email must not be treated as a ClawHub account key. The
    // immutable GitHub provider account id is the only account-linking key.
    allowDangerousEmailAccountLinking: false,
    async profile(profile, tokens) {
      let githubOrgMembershipSync;
      const accessToken = tokens.access_token?.trim();
      if (accessToken) {
        try {
          githubOrgMembershipSync = await fetchActiveGitHubOrgMemberships(accessToken);
        } catch (error) {
          console.warn(
            `[auth] GitHub organization membership sync failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return {
        id: normalizeGitHubProfileId(profile.id),
        name: profile.login,
        email: profile.email ?? undefined,
        image: profile.avatar_url,
        ...(githubOrgMembershipSync
          ? { [GITHUB_ORG_MEMBERSHIP_SYNC_PROFILE_KEY]: githubOrgMembershipSync }
          : {}),
      };
    },
  });
}

function getBannedReauthMessage(_reason: string | undefined) {
  return BANNED_REAUTH_MESSAGE;
}

export async function handleDeletedUserSignIn(
  ctx: GenericMutationCtx<DataModel>,
  args: { userId: Id<"users">; existingUserId: Id<"users"> | null },
  userOverride?: {
    deletedAt?: number;
    deactivatedAt?: number;
    purgedAt?: number;
    banReason?: string;
  } | null,
) {
  const user = userOverride !== undefined ? userOverride : await ctx.db.get(args.userId);
  if (!user?.deletedAt && !user?.deactivatedAt) return;

  // Verify that the incoming identity matches the existing account to prevent bypass.
  if (args.existingUserId && args.existingUserId !== args.userId) {
    return;
  }

  if (user.deactivatedAt) {
    throw new ConvexError(DELETED_ACCOUNT_REAUTH_MESSAGE);
  }

  const userId = args.userId;
  const deletedAt = user.deletedAt ?? Date.now();
  const banRecords = await ctx.db
    .query("auditLogs")
    .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", userId.toString()))
    .collect();

  const hasBlockingBan = banRecords.some((record) =>
    REAUTH_BLOCKING_BAN_ACTIONS.has(record.action),
  );

  if (hasBlockingBan) {
    throw new ConvexError(getBannedReauthMessage(user.banReason));
  }

  // Migrate legacy self-deleted accounts (stored in deletedAt) to the new
  // irreversible state and reject sign-in.
  await ctx.db.patch(userId, {
    deletedAt: undefined,
    deactivatedAt: deletedAt,
    purgedAt: user.purgedAt ?? deletedAt,
    updatedAt: Date.now(),
  });

  throw new ConvexError(DELETED_ACCOUNT_REAUTH_MESSAGE);
}

type AuthProfile = Record<string, unknown> & {
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

function userDataFromAuthProfile(args: {
  provider: { type: string; allowDangerousEmailAccountLinking?: boolean };
  profile: AuthProfile;
}) {
  const {
    emailVerified: profileEmailVerified,
    phoneVerified: profilePhoneVerified,
    [GITHUB_ORG_MEMBERSHIP_SYNC_PROFILE_KEY]: _githubOrgMembershipSync,
    ...profile
  } = args.profile;
  const emailVerified =
    profileEmailVerified ??
    ((args.provider.type === "oauth" || args.provider.type === "oidc") &&
      args.provider.allowDangerousEmailAccountLinking !== false);
  const phoneVerified = profilePhoneVerified ?? false;

  return {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
    ...profile,
  };
}

async function schedulePostUserCreatedOrUpdated(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  user: Parameters<typeof shouldScheduleGitHubProfileSync>[0],
) {
  await ctx.scheduler.runAfter(0, internal.publishers.ensurePersonalPublisherInternal, {
    userId,
  });

  // Schedule GitHub profile sync to handle username renames (fixes #303).
  // This runs as a background action so it doesn't block sign-in.
  const now = Date.now();
  if (shouldScheduleGitHubProfileSync(user, now)) {
    await ctx.scheduler.runAfter(0, internal.users.syncGitHubProfileAction, {
      userId,
    });
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    createGitHubAuthProvider(),
    ConvexCredentials({
      id: "dev-persona",
      authorize: async (credentials, ctx) => {
        const devAuthSecret =
          typeof credentials.devAuthSecret === "string" ? credentials.devAuthSecret : undefined;
        if (!isLocalDevAuthEnabled(process.env, devAuthSecret)) {
          throw new Error("Dev auth is disabled");
        }
        const persona = typeof credentials.persona === "string" ? credentials.persona : "";
        if (!DEV_PERSONAS.has(persona)) throw new Error("Unknown dev persona");
        const userId: Id<"users"> = await ctx.runMutation(internal.users.upsertDevPersonaInternal, {
          persona: persona as "owner" | "user" | "admin" | "officialOrgMember" | "abusePublisher",
          devAuthSecret,
        });
        return { userId };
      },
    }),
  ],
  callbacks: {
    /**
     * Create/update users and sync GitHub profile.
     *
     * Banned/deleted users keep the OAuth callback non-mutating so code
     * redemption can fail in beforeSessionCreation and render /account-banned.
     *
     * The GitHub profile sync is scheduled as a background action to handle
     * the case where a user renames their GitHub account (fixes #303).
     */
    async createOrUpdateUser(ctx, args) {
      const userData = userDataFromAuthProfile(args);
      const githubOrgMembershipSync = readGitHubOrgMembershipSync(args.profile);
      if (args.existingUserId !== null) {
        const userId = args.existingUserId as Id<"users">;
        const existingUser = await ctx.db.get(userId);
        if (existingUser?.deletedAt || existingUser?.deactivatedAt) {
          return userId;
        }
        await ctx.db.patch(userId, userData);
        if (githubOrgMembershipSync) {
          await replaceGitHubOrgMemberships(ctx, userId, githubOrgMembershipSync);
        }
        await schedulePostUserCreatedOrUpdated(ctx, userId, existingUser);
        return userId;
      }

      const userId = await ctx.db.insert("users", userData);
      if (githubOrgMembershipSync) {
        await replaceGitHubOrgMemberships(ctx, userId, githubOrgMembershipSync);
      }
      const user = await ctx.db.get(userId);
      await schedulePostUserCreatedOrUpdated(ctx, userId, user);
      return userId;
    },
    async beforeSessionCreation(ctx, args) {
      await handleDeletedUserSignIn(ctx, {
        userId: args.userId,
        existingUserId: args.userId,
      });
    },
  },
});
