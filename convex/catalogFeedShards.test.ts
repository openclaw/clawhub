import {
  CATALOG_SKILLS_FEED_ID,
  parseCatalogFeedShard,
  type CatalogFeedEntry,
} from "clawhub-schema";
import { describe, expect, it, vi } from "vitest";
import {
  buildCatalogFeedShards,
  getCatalogFeedShardByDigest,
  getLatestCatalogFeedShardPublication,
} from "./catalogFeedShards";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getLatestHandler = (
  getLatestCatalogFeedShardPublication as unknown as WrappedHandler<
    { feedId: typeof CATALOG_SKILLS_FEED_ID },
    unknown
  >
)._handler;
const getShardByDigestHandler = (
  getCatalogFeedShardByDigest as unknown as WrappedHandler<{ sha256: string }, unknown>
)._handler;

function entry(index: number): CatalogFeedEntry {
  const id = `@openclaw/skill-${index.toString().padStart(4, "0")}`;
  return {
    type: "skill",
    id,
    title: id,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "public-clawhub",
          package: id,
          version: "1.0.0",
          integrity: `sha256:${index}`,
        },
      ],
    },
  };
}

describe("catalog feed shard publication builder", () => {
  it("builds complete bounded immutable shards", async () => {
    const shards = await buildCatalogFeedShards({
      feedId: CATALOG_SKILLS_FEED_ID,
      sequence: 3,
      entries: Array.from({ length: 501 }, (_, index) => entry(index)),
    });

    expect(shards).toHaveLength(3);
    expect(shards.map((shard) => shard.entryCount)).toEqual([250, 250, 1]);
    for (const [index, built] of shards.entries()) {
      expect(built.index).toBe(index);
      expect(built.byteLength).toBe(Buffer.byteLength(built.payload));
      expect(built.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(parseCatalogFeedShard(JSON.parse(built.payload))).toMatchObject({
        feedId: CATALOG_SKILLS_FEED_ID,
        sequence: 3,
        index,
      });
    }
  });

  it("builds roots from lightweight descriptors without reading shard payload rows", async () => {
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => {
        if (table === "catalogFeedShardPublications") {
          return {
            order: vi.fn(() => ({
              filter: vi.fn(() => ({
                first: vi.fn(async () => ({
                  _id: "publication:1",
                  feedId: CATALOG_SKILLS_FEED_ID,
                  sequence: 3,
                  generatedAt: "2026-07-17T00:00:00.000Z",
                  expiresAt: "2099-07-18T00:00:00.000Z",
                  description: "Official skills",
                  entryCount: 1,
                  expectedShardCount: 1,
                  publishedAt: 1,
                })),
              })),
            })),
          };
        }
        return {
          order: vi.fn(() => ({
            collect: vi.fn(async () => [
              { index: 0, sha256: "a".repeat(64), byteLength: 123, entryCount: 1 },
            ]),
          })),
        };
      }),
    }));

    await expect(
      getLatestHandler({ db: { query } }, { feedId: CATALOG_SKILLS_FEED_ID }),
    ).resolves.toMatchObject({
      sequence: 3,
      shards: [{ index: 0, byteLength: 123, entryCount: 1 }],
    });
    expect(query).toHaveBeenCalledWith("catalogFeedShardDescriptors");
    expect(query).not.toHaveBeenCalledWith("catalogFeedShards");
  });

  it("serves immutable shard bytes through their retention window", async () => {
    const sha256 = "a".repeat(64);
    const shard = {
      publicationId: "publication:1",
      payload: "{}",
      sha256,
      byteLength: 2,
      feedId: CATALOG_SKILLS_FEED_ID,
      sequence: 3,
      index: 0,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: vi.fn(async () => [shard]) })),
        })),
        get: vi.fn(async () => ({
          status: "ready",
          expiresAt: "2026-07-17T00:00:00.000Z",
          expirationTime: Date.now() + 60_000,
        })),
      },
    };

    await expect(getShardByDigestHandler(ctx, { sha256 })).resolves.toMatchObject({
      payload: shard.payload,
      sha256,
      byteLength: shard.byteLength,
      feedId: shard.feedId,
      sequence: shard.sequence,
      index: shard.index,
    });
  });
});
