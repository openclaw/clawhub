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
    { userId: string; cursor?: string | null; limit?: number },
    { items: unknown[]; nextCursor: string | null }
  >
)._handler;
const deletePublisherActivityInternalHandler = (
  deletePublisherActivityInternal as unknown as WrappedHandler<
    { publisherId: string; cursor?: string },
    { deleted: number; scheduled: boolean }
  >
)._handler;

function queryBuilder(params: {
  existingActivity?: Record<string, unknown> | null;
  activities?: Array<Record<string, unknown>>;
  followedPublisherIds?: Set<string>;
}) {
  return vi.fn((table: string) => ({
    withIndex: (_index: string, build?: (query: unknown) => unknown) => {
      const filters = new Map<string, unknown>();
      const q = {
        eq(field: string, value: unknown) {
          filters.set(field, value);
          return q;
        },
        lt(field: string, value: unknown) {
          filters.set(`lt:${field}`, value);
          return q;
        },
      };
      build?.(q);
      return {
        unique: async () => params.existingActivity ?? null,
        order: () => ({
          take: async (limit: number) => {
            if (table === "publisherFollows") {
              return [...(params.followedPublisherIds ?? [])]
                .map((publisherId, index) => ({
                  _id: `publisherFollows:${index}`,
                  followerUserId: "users:viewer",
                  publisherId,
                }))
                .slice(0, limit);
            }
            const publisherId = filters.get("publisherId");
            const before = filters.get("lt:sortKey");
            return (params.activities ?? [])
              .map((activity) => {
                const sortKey =
                  typeof activity.sortKey === "string"
                    ? activity.sortKey
                    : `${String(activity.eventAt).padStart(15, "0")}:${String(activity._id)}`;
                return { ...activity, sortKey } as Record<string, unknown> & { sortKey: string };
              })
              .filter(
                (activity) =>
                  activity.publisherId === publisherId &&
                  (typeof before !== "string" || activity.sortKey < before),
              )
              .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
              .slice(0, limit);
          },
        }),
      };
    },
  }));
}

describe("publisher activity", () => {
  afterEach(() => vi.clearAllMocks());

  it("records one deduplicated activity row without follower fanout", async () => {
    const query = queryBuilder({ existingActivity: null });
    const insert = vi.fn(async () => "publisherActivity:1");
    const get = vi.fn(async () => ({
      _id: "publishers:nvidia",
      handle: "nvidia",
      displayName: "NVIDIA",
      kind: "org",
    }));

    const result = await recordPublisherPublicationActivity(
      { db: { get, query, insert } } as never,
      {
        publisherId: "publishers:nvidia" as never,
        eventType: "skill.publish",
        skillId: "skills:cuda" as never,
        skillVersionId: "skillVersions:1" as never,
        version: "1.2.3",
        eventAt: 42,
      },
    );

    expect(result).toMatchObject({ created: true, activityId: "publisherActivity:1" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "publisherActivity",
      expect.objectContaining({
        dedupeKey: "skill.publish:skillVersions:1",
        eventAt: 42,
      }),
    );
  });

  it("returns only currently followed, visible, still-owned artifacts", async () => {
    const activities = [
      {
        _id: "publisherActivity:visible",
        publisherId: "publishers:nvidia",
        eventType: "skill.publish",
        skillId: "skills:cuda",
        skillVersionId: "skillVersions:1",
        version: "1.2.3",
        eventAt: 42,
      },
      {
        _id: "publisherActivity:unfollowed",
        publisherId: "publishers:other",
        eventType: "skill.publish",
        skillId: "skills:other",
        skillVersionId: "skillVersions:2",
        version: "2.0.0",
        eventAt: 41,
      },
      {
        _id: "publisherActivity:revoked",
        publisherId: "publishers:nvidia",
        eventType: "plugin.publish",
        packageId: "packages:blocked",
        packageReleaseId: "packageReleases:blocked",
        version: "3.0.0",
        eventAt: 40,
      },
      {
        _id: "publisherActivity:blocked-skill",
        publisherId: "publishers:nvidia",
        eventType: "skill.publish",
        skillId: "skills:blocked",
        skillVersionId: "skillVersions:blocked",
        version: "4.0.0",
        eventAt: 39,
      },
    ];
    const query = queryBuilder({
      activities,
      followedPublisherIds: new Set(["publishers:nvidia"]),
    });
    const docs: Record<string, Record<string, unknown>> = {
      "publishers:nvidia": {
        _id: "publishers:nvidia",
        handle: "nvidia",
        displayName: "NVIDIA",
        kind: "org",
        image: undefined,
      },
      "skills:cuda": {
        _id: "skills:cuda",
        ownerPublisherId: "publishers:nvidia",
        displayName: "CUDA Helper",
        slug: "cuda-helper",
      },
      "skillVersions:1": {
        _id: "skillVersions:1",
        skillId: "skills:cuda",
      },
      "packages:blocked": {
        _id: "packages:blocked",
        ownerPublisherId: "publishers:nvidia",
        normalizedName: "@nvidia/blocked",
        displayName: "Blocked Plugin",
        family: "code-plugin",
        channel: "public",
      },
      "packageReleases:blocked": {
        _id: "packageReleases:blocked",
        packageId: "packages:blocked",
        manualModeration: { state: "revoked" },
      },
      "skills:blocked": {
        _id: "skills:blocked",
        ownerPublisherId: "publishers:nvidia",
        displayName: "Blocked Skill",
        slug: "blocked-skill",
      },
      "skillVersions:blocked": {
        _id: "skillVersions:blocked",
        skillId: "skills:blocked",
        llmAnalysis: { verdict: "malicious" },
      },
    };
    const get = vi.fn(async (id: string) => docs[id] ?? null);

    const result = await listMineInternalHandler(
      { db: { get, query } },
      { userId: "users:viewer", limit: 25 },
    );

    expect(result.nextCursor).toBeNull();
    expect(result.items).toEqual([
      expect.objectContaining({
        activityId: "publisherActivity:visible",
        artifact: expect.objectContaining({
          kind: "skill",
          href: "/nvidia/skills/cuda-helper",
        }),
      }),
    ]);
  });

  it("keeps an independent pagination frontier for each followed publisher", async () => {
    const activities = [
      ...[40, 30, 20].map((eventAt, index) => ({
        _id: `publisherActivity:a${index}`,
        publisherId: "publishers:a",
        eventType: "skill.publish",
        skillId: `skills:a${index}`,
        skillVersionId: `skillVersions:a${index}`,
        version: `${index + 1}.0.0`,
        eventAt,
      })),
      {
        _id: "publisherActivity:b0",
        publisherId: "publishers:b",
        eventType: "skill.publish",
        skillId: "skills:b0",
        skillVersionId: "skillVersions:b0",
        version: "1.0.0",
        eventAt: 10,
      },
    ];
    const query = queryBuilder({
      activities,
      followedPublisherIds: new Set(["publishers:a", "publishers:b"]),
    });
    const get = vi.fn(async (id: string) => {
      if (id === "publishers:a" || id === "publishers:b") {
        const handle = id.endsWith(":a") ? "a" : "b";
        return { _id: id, handle, displayName: handle.toUpperCase(), kind: "org" };
      }
      if (id.startsWith("skills:")) {
        const suffix = id.slice("skills:".length);
        return {
          _id: id,
          ownerPublisherId: `publishers:${suffix[0]}`,
          displayName: suffix.toUpperCase(),
          slug: suffix,
        };
      }
      if (id.startsWith("skillVersions:")) {
        return { _id: id, skillId: `skills:${id.slice("skillVersions:".length)}` };
      }
      return null;
    });

    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listMineInternalHandler(
        { db: { get, query } },
        { userId: "users:viewer", limit: 1, cursor },
      );
      seen.push(...(page.items as Array<{ activityId: string }>).map((item) => item.activityId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([
      "publisherActivity:a0",
      "publisherActivity:a1",
      "publisherActivity:a2",
      "publisherActivity:b0",
    ]);
  });

  it("deletes publisher activity in resumable batches", async () => {
    const deleteDoc = vi.fn();
    const runAfter = vi.fn();
    const paginate = vi.fn(async () => ({
      page: [{ _id: "publisherActivity:1" }, { _id: "publisherActivity:2" }],
      continueCursor: "next",
      isDone: false,
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
      expect.objectContaining({ publisherId: "publishers:nvidia", cursor: "next" }),
    );
  });
});
