import { CATALOG_FEED_ID, type CatalogFeedEntry } from "clawhub-schema";
import { describe, expect, it, vi } from "vitest";
import {
  appendCatalogFeedQueryResults,
  finalizeCatalogFeedQueryMaterialization,
  getCatalogFeedQueryRevision,
  scanCatalogFeedQueryIndex,
} from "./catalogFeed";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const scanHandler = (
  scanCatalogFeedQueryIndex as unknown as WrappedHandler<
    {
      feedId: typeof CATALOG_FEED_ID;
      sequence: number;
      query: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    { scannedCount: number; matches: string[]; isDone: boolean; continueCursor: string }
  >
)._handler;

const appendHandler = (
  appendCatalogFeedQueryResults as unknown as WrappedHandler<
    {
      materializationKey: string;
      expectedScannedEntryCount: number;
      scannedCount: number;
      payloads: string[];
    },
    { scannedEntryCount: number; resultCount: number }
  >
)._handler;

const finalizeHandler = (
  finalizeCatalogFeedQueryMaterialization as unknown as WrappedHandler<
    { materializationKey: string },
    { resultCount: number }
  >
)._handler;

const getRevisionHandler = (
  getCatalogFeedQueryRevision as unknown as WrappedHandler<
    { feedId: typeof CATALOG_FEED_ID },
    { sequence: number; entryCount: number } | null
  >
)._handler;

function entry(overrides: Partial<CatalogFeedEntry> = {}): CatalogFeedEntry {
  return {
    type: "plugin",
    id: "@openclaw/cuda",
    title: "CUDA Helper",
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "npm",
          package: "@openclaw/cuda",
          version: "1.0.0",
          integrity: "sha256:cuda",
        },
      ],
    },
    ...overrides,
  };
}

describe("catalog feed indexed query materialization", () => {
  it("uses the newest completed index while a newer publication is still building", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const builder = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      field: vi.fn((name: string) => name),
    };
    const first = vi.fn(async () => ({ sequence: 6, entryCount: 42, expiresAt }));
    const filter = vi.fn(
      (apply: (query: typeof builder) => unknown) => (apply(builder), { first }),
    );
    const order = vi.fn(() => ({ filter }));
    const withIndex = vi.fn(
      (_name: string, apply: (query: typeof builder) => unknown) => (apply(builder), { order }),
    );

    await expect(
      getRevisionHandler(
        { db: { query: vi.fn(() => ({ withIndex })) } },
        { feedId: CATALOG_FEED_ID },
      ),
    ).resolves.toEqual({ sequence: 6, entryCount: 42, expiresAt });
    expect(order).toHaveBeenCalledWith("desc");
    expect(builder.neq).toHaveBeenCalledWith("entryCount", undefined);
    expect(builder.gt).toHaveBeenCalledWith("expiresAt", expect.any(String));
  });

  it("scans a pinned revision index and emits only normalized query matches", async () => {
    const matching = entry();
    const wrongPublisher = entry({
      id: "@other/cuda",
      publisher: { id: "other", trust: "community" },
    });
    const builder = { eq: vi.fn().mockReturnThis() };
    const paginate = vi.fn(async () => ({
      page: [{ payload: JSON.stringify(matching) }, { payload: JSON.stringify(wrongPublisher) }],
      isDone: true,
      continueCursor: "",
    }));
    const withIndex = vi.fn(
      (_name: string, apply: (query: typeof builder) => unknown) => (apply(builder), { paginate }),
    );

    const result = await scanHandler(
      { db: { query: vi.fn(() => ({ withIndex })) } },
      {
        feedId: CATALOG_FEED_ID,
        sequence: 7,
        query: JSON.stringify({
          text: "CUDA",
          types: ["plugin"],
          states: ["available"],
          publisherIds: ["openclaw"],
        }),
        paginationOpts: { cursor: null, numItems: 250 },
      },
    );

    expect(withIndex).toHaveBeenCalledWith("by_feed_sequence_ordinal", expect.any(Function));
    expect(builder.eq).toHaveBeenNthCalledWith(1, "feedId", CATALOG_FEED_ID);
    expect(builder.eq).toHaveBeenNthCalledWith(2, "sequence", 7);
    expect(result).toEqual({
      scannedCount: 2,
      matches: [JSON.stringify(matching)],
      isDone: true,
      continueCursor: "",
    });
  });

  it("appends ordered result rows and advances exact scan and result counts", async () => {
    const insert = vi.fn();
    const patch = vi.fn();
    const materialization = {
      _id: "catalogFeedQueryMaterializations:1",
      status: "building",
      scannedEntryCount: 2,
      expectedEntryCount: 5,
      resultCount: 1,
      expirationTime: Date.now() + 60_000,
    };
    const result = await appendHandler(
      {
        db: {
          get: vi.fn(),
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({ unique: vi.fn(async () => materialization) })),
          })),
          insert,
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
      },
      {
        materializationKey: "a".repeat(64),
        expectedScannedEntryCount: 2,
        scannedCount: 3,
        payloads: ["one", "two"],
      },
    );

    expect(insert).toHaveBeenNthCalledWith(
      1,
      "catalogFeedQueryResults",
      expect.objectContaining({ ordinal: 1, payload: "one" }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      "catalogFeedQueryResults",
      expect.objectContaining({ ordinal: 2, payload: "two" }),
    );
    expect(patch).toHaveBeenCalledWith(materialization._id, {
      scannedEntryCount: 5,
      resultCount: 3,
    });
    expect(result).toEqual({ scannedEntryCount: 5, resultCount: 3 });
  });

  it("refuses to publish an exact count before the pinned index scan is complete", async () => {
    const patch = vi.fn();
    await expect(
      finalizeHandler(
        {
          db: {
            get: vi.fn(),
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "catalogFeedQueryMaterializations:1",
                  status: "building",
                  scannedEntryCount: 4,
                  expectedEntryCount: 5,
                  expirationTime: Date.now() + 60_000,
                })),
              })),
            })),
            patch,
            insert: vi.fn(),
            replace: vi.fn(),
            delete: vi.fn(),
            normalizeId: vi.fn(),
            system: {},
          },
        },
        { materializationKey: "a".repeat(64) },
      ),
    ).rejects.toThrow("incomplete");
    expect(patch).not.toHaveBeenCalled();
  });
});
