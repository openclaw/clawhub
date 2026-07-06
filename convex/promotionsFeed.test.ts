import { parsePromotionsFeed, PROMOTIONS_FEED_ID } from "clawhub-schema";
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { publishInternal } = await import("./promotionsFeed");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const publishHandler = (publishInternal as unknown as WrappedHandler<Record<string, never>>)
  ._handler;

const basePromotion = {
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  models: [{ modelRef: "example-provider/example/model-alpha", alias: "model-alpha" }],
  createdByUserId: "users:admin",
  createdAt: 1,
  updatedAt: 1,
};

function makeCtx({
  promotions,
  latestPublication = null,
}: {
  promotions: Array<Record<string, unknown>>;
  latestPublication?: Record<string, unknown> | null;
}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const patches: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const db = {
    normalizeId: vi.fn(),
    system: {},
    get: vi.fn(),
    query: vi.fn((table: string) => {
      if (table === "promotions") {
        return {
          withIndex: vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
              yield* promotions;
            },
          })),
        };
      }
      if (table === "catalogFeedPublications") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => latestPublication),
          })),
        };
      }
      throw new Error(`Unexpected query table: ${table}`);
    }),
    insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
      inserts.push({ table, doc });
      return `${table}:${inserts.length}`;
    }),
    patch: vi.fn(async (id: unknown, patch: Record<string, unknown>) => {
      patches.push({ id, patch });
    }),
    replace: vi.fn(),
    delete: vi.fn(),
  };
  return { ctx: { db } as never, inserts, patches };
}

describe("promotionsFeed.publishInternal", () => {
  it("publishes launched active promotions as a valid feed snapshot", async () => {
    const now = Date.now();
    const { ctx, inserts } = makeCtx({
      promotions: [
        {
          ...basePromotion,
          _id: "promotions:1",
          slug: "live",
          status: "active",
          startsAt: now - 1_000,
          endsAt: now + 1_000,
        },
        {
          ...basePromotion,
          _id: "promotions:2",
          slug: "not-started",
          status: "active",
          startsAt: now + 500,
          endsAt: now + 2_000,
        },
      ],
    });

    const result = (await publishHandler(ctx, {})) as { sequence: number; entryCount: number };

    expect(result.sequence).toBe(1);
    expect(result.entryCount).toBe(1);
    const publicationInsert = inserts.find((entry) => entry.table === "catalogFeedPublications");
    expect(publicationInsert?.doc.feedId).toBe(PROMOTIONS_FEED_ID);
    const feed = parsePromotionsFeed(JSON.parse(publicationInsert?.doc.payload as string));
    expect(feed.entries.map((entry) => entry.slug)).toEqual(["live"]);
    expect(feed.entries[0]).not.toHaveProperty("status");
  });

  it("increments the sequence and patches the existing publication row", async () => {
    const now = Date.now();
    const { ctx, inserts, patches } = makeCtx({
      promotions: [
        {
          ...basePromotion,
          _id: "promotions:1",
          slug: "live",
          status: "active",
          startsAt: now - 1_000,
          endsAt: now + 1_000,
        },
      ],
      latestPublication: { _id: "catalogFeedPublications:1", sequence: 7 },
    });

    const result = (await publishHandler(ctx, {})) as { sequence: number };

    expect(result.sequence).toBe(8);
    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.sequence).toBe(8);
  });

  it("publishes an empty feed when nothing is live", async () => {
    const { ctx, inserts } = makeCtx({ promotions: [] });

    const result = (await publishHandler(ctx, {})) as { entryCount: number };

    expect(result.entryCount).toBe(0);
    const publicationInsert = inserts.find((entry) => entry.table === "catalogFeedPublications");
    const feed = parsePromotionsFeed(JSON.parse(publicationInsert?.doc.payload as string));
    expect(feed.entries).toEqual([]);
  });
});
