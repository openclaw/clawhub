import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const MAX_GITHUB_AUTH_ACCOUNTS_PER_USER = 10;

export function canHealSkillOwnershipByGitHubProviderAccountId(
  ownerProviderAccountId: string | null | undefined,
  callerProviderAccountId: string | null | undefined,
) {
  // Security invariant: missing identity must never grant ownership.
  if (!ownerProviderAccountId || !callerProviderAccountId) return false;
  return ownerProviderAccountId === callerProviderAccountId;
}

export async function getGitHubProviderAccountId(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<string | null> {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "github"))
    .take(MAX_GITHUB_AUTH_ACCOUNTS_PER_USER + 1);
  if (accounts.length === 0) return null;
  if (accounts.length > MAX_GITHUB_AUTH_ACCOUNTS_PER_USER) {
    throw new Error(formatTooManyGitHubAuthAccountsError(userId, accounts));
  }

  const providerAccountId = accounts[0]?.providerAccountId;
  if (
    typeof providerAccountId !== "string" ||
    accounts.some((account) => account.providerAccountId !== providerAccountId)
  ) {
    throw new Error(formatConflictingGitHubAuthAccountsError(userId, accounts));
  }

  return providerAccountId;
}

function formatConflictingGitHubAuthAccountsError(
  userId: Id<"users">,
  accounts: Array<Doc<"authAccounts">>,
) {
  const accountIds = accounts.map((account) => account._id).join(", ");
  return `Conflicting GitHub auth accounts for user ${userId}: [${accountIds}]`;
}

function formatTooManyGitHubAuthAccountsError(
  userId: Id<"users">,
  accounts: Array<Doc<"authAccounts">>,
) {
  const accountIds = accounts.map((account) => account._id).join(", ");
  return `Too many GitHub auth accounts for user ${userId}; manual reconciliation required: [${accountIds}]`;
}
