import type { IndexKey } from "convex-helpers/server/pagination";
import type { Value } from "convex/values";

const GET_PAGE_TIEBREAKER_FIELD_COUNT = 2;

export function encodeIndexKeyValue(val: Value | undefined): Value {
  return val === undefined ? { __undef: 1 } : val;
}

export function decodeIndexKeyValue(val: unknown): Value | undefined {
  if (val !== null && typeof val === "object" && "__undef" in (val as Record<string, unknown>)) {
    return undefined;
  }
  return val as Value;
}

export function encodeIndexCursor(indexName: string, key: IndexKey): string {
  return JSON.stringify({
    v: 1,
    index: indexName,
    key: key.map(encodeIndexKeyValue),
  });
}

function indexKeyStartsWithPrefix(key: IndexKey, prefix: IndexKey): boolean {
  if (key.length < prefix.length) return false;
  return prefix.every((value, index) => key[index] === value);
}

export function decodeIndexCursor({
  cursor,
  indexName,
  maxIndexKeyLength,
  eqPrefix,
  allowLegacyArray = true,
}: {
  cursor?: string | null;
  indexName: string;
  maxIndexKeyLength: number;
  eqPrefix: IndexKey;
  allowLegacyArray?: boolean;
}): IndexKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as unknown;
    const isSelfDescribingCursor =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { v?: unknown }).v === 1 &&
      (parsed as { index?: unknown }).index === indexName &&
      Array.isArray((parsed as { key?: unknown }).key);
    const arr =
      Array.isArray(parsed) && allowLegacyArray
        ? parsed
        : isSelfDescribingCursor
          ? (parsed as { key: unknown[] }).key
          : null;
    if (!Array.isArray(arr)) return null;
    const key = arr.map(decodeIndexKeyValue);
    // Self-describing cursors include the index name, so they can safely carry
    // getPage's full key with Convex's implicit _creationTime/_id tie-breakers.
    const maxLength = isSelfDescribingCursor
      ? maxIndexKeyLength + GET_PAGE_TIEBREAKER_FIELD_COUNT
      : maxIndexKeyLength;
    if (key.length > maxLength) return null;
    if (!indexKeyStartsWithPrefix(key, eqPrefix)) return null;
    return key;
  } catch {
    return null;
  }
}
