"use node";

import { v } from "convex/values";
import { internalAction } from "./functions";
import { syncGitHubSkillSourcesHandler, verifyGitHubSkillHandler } from "./githubSkillSync";
import { getGitHubSyncErrorMessage as getErrorMessage } from "./lib/githubSkillSync";
import { Events, logErrorEvent } from "./lib/observabilityEvents";

export const syncGitHubSkillSourcesInternal = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      return await syncGitHubSkillSourcesHandler(ctx, args);
    } catch (error) {
      logErrorEvent(Events.GitHubSkillSourceSyncFailed, { error: getErrorMessage(error) });
      throw error;
    }
  },
});

export const verifyGitHubSkillInternal = internalAction({
  args: {
    skillId: v.id("skills"),
    contentHash: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: verifyGitHubSkillHandler,
});
