import { type } from "arktype";
import { CatalogFeedEntrySchema, CATALOG_FEED_ID, CATALOG_FEED_SCHEMA_VERSION, CATALOG_SKILLS_FEED_ID, normalizeCatalogFeedEntries, } from "./catalogFeed.js";
export const CATALOG_FEED_SHARD_ROOT_PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-shard-root.v1";
export const CATALOG_SKILLS_FEED_SHARD_ROOT_PAYLOAD_TYPE = "openclaw.official-skills-catalog-shard-root.v1";
export const CATALOG_FEED_SHARD_MAX_BYTES = 1024 * 1024;
export const CATALOG_FEED_SHARD_MAX_ENTRIES = 10_000;
export const CATALOG_FEED_SHARD_ROOT_MAX_SHARDS = 1024;
export const CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES = 1_000_000;
export const CATALOG_FEED_SHARD_SET_MAX_BYTES = 256 * 1024 * 1024;
export const CatalogFeedShardDescriptorSchema = type({
    "+": "reject",
    index: "number",
    url: "string",
    sha256: "string",
    byteLength: "number",
    entryCount: "number",
});
export const CatalogFeedShardRootSchema = type({
    "+": "reject",
    schemaVersion: "number",
    feedId: "string",
    sequence: "number",
    generatedAt: "string",
    expiresAt: "string",
    metadata: {
        "+": "reject",
        description: "string|null",
    },
    entryCount: "number",
    shards: CatalogFeedShardDescriptorSchema.array(),
});
export const CatalogFeedShardSchema = type({
    "+": "reject",
    schemaVersion: "number",
    feedId: "string",
    sequence: "number",
    index: "number",
    entries: CatalogFeedEntrySchema.array(),
});
const utf8Length = (value) => new TextEncoder().encode(value).length;
function requireNonNegativeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }
}
function requireValidWindow(generatedAt, expiresAt) {
    const isRfc3339Instant = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
        if (!match)
            return false;
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
        return (month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= daysInMonth[month - 1] &&
            hour <= 23 &&
            minute <= 59 &&
            second <= 59 &&
            offsetHour <= 23 &&
            offsetMinute <= 59 &&
            Number.isFinite(Date.parse(value)));
    };
    if (generatedAt.length > 64 ||
        expiresAt.length > 64 ||
        !isRfc3339Instant(generatedAt) ||
        !isRfc3339Instant(expiresAt) ||
        Date.parse(expiresAt) <= Date.parse(generatedAt)) {
        throw new Error("Catalog feed shard timestamps are invalid");
    }
}
function requireFeedId(feedId) {
    if (feedId !== CATALOG_FEED_ID && feedId !== CATALOG_SKILLS_FEED_ID) {
        throw new Error("Catalog feed shard feedId is unsupported");
    }
}
export function parseCatalogFeedShardRoot(value) {
    const root = CatalogFeedShardRootSchema.assert(value);
    if (root.schemaVersion !== CATALOG_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported catalog feed shard root schema: ${root.schemaVersion}`);
    }
    requireFeedId(root.feedId);
    requireNonNegativeInteger(root.sequence, "Catalog feed shard root sequence");
    requireValidWindow(root.generatedAt, root.expiresAt);
    if (root.metadata.description !== null && utf8Length(root.metadata.description) > 1024) {
        throw new Error("Catalog feed shard root description exceeds 1024 UTF-8 bytes");
    }
    requireNonNegativeInteger(root.entryCount, "Catalog feed shard root entryCount");
    if (root.entryCount > CATALOG_FEED_SHARD_ROOT_MAX_ENTRIES) {
        throw new Error("Catalog feed shard root entryCount exceeds its limit");
    }
    if (root.shards.length > CATALOG_FEED_SHARD_ROOT_MAX_SHARDS) {
        throw new Error("Catalog feed shard root exceeds its shard limit");
    }
    if ((root.entryCount === 0) !== (root.shards.length === 0)) {
        throw new Error("Catalog feed empty shard roots must have no shard descriptors");
    }
    let describedEntries = 0;
    let describedBytes = 0;
    const urls = new Set();
    const digests = new Set();
    for (const [index, shard] of root.shards.entries()) {
        if (shard.index !== index)
            throw new Error("Catalog feed shard indexes must be contiguous");
        if (!/^[a-f0-9]{64}$/u.test(shard.sha256)) {
            throw new Error("Catalog feed shard digest must be lowercase SHA-256 hex");
        }
        if (digests.has(shard.sha256))
            throw new Error("Catalog feed shard digest is duplicated");
        digests.add(shard.sha256);
        if (!Number.isSafeInteger(shard.byteLength) ||
            shard.byteLength < 1 ||
            shard.byteLength > CATALOG_FEED_SHARD_MAX_BYTES) {
            throw new Error("Catalog feed shard byteLength is invalid");
        }
        if (!Number.isSafeInteger(shard.entryCount) ||
            shard.entryCount < 1 ||
            shard.entryCount > CATALOG_FEED_SHARD_MAX_ENTRIES) {
            throw new Error("Catalog feed shard entryCount is invalid");
        }
        let url;
        try {
            url = new URL(shard.url);
        }
        catch {
            throw new Error("Catalog feed shard URL must be absolute HTTPS");
        }
        if (url.protocol !== "https:" || url.username || url.password || utf8Length(shard.url) > 2048) {
            throw new Error("Catalog feed shard URL must be absolute HTTPS without credentials");
        }
        if (urls.has(url.href))
            throw new Error("Catalog feed shard URL is duplicated");
        urls.add(url.href);
        describedEntries += shard.entryCount;
        describedBytes += shard.byteLength;
    }
    if (describedEntries !== root.entryCount) {
        throw new Error("Catalog feed shard root entryCount does not match its descriptors");
    }
    if (describedBytes > CATALOG_FEED_SHARD_SET_MAX_BYTES) {
        throw new Error("Catalog feed shard set exceeds its aggregate byte limit");
    }
    if (utf8Length(JSON.stringify(root)) > CATALOG_FEED_SHARD_MAX_BYTES) {
        throw new Error("Catalog feed shard root exceeds its byte limit");
    }
    return root;
}
export function parseCatalogFeedShard(value) {
    const shard = CatalogFeedShardSchema.assert(value);
    if (shard.schemaVersion !== CATALOG_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported catalog feed shard schema: ${shard.schemaVersion}`);
    }
    requireFeedId(shard.feedId);
    requireNonNegativeInteger(shard.sequence, "Catalog feed shard sequence");
    requireNonNegativeInteger(shard.index, "Catalog feed shard index");
    if (shard.entries.length < 1 || shard.entries.length > CATALOG_FEED_SHARD_MAX_ENTRIES) {
        throw new Error("Catalog feed shard entry count is invalid");
    }
    const expectedType = shard.feedId === CATALOG_SKILLS_FEED_ID ? "skill" : "plugin";
    const identities = new Set();
    let previousId;
    for (const entry of shard.entries) {
        if (entry.type !== expectedType)
            throw new Error("Catalog feed shard entry type is invalid");
        const identity = `${entry.type}\0${entry.id}`;
        if (identities.has(identity))
            throw new Error("Catalog feed shard entry identity is duplicated");
        identities.add(identity);
        if (previousId !== undefined && previousId.localeCompare(entry.id) >= 0) {
            throw new Error("Catalog feed shard entries must use deterministic id ordering");
        }
        previousId = entry.id;
    }
    return shard;
}
export function serializeCatalogFeedShard(shard) {
    const parsed = parseCatalogFeedShard({
        ...shard,
        entries: normalizeCatalogFeedEntries(shard.entries),
    });
    return JSON.stringify({
        schemaVersion: parsed.schemaVersion,
        feedId: parsed.feedId,
        sequence: parsed.sequence,
        index: parsed.index,
        entries: parsed.entries,
    });
}
export function serializeCatalogFeedShardRoot(root) {
    const parsed = parseCatalogFeedShardRoot(root);
    const payload = JSON.stringify({
        schemaVersion: parsed.schemaVersion,
        feedId: parsed.feedId,
        sequence: parsed.sequence,
        generatedAt: parsed.generatedAt,
        expiresAt: parsed.expiresAt,
        metadata: parsed.metadata,
        entryCount: parsed.entryCount,
        shards: parsed.shards,
    });
    if (utf8Length(payload) > CATALOG_FEED_SHARD_MAX_BYTES) {
        throw new Error("Catalog feed shard root exceeds its byte limit");
    }
    return payload;
}
async function sha256Hex(bytes) {
    const input = new Uint8Array(bytes.byteLength);
    input.set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function validateCatalogFeedShardSet(rootValue, shardPayloads) {
    const root = parseCatalogFeedShardRoot(rootValue);
    if (shardPayloads.length !== root.shards.length) {
        throw new Error("Catalog feed shard set is incomplete");
    }
    const shards = await Promise.all(shardPayloads.map(async (payload, index) => {
        const bytes = new TextEncoder().encode(payload);
        const descriptor = root.shards[index];
        if (bytes.length !== descriptor.byteLength ||
            (await sha256Hex(bytes)) !== descriptor.sha256) {
            throw new Error("Catalog feed shard bytes do not match their signed descriptor");
        }
        let value;
        try {
            value = JSON.parse(payload);
        }
        catch {
            throw new Error("Catalog feed shard payload is not valid JSON");
        }
        return parseCatalogFeedShard(value);
    }));
    const entries = [];
    const identities = new Set();
    let previousId;
    for (const [index, shard] of shards.entries()) {
        if (shard.feedId !== root.feedId || shard.sequence !== root.sequence || shard.index !== index) {
            throw new Error("Catalog feed shard does not match its signed root");
        }
        if (shard.entries.length !== root.shards[index].entryCount) {
            throw new Error("Catalog feed shard entry count does not match its descriptor");
        }
        for (const entry of shard.entries) {
            const identity = `${entry.type}\0${entry.id}`;
            if (identities.has(identity))
                throw new Error("Catalog feed shard set identity is duplicated");
            identities.add(identity);
            if (previousId !== undefined && previousId.localeCompare(entry.id) >= 0) {
                throw new Error("Catalog feed shard set ordering is invalid");
            }
            previousId = entry.id;
            entries.push(entry);
        }
    }
    if (entries.length !== root.entryCount) {
        throw new Error("Catalog feed shard set entry count is incomplete");
    }
    return { root, shards, entries };
}
//# sourceMappingURL=catalogFeedShards.js.map