/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const { backfillCommentScamModerationInternal, continueCommentScamModerationJobInternal } =
  await import("./commentModeration");

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

describe("comment scam moderation drain", () => {
  it.each([
    [
      "backfillCommentScamModerationInternal",
      backfillCommentScamModerationInternal,
      {
        actorUserId: "users:legacy",
        dryRun: true,
        batchSize: 25,
        maxBatches: 1,
        cursor: "legacy-cursor",
        rescan: true,
        includeSoftDeleted: true,
      },
    ],
    [
      "continueCommentScamModerationJobInternal",
      continueCommentScamModerationJobInternal,
      {
        actorUserId: "users:legacy",
        dryRun: true,
        batchSize: 25,
        cursor: "legacy-cursor",
        rescan: true,
        includeSoftDeleted: true,
      },
    ],
  ])("keeps legacy %s scheduled jobs harmless", async (_name, action, args) => {
    await expect(getHandler(action)({}, args)).resolves.toEqual({
      ok: true,
      retired: true,
    });
  });
});
