"use node";

import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { v } from "convex/values";
import { Resend } from "resend";
import { internal } from "./_generated/api";
import { internalAction } from "./functions";
import {
  buildBanNotificationEmail,
  buildMaliciousArtifactEmail,
  buildPublisherAbuseWarningEmail,
  buildRestoredAccountEmail,
  buildSecretBlockedPublishEmail,
  type NotificationArtifact,
} from "./lib/emails";

const DEFAULT_FROM = "ClawHub Security <noreply@notifications.openclaw.ai>";

const notificationArtifactValidator = v.object({
  kind: v.union(v.literal("skill"), v.literal("plugin")),
  name: v.string(),
});

const publisherAbuseWarningScoreValidator = v.object({
  modelVersion: v.string(),
  publishedSkills: v.number(),
  totalInstalls: v.number(),
  totalStars: v.number(),
  totalDownloads: v.number(),
  installsPerSkill: v.number(),
  starsPerSkill: v.number(),
  downloadsPerSkill: v.number(),
  zScore: v.number(),
  reasonCodes: v.array(v.string()),
});

type SendEmailArgs = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SendEmailResult = { ok: true; id: string | null } | { ok: false; reason: string };

function getEmailConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.CLAWHUB_SECURITY_EMAIL_FROM || DEFAULT_FROM,
  };
}

async function sendTransactionalEmail(args: SendEmailArgs) {
  const captureFile = process.env.CLAWHUB_EMAIL_CAPTURE_FILE?.trim();
  if (captureFile) {
    await mkdir(dirname(captureFile), { recursive: true });
    await appendFile(
      captureFile,
      `${JSON.stringify({ ...args, capturedAt: Date.now() })}\n`,
      "utf8",
    );
    return { ok: true as const, id: "local-capture" };
  }

  const config = getEmailConfig();
  if (!config.apiKey) {
    console.warn(`[emails] RESEND_API_KEY is not configured; skipped ${args.idempotencyKey}`);
    return { ok: false as const, reason: "missing_api_key" as const };
  }

  try {
    const resend = new Resend(config.apiKey);
    const result = await resend.emails.send(
      {
        from: config.from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        html: args.html,
      },
      { idempotencyKey: args.idempotencyKey },
    );
    if (result.error) {
      console.error("[emails] Resend error", result.error);
      return { ok: false as const, reason: "resend_error" as const };
    }
    return { ok: true as const, id: result.data?.id ?? null };
  } catch (error) {
    console.error("[emails] Send failed", error);
    return { ok: false as const, reason: "send_error" as const };
  }
}

export const sendBanNotificationInternal = internalAction({
  args: {
    userId: v.id("users"),
    bannedAt: v.number(),
    to: v.string(),
    handle: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("autoban")),
    reason: v.optional(v.string()),
    trigger: v.optional(v.string()),
    artifact: v.optional(notificationArtifactValidator),
    hiddenArtifacts: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const email = await buildBanNotificationEmail({
      handle: args.handle,
      source: args.source,
      reason: args.reason,
      trigger: args.trigger,
      artifact: args.artifact as NotificationArtifact | undefined,
      bannedAt: args.bannedAt,
      hiddenArtifacts: args.hiddenArtifacts,
    });
    return await sendTransactionalEmail({
      idempotencyKey: `ban:${args.userId}:${args.bannedAt}`,
      to: args.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  },
});

export const sendRestoredAccountNotificationInternal = internalAction({
  args: {
    userId: v.id("users"),
    restoredAt: v.number(),
    to: v.string(),
    handle: v.optional(v.string()),
    restoredListings: v.optional(v.array(notificationArtifactValidator)),
    skillsRestored: v.optional(v.number()),
    packagesRestored: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const email = await buildRestoredAccountEmail({
      handle: args.handle,
      restoredListings: args.restoredListings as NotificationArtifact[] | undefined,
      restoredAt: args.restoredAt,
      skillsRestored: args.skillsRestored,
      packagesRestored: args.packagesRestored,
    });
    return await sendTransactionalEmail({
      idempotencyKey: `account-restored:${args.userId}:${args.restoredAt}`,
      to: args.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  },
});

export const sendMaliciousArtifactNotificationInternal = internalAction({
  args: {
    userId: v.id("users"),
    findingAt: v.number(),
    to: v.string(),
    handle: v.optional(v.string()),
    artifact: notificationArtifactValidator,
    version: v.optional(v.string()),
    trigger: v.optional(v.string()),
    findingSummary: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const email = await buildMaliciousArtifactEmail({
      handle: args.handle,
      artifact: args.artifact as NotificationArtifact,
      version: args.version,
      trigger: args.trigger,
      findingSummary: args.findingSummary,
    });
    return await sendTransactionalEmail({
      idempotencyKey: `malicious-artifact:${args.userId}:${args.findingAt}:${args.artifact.kind}:${args.artifact.name}:${args.version ?? ""}`,
      to: args.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  },
});

export const sendSecretPublishBlockedNotificationInternal = internalAction({
  args: {
    attemptId: v.id("publishAttempts"),
    userId: v.id("users"),
    to: v.string(),
    handle: v.optional(v.string()),
    artifact: notificationArtifactValidator,
    version: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const email = await buildSecretBlockedPublishEmail({
      handle: args.handle,
      artifact: args.artifact as NotificationArtifact,
      version: args.version,
    });
    return await sendTransactionalEmail({
      idempotencyKey: `secret-publish-block:${args.attemptId}:${args.userId}`,
      to: args.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  },
});

export const sendPublisherAbuseWarningInternal = internalAction({
  args: {
    nominationId: v.id("publisherAbuseReviewNominations"),
    ownerKey: v.string(),
    runId: v.id("publisherAbuseScoreRuns"),
    scoreId: v.id("publisherAbuseScores"),
    userId: v.id("users"),
    to: v.string(),
    handle: v.optional(v.string()),
    publisherHandle: v.string(),
    warningPendingAt: v.number(),
    graceMs: v.number(),
    score: publisherAbuseWarningScoreValidator,
  },
  handler: async (ctx, args): Promise<SendEmailResult> => {
    const claimResult: { ok: boolean; reason?: string } = await ctx.runMutation(
      internal.publisherAbuse.claimPublisherAbusePendingWarningInternal,
      {
        nominationId: args.nominationId,
        runId: args.runId,
        scoreId: args.scoreId,
        warningPendingAt: args.warningPendingAt,
      },
    );
    if (!claimResult.ok) {
      return { ok: false, reason: claimResult.reason ?? "stale_warning" };
    }

    const warningSentAt = Date.now();
    const deadlineAt = warningSentAt + args.graceMs;
    const email = await buildPublisherAbuseWarningEmail({
      handle: args.handle,
      publisherHandle: args.publisherHandle,
      warningSentAt,
      deadlineAt,
      score: args.score,
    });
    const result = await sendTransactionalEmail({
      idempotencyKey: `publisher-abuse-warning:${args.nominationId}:${args.userId}:${args.scoreId}`,
      to: args.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    if (!result.ok) {
      await ctx.runMutation(internal.publisherAbuse.clearPublisherAbusePendingWarningInternal, {
        nominationId: args.nominationId,
        runId: args.runId,
        scoreId: args.scoreId,
        warningPendingAt: args.warningPendingAt,
      });
      return result;
    }

    await ctx.runMutation(internal.publisherAbuse.recordPublisherAbuseWarningSentInternal, {
      nominationId: args.nominationId,
      ownerKey: args.ownerKey,
      runId: args.runId,
      scoreId: args.scoreId,
      warningPendingAt: args.warningPendingAt,
      warningSentAt,
      deadlineAt,
    });
    return result;
  },
});
