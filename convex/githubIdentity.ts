import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import { getGitHubProviderAccountId } from './lib/githubIdentity'

export const getGitHubProviderAccountIdInternal = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => getGitHubProviderAccountId(ctx, args.userId),
})

