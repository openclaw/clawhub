import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import {
  PUBLISHER_ABUSE_TRAFFIC_EXPLANATION_MAX_LENGTH,
  matchesPublisherAbuseTrafficExplanationToken,
  publisherAbuseTrafficExplanationKindValidator,
} from "./lib/publisherAbuseTrafficExplanation";
import {
  assertCanManageOwnedResource,
  isPublisherActive,
  type PublisherRole,
} from "./lib/publishers";

const TRAFFIC_EXPLANATION_PUBLISHER_ROLES = ["admin"] satisfies PublisherRole[];
const TRAFFIC_EXPLANATION_RECIPIENT_LIMIT = 20;
const MAX_SAFE_DELIVERY_REASON_LENGTH = 500;

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

async function insertCommunicationAudit(
  ctx: Pick<MutationCtx, "db">,
  args: {
    signalId: Id<"publisherAbuseSignals">;
    action: string;
    createdAt: number;
    actorUserId?: Id<"users">;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.db.insert("auditLogs", {
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    action: args.action,
    targetType: "publisherAbuseSignal",
    targetId: args.signalId,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    createdAt: args.createdAt,
  });
}

function signalStillBelongsToSkill(signal: Doc<"publisherAbuseSignals">, skill: Doc<"skills">) {
  const signalPublisherId = signal.ownerPublisherId ?? null;
  const currentPublisherId = skill.ownerPublisherId ?? null;
  if (signalPublisherId !== currentPublisherId) return false;
  return currentPublisherId !== null || signal.ownerUserId === skill.ownerUserId;
}

async function canManageTrafficExplanation(ctx: DbCtx, user: Doc<"users">, skill: Doc<"skills">) {
  try {
    await assertCanManageOwnedResource(ctx, {
      actor: user,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowedPublisherRoles: TRAFFIC_EXPLANATION_PUBLISHER_ROLES,
    });
    return true;
  } catch (error) {
    if (error instanceof ConvexError) return false;
    throw error;
  }
}

async function getTrafficExplanationForUser(
  ctx: DbCtx,
  signalId: Id<"publisherAbuseSignals">,
  user: Doc<"users">,
  token: string,
) {
  const signal = await ctx.db.get(signalId);
  if (!signal?.trafficExplanationRequest) return null;
  if (
    !(await matchesPublisherAbuseTrafficExplanationToken(
      token,
      signal.trafficExplanationRequest.tokenHash,
    ))
  ) {
    return null;
  }
  const skill = await ctx.db.get(signal.skillId);
  if (!skill || !signalStillBelongsToSkill(signal, skill)) return null;
  if (!(await canManageTrafficExplanation(ctx, user, skill))) return null;
  return { signal, skill };
}

export const getForOwner = query({
  args: { signalId: v.string(), token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const signalId = ctx.db.normalizeId("publisherAbuseSignals", args.signalId);
    if (!signalId) return null;
    const result = await getTrafficExplanationForUser(ctx, signalId, user, args.token);
    if (!result) return null;

    return {
      signalId: result.signal._id,
      scope:
        result.signal.signalType === "owner_synchronized_download_trends"
          ? ("publisher" as const)
          : ("skill" as const),
      skillDisplayName: result.signal.skillDisplayName,
      skillSlug: result.signal.skillSlug,
      publisherHandle: result.signal.handleSnapshot,
      allPublisherSkills: result.signal.portfolioEvidence?.allPublisherSkills ?? false,
      response: result.signal.trafficExplanationResponse ?? null,
    };
  },
});

export const submit = mutation({
  args: {
    signalId: v.string(),
    token: v.string(),
    kind: publisherAbuseTrafficExplanationKindValidator,
    message: v.optional(v.string()),
  },
  returns: v.object({ ok: v.literal(true), submittedAt: v.number() }),
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    const signalId = ctx.db.normalizeId("publisherAbuseSignals", args.signalId);
    if (!signalId) throw new ConvexError("Traffic explanation request not found");
    const result = await getTrafficExplanationForUser(ctx, signalId, user, args.token);
    if (!result) throw new ConvexError("Traffic explanation request not found");
    if (result.signal.trafficExplanationResponse) {
      throw new ConvexError("A response has already been submitted for this traffic request");
    }

    const message = args.message?.trim();
    if (message && message.length > PUBLISHER_ABUSE_TRAFFIC_EXPLANATION_MAX_LENGTH) {
      throw new ConvexError(
        `Explanation must be ${PUBLISHER_ABUSE_TRAFFIC_EXPLANATION_MAX_LENGTH.toLocaleString()} characters or fewer`,
      );
    }
    if (args.kind === "expected" && !message) {
      throw new ConvexError("Please tell us what may have caused the traffic");
    }

    const submittedAt = Date.now();
    await ctx.db.patch(signalId, {
      trafficExplanationResponse: {
        kind: args.kind,
        ...(message ? { message } : {}),
        submittedAt,
        submittedByUserId: userId,
      },
      needsAttention: true,
      attentionState: "needs_attention",
      notificationEventKind: "publisher_abuse_signal_owner_response_submitted",
      notificationState: "queued",
      notificationAttemptCount: 0,
      notificationLatestAttemptAt: undefined,
      notificationDeliveredAt: undefined,
      needsNotification: true,
      notificationClaimedAt: undefined,
      lastNotificationError: undefined,
      lastChangedAt: submittedAt,
    });
    await insertCommunicationAudit(ctx, {
      actorUserId: userId,
      action: "publisher_abuse.signal.traffic_explanation_submitted",
      signalId,
      metadata: {
        skillId: result.signal.skillId,
        responseKind: args.kind,
      },
      createdAt: submittedAt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.publisherAbuse.notifyPublisherAbuseSignalChangesInternal,
      {},
    );

    return { ok: true as const, submittedAt };
  },
});

type EmailRecipient = {
  user: Doc<"users">;
  email: string;
};

async function activeEmailUser(
  ctx: DbCtx,
  userId: Id<"users"> | null | undefined,
): Promise<EmailRecipient | null> {
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  const email = user?.email?.trim();
  if (!user || user.deletedAt || user.deactivatedAt || !email) return null;
  if (user.role === "admin" || user.role === "moderator") return null;
  return { user, email };
}

async function findOrganizationRecipient(ctx: DbCtx, publisherId: Id<"publishers">) {
  for (const role of ["owner", "admin"] as const) {
    const members = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_and_role", (q) => q.eq("publisherId", publisherId).eq("role", role))
      .take(TRAFFIC_EXPLANATION_RECIPIENT_LIMIT);
    for (const member of members) {
      const user = await activeEmailUser(ctx, member.userId);
      if (user) return user;
    }
  }
  return null;
}

export async function getEmailContextInternalHandler(
  ctx: DbCtx,
  args: { signalId: Id<"publisherAbuseSignals"> },
) {
  const signal = await ctx.db.get(args.signalId);
  if (!signal?.trafficExplanationRequest || signal.trafficExplanationRequest.sentAt) return null;
  if (
    signal.trafficExplanationRequest.state === "cancelled" ||
    signal.trafficExplanationRequest.state === "not_deliverable"
  ) {
    return null;
  }
  const requestedAt = signal.trafficExplanationRequest.requestedAt;
  if (signal.trafficExplanationResponse) {
    return { kind: "skip" as const, requestedAt, reason: "owner_already_responded" };
  }
  if (signal.reviewStatus !== "open") {
    return { kind: "skip" as const, requestedAt, reason: "signal_no_longer_open" };
  }

  const skill = await ctx.db.get(signal.skillId);
  if (!skill || !signalStillBelongsToSkill(signal, skill)) {
    return { kind: "skip" as const, requestedAt, reason: "skill_owner_changed" };
  }

  let recipient: EmailRecipient | null = null;
  let publisherHandle = signal.handleSnapshot;
  if (signal.ownerPublisherId) {
    const publisher = await ctx.db.get(signal.ownerPublisherId);
    if (!publisher || !isPublisherActive(publisher)) {
      return { kind: "skip" as const, requestedAt, reason: "publisher_unavailable" };
    }
    publisherHandle = publisher.handle;
    recipient =
      publisher.kind === "user"
        ? await activeEmailUser(ctx, publisher.linkedUserId ?? skill.ownerUserId)
        : await findOrganizationRecipient(ctx, publisher._id);
  } else {
    recipient = await activeEmailUser(ctx, signal.ownerUserId ?? skill.ownerUserId);
  }
  if (!recipient) {
    return { kind: "skip" as const, requestedAt, reason: "owner_email_unavailable" };
  }

  return {
    kind: "send" as const,
    requestedAt,
    recipientUserId: recipient.user._id,
    to: recipient.email,
    handle: recipient.user.handle,
    publisherHandle,
    skillDisplayName: signal.skillDisplayName,
    skillSlug: signal.skillSlug,
    scope:
      signal.signalType === "owner_synchronized_download_trends"
        ? ("publisher" as const)
        : ("skill" as const),
    allPublisherSkills: signal.portfolioEvidence?.allPublisherSkills ?? false,
    attemptCount: signal.trafficExplanationRequest.attemptCount ?? 0,
  };
}

export const getEmailContextInternal = internalQuery({
  args: { signalId: v.id("publisherAbuseSignals") },
  returns: v.any(),
  handler: getEmailContextInternalHandler,
});

export const beginDeliveryAttemptInternal = internalMutation({
  args: {
    signalId: v.id("publisherAbuseSignals"),
    requestedAt: v.number(),
    attemptedAt: v.number(),
    expectedAttemptCount: v.number(),
    tokenHash: v.string(),
    recipientUserId: v.id("users"),
    recipientEmail: v.string(),
    subject: v.string(),
    templateVersion: v.string(),
    reasonBullets: v.array(v.string()),
    redactedTextSnapshot: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const signal = await ctx.db.get(args.signalId);
    const request = signal?.trafficExplanationRequest;
    if (
      !signal ||
      !request ||
      request.requestedAt !== args.requestedAt ||
      (request.attemptCount ?? 0) !== args.expectedAttemptCount ||
      request.sentAt ||
      request.state === "cancelled" ||
      request.state === "not_deliverable"
    ) {
      return { ok: false as const, reason: "stale_request" as const };
    }
    const currentEmailContext = await getEmailContextInternalHandler(ctx, {
      signalId: args.signalId,
    });
    if (
      currentEmailContext?.kind !== "send" ||
      currentEmailContext.recipientUserId !== args.recipientUserId ||
      currentEmailContext.to !== args.recipientEmail
    ) {
      return { ok: false as const, reason: "owner_changed" as const };
    }
    const attemptCount = (request.attemptCount ?? 0) + 1;
    await ctx.db.patch(args.signalId, {
      trafficExplanationRequest: {
        ...request,
        tokenHash: args.tokenHash,
        state: attemptCount === 1 ? "queued" : "retrying",
        latestAttemptAt: args.attemptedAt,
        attemptCount,
        recipientUserId: args.recipientUserId,
        recipientEmail: args.recipientEmail,
        subject: args.subject,
        templateVersion: args.templateVersion,
        reasonBullets: args.reasonBullets,
        redactedTextSnapshot: args.redactedTextSnapshot,
        deliveryError: undefined,
      },
      contactState: attemptCount === 1 ? "queued" : "retrying",
      attentionState: "not_contacted",
      needsAttention: false,
    });
    await insertCommunicationAudit(ctx, {
      signalId: args.signalId,
      action: "publisher_abuse.signal.owner_contact_attempted",
      createdAt: args.attemptedAt,
      metadata: { attemptCount, recipientUserId: args.recipientUserId },
    });
    return { ok: true as const, attemptCount };
  },
});

export const recordDeliveryInternal = internalMutation({
  args: {
    signalId: v.id("publisherAbuseSignals"),
    requestedAt: v.number(),
    delivery: v.union(
      v.object({
        status: v.literal("sent"),
        sentAt: v.number(),
        providerId: v.union(v.string(), v.null()),
      }),
      v.object({
        status: v.union(
          v.literal("retrying"),
          v.literal("cancelled"),
          v.literal("not_deliverable"),
        ),
        recordedAt: v.number(),
        reason: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const signal = await ctx.db.get(args.signalId);
    const request = signal?.trafficExplanationRequest;
    if (!signal || !request || request.requestedAt !== args.requestedAt || request.sentAt) {
      return { ok: false as const, reason: "stale_request" as const };
    }

    if (args.delivery.status === "sent") {
      await ctx.db.patch(args.signalId, {
        trafficExplanationRequest: {
          ...request,
          state: "sent",
          sentAt: args.delivery.sentAt,
          providerId: args.delivery.providerId ?? undefined,
          deliveryError: undefined,
        },
        contactState: "sent",
        attentionState: "awaiting_owner",
        needsAttention: false,
      });
      await insertCommunicationAudit(ctx, {
        signalId: args.signalId,
        action: "publisher_abuse.signal.owner_contact_sent",
        createdAt: args.delivery.sentAt,
        metadata: {
          attemptCount: request.attemptCount ?? 1,
          recipientUserId: request.recipientUserId,
          providerId: args.delivery.providerId,
        },
      });
      return { ok: true as const, attemptCount: request.attemptCount ?? 1 };
    }

    const reason = args.delivery.reason.slice(0, MAX_SAFE_DELIVERY_REASON_LENGTH);
    const terminal = args.delivery.status !== "retrying";
    const notDeliverable = args.delivery.status === "not_deliverable";
    await ctx.db.patch(args.signalId, {
      trafficExplanationRequest: {
        ...request,
        state: args.delivery.status,
        tokenHash: terminal ? undefined : request.tokenHash,
        deliveryError: reason,
      },
      contactState: args.delivery.status,
      attentionState: notDeliverable ? "contact_failed" : terminal ? "none" : "not_contacted",
      needsAttention: notDeliverable,
      ...(notDeliverable
        ? {
            notificationEventKind: "publisher_abuse_signal_owner_contact_failed" as const,
            notificationState: "queued" as const,
            notificationAttemptCount: 0,
            notificationLatestAttemptAt: undefined,
            notificationDeliveredAt: undefined,
            needsNotification: true,
            notificationClaimedAt: undefined,
            lastNotificationError: undefined,
            lastChangedAt: args.delivery.recordedAt,
          }
        : {}),
    });
    await insertCommunicationAudit(ctx, {
      signalId: args.signalId,
      action:
        args.delivery.status === "retrying"
          ? "publisher_abuse.signal.owner_contact_retrying"
          : args.delivery.status === "cancelled"
            ? "publisher_abuse.signal.owner_contact_cancelled"
            : "publisher_abuse.signal.owner_contact_not_deliverable",
      createdAt: args.delivery.recordedAt,
      metadata: { attemptCount: request.attemptCount ?? 0, reason },
    });
    if (notDeliverable) {
      await ctx.scheduler.runAfter(
        0,
        internal.publisherAbuse.notifyPublisherAbuseSignalChangesInternal,
        {},
      );
    }
    return { ok: true as const };
  },
});
