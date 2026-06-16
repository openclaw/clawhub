/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const {
  backfillLlmEval,
  countSuspiciousInventoryInternal,
  evaluateBySlug,
  evaluateCommentForScam,
  evaluatePackageReleaseWithLlm,
  evaluateWithLlm,
  scheduleSuspiciousPluginLlmRescanInternal,
  scheduleSuspiciousSkillLlmRescanInternal,
} = await import("./llmEval");

type RetiredResult = { ok: true; retired: true };
type RetiredActionHandler = (ctx: unknown, args: unknown) => Promise<RetiredResult>;
type ActionWithHandler = { _handler: RetiredActionHandler };

function hasHandler(action: unknown): action is ActionWithHandler {
  return (
    typeof action === "object" &&
    action !== null &&
    "_handler" in action &&
    typeof action._handler === "function"
  );
}

function getHandler(action: unknown): RetiredActionHandler {
  if (!hasHandler(action)) {
    throw new Error("expected mocked Convex action to expose _handler");
  }
  return action._handler;
}

describe("LLM eval drain", () => {
  it.each([
    [
      "evaluateWithLlm",
      evaluateWithLlm,
      {
        versionId: "skillVersions:legacy",
        moderationMode: "normal",
      },
    ],
    [
      "evaluatePackageReleaseWithLlm",
      evaluatePackageReleaseWithLlm,
      {
        releaseId: "packageReleases:legacy",
      },
    ],
    [
      "evaluateBySlug",
      evaluateBySlug,
      {
        slug: "legacy-skill",
      },
    ],
    [
      "backfillLlmEval",
      backfillLlmEval,
      {
        cursor: 100,
        batchSize: 25,
        delayMs: 0,
        dryRun: true,
        maxToSchedule: 1,
        moderationMode: "preserve",
        accTotal: 0,
        accScheduled: 0,
        accSkipped: 0,
        startTime: 123,
      },
    ],
    [
      "scheduleSuspiciousSkillLlmRescanInternal",
      scheduleSuspiciousSkillLlmRescanInternal,
      {
        bucket: "all",
        cursor: null,
        batchSize: 25,
        pageDelayMs: 0,
        evalDelayStepMs: 0,
        dryRun: true,
        maxToSchedule: 1,
        moderationMode: "normal",
        accExamined: 0,
        accScheduled: 0,
        accSkipped: 0,
        startTime: 123,
      },
    ],
    [
      "scheduleSuspiciousPluginLlmRescanInternal",
      scheduleSuspiciousPluginLlmRescanInternal,
      {
        cursor: null,
        batchSize: 25,
        pageDelayMs: 0,
        evalDelayStepMs: 0,
        dryRun: true,
        maxToSchedule: 1,
        accExamined: 0,
        accScheduled: 0,
        accSkipped: 0,
        startTime: 123,
      },
    ],
    [
      "countSuspiciousInventoryInternal",
      countSuspiciousInventoryInternal,
      {
        batchSize: 25,
        maxPages: 1,
      },
    ],
    [
      "evaluateCommentForScam",
      evaluateCommentForScam,
      {
        commentId: "comments:legacy",
        skillId: "skills:legacy",
        userId: "users:legacy",
        body: "legacy comment body",
      },
    ],
  ])("keeps legacy %s scheduled jobs harmless", async (_name, action, args) => {
    await expect(getHandler(action)({}, args)).resolves.toEqual({
      ok: true,
      retired: true,
    });
  });
});
