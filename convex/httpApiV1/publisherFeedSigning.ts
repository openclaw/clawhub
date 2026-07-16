import {
  normalizePublisherFeedQuery,
  PublisherFeedChangePageSchema,
  PublisherFeedQueryPageSchema,
  PublisherFeedResetRequiredSchema,
  parsePublisherFeed,
  publisherFeedId,
  type PublisherFeedQuery,
} from "clawhub-schema";
import type { FeedSigningConfig } from "./catalogFeedSigning";
import { signFeedPayload } from "./catalogFeedSigning";

export const PUBLISHER_FEED_QUERY_PAYLOAD_TYPE = "openclaw.clawhub-publisher-feed-query-results.v1";
export const PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE = "openclaw.clawhub-publisher-feed-changes.v1";
export const PUBLISHER_FEED_SNAPSHOT_PAYLOAD_TYPE = "openclaw.clawhub-publisher-feed-snapshot.v1";
const PUBLISHER_FEED_CURSOR_PAYLOAD_TYPE = "openclaw.clawhub-publisher-feed-cursor.v1";

const CURSOR_MAX_LENGTH = 4096;

type CursorBase = {
  schemaVersion: 1;
  publisherId: string;
  feedId: string;
  offset: number;
  limit: number;
  pageIndex: number;
  generatedAt: string;
  expiresAt: string;
};

export type PublisherQueryCursor = CursorBase & {
  operation: "query";
  sequence: number;
  query: PublisherFeedQuery;
};

export type PublisherChangesCursor = CursorBase & {
  operation: "changes";
  fromSequence: number;
  toSequence: number;
};

export type PublisherProjectionCursor = PublisherQueryCursor | PublisherChangesCursor;

const PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES = 400;

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url value");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]) {
  return Object.keys(record).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function assertPublisherFeedSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid publisher feed snapshot");
  }
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      "schemaVersion",
      "feedId",
      "publisherId",
      "handle",
      "displayName",
      "generatedAt",
      "expiresAt",
      "sequence",
      "entries",
    ]) ||
    typeof record.expiresAt !== "string"
  ) {
    throw new Error("Invalid publisher feed snapshot");
  }
  const { expiresAt, ...feed } = record;
  const parsed = parsePublisherFeed({ ...feed, nextCursor: null });
  if (
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.parse(parsed.generatedAt) ||
    parsed.entries.length > PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES
  ) {
    throw new Error("Invalid publisher feed snapshot bounds");
  }
  const identities = new Set<string>();
  for (const entry of parsed.entries) {
    const identity = `${entry.kind}\0${entry.id}`;
    if (identities.has(identity)) {
      throw new Error("Invalid publisher feed snapshot duplicate entry");
    }
    identities.add(identity);
  }
}

function parseCursorPayload(value: unknown): PublisherProjectionCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const operation = record.operation;
  const commonKeys = [
    "schemaVersion",
    "operation",
    "publisherId",
    "feedId",
    "offset",
    "limit",
    "pageIndex",
    "generatedAt",
    "expiresAt",
  ];
  const operationKeys =
    operation === "query"
      ? ["sequence", "query"]
      : operation === "changes"
        ? ["fromSequence", "toSequence"]
        : null;
  if (!operationKeys || !hasExactKeys(record, [...commonKeys, ...operationKeys])) return null;
  if (
    record.schemaVersion !== 1 ||
    typeof record.publisherId !== "string" ||
    !record.publisherId ||
    typeof record.feedId !== "string" ||
    record.feedId !== publisherFeedId(record.publisherId) ||
    !isSafeNonNegativeInteger(record.offset) ||
    !isSafeNonNegativeInteger(record.pageIndex) ||
    typeof record.limit !== "number" ||
    !Number.isSafeInteger(record.limit) ||
    record.limit < 1 ||
    typeof record.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.generatedAt)) ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    Date.parse(record.expiresAt) <= Date.parse(record.generatedAt)
  ) {
    return null;
  }
  if (operation === "query") {
    if (!isSafeNonNegativeInteger(record.sequence)) return null;
    try {
      const query = normalizePublisherFeedQuery(record.query);
      if (JSON.stringify(query) !== JSON.stringify(record.query)) return null;
      return { ...(record as Omit<PublisherQueryCursor, "query">), query };
    } catch {
      return null;
    }
  }
  if (
    !isSafeNonNegativeInteger(record.fromSequence) ||
    !isSafeNonNegativeInteger(record.toSequence) ||
    record.toSequence < record.fromSequence
  ) {
    return null;
  }
  return record as PublisherChangesCursor;
}

export async function encodePublisherProjectionCursor(
  cursor: PublisherProjectionCursor,
  config: FeedSigningConfig,
) {
  const payload = JSON.stringify(cursor);
  const signed = await signFeedPayload(PUBLISHER_FEED_CURSOR_PAYLOAD_TYPE, payload, config);
  const encoded = base64UrlEncode(new TextEncoder().encode(signed.body));
  if (encoded.length > CURSOR_MAX_LENGTH) throw new Error("Publisher feed cursor is too large");
  return encoded;
}

export async function decodePublisherProjectionCursor(
  raw: string,
  config: FeedSigningConfig,
): Promise<PublisherProjectionCursor | null> {
  if (!raw || raw.length > CURSOR_MAX_LENGTH) return null;
  try {
    const envelopeBody = new TextDecoder().decode(base64UrlDecode(raw));
    const envelope = JSON.parse(envelopeBody) as Record<string, unknown>;
    if (
      !hasExactKeys(envelope, ["schemaVersion", "payloadType", "payload", "signatures"]) ||
      envelope.schemaVersion !== 1 ||
      envelope.payloadType !== PUBLISHER_FEED_CURSOR_PAYLOAD_TYPE ||
      typeof envelope.payload !== "string" ||
      !Array.isArray(envelope.signatures) ||
      envelope.signatures.length !== 1
    ) {
      return null;
    }
    const payload = new TextDecoder().decode(base64UrlDecode(envelope.payload));
    const expected = await signFeedPayload(PUBLISHER_FEED_CURSOR_PAYLOAD_TYPE, payload, config);
    if (!timingSafeEqual(expected.body, envelopeBody)) return null;
    return parseCursorPayload(JSON.parse(payload));
  } catch {
    return null;
  }
}

export async function signedPublisherProjectionResponse(
  payloadType:
    | typeof PUBLISHER_FEED_SNAPSHOT_PAYLOAD_TYPE
    | typeof PUBLISHER_FEED_QUERY_PAYLOAD_TYPE
    | typeof PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE,
  payload: unknown,
  config: FeedSigningConfig,
  status = 200,
  additionalHeaders?: HeadersInit,
) {
  if (payloadType === PUBLISHER_FEED_SNAPSHOT_PAYLOAD_TYPE) {
    assertPublisherFeedSnapshot(payload);
  } else if (payloadType === PUBLISHER_FEED_QUERY_PAYLOAD_TYPE) {
    PublisherFeedQueryPageSchema.assert(payload);
  } else if ((payload as { resetRequired?: unknown }).resetRequired === true) {
    PublisherFeedResetRequiredSchema.assert(payload);
  } else {
    PublisherFeedChangePageSchema.assert(payload);
  }
  const signed = await signFeedPayload(payloadType, JSON.stringify(payload), config);
  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", "application/vnd.dsse+json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-SHA256", signed.sha256);
  headers.set("X-OpenClaw-Feed-Signing-Key-ID", config.keyId);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(signed.body, {
    status,
    headers,
  });
}
