/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalAction: (def: { args: unknown; handler: unknown }) => ({
    _args: def.args,
    _handler: def.handler,
  }),
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
type ActionWithHandler = { _args: unknown; _handler: RetiredActionHandler };
type ConvexValidatorLike = {
  isConvexValidator: true;
  isOptional: "required" | "optional";
  json: unknown;
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
    (value.isOptional === "required" || value.isOptional === "optional") &&
    "json" in value
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

function expectLegacyUnionLiterals(action: unknown, key: string, expected: readonly string[]) {
  const validator = getArgs(action)[key];
  if (!isConvexValidator(validator)) throw new Error(`expected validator for ${key}`);
  expect(validator.json).toEqual({
    type: "union",
    value: expected.map((value) => ({ type: "literal", value })),
  });
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

  it("keeps legacy scheduled-job argument validators registered", () => {
    expectLegacyArgShape(evaluateWithLlm, {
      required: ["versionId"],
      optional: ["moderationMode"],
    });
    expectLegacyArgShape(evaluatePackageReleaseWithLlm, {
      required: ["releaseId"],
      optional: [],
    });
    expectLegacyArgShape(evaluateBySlug, {
      required: ["slug"],
      optional: [],
    });
    expectLegacyArgShape(backfillLlmEval, {
      required: [],
      optional: [
        "accScheduled",
        "accSkipped",
        "accTotal",
        "batchSize",
        "cursor",
        "delayMs",
        "dryRun",
        "maxToSchedule",
        "moderationMode",
        "startTime",
      ],
    });
    expectLegacyArgShape(scheduleSuspiciousSkillLlmRescanInternal, {
      required: ["bucket"],
      optional: [
        "accExamined",
        "accScheduled",
        "accSkipped",
        "batchSize",
        "cursor",
        "dryRun",
        "evalDelayStepMs",
        "maxToSchedule",
        "moderationMode",
        "pageDelayMs",
        "startTime",
      ],
    });
    expectLegacyArgShape(scheduleSuspiciousPluginLlmRescanInternal, {
      required: [],
      optional: [
        "accExamined",
        "accScheduled",
        "accSkipped",
        "batchSize",
        "cursor",
        "dryRun",
        "evalDelayStepMs",
        "maxToSchedule",
        "pageDelayMs",
        "startTime",
      ],
    });
    expectLegacyArgShape(countSuspiciousInventoryInternal, {
      required: [],
      optional: ["batchSize", "maxPages"],
    });
    expectLegacyArgShape(evaluateCommentForScam, {
      required: ["body", "commentId", "skillId", "userId"],
      optional: [],
    });

    expectLegacyUnionLiterals(evaluateWithLlm, "moderationMode", ["normal", "preserve"]);
    expectLegacyUnionLiterals(backfillLlmEval, "moderationMode", ["normal", "preserve"]);
    expectLegacyUnionLiterals(scheduleSuspiciousSkillLlmRescanInternal, "moderationMode", [
      "normal",
      "preserve",
    ]);
    expectLegacyUnionLiterals(scheduleSuspiciousSkillLlmRescanInternal, "bucket", [
      "all",
      "llm-only",
      "vt-only",
      "both",
    ]);
  });
});
