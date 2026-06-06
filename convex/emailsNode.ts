"use node";

import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "./functions";
import {
  buildBanNotificationEmail,
  buildMaliciousArtifactEmail,
  buildRestoredAccountEmail,
  type NotificationArtifact,
} from "./lib/emails";

const DEFAULT_FROM = "ClawHub Security <noreply@notifications.openclaw.ai>";
const DEFAULT_REPLY_TO = "security@notifications.openclaw.ai";

const notificationArtifactValidator = v.object({
  kind: v.union(v.literal("skill"), v.literal("plugin")),
  name: v.string(),
});

type SendEmailArgs = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

function getEmailConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.CLAWHUB_SECURITY_EMAIL_FROM || DEFAULT_FROM,
    replyTo: process.env.CLAWHUB_SECURITY_EMAIL || DEFAULT_REPLY_TO,
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
        replyTo: config.replyTo,
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
  },
  handler: async (_ctx, args) => {
    const email = buildBanNotificationEmail({
      handle: args.handle,
      source: args.source,
      reason: args.reason,
      trigger: args.trigger,
      artifact: args.artifact as NotificationArtifact | undefined,
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
  },
  handler: async (_ctx, args) => {
    const email = buildRestoredAccountEmail({
      handle: args.handle,
      restoredListings: args.restoredListings as NotificationArtifact[] | undefined,
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
  },
  handler: async (_ctx, args) => {
    const email = buildMaliciousArtifactEmail({
      handle: args.handle,
      artifact: args.artifact as NotificationArtifact,
      version: args.version,
      trigger: args.trigger,
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
