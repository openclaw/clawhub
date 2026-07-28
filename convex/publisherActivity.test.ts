/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./lib/access", () => ({ requireUser: vi.fn() }));
vi.mock("./lib/globalStats", () => ({
  isPublicPluginDoc: vi.fn((value) => Boolean(value && !value.softDeletedAt)),
  isPublicSkillDoc: vi.fn((value) => Boolean(value && !value.softDeletedAt)),
}));
vi.mock("./lib/publishers", () => ({
  MAX_FOLLOWED_PUBLISHERS: 100,
  getPublicPublisherVisibility: vi.fn(async (_ctx, publisher) =>
    publisher ? { publisher, linkedUser: null } : null,
  ),
}));

const { deletePublisherActivityInternal, listMineInternal, recordPublisherPublicationActivity } =
  await import("./publisherActivity");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listMineInternalHandler = (
  listMineInternal as unknown as WrappedHandler<
    {
      userId: string;
      cursor?: string | null;
      limit?: number;
      projection?: "following" | "inbox";
    },
    {
      groups: Array<{
        activitySortKey: string;
        recordedItemCount: number;
        previewItems: unknown[];
      }>;
      nextCursor: string | null;
    }
  >
)._handler;
const deletePublisherActivityInternalHandler = (
  deletePublisherActivityInternal as unknown as WrappedHandler<
    { publisherId: string; phase?: "events" | "groups"; cursor?: string },
    { deleted: number; scheduled: boolean }
  >
)._handler;

type Row = Record<string, unknown> & { _id: string };

function indexedQuery(rows: Row[], build?: (query: unknown) => unknown) {
  const filters = new Map<string, unknown>();
  const upperBounds = new Map<string, unknown>();
  const q = {
    eq(field: string, value: unknown) {
      filters.set(field, value);
      return q;
    },
    lt(field: string, value: unknown) {
      upperBounds.set(field, value);
      return q;
    },
  };
  build?.(q);
  const filtered = () =>
    rows.filter((row) => {
      for (const [field, value] of filters) if (row[field] !== value) return false;
      for (const [field, value] of upperBounds) {
        if (typeof row[field] !== "string" || typeof value !== "string" || row[field] >= value) {
          return false;
        }
      }
      return true;
    });
  const ordered = () =>
    filtered().sort((left, right) =>
      String(right.sortKey ?? right._id).localeCompare(String(left.sortKey ?? left._id)),
    );
  return {
    unique: async () => filtered()[0] ?? null,
    order: () => ({
      take: async (limit: number) => ordered().slice(0, limit),
      paginate: async ({ numItems }: { cursor: string | null; numItems: number }) => ({
        page: ordered().slice(0, numItems),
        continueCursor: "",
        isDone: true,
      }),
    }),
    paginate: async ({ numItems }: { cursor: string | null; numItems: number }) => ({
      page: ordered().slice(0, numItems),
      continueCursor: "",
      isDone: true,
    }),
  };
}

describe("publisher activity groups", () => {
  afterEach(() => vi.clearAllMocks());

  it("coalesces releases that share a publication batch while retaining granular events", async () => {
    const activities: Row[] = [];
    const groups: Row[] = [];
    const publisher = {
      _id: "publishers:nvidia",
      handle: "nvidia",
      displayName: "NVIDIA",
      kind: "org",
    };
    let nextId = 1;
    const query = vi.fn((table: string) => ({
      withIndex: (_index: string, build?: (query: unknown) => unknown) =>
        indexedQuery(table === "publisherActivity" ? activities : groups, build),
    }));
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      const row = { _id: `${table}:${nextId++}`, ...value };
      (table === "publisherActivity" ? activities : groups).push(row);
      return row._id;
    });
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      const row = groups.find((candidate) => candidate._id === id);
      Object.assign(row!, value);
    });
    const ctx = { db: { get: vi.fn(async () => publisher), query, insert, patch } } as never;

    for (let index = 0; index < 2; index += 1) {
      await recordPublisherPublicationActivity(ctx, {
        publisherId: "publishers:nvidia" as never,
        eventType: "skill.publish",
        skillId: `skills:${index}` as never,
        skillVersionId: `skillVersions:${index}` as never,
        version: "2.0.0",
        eventAt: 100 + index,
        publicationBatchId: "github:nvidia/skills:abc123",
      });
    }

    expect(activities).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ itemCount: 2, eventAt: 101 });
    expect(activities[0]?.batchKey).toBe(groups[0]?.batchKey);
  });

  it("renders a 50-skill batch plus an unrelated plugin release as two groups", async () => {
    const publisher = {
      _id: "publishers:patrick",
      handle: "patrick",
      displayName: "Patrick",
      kind: "user",
      image: undefined,
    };
    const groups: Row[] = [
      {
        _id: "publisherActivityGroups:skills",
        publisherId: publisher._id,
        batchKey: "batch:skills",
        eventAt: 200,
        sortKey: "000000000000200:batch:skills",
        itemCount: 50,
      },
      {
        _id: "publisherActivityGroups:plugin",
        publisherId: publisher._id,
        batchKey: "batch:plugin",
        eventAt: 100,
        sortKey: "000000000000100:batch:plugin",
        itemCount: 1,
      },
    ];
    const activities: Row[] = [
      ...Array.from({ length: 50 }, (_, index) => ({
        _id: `publisherActivity:skill:${index}`,
        publisherId: publisher._id,
        batchKey: "batch:skills",
        eventType: "skill.publish",
        skillId: `skills:${index}`,
        skillVersionId: `skillVersions:${index}`,
        version: "2.0.0",
        eventAt: 200 - index,
        sortKey: `${String(200 - index).padStart(15, "0")}:skill:${index}`,
      })),
      {
        _id: "publisherActivity:plugin",
        publisherId: publisher._id,
        batchKey: "batch:plugin",
        eventType: "plugin.publish",
        packageId: "packages:one",
        packageReleaseId: "packageReleases:one",
        version: "1.0.0",
        eventAt: 100,
        sortKey: "000000000000100:plugin",
      },
    ];
    const follows: Row[] = [
      {
        _id: "publisherFollows:1",
        followerUserId: "users:viewer",
        publisherId: publisher._id,
        notifications: "all",
      },
    ];
    const docs: Record<string, Row | Record<string, unknown>> = {
      [publisher._id]: publisher,
      "packages:one": {
        _id: "packages:one",
        ownerPublisherId: publisher._id,
        normalizedName: "@patrick/one",
        displayName: "One Plugin",
        family: "code-plugin",
        channel: "public",
      },
      "packageReleases:one": {
        _id: "packageReleases:one",
        packageId: "packages:one",
      },
    };
    for (let index = 0; index < 50; index += 1) {
      docs[`skills:${index}`] = {
        _id: `skills:${index}`,
        ownerPublisherId: publisher._id,
        displayName: `Skill ${index}`,
        slug: `skill-${index}`,
      };
      docs[`skillVersions:${index}`] = {
        _id: `skillVersions:${index}`,
        skillId: `skills:${index}`,
      };
    }
    const query = vi.fn((table: string) => ({
      withIndex: (_index: string, build?: (query: unknown) => unknown) =>
        indexedQuery(
          table === "publisherFollows"
            ? follows
            : table === "publisherActivityGroups"
              ? groups
              : activities,
          build,
        ),
    }));
    const get = vi.fn(async (id: string) => docs[id] ?? null);

    const result = await listMineInternalHandler(
      { db: { get, query } },
      { userId: "users:viewer", limit: 25 },
    );

    expect(result.nextCursor).toBeNull();
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.recordedItemCount)).toEqual([50, 1]);
    expect(result.groups[0]?.activitySortKey).toBe(groups[0]?.sortKey);
    expect(result.groups[0]?.previewItems).toHaveLength(3);

    follows[0] = { ...follows[0], notifications: "none" };
    const mutedInbox = await listMineInternalHandler(
      { db: { get, query } },
      { userId: "users:viewer", limit: 25, projection: "inbox" },
    );
    expect(mutedInbox.groups).toEqual([]);
  });

  it("deletes granular events before scheduling group cleanup", async () => {
    const deleteDoc = vi.fn();
    const runAfter = vi.fn();
    const paginate = vi.fn(async () => ({
      page: [{ _id: "publisherActivity:1" }, { _id: "publisherActivity:2" }],
      continueCursor: "",
      isDone: true,
    }));
    const query = vi.fn(() => ({ withIndex: () => ({ paginate }) }));

    const result = await deletePublisherActivityInternalHandler(
      { db: { query, delete: deleteDoc }, scheduler: { runAfter } },
      { publisherId: "publishers:nvidia" },
    );

    expect(result).toEqual({ deleted: 2, scheduled: true });
    expect(deleteDoc).toHaveBeenCalledTimes(2);
    expect(runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({ publisherId: "publishers:nvidia", phase: "groups" }),
    );
  });
});
