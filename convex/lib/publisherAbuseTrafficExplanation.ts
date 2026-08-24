import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const PUBLISHER_ABUSE_TRAFFIC_EXPLANATION_MAX_LENGTH = 3_000;
export const PUBLISHER_ABUSE_SIGNAL_COMMUNICATION_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const TRAFFIC_EXPLANATION_TOKEN_BYTES = 32;
const TRAFFIC_EXPLANATION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const TRAFFIC_EXPLANATION_TOKEN_SECRET_PATTERN = /^[a-f0-9]{64}$/;

export const publisherAbuseTrafficExplanationKindValidator = v.union(
  v.literal("expected"),
  v.literal("not_recognized"),
  v.literal("unsure"),
);

export function publisherAbuseSignalCommunicationExpirationTime(activityAt: number) {
  return activityAt + PUBLISHER_ABUSE_SIGNAL_COMMUNICATION_RETENTION_MS;
}

export async function getPublisherAbuseSignalCommunication(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  signalId: Id<"publisherAbuseSignals">,
) {
  return await ctx.db
    .query("publisherAbuseSignalCommunications")
    .withIndex("by_signal_id", (q) => q.eq("signalId", signalId))
    .unique();
}

export async function createPublisherAbuseTrafficExplanationToken(args: {
  signalId: string;
  requestedAt: number;
  secret: string;
}): Promise<{
  token: string;
  tokenHash: string;
}> {
  if (!TRAFFIC_EXPLANATION_TOKEN_SECRET_PATTERN.test(args.secret)) {
    throw new Error("Traffic explanation token secret must be a 256-bit lowercase hex value");
  }
  const secretBytes = Uint8Array.from(args.secret.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  if (secretBytes.byteLength !== TRAFFIC_EXPLANATION_TOKEN_BYTES) {
    throw new Error("Traffic explanation token secret must be 256 bits");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const caseIdentity = JSON.stringify([
    "publisher-abuse-traffic-explanation.v1",
    args.signalId,
    args.requestedAt,
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(caseIdentity));
  const token = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    token,
    tokenHash: await hashPublisherAbuseTrafficExplanationToken(token),
  };
}

export function truncatePublisherAbuseResponsePreview(value: string, maxLength = 500): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;

  let end = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    value,
  )) {
    if (end + segment.length > maxLength) break;
    end += segment.length;
  }
  return value.slice(0, end);
}

export async function hashPublisherAbuseTrafficExplanationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function matchesPublisherAbuseTrafficExplanationToken(
  token: string,
  expectedHash: string | undefined,
): Promise<boolean> {
  if (!expectedHash || !TRAFFIC_EXPLANATION_TOKEN_PATTERN.test(token)) return false;
  const actualHash = await hashPublisherAbuseTrafficExplanationToken(token);
  if (actualHash.length !== expectedHash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    mismatch |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return mismatch === 0;
}
