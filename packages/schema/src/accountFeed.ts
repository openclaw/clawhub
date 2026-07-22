import { type inferred, type } from "arktype";

export const PUBLISHER_FEED_SCHEMA_VERSION = 1;
export const PUBLISHER_FEED_DEFAULT_LIMIT = 50;
export const PUBLISHER_FEED_MAX_LIMIT = 100;
export const PUBLISHER_FEED_QUERY_MAX_LIMIT = 200;
export const PUBLISHER_FEED_CHANGE_MAX_LIMIT = 500;

export const PublisherFeedEntryKindSchema = type('"skill"|"plugin"');
export type PublisherFeedEntryKind = (typeof PublisherFeedEntryKindSchema)[inferred];

export const PublisherFeedEntrySchema = type({
  "+": "reject",
  kind: PublisherFeedEntryKindSchema,
  id: "string",
  name: "string",
  displayName: "string",
  summary: "string|null",
  url: "string",
  updatedAt: "number",
});
export type PublisherFeedEntry = (typeof PublisherFeedEntrySchema)[inferred];

export const PublisherFeedSchema = type({
  "+": "reject",
  schemaVersion: "number",
  feedId: "string",
  publisherId: "string",
  handle: "string|null",
  displayName: "string",
  generatedAt: "string",
  sequence: "number",
  entries: PublisherFeedEntrySchema.array(),
  nextCursor: "string|null",
});
export type PublisherFeed = (typeof PublisherFeedSchema)[inferred];

export const PublisherFeedQuerySchema = type({
  "+": "reject",
  text: "string?",
  kinds: PublisherFeedEntryKindSchema.array().optional(),
});
export type PublisherFeedQuery = (typeof PublisherFeedQuerySchema)[inferred];

export const PublisherFeedMetadataSchema = type({
  "+": "reject",
  publisherId: "string",
  handle: "string|null",
  displayName: "string",
});
export type PublisherFeedMetadata = (typeof PublisherFeedMetadataSchema)[inferred];

export const PublisherFeedUpsertChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"upsert"',
  entry: PublisherFeedEntrySchema,
});
export const PublisherFeedRemoveChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"remove"',
  entryId: "string",
  entryKind: PublisherFeedEntryKindSchema,
});
export const PublisherFeedMetadataChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"metadata"',
  metadata: PublisherFeedMetadataSchema,
});
export const PublisherFeedChangeSchema = type(
  PublisherFeedUpsertChangeSchema.or(PublisherFeedRemoveChangeSchema).or(
    PublisherFeedMetadataChangeSchema,
  ),
);
export type PublisherFeedChange = (typeof PublisherFeedChangeSchema)[inferred];

export const PublisherFeedQueryPageSchema = type({
  "+": "reject",
  schemaVersion: "number",
  feedId: "string",
  sequence: "number",
  generatedAt: "string",
  expiresAt: "string",
  query: PublisherFeedQuerySchema,
  requestCursor: "string|null",
  pageIndex: "number",
  startIndex: "number",
  resultCount: "number",
  entries: PublisherFeedEntrySchema.array(),
  nextCursor: "string|null",
});
export type PublisherFeedQueryPage = (typeof PublisherFeedQueryPageSchema)[inferred];

export const PublisherFeedChangePageSchema = type({
  "+": "reject",
  schemaVersion: "number",
  feedId: "string",
  fromSequence: "number",
  toSequence: "number",
  generatedAt: "string",
  expiresAt: "string",
  requestCursor: "string|null",
  pageIndex: "number",
  startIndex: "number",
  changeCount: "number",
  changes: PublisherFeedChangeSchema.array(),
  nextCursor: "string|null",
});
export type PublisherFeedChangePage = (typeof PublisherFeedChangePageSchema)[inferred];

export const PublisherFeedResetRequiredSchema = type({
  "+": "reject",
  schemaVersion: "number",
  feedId: "string",
  fromSequence: "number",
  currentSequence: "number",
  generatedAt: "string",
  expiresAt: "string",
  resetRequired: "true",
  snapshotUrl: "string",
});
export type PublisherFeedResetRequired = (typeof PublisherFeedResetRequiredSchema)[inferred];

export function publisherFeedId(publisherId: string) {
  return `clawhub.publisher.${publisherId}`;
}

function normalizeQueryTextWhitespace(value: string) {
  let result = "";
  let pendingSpace = false;
  for (const character of value.normalize("NFC")) {
    const codePoint = character.codePointAt(0)!;
    if ((codePoint >= 0x09 && codePoint <= 0x0d) || codePoint === 0x20) {
      pendingSpace = result.length > 0;
      continue;
    }
    if (pendingSpace) result += " ";
    result += character;
    pendingSpace = false;
  }
  return result;
}

export function normalizePublisherFeedQuery(value: unknown): PublisherFeedQuery {
  const query = PublisherFeedQuerySchema.assert(value);
  const normalized: PublisherFeedQuery = {};
  if (query.text !== undefined) {
    const text = normalizeQueryTextWhitespace(query.text);
    if (!text || new TextEncoder().encode(text).length > 256) {
      throw new Error("Publisher feed query text must be between 1 and 256 UTF-8 bytes");
    }
    normalized.text = text;
  }
  if (query.kinds !== undefined) {
    const kinds = [...new Set(query.kinds)].sort();
    if (kinds.length === 0) throw new Error("Publisher feed query kinds must not be empty");
    normalized.kinds = kinds;
  }
  if (normalized.text === undefined && normalized.kinds === undefined) {
    throw new Error("Publisher feed query must include text or kinds");
  }
  return normalized;
}

function containsAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export function parsePublisherFeed(value: unknown): PublisherFeed {
  const feed = PublisherFeedSchema.assert(value);
  if (feed.schemaVersion !== PUBLISHER_FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported publisher feed schema version: ${feed.schemaVersion}`);
  }
  if (!feed.publisherId || feed.feedId !== publisherFeedId(feed.publisherId)) {
    throw new Error("Publisher feed id does not match its stable publisher identity");
  }
  if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
    throw new Error("Publisher feed sequence must be a non-negative integer");
  }
  if (!Number.isFinite(Date.parse(feed.generatedAt))) {
    throw new Error("Publisher feed generatedAt must be a valid ISO date");
  }
  for (const entry of feed.entries) {
    if (!entry.id || !entry.name || !entry.displayName) {
      throw new Error("Publisher feed entry identity fields must be non-empty");
    }
    if (!Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) {
      throw new Error("Publisher feed entry updatedAt must be a non-negative finite number");
    }
    if (entry.url.startsWith("/")) {
      if (
        entry.url.startsWith("//") ||
        entry.url.includes("\\") ||
        containsAsciiControlCharacter(entry.url)
      ) {
        throw new Error("Publisher feed entry URL must be a safe origin-relative reference");
      }
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      throw new Error("Publisher feed entry URL must be absolute HTTPS or origin-relative");
    }
    if (url.protocol !== "https:") {
      throw new Error("Publisher feed entry URL must be absolute HTTPS or origin-relative");
    }
  }
  return feed;
}
