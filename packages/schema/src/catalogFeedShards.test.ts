import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  type CatalogFeedEntry,
} from "./catalogFeed.js";
import {
  parseCatalogFeedShardRoot,
  serializeCatalogFeedShard,
  serializeCatalogFeedShardRoot,
  validateCatalogFeedShardSet,
} from "./catalogFeedShards.js";

function entry(id: string): CatalogFeedEntry {
  return {
    type: "plugin",
    id,
    title: id,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: CATALOG_FEED_SOURCE_REF,
          package: `@openclaw/${id}`,
          version: "1.0.0",
          integrity: `sha256:${id}`,
        },
      ],
    },
  };
}

function descriptor(payload: string) {
  return {
    index: 0,
    url: "https://clawhub.ai/v1/feeds/plugins/shards/sha256-test.json",
    sha256: createHash("sha256").update(payload).digest("hex"),
    byteLength: Buffer.byteLength(payload),
    entryCount: 2,
  };
}

describe("catalog feed shard schema", () => {
  it("serializes shards deterministically and verifies their exact described bytes", async () => {
    const payload = serializeCatalogFeedShard({
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence: 7,
      index: 0,
      entries: [entry("zeta"), entry("alpha")],
    });
    const root = {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence: 7,
      generatedAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-18T00:00:00.000Z",
      metadata: { description: "Official plugins" },
      entryCount: 2,
      shards: [descriptor(payload)],
    };

    expect(payload.indexOf('"id":"alpha"')).toBeLessThan(payload.indexOf('"id":"zeta"'));
    expect(JSON.parse(serializeCatalogFeedShardRoot(root))).toEqual(root);
    const verified = await validateCatalogFeedShardSet(root, [payload]);
    expect(verified.entries.map((value) => value.id)).toEqual(["alpha", "zeta"]);
  });

  it("rejects modified shard bytes even when they still contain valid JSON", async () => {
    const payload = serializeCatalogFeedShard({
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence: 7,
      index: 0,
      entries: [entry("alpha")],
    });
    const root = {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence: 7,
      generatedAt: "2026-07-17T00:00:00Z",
      expiresAt: "2026-07-18T00:00:00Z",
      metadata: { description: null },
      entryCount: 1,
      shards: [{ ...descriptor(payload), entryCount: 1 }],
    };

    await expect(validateCatalogFeedShardSet(root, [`${payload} `])).rejects.toThrow(
      "do not match their signed descriptor",
    );
  });

  it("rejects the same invalid featuredAt combinations as atomic feeds", () => {
    const shard = {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence: 7,
      index: 0,
    };

    expect(() =>
      serializeCatalogFeedShard({
        ...shard,
        entries: [{ ...entry("alpha"), featuredAt: 1 }],
      }),
    ).toThrow("featuredAt requires a featured entry");
    expect(() =>
      serializeCatalogFeedShard({
        ...shard,
        entries: [{ ...entry("alpha"), featured: true, featuredAt: -1 }],
      }),
    ).toThrow("featuredAt requires a featured entry");
    expect(() =>
      serializeCatalogFeedShard({
        ...shard,
        entries: [{ ...entry("alpha"), featured: true, featuredAt: 1.5 }],
      }),
    ).toThrow("featuredAt requires a featured entry");
  });

  it("rejects non-RFC3339 windows and noncontiguous descriptors", () => {
    expect(() =>
      parseCatalogFeedShardRoot({
        schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
        feedId: CATALOG_FEED_ID,
        sequence: 7,
        generatedAt: "2026-07-17 00:00:00Z",
        expiresAt: "2026-07-18T00:00:00Z",
        metadata: { description: null },
        entryCount: 1,
        shards: [
          {
            index: 1,
            url: "https://clawhub.ai/shard.json",
            sha256: "a".repeat(64),
            byteLength: 1,
            entryCount: 1,
          },
        ],
      }),
    ).toThrow();
  });
});
