/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalAction: (def: { args: unknown; handler: unknown }) => ({
    _args: def.args,
    _handler: def.handler,
  }),
}));

const { backfillCommentScamModerationInternal, continueCommentScamModerationJobInternal } =
  await import("./commentModeration");

type RetiredResult = { ok: true; retired: true };
type RetiredActionHandler = (ctx: unknown, args: unknown) => Promise<RetiredResult>;
type ActionWithHandler = { _args: unknown; _handler: RetiredActionHandler };
type ConvexValidatorLike = {
  isConvexValidator: true;
  isOptional: "required" | "optional";
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConvexValidator(value: unknown): value is ConvexValidatorLike {
  return (
    isRecord(value) &&
    value.isConvexValidator === true &&
    (value.isOptional === "required" || value.isOptional === "optional")
  );
}

function getArgs(action: unknown): Record<string, unknown> {
  if (!hasHandler(action) || !isRecord(action._args)) {
    throw new Error("expected mocked Convex action to expose _args");
  }
  return action._args;
}

function expectLegacyArgShape(
  action: unknown,
  expected: { required: readonly string[]; optional: readonly string[] },
) {
  const args = getArgs(action);
  expect(Object.keys(args).sort()).toEqual([...expected.required, ...expected.optional].sort());
  for (const key of expected.required) {
    const validator = args[key];
    if (!isConvexValidator(validator)) throw new Error(`expected validator for ${key}`);
    expect(validator.isOptional).toBe("required");
  }
  for (const key of expected.optional) {
    const validator = args[key];
    if (!isConvexValidator(validator)) throw new Error(`expected validator for ${key}`);
    expect(validator.isOptional).toBe("optional");
  }
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

  it("keeps legacy scheduled-job argument validators registered", () => {
    expectLegacyArgShape(backfillCommentScamModerationInternal, {
      required: ["actorUserId"],
      optional: ["batchSize", "cursor", "dryRun", "includeSoftDeleted", "maxBatches", "rescan"],
    });
    expectLegacyArgShape(continueCommentScamModerationJobInternal, {
      required: ["actorUserId"],
      optional: ["batchSize", "cursor", "dryRun", "includeSoftDeleted", "rescan"],
    });
  });
});
