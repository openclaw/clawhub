"use node";

import { v } from "convex/values";
import { internalAction } from "./functions";
import { syncGitHubSkillSourcesHandler, verifyGitHubSkillHandler } from "./githubSkillSync";
import { Events, logErrorEvent } from "./lib/observabilityEvents";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

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
