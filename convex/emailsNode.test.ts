/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";

const { resendConstructorMock, resendSendMock } = vi.hoisted(() => ({
  resendConstructorMock: vi.fn(function ResendMock() {
    return { emails: { send: resendSendMock } };
  }),
  resendSendMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: resendConstructorMock,
}));

const { sendBanNotificationInternal, sendPublisherAbuseWarningInternal } =
  await import("./emailsNode");

type SendBanNotificationHandler = {
  _handler: (
    ctx: unknown,
    args: {
      userId: string;
      bannedAt: number;
      to: string;
      handle?: string;
      source: "manual" | "autoban";
      reason?: string;
    },
  ) => Promise<unknown>;
};

type SendPublisherAbuseWarningHandler = {
  _handler: (
    ctx: {
      runMutation: ReturnType<typeof vi.fn>;
    },
    args: {
      nominationId: string;
      ownerKey: string;
      runId: string;
      scoreId: string;
      userId: string;
      to: string;
      handle?: string;
      publisherHandle: string;
      warningPendingAt: number;
      graceMs: number;
      score: {
        modelVersion: string;
        publishedSkills: number;
        totalInstalls: number;
        totalStars: number;
        totalDownloads: number;
        installsPerSkill: number;
        starsPerSkill: number;
        downloadsPerSkill: number;
        zScore: number;
        reasonCodes: string[];
      };
    },
  ) => Promise<unknown>;
};

function publisherAbuseWarningArgs() {
  return {
    nominationId: "publisherAbuseReviewNominations:candidate",
    ownerKey: "publisher:publishers:candidate",
    runId: "publisherAbuseScoreRuns:run",
    scoreId: "publisherAbuseScores:score",
    userId: "users:target",
    to: "target@example.com",
    handle: "target",
    publisherHandle: "bulkpub",
    warningPendingAt: 1_700_000_000_000,
    graceMs: 7 * 24 * 60 * 60 * 1000,
    score: {
      modelVersion: "publisher-abuse-pressure.v2",
      publishedSkills: 143,
      totalInstalls: 2,
      totalStars: 0,
      totalDownloads: 30,
      installsPerSkill: 0.01,
      starsPerSkill: 0,
      downloadsPerSkill: 0.21,
      zScore: 3.2,
      reasonCodes: ["high_catalog_volume"],
    },
  };
}

describe("transactional account emails", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "resend_test");
    resendConstructorMock.mockClear();
    resendSendMock.mockReset();
    resendSendMock.mockResolvedValue({ data: { id: "email_123" }, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends ban notifications without a Reply-To header", async () => {
    const result = await (
      sendBanNotificationInternal as unknown as SendBanNotificationHandler
    )._handler(
      {},
      {
        userId: "users:target",
        bannedAt: 1_700_000_000_000,
        to: "target@example.com",
        handle: "target",
        source: "manual",
        reason: "security review",
      },
    );

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = resendSendMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      from: "ClawHub Security <noreply@notifications.openclaw.ai>",
      to: "target@example.com",
      subject: "Your ClawHub account has been suspended",
    });
    expect(payload).not.toHaveProperty("replyTo");
    expect(options).toEqual({ idempotencyKey: "ban:users:target:1700000000000" });
  });

  it("includes the publisher abuse nomination in warning idempotency keys", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const ctx = {
      runMutation: vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }),
    };

    const result = await (
      sendPublisherAbuseWarningInternal as unknown as SendPublisherAbuseWarningHandler
    )._handler(ctx, publisherAbuseWarningArgs());

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const [, options] = resendSendMock.mock.calls[0] ?? [];
    expect(options).toEqual({
      idempotencyKey:
        "publisher-abuse-warning:publisherAbuseReviewNominations:candidate:users:target:1700000000000",
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      internal.publisherAbuse.recordPublisherAbuseWarningSentInternal,
      {
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        runId: "publisherAbuseScoreRuns:run",
        scoreId: "publisherAbuseScores:score",
        warningPendingAt: 1_700_000_000_000,
        warningSentAt: 1_700_000_100_000,
        deadlineAt: 1_700_604_900_000,
      },
    );
  });

  it("does not send publisher abuse warnings when the pending claim is stale", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValueOnce({ ok: false, reason: "stale_warning" }),
    };

    const result = await (
      sendPublisherAbuseWarningInternal as unknown as SendPublisherAbuseWarningHandler
    )._handler(ctx, publisherAbuseWarningArgs());

    expect(result).toEqual({ ok: false, reason: "stale_warning" });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      internal.publisherAbuse.claimPublisherAbusePendingWarningInternal,
      {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:run",
        scoreId: "publisherAbuseScores:score",
        warningPendingAt: 1_700_000_000_000,
      },
    );
  });

  it("clears publisher abuse pending warnings when email delivery fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    const ctx = {
      runMutation: vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }),
    };

    const result = await (
      sendPublisherAbuseWarningInternal as unknown as SendPublisherAbuseWarningHandler
    )._handler(ctx, publisherAbuseWarningArgs());

    expect(result).toEqual({ ok: false, reason: "resend_error" });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      internal.publisherAbuse.clearPublisherAbusePendingWarningInternal,
      {
        nominationId: "publisherAbuseReviewNominations:candidate",
        runId: "publisherAbuseScoreRuns:run",
        scoreId: "publisherAbuseScores:score",
        warningPendingAt: 1_700_000_000_000,
      },
    );
  });
});
