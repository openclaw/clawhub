import { query } from "./functions";
import { getOptionalActiveAuthUserId } from "./lib/access";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) {
      return { syncedAt: null, truncated: false, memberships: [] };
    }
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) {
      return { syncedAt: null, truncated: false, memberships: [] };
    }

    const memberships = await ctx.db
      .query("githubOrgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    memberships.sort((left, right) => left.login.localeCompare(right.login));

    return {
      syncedAt: user.githubOrgMembershipsSyncedAt ?? null,
      truncated: user.githubOrgMembershipsTruncated ?? false,
      memberships: memberships.map(({ githubOrgId, login, avatarUrl, role, syncedAt }) => ({
        githubOrgId,
        login,
        avatarUrl: avatarUrl ?? null,
        role,
        syncedAt,
      })),
    };
  },
});
