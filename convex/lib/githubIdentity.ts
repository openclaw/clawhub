import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

export function canHealSkillOwnershipByGitHubProviderAccountId(
  ownerProviderAccountId: string | null | undefined,
  callerProviderAccountId: string | null | undefined,
) {
  // Security invariant: missing identity must never grant ownership.
  if (!ownerProviderAccountId || !callerProviderAccountId) return false
  return ownerProviderAccountId === callerProviderAccountId
}

export async function getGitHubProviderAccountId(
  ctx: Pick<QueryCtx, 'db'>,
  userId: Id<'users'>,
): Promise<string | null> {
  const account = await ctx.db
    .query('authAccounts')
    .withIndex('userIdAndProvider', (q) => q.eq('userId', userId).eq('provider', 'github'))
    .unique()
  return account?.providerAccountId ?? null
}
