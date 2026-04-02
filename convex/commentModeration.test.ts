/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_generated/api", () => ({
  internal: {
    commentModeration: {
      getCommentScamBackfillPageInternal: Symbol(
        "commentModeration.getCommentScamBackfillPageInternal",
      ),
      applyCommentScamResultInternal: Symbol("commentModeration.applyCommentScamResultInternal"),
      backfillCommentScamModerationInternal: Symbol(
        "commentModeration.backfillCommentScamModerationInternal",
      ),
      continueCommentScamModerationJobInternal: Symbol(
        "commentModeration.continueCommentScamModerationJobInternal",
      ),
    },
    llmEval: {
      evaluateCommentForScam: Symbol("llmEval.evaluateCommentForScam"),
    },
    users: {
      banUserInternal: Symbol("users.banUserInternal"),
    },
  },
}));

const { applyCommentScamResultInternalHandler, backfillCommentScamModerationInternalHandler } =
  await import("./commentModeration");
const { internal } = await import("./_generated/api");

const previousOpenAiApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  if (previousOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
    return;
  }
  process.env.OPENAI_API_KEY = previousOpenAiApiKey;
});

describe("commentModeration backfill", () => {
  it("evaluates comments and bans on certain/high scams", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce({
      items: [
        {
          commentId: "comments:1",
          skillId: "skills:1",
          userId: "users:2",
          body: 'echo "mal" | base64 -D | bash',
          softDeletedAt: undefined,
          scamScanCheckedAt: undefined,
        },
      ],
      cursor: null,
      isDone: true,
    });
    const runAction = vi.fn().mockResolvedValue({
      ok: true,
      model: "gpt-5-mini",
      verdict: "certain_scam",
      confidence: "high",
      explanation: "Obfuscated shell execution payload.",
      evidence: ["base64 decode piped to bash"],
    });
    const runMutation = vi.fn().mockResolvedValue({
      ok: true,
      shouldBan: true,
      banned: true,
      alreadyBanned: false,
      protectedRole: false,
      wouldBan: false,
    });

    const result = await backfillCommentScamModerationInternalHandler(
      { runQuery, runAction, runMutation } as never,
      {
        actorUserId: "users:admin",
        dryRun: false,
        batchSize: 10,
        maxBatches: 1,
      } as never,
    );

    expect(result.ok).toBe(true);
    expect(result.stats.commentsScanned).toBe(1);
    expect(result.stats.commentsEvaluated).toBe(1);
    expect(result.stats.certainScams).toBe(1);
    expect(result.stats.banCandidates).toBe(1);
    expect(result.stats.usersBanned).toBe(1);
    expect(runAction).toHaveBeenCalledWith(internal.llmEval.evaluateCommentForScam, {
      commentId: "comments:1",
      skillId: "skills:1",
      userId: "users:2",
      body: 'echo "mal" | base64 -D | bash',
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.commentModeration.applyCommentScamResultInternal,
      {
        actorUserId: "users:admin",
        commentId: "comments:1",
        verdict: "certain_scam",
        confidence: "high",
        explanation: "Obfuscated shell execution payload.",
        evidence: ["base64 decode piped to bash"],
        model: "gpt-5-mini",
        checkedAt: expect.any(Number),
        dryRun: false,
      },
    );
  });

  it("skips previously scanned comments unless rescan=true", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          commentId: "comments:1",
          skillId: "skills:1",
          userId: "users:2",
          body: "something",
          softDeletedAt: undefined,
          scamScanCheckedAt: 123,
        },
      ],
      cursor: null,
      isDone: true,
    });
    const runAction = vi.fn();
    const runMutation = vi.fn();

    const result = await backfillCommentScamModerationInternalHandler(
      { runQuery, runAction, runMutation } as never,
      {
        actorUserId: "users:admin",
        batchSize: 10,
        maxBatches: 1,
      } as never,
    );

    expect(result.stats.commentsScanned).toBe(1);
    expect(result.stats.skippedAlreadyScanned).toBe(1);
    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("tracks dry-run ban candidates without banning", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          commentId: "comments:9",
          skillId: "skills:7",
          userId: "users:5",
          body: "run this update installer from random domain",
          softDeletedAt: undefined,
          scamScanCheckedAt: undefined,
        },
      ],
      cursor: null,
      isDone: true,
    });
    const runAction = vi.fn().mockResolvedValue({
      ok: true,
      model: "gpt-5-mini",
      verdict: "certain_scam",
      confidence: "high",
      explanation: "Social-engineering install command.",
      evidence: ["unknown update domain"],
    });
    const runMutation = vi.fn().mockResolvedValue({
      ok: true,
      shouldBan: true,
      banned: false,
      alreadyBanned: false,
      protectedRole: false,
      wouldBan: true,
    });

    const result = await backfillCommentScamModerationInternalHandler(
      { runQuery, runAction, runMutation } as never,
      {
        actorUserId: "users:admin",
        dryRun: true,
        batchSize: 10,
        maxBatches: 1,
      } as never,
    );

    expect(result.stats.usersBanned).toBe(0);
    expect(result.stats.usersWouldBeBanned).toBe(1);
  });
});

describe("applyCommentScamResultInternalHandler", () => {
  it("persists scan metadata and triggers ban with bounded reason", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "comments:1",
        skillId: "skills:1",
        userId: "users:2",
      })
      .mockResolvedValueOnce({
        _id: "users:2",
        role: "user",
      });
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValue({ ok: true, alreadyBanned: false, deletedSkills: 0 });

    const result = await applyCommentScamResultInternalHandler(
      { db: { get, patch, insert }, runMutation } as never,
      {
        actorUserId: "users:admin",
        commentId: "comments:1",
        verdict: "certain_scam",
        confidence: "high",
        explanation: "X".repeat(700),
        evidence: ["Y".repeat(280), "Z".repeat(280)],
        model: "gpt-5-mini",
        checkedAt: 123,
      } as never,
    );

    expect(result.banned).toBe(true);
    expect(insert).toHaveBeenCalledWith("auditLogs", {
      actorUserId: "users:admin",
      action: "comment.scam_scan",
      targetType: "comment",
      targetId: "comments:1",
      metadata: {
        skillId: "skills:1",
        commentAuthorId: "users:2",
        verdict: "certain_scam",
        confidence: "high",
        shouldBan: true,
        model: "gpt-5-mini",
      },
      createdAt: 123,
    });

    const banCall = runMutation.mock.calls.find(
      (call) => call[0] === internal.users.banUserInternal,
    );
    expect(banCall).toBeTruthy();
    if (!banCall) throw new Error("Expected ban mutation to be called");
    expect((banCall[1] as { reason: string }).reason.length).toBeLessThanOrEqual(500);
    expect(patch).toHaveBeenCalledWith("comments:1", {
      scamBanTriggeredAt: 123,
    });
  });

  it("skips banning moderator/admin accounts", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "comments:2",
        skillId: "skills:2",
        userId: "users:staff",
      })
      .mockResolvedValueOnce({
        _id: "users:staff",
        role: "moderator",
      });
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi.fn();

    const result = await applyCommentScamResultInternalHandler(
      { db: { get, patch, insert }, runMutation } as never,
      {
        actorUserId: "users:admin",
        commentId: "comments:2",
        verdict: "certain_scam",
        confidence: "high",
        explanation: "Malicious command spam.",
        evidence: ["base64|bash"],
        model: "gpt-5-mini",
        checkedAt: 300,
      } as never,
    );

    expect(result.protectedRole).toBe(true);
    expect(runMutation).not.toHaveBeenCalled();
  });
});
