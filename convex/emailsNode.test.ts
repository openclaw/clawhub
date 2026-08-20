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

const {
  sendBanNotificationInternal,
  sendPublisherAbuseTrafficExplanationInternal,
  sendPublisherAbuseWarningInternal,
} = await import("./emailsNode");

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

type SendPublisherAbuseTrafficExplanationHandler = {
  _handler: (
    ctx: {
      runQuery: ReturnType<typeof vi.fn>;
      runMutation: ReturnType<typeof vi.fn>;
      scheduler: { runAfter: ReturnType<typeof vi.fn> };
    },
    args: { signalId: string },
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

  it("uses a stable publisher abuse warning idempotency key across pending retries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const ctx = {
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true }),
    };

    const result = await (
      sendPublisherAbuseWarningInternal as unknown as SendPublisherAbuseWarningHandler
    )._handler(ctx, publisherAbuseWarningArgs());
    const retryResult = await (
      sendPublisherAbuseWarningInternal as unknown as SendPublisherAbuseWarningHandler
    )._handler(ctx, {
      ...publisherAbuseWarningArgs(),
      warningPendingAt: 1_700_000_090_000,
    });

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(retryResult).toEqual({ ok: true, id: "email_123" });
    expect(resendSendMock).toHaveBeenCalledTimes(2);
    const [, options] = resendSendMock.mock.calls[0] ?? [];
    const [, retryOptions] = resendSendMock.mock.calls[1] ?? [];
    expect(options).toEqual({
      idempotencyKey:
        "publisher-abuse-warning:publisherAbuseReviewNominations:candidate:users:target:publisherAbuseScores:score",
    });
    expect(retryOptions).toEqual(options);
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

  it("sends a neutral traffic question with a stable request link", async () => {
    vi.stubEnv("SITE_URL", "https://clawhub.example/");
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "send",
        requestedAt: 1_700_000_000_000,
        recipientUserId: "users:owner",
        to: "owner@example.com",
        handle: "owner",
        publisherHandle: "owner",
        skillDisplayName: "Popular Skill",
        skillSlug: "popular-skill",
        scope: "skill",
        allPublisherSkills: false,
        attemptCount: 0,
      }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, attemptCount: 1 })
        .mockResolvedValueOnce({ ok: true }),
      scheduler: { runAfter: vi.fn() },
    };

    const result = await (
      sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
    )._handler(ctx, {
      signalId: "publisherAbuseSignals:traffic",
    });

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(ctx.runQuery).toHaveBeenCalledWith(
      internal.publisherAbuseTrafficExplanation.getEmailContextInternal,
      { signalId: "publisherAbuseSignals:traffic" },
    );
    const [payload, options] = resendSendMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      to: "owner@example.com",
      subject: "Question about downloads for Popular Skill",
    });
    expect(payload.text).toMatch(
      /https:\/\/clawhub\.example\/traffic-explanation\?signal=publisherAbuseSignals%3Atraffic&token=[a-f0-9]{64}/,
    );
    expect(options).toEqual({
      idempotencyKey: expect.stringMatching(
        /^publisher-abuse-traffic-explanation:publisherAbuseSignals:traffic:1700000000000:[a-f0-9]{64}$/,
      ),
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      internal.publisherAbuseTrafficExplanation.beginDeliveryAttemptInternal,
      expect.objectContaining({
        signalId: "publisherAbuseSignals:traffic",
        expectedAttemptCount: 0,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        recipientEmail: "owner@example.com",
        subject: "Question about downloads for Popular Skill",
        templateVersion: "traffic-explanation.v1",
        redactedTextSnapshot: expect.stringContaining("[SECURE EXPLANATION LINK]"),
      }),
    );
    expect(JSON.stringify(ctx.runMutation.mock.calls[0])).not.toContain("token=");
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      internal.publisherAbuseTrafficExplanation.recordDeliveryInternal,
      {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        delivery: {
          status: "sent",
          sentAt: 1_700_000_100_000,
          providerId: "email_123",
        },
      },
    );
  });

  it("sends publisher-scoped reasons for synchronized skill traffic", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "send",
        requestedAt: 1_700_000_000_000,
        recipientUserId: "users:owner",
        to: "owner@example.com",
        handle: "owner",
        publisherHandle: "portfolio-owner",
        skillDisplayName: "Ownership Anchor",
        skillSlug: "ownership-anchor",
        scope: "publisher",
        allPublisherSkills: true,
        attemptCount: 0,
      }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, attemptCount: 1 })
        .mockResolvedValueOnce({ ok: true }),
      scheduler: { runAfter: vi.fn() },
    };

    await (
      sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
    )._handler(ctx, {
      signalId: "publisherAbuseSignals:portfolio",
    });

    const [payload] = resendSendMock.mock.calls[0] ?? [];
    expect(payload.subject).toBe("Question about downloads for @portfolio-owner");
    expect(payload.text).toContain(
      "- Unusual download activity was detected across all of your skills.",
    );
    expect(payload.text).toContain(
      "- Download activity across those skills follows nearly identical trends.",
    );
  });

  it("does not email a request that is no longer actionable", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "skip",
        requestedAt: 1_700_000_000_000,
        reason: "skill_owner_changed",
      }),
      runMutation: vi.fn().mockResolvedValue({ ok: true }),
      scheduler: { runAfter: vi.fn() },
    };

    const result = await (
      sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
    )._handler(ctx, {
      signalId: "publisherAbuseSignals:traffic",
    });

    expect(result).toEqual({ ok: false, reason: "skill_owner_changed" });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      internal.publisherAbuseTrafficExplanation.recordDeliveryInternal,
      {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        delivery: {
          status: "cancelled",
          recordedAt: expect.any(Number),
          reason: "skill_owner_changed",
        },
      },
    );
  });

  it("records a bounded retry when owner contact delivery fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "send",
        requestedAt: 1_700_000_000_000,
        recipientUserId: "users:owner",
        to: "owner@example.com",
        handle: "owner",
        publisherHandle: "owner",
        skillDisplayName: "Popular Skill",
        skillSlug: "popular-skill",
        scope: "skill",
        allPublisherSkills: false,
        attemptCount: 0,
      }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, attemptCount: 1 })
        .mockResolvedValueOnce({ ok: true }),
      scheduler: { runAfter: vi.fn(async () => null) },
    };

    await expect(
      (
        sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
      )._handler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
      }),
    ).resolves.toEqual({ ok: false, reason: "resend_error" });

    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      internal.publisherAbuseTrafficExplanation.recordDeliveryInternal,
      {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        delivery: {
          status: "retrying",
          recordedAt: expect.any(Number),
          reason: "resend_error",
        },
      },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      5 * 60_000,
      internal.emailsNode.sendPublisherAbuseTrafficExplanationInternal,
      { signalId: "publisherAbuseSignals:traffic" },
    );
  });

  it("stops retrying after the fourth owner contact delivery failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "send",
        requestedAt: 1_700_000_000_000,
        recipientUserId: "users:owner",
        to: "owner@example.com",
        handle: "owner",
        publisherHandle: "owner",
        skillDisplayName: "Popular Skill",
        skillSlug: "popular-skill",
        scope: "skill",
        allPublisherSkills: false,
        attemptCount: 3,
      }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, attemptCount: 4 })
        .mockResolvedValueOnce({ ok: true }),
      scheduler: { runAfter: vi.fn(async () => null) },
    };

    await expect(
      (
        sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
      )._handler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
      }),
    ).resolves.toEqual({ ok: false, reason: "resend_error" });

    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      internal.publisherAbuseTrafficExplanation.recordDeliveryInternal,
      {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        delivery: {
          status: "not_deliverable",
          recordedAt: expect.any(Number),
          reason: "resend_error",
        },
      },
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not email when another action already claimed the attempt", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        kind: "send",
        requestedAt: 1_700_000_000_000,
        recipientUserId: "users:owner",
        to: "owner@example.com",
        handle: "owner",
        publisherHandle: "owner",
        skillDisplayName: "Popular Skill",
        skillSlug: "popular-skill",
        scope: "skill",
        allPublisherSkills: false,
        attemptCount: 0,
      }),
      runMutation: vi.fn().mockResolvedValue({ ok: false, reason: "stale_request" }),
      scheduler: { runAfter: vi.fn() },
    };

    const result = await (
      sendPublisherAbuseTrafficExplanationInternal as unknown as SendPublisherAbuseTrafficExplanationHandler
    )._handler(ctx, {
      signalId: "publisherAbuseSignals:traffic",
    });

    expect(result).toEqual({ ok: false, reason: "stale_request" });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });
});
