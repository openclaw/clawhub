import { type inferred, type } from "arktype";
import {
  CatalogFeedEntrySchema,
  CatalogFeedStateSchema,
  CATALOG_FEED_SCHEMA_VERSION,
} from "./catalogFeed.js";

export const CATALOG_FEED_QUERY_PAYLOAD_TYPE =
  "openclaw.official-external-plugin-catalog-query-results.v1";
export const CATALOG_FEED_CHANGES_PAYLOAD_TYPE =
  "openclaw.official-external-plugin-catalog-changes.v1";
export const CATALOG_FEED_QUERY_MAX_ENTRIES = 200;
export const CATALOG_FEED_CHANGES_MAX_RECORDS = 500;
export const CATALOG_FEED_DESCRIPTION_MAX_BYTES = 1_024;

export const CatalogFeedQuerySchema = type({
  "+": "reject",
  text: "string?",
  types: type('"plugin"|"skill"').array().optional(),
  states: CatalogFeedStateSchema.array().optional(),
  publisherIds: type("string").array().optional(),
});
export type CatalogFeedQuery = (typeof CatalogFeedQuerySchema)[inferred];

export const CatalogFeedMetadataSchema = type({
  "+": "reject",
  description: "string|null",
});
export type CatalogFeedMetadata = (typeof CatalogFeedMetadataSchema)[inferred];

export const CatalogFeedUpsertChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"upsert"',
  entry: CatalogFeedEntrySchema,
});
export const CatalogFeedRemoveChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"remove"',
  entryId: "string",
  entryType: '"plugin"|"skill"',
});
export const CatalogFeedMetadataChangeSchema = type({
  "+": "reject",
  sequence: "number",
  operation: '"metadata"',
  metadata: CatalogFeedMetadataSchema,
});
export const CatalogFeedChangeSchema = type(
  CatalogFeedUpsertChangeSchema.or(CatalogFeedRemoveChangeSchema).or(
    CatalogFeedMetadataChangeSchema,
  ),
);
export type CatalogFeedChange = (typeof CatalogFeedChangeSchema)[inferred];

export const CatalogFeedQueryPageSchema = type({
  "+": "reject",
  schemaVersion: "number",
  feedId: "string",
  sequence: "number",
  generatedAt: "string",
  expiresAt: "string",
  query: CatalogFeedQuerySchema,
  requestCursor: "string|null",
  pageIndex: "number",
  startIndex: "number",
  resultCount: "number",
  entries: CatalogFeedEntrySchema.array(),
  nextCursor: "string|null",
});
export type CatalogFeedQueryPage = (typeof CatalogFeedQueryPageSchema)[inferred];

export const CatalogFeedChangePageSchema = type({
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
  changes: CatalogFeedChangeSchema.array(),
  nextCursor: "string|null",
});
export type CatalogFeedChangePage = (typeof CatalogFeedChangePageSchema)[inferred];

export const CatalogFeedResetRequiredSchema = type({
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
export type CatalogFeedResetRequired = (typeof CatalogFeedResetRequiredSchema)[inferred];

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

function requireBoundedString(value: string, name: string, maxBytes: number) {
  const length = utf8Length(value);
  if (length < 1 || length > maxBytes) {
    throw new Error(`${name} must be between 1 and ${maxBytes} UTF-8 bytes`);
  }
}

function requireNonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function requireValidWindow(generatedAt: string, expiresAt: string) {
  requireBoundedString(generatedAt, "Catalog feed projection generatedAt", 64);
  requireBoundedString(expiresAt, "Catalog feed projection expiresAt", 64);
  const isRfc3339Instant = (value: string) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(
        value,
      );
    if (!match) return false;
    const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
      match[1],
      match[2],
      match[3],
      match[4],
      match[5],
      match[6],
      match[8] ?? "0",
      match[9] ?? "0",
    ].map(Number);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= daysInMonth[month - 1]! &&
      hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      (offsetHour === 0 || (offsetHour <= 23 && offsetMinute <= 59)) &&
      Number.isFinite(Date.parse(value))
    );
  };
  if (!isRfc3339Instant(generatedAt) || !isRfc3339Instant(expiresAt)) {
    throw new Error("Catalog feed projection timestamps must use RFC 3339 syntax");
  }
  const generatedAtMs = Date.parse(generatedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new Error("Catalog feed projection timestamps must be valid dates");
  }
  if (expiresAtMs <= generatedAtMs) {
    throw new Error("Catalog feed projection expiresAt must be after generatedAt");
  }
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

function sortedUnique(values: readonly string[]) {
  const encoder = new TextEncoder();
  const compareUtf8 = (left: string, right: string) => {
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
      const difference = leftBytes[index]! - rightBytes[index]!;
      if (difference !== 0) return difference;
    }
    return leftBytes.length - rightBytes.length;
  };
  return [...new Set(values)].sort(compareUtf8);
}

export function normalizeCatalogFeedQuery(value: unknown): CatalogFeedQuery {
  const query = CatalogFeedQuerySchema.assert(value);
  const normalized: CatalogFeedQuery = {};
  if (query.text !== undefined) {
    const text = normalizeQueryTextWhitespace(query.text);
    requireBoundedString(text, "Catalog feed query text", 256);
    normalized.text = text;
  }
  if (query.types !== undefined) {
    const types = sortedUnique(query.types) as NonNullable<CatalogFeedQuery["types"]>;
    if (types.length === 0) throw new Error("Catalog feed query types must not be empty");
    normalized.types = types;
  }
  if (query.states !== undefined) {
    const states = sortedUnique(query.states) as NonNullable<CatalogFeedQuery["states"]>;
    if (states.length === 0) throw new Error("Catalog feed query states must not be empty");
    normalized.states = states;
  }
  if (query.publisherIds !== undefined) {
    const publisherIds = sortedUnique(query.publisherIds);
    if (publisherIds.length < 1 || publisherIds.length > 100) {
      throw new Error("Catalog feed query publisherIds must contain between 1 and 100 values");
    }
    for (const publisherId of publisherIds) {
      requireBoundedString(publisherId, "Catalog feed publisher id", 256);
    }
    normalized.publisherIds = publisherIds;
  }
  if (Object.keys(normalized).length === 0) {
    throw new Error("Catalog feed query must include at least one filter");
  }
  return normalized;
}

function queriesEqual(left: CatalogFeedQuery, right: CatalogFeedQuery) {
  const arraysEqual = (first?: readonly string[], second?: readonly string[]) =>
    first === undefined
      ? second === undefined
      : second !== undefined &&
        first.length === second.length &&
        first.every((value, index) => value === second[index]);
  return (
    left.text === right.text &&
    arraysEqual(left.types, right.types) &&
    arraysEqual(left.states, right.states) &&
    arraysEqual(left.publisherIds, right.publisherIds)
  );
}

function requireProjectionHeader(value: {
  schemaVersion: number;
  feedId: string;
  generatedAt: string;
  expiresAt: string;
}) {
  if (value.schemaVersion !== CATALOG_FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported catalog feed projection schema version: ${value.schemaVersion}`);
  }
  requireBoundedString(value.feedId, "Catalog feed id", 256);
  requireValidWindow(value.generatedAt, value.expiresAt);
}

function requireCanonicalEntryMetadata(entry: CatalogFeedQueryPage["entries"][number]) {
  if (
    entry.featuredAt !== undefined &&
    (entry.featured !== true || !Number.isSafeInteger(entry.featuredAt) || entry.featuredAt < 0)
  ) {
    throw new Error("Catalog feed featuredAt requires a featured entry and epoch milliseconds");
  }
}

function requirePageBounds(value: {
  requestCursor: string | null;
  pageIndex: number;
  startIndex: number;
  itemCount: number;
  totalCount: number;
  nextCursor: string | null;
}) {
  requireNonNegativeInteger(value.pageIndex, "Catalog feed projection pageIndex");
  requireNonNegativeInteger(value.startIndex, "Catalog feed projection startIndex");
  requireNonNegativeInteger(value.totalCount, "Catalog feed projection total count");
  if (value.requestCursor === null && (value.pageIndex !== 0 || value.startIndex !== 0)) {
    throw new Error("Catalog feed projection first page must start at page and item index zero");
  }
  if (value.requestCursor !== null && value.pageIndex === 0) {
    throw new Error("Catalog feed projection continuation must have a positive page index");
  }
  if (value.requestCursor !== null && value.startIndex < value.pageIndex) {
    throw new Error("Catalog feed projection continuation offset cannot precede its page index");
  }
  if (value.startIndex + value.itemCount > value.totalCount) {
    throw new Error("Catalog feed projection page exceeds its declared total count");
  }
  if (value.nextCursor === null && value.startIndex + value.itemCount !== value.totalCount) {
    throw new Error("Catalog feed projection terminal page must end at its declared total count");
  }
  if (
    value.nextCursor !== null &&
    (value.itemCount === 0 || value.startIndex + value.itemCount >= value.totalCount)
  ) {
    throw new Error("Catalog feed projection continuation must make progress before total count");
  }
  if (value.nextCursor !== null && value.nextCursor === value.requestCursor) {
    throw new Error("Catalog feed projection next cursor must differ from the request cursor");
  }
  for (const cursor of [value.requestCursor, value.nextCursor]) {
    if (cursor !== null && utf8Length(cursor) > 4096) {
      throw new Error("Catalog feed projection cursor exceeds 4096 UTF-8 bytes");
    }
  }
}

export function parseCatalogFeedQueryPage(value: unknown): CatalogFeedQueryPage {
  const page = CatalogFeedQueryPageSchema.assert(value);
  requireProjectionHeader(page);
  requireNonNegativeInteger(page.sequence, "Catalog feed projection sequence");
  const normalizedQuery = normalizeCatalogFeedQuery(page.query);
  if (!queriesEqual(normalizedQuery, page.query)) {
    throw new Error("Catalog feed query page must carry the normalized query");
  }
  if (page.entries.length > CATALOG_FEED_QUERY_MAX_ENTRIES) {
    throw new Error(`Catalog feed query page exceeds ${CATALOG_FEED_QUERY_MAX_ENTRIES} entries`);
  }
  const entryKeys = new Set<string>();
  for (const entry of page.entries) {
    requireCanonicalEntryMetadata(entry);
    requireBoundedString(entry.id, "Catalog feed query entry id", 256);
    const entryKey = `${entry.type}\0${entry.id}`;
    if (entryKeys.has(entryKey)) {
      throw new Error("Catalog feed query page contains duplicate entry identities");
    }
    entryKeys.add(entryKey);
    if (page.query.types && !page.query.types.includes(entry.type)) {
      throw new Error("Catalog feed query entry does not match the requested types");
    }
    if (page.query.states && !page.query.states.includes(entry.state)) {
      throw new Error("Catalog feed query entry does not match the requested states");
    }
    if (page.query.publisherIds && !page.query.publisherIds.includes(entry.publisher.id)) {
      throw new Error("Catalog feed query entry does not match the requested publisherIds");
    }
  }
  requirePageBounds({
    requestCursor: page.requestCursor,
    pageIndex: page.pageIndex,
    startIndex: page.startIndex,
    itemCount: page.entries.length,
    totalCount: page.resultCount,
    nextCursor: page.nextCursor,
  });
  return page;
}

export function parseCatalogFeedQueryPages(values: readonly unknown[]): CatalogFeedQueryPage[] {
  if (values.length === 0) {
    throw new Error("Catalog feed query page chain must not be empty");
  }
  const pages = values.map(parseCatalogFeedQueryPage);
  const first = pages[0]!;
  if (first.requestCursor !== null || first.pageIndex !== 0 || first.startIndex !== 0) {
    throw new Error("Catalog feed query page chain must start at page and item index zero");
  }
  const entryKeys = new Set<string>();
  const consumedCursors = new Set<string>();
  let expectedStartIndex = 0;
  let expectedRequestCursor: string | null = null;
  for (const [pageIndex, page] of pages.entries()) {
    if (
      page.feedId !== first.feedId ||
      page.sequence !== first.sequence ||
      page.generatedAt !== first.generatedAt ||
      page.expiresAt !== first.expiresAt ||
      page.resultCount !== first.resultCount ||
      !queriesEqual(page.query, first.query)
    ) {
      throw new Error("Catalog feed query page chain changed its pinned projection");
    }
    if (
      page.pageIndex !== pageIndex ||
      page.startIndex !== expectedStartIndex ||
      page.requestCursor !== expectedRequestCursor
    ) {
      throw new Error("Catalog feed query page chain contains a cursor, page, or offset gap");
    }
    if (page.requestCursor !== null) {
      if (consumedCursors.has(page.requestCursor)) {
        throw new Error("Catalog feed query page chain reuses a continuation cursor");
      }
      consumedCursors.add(page.requestCursor);
    }
    for (const entry of page.entries) {
      const entryKey = `${entry.type}\0${entry.id}`;
      if (entryKeys.has(entryKey)) {
        throw new Error("Catalog feed query page chain contains duplicate entry identities");
      }
      entryKeys.add(entryKey);
    }
    expectedStartIndex += page.entries.length;
    expectedRequestCursor = page.nextCursor;
  }
  if (expectedRequestCursor !== null) {
    throw new Error("Catalog feed query page chain must include its terminal page");
  }
  return pages;
}

export function parseCatalogFeedChangePage(value: unknown): CatalogFeedChangePage {
  const page = CatalogFeedChangePageSchema.assert(value);
  requireProjectionHeader(page);
  requireNonNegativeInteger(page.fromSequence, "Catalog feed change fromSequence");
  requireNonNegativeInteger(page.toSequence, "Catalog feed change toSequence");
  if (page.toSequence < page.fromSequence) {
    throw new Error("Catalog feed change toSequence must not precede fromSequence");
  }
  if (page.changes.length > CATALOG_FEED_CHANGES_MAX_RECORDS) {
    throw new Error(`Catalog feed change page exceeds ${CATALOG_FEED_CHANGES_MAX_RECORDS} records`);
  }
  let priorSequence = page.fromSequence;
  for (const change of page.changes) {
    requireNonNegativeInteger(change.sequence, "Catalog feed change sequence");
    if (change.sequence <= page.fromSequence || change.sequence > page.toSequence) {
      throw new Error("Catalog feed change sequence is outside the requested range");
    }
    if (change.sequence < priorSequence) {
      throw new Error("Catalog feed changes must be ordered by sequence");
    }
    if (
      change.sequence > priorSequence + 1 &&
      (page.pageIndex === 0 || priorSequence > page.fromSequence)
    ) {
      throw new Error("Catalog feed change page contains a missing revision");
    }
    priorSequence = change.sequence;
    if (change.operation === "remove") {
      requireBoundedString(change.entryId, "Catalog feed removed entry id", 256);
    } else if (change.operation === "upsert") {
      requireCanonicalEntryMetadata(change.entry);
      requireBoundedString(change.entry.id, "Catalog feed upsert entry id", 256);
    } else if (change.metadata.description !== null) {
      requireBoundedString(
        change.metadata.description,
        "Catalog feed metadata description",
        CATALOG_FEED_DESCRIPTION_MAX_BYTES,
      );
    }
  }
  if (page.nextCursor === null) {
    const terminalSequence = page.changes.at(-1)?.sequence ?? page.fromSequence;
    if (terminalSequence !== page.toSequence) {
      throw new Error("Catalog feed terminal change page must reach toSequence");
    }
  }
  requirePageBounds({
    requestCursor: page.requestCursor,
    pageIndex: page.pageIndex,
    startIndex: page.startIndex,
    itemCount: page.changes.length,
    totalCount: page.changeCount,
    nextCursor: page.nextCursor,
  });
  return page;
}

export function parseCatalogFeedChangePages(values: readonly unknown[]): CatalogFeedChangePage[] {
  if (values.length === 0) {
    throw new Error("Catalog feed change page chain must not be empty");
  }
  const pages = values.map(parseCatalogFeedChangePage);
  const first = pages[0]!;
  if (first.requestCursor !== null || first.pageIndex !== 0 || first.startIndex !== 0) {
    throw new Error("Catalog feed change page chain must start at page and item index zero");
  }
  let expectedStartIndex = 0;
  let expectedRequestCursor: string | null = null;
  let priorSequence = first.fromSequence;
  const consumedCursors = new Set<string>();
  for (const [pageIndex, page] of pages.entries()) {
    if (
      page.feedId !== first.feedId ||
      page.fromSequence !== first.fromSequence ||
      page.toSequence !== first.toSequence ||
      page.generatedAt !== first.generatedAt ||
      page.expiresAt !== first.expiresAt ||
      page.changeCount !== first.changeCount
    ) {
      throw new Error("Catalog feed change page chain changed its pinned range");
    }
    if (
      page.pageIndex !== pageIndex ||
      page.startIndex !== expectedStartIndex ||
      page.requestCursor !== expectedRequestCursor
    ) {
      throw new Error("Catalog feed change page chain contains a cursor, page, or offset gap");
    }
    if (page.requestCursor !== null) {
      if (consumedCursors.has(page.requestCursor)) {
        throw new Error("Catalog feed change page chain reuses a continuation cursor");
      }
      consumedCursors.add(page.requestCursor);
    }
    for (const change of page.changes) {
      if (change.sequence !== priorSequence && change.sequence !== priorSequence + 1) {
        throw new Error("Catalog feed change page chain contains a missing revision");
      }
      priorSequence = change.sequence;
    }
    expectedStartIndex += page.changes.length;
    expectedRequestCursor = page.nextCursor;
  }
  if (expectedRequestCursor !== null) {
    throw new Error("Catalog feed change page chain must include its terminal page");
  }
  if (priorSequence !== first.toSequence) {
    throw new Error("Catalog feed change page chain must cover every revision");
  }
  return pages;
}

export function parseCatalogFeedResetRequired(value: unknown): CatalogFeedResetRequired {
  const reset = CatalogFeedResetRequiredSchema.assert(value);
  requireProjectionHeader(reset);
  requireNonNegativeInteger(reset.fromSequence, "Catalog feed reset fromSequence");
  requireNonNegativeInteger(reset.currentSequence, "Catalog feed reset currentSequence");
  if (reset.currentSequence <= reset.fromSequence) {
    throw new Error("Catalog feed reset currentSequence must follow fromSequence");
  }
  if (utf8Length(reset.snapshotUrl) > 2048) {
    throw new Error("Catalog feed reset snapshotUrl exceeds 2048 UTF-8 bytes");
  }
  let snapshotUrl: URL;
  try {
    snapshotUrl = new URL(reset.snapshotUrl);
  } catch {
    throw new Error("Catalog feed reset snapshotUrl must be absolute HTTPS");
  }
  if (snapshotUrl.protocol !== "https:" || snapshotUrl.username || snapshotUrl.password) {
    throw new Error("Catalog feed reset snapshotUrl must be absolute HTTPS without credentials");
  }
  return reset;
}
