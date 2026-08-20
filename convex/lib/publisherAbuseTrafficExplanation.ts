import { v } from "convex/values";

export const PUBLISHER_ABUSE_TRAFFIC_EXPLANATION_MAX_LENGTH = 3_000;
const TRAFFIC_EXPLANATION_TOKEN_BYTES = 32;
const TRAFFIC_EXPLANATION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export const publisherAbuseTrafficExplanationKindValidator = v.union(
  v.literal("expected"),
  v.literal("not_recognized"),
  v.literal("unsure"),
);

export async function createPublisherAbuseTrafficExplanationToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(TRAFFIC_EXPLANATION_TOKEN_BYTES));
  const token = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
