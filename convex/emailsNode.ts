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
  notificationArtifactValidator,
  publisherAbuseWarningScoreValidator,
  secretBlockedArtifactValidator,
} from "./lib/emails";

const DEFAULT_FROM = "ClawHub Security <noreply@notifications.openclaw.ai>";

type SendEmailArgs = {
  from?: string;
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
        from: args.from ?? config.from,
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
      artifact: args.artifact,
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
      restoredListings: args.restoredListings,
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
      artifact: args.artifact,
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
    artifact: secretBlockedArtifactValidator,
    version: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const email = await buildSecretBlockedPublishEmail({
      handle: args.handle,
      artifact: args.artifact,
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

export const sendTemplatePublicationOutcomeInternal = internalAction({
  args: {
    attemptId: v.id("publishAttempts"),
    releaseId: v.optional(v.id("packageReleases")),
    to: v.string(),
    outcome: v.union(v.literal("published"), v.literal("blocked"), v.literal("scan_failed")),
    packageName: v.string(),
    displayName: v.string(),
    version: v.string(),
    publishedAt: v.optional(v.number()),
    templateUrl: v.optional(v.string()),
    auditPassed: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<SendEmailResult> => {
    const { packageName, displayName, version, outcome } = args;
    const { renderTemplatePublishedEmail, renderTemplateNotPublishedEmail } =
      await import("./lib/emailRendering");
    const from =
      process.env.CLAWHUB_NOREPLY_FROM?.trim() || "ClawHub <noreply@notifications.openclaw.ai>";
    if (outcome === "published") {
      if (!args.releaseId || !args.templateUrl || args.publishedAt === undefined) {
        throw new Error(
          "Published template notification requires release, URL and publication time",
        );
      }
      const date = new Date(args.publishedAt);
      const publishedAt =
        date.toLocaleDateString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "short",
          day: "numeric",
        }) +
        " · " +
        date.toISOString().slice(11, 16) +
        " UTC";
      const email = await renderTemplatePublishedEmail({
        displayName,
        packageName,
        version,
        publishedAt,
        templateUrl: args.templateUrl,
        auditPassed: args.auditPassed === true,
      });
      return sendTransactionalEmail({
        ...email,
        from,
        to: args.to,
        subject: `${packageName}@${version} is now public on ClawHub`,
        idempotencyKey: "template-published:" + args.releaseId,
      });
    }
    const email = await renderTemplateNotPublishedEmail({
      displayName,
      packageName,
      version,
      outcome,
    });
    return sendTransactionalEmail({
      ...email,
      from,
      to: args.to,
      subject:
        outcome === "blocked"
          ? `ClawHub blocked ${packageName}@${version}`
          : `ClawHub couldn’t finish checking ${packageName}@${version}`,
      idempotencyKey: "template-" + outcome + ":" + args.attemptId,
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
