import { describe, expect, it, vi } from "vitest";
import { getSoulBySlugInternal, insertVersion, list } from "./souls";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler;
const getSoulBySlugInternalHandler = (
  getSoulBySlugInternal as unknown as WrappedHandler<{ slug: string }>
)._handler;
const listHandler = (list as unknown as WrappedHandler<{ ownerUserId?: string; limit?: number }>)._handler;

describe("souls.insertVersion", () => {
  it("throws a soul-specific ownership error for non-owners", async () => {
    let requestedSlug: string | null = null;
    const db = {
      normalizeId: vi.fn(),
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") return { _id: "users:caller", deletedAt: undefined };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table !== "souls") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (
            name: string,
            build: ((q: { eq: (field: string, value: string) => unknown }) => unknown) | undefined,
          ) => {
            if (name !== "by_slug") throw new Error(`unexpected index ${name}`);
            const q = {
              eq: (field: string, value: string) => {
                if (field !== "slug") throw new Error(`unexpected field ${field}`);
                requestedSlug = value;
                return q;
              },
            };
            build?.(q);
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "souls:1",
                    slug: "demo-soul",
                    ownerUserId: "users:owner",
                    softDeletedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
    };

    await expect(
      insertVersionHandler(
        { db } as never,
        {
          userId: "users:caller",
          slug: "Demo-Soul",
          displayName: "Demo Soul",
          version: "1.0.0",
          changelog: "Initial",
          changelogSource: "user",
          tags: ["latest"],
          fingerprint: "f".repeat(64),
          files: [
            {
              path: "SOUL.md",
              size: 100,
              storageId: "_storage:1",
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
          ],
          parsed: {
            frontmatter: {},
            metadata: {},
          },
          embedding: [0.1, 0.2],
        } as never,
      ),
    ).rejects.toThrow("Only the owner can publish soul updates");

    expect(requestedSlug).toBe("demo-soul");
  });

  it("normalizes mixed-case slugs in internal soul lookups", async () => {
    let requestedSlug: string | null = null;

    const result = await getSoulBySlugInternalHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table !== "souls") throw new Error(`unexpected table ${table}`);
            return {
              withIndex: (
                name: string,
                build:
                  | ((q: { eq: (field: string, value: string) => unknown }) => unknown)
                  | undefined,
              ) => {
                if (name !== "by_slug") throw new Error(`unexpected index ${name}`);
                const q = {
                  eq: (field: string, value: string) => {
                    if (field !== "slug") throw new Error(`unexpected field ${field}`);
                    requestedSlug = value;
                    return q;
                  },
                };
                build?.(q);
                return {
                  order: () => ({
                    take: async () => [
                      {
                        _id: "souls:1",
                        slug: "demo-soul",
                        ownerUserId: "users:owner",
                        softDeletedAt: undefined,
                      },
                    ],
                  }),
                };
              },
            };
          }),
        },
      } as never,
      { slug: "Demo-Soul" } as never,
    );

    expect(requestedSlug).toBe("demo-soul");
    expect(result).toEqual(
      expect.objectContaining({
        _id: "souls:1",
        slug: "demo-soul",
      }),
    );
  });
});

describe("souls.list", () => {
  it("uses the active browse index and only takes the requested limit", async () => {
    let requestedIndex: string | null = null;
    let requestedSoftDeletedAt: number | undefined;
    let requestedLimit: number | null = null;

    const result = await listHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table !== "souls") throw new Error(`unexpected table ${table}`);
            return {
              withIndex: (
                name: string,
                build:
                  | ((q: { eq: (field: string, value: undefined) => unknown }) => unknown)
                  | undefined,
              ) => {
                requestedIndex = name;
                const q = {
                  eq: (field: string, value: undefined) => {
                    if (field !== "softDeletedAt") throw new Error(`unexpected field ${field}`);
                    requestedSoftDeletedAt = value;
                    return q;
                  },
                };
                build?.(q);
                return {
                  order: () => ({
                    take: async (limit: number) => {
                      requestedLimit = limit;
                      return [
                        {
                          _id: "souls:1",
                          _creationTime: 1,
                          slug: "demo-soul",
                          displayName: "Demo Soul",
                          summary: "A demo soul",
                          ownerUserId: "users:owner",
                          ownerPublisherId: undefined,
                          latestVersionId: undefined,
                          tags: {},
                          softDeletedAt: undefined,
                          stats: { downloads: 1, stars: 2, versions: 3, comments: 4 },
                          createdAt: 1,
                          updatedAt: 2,
                        },
                      ];
                    },
                  }),
                };
              },
            };
          }),
        },
      } as never,
      { limit: 7 } as never,
    );

    expect(requestedIndex).toBe("by_active_updated");
    expect(requestedSoftDeletedAt).toBeUndefined();
    expect(requestedLimit).toBe(7);
    expect(result).toEqual([
      expect.objectContaining({
        _id: "souls:1",
        slug: "demo-soul",
        displayName: "Demo Soul",
      }),
    ]);
  });
});
