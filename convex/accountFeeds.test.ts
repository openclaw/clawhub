/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  buildPublisherFeedProjectionImpl,
  getPublisherDetail,
  getPublisherFeedChanges,
  prunePublisherFeedHistoryImpl,
  publishPublisherFeedRevisionImpl,
  queryPublisherFeedPublicationImpl,
} from "./accountFeeds";

type InternalHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

const getPublisherDetailHandler = (getPublisherDetail as unknown as { _handler: InternalHandler })
  ._handler;
const getPublisherFeedHandler = buildPublisherFeedProjectionImpl as InternalHandler;
const getPublisherFeedChangesHandler = (
  getPublisherFeedChanges as unknown as { _handler: InternalHandler }
)._handler;

function doc<T extends "users" | "publishers" | "packages" | "skills">(id: string) {
  return id as unknown as import("./_generated/dataModel").Id<T>;
}

function makeQuery(pages: unknown[] | unknown[][]) {
  const normalizedPages = Array.isArray(pages[0]) ? (pages as unknown[][]) : [pages as unknown[]];
  let index = 0;
  return {
    withIndex: vi.fn(() => ({
      order: vi.fn(() => ({
        paginate: vi.fn(async () => {
          const page = normalizedPages[index] ?? [];
          index += 1;
          return {
            page,
            isDone: index >= normalizedPages.length,
            continueCursor: index >= normalizedPages.length ? null : `cursor-${index}`,
          };
        }),
      })),
    })),
  };
}

function makePublisher() {
  return {
    _id: doc<"publishers">("publishers:alice"),
    handle: "alice",
    displayName: "Alice",
    linkedUserId: undefined,
    deletedAt: undefined,
    deactivatedAt: undefined,
  };
}

describe("publisher feed projection", () => {
  it("prunes revision markers before their bounded change journal", async () => {
    const revision = { _id: "publisherFeedRevisions:1" };
    const change = { _id: "publisherFeedChanges:1" };
    const deleted: string[] = [];
    const runAfter = vi.fn();
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        order: vi.fn(() => ({
          take: vi.fn(async () => (table === "publisherFeedRevisions" ? [revision] : [change])),
        })),
      })),
    }));
    const ctx = {
      db: { query, delete: vi.fn(async (id: string) => deleted.push(id)) },
      scheduler: { runAfter },
    } as never;

    const revisions = await prunePublisherFeedHistoryImpl(ctx, {
      publisherId: doc<"publishers">("publishers:alice"),
      cutoffSequence: 3,
      phase: "revisions",
    });

    expect(revisions).toEqual({ deleted: 1, phase: "revisions", complete: false });
    expect(deleted).toEqual(["publisherFeedRevisions:1"]);
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      publisherId: "publishers:alice",
      cutoffSequence: 3,
      phase: "changes",
    });

    const changes = await prunePublisherFeedHistoryImpl(ctx, {
      publisherId: doc<"publishers">("publishers:alice"),
      cutoffSequence: 3,
      phase: "changes",
    });
    expect(changes).toEqual({ deleted: 1, phase: "changes", complete: true });
    expect(deleted).toEqual(["publisherFeedRevisions:1", "publisherFeedChanges:1"]);
  });

  it("rejects ids that do not normalize to the publishers table", async () => {
    const get = vi.fn();
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );

    const result = await getPublisherDetailHandler(
      { db: { get, normalizeId } },
      { publisherId: "users:alice" },
    );

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("resolves public publisher details by mutable handle", async () => {
    const publisher = makePublisher();
    const unique = vi.fn(async () => publisher);
    const eq = vi.fn(() => ({ unique }));
    const withIndex = vi.fn((_name: string, apply: (q: { eq: typeof eq }) => unknown) =>
      apply({ eq }),
    );
    const query = vi.fn(() => ({ withIndex }));

    const result = await getPublisherDetailHandler(
      { db: { get: vi.fn(), normalizeId: vi.fn(() => null), query } },
      { publisherId: "@Alice" },
    );

    expect(result).toMatchObject({
      publisher: { _id: publisher._id, handle: "alice" },
      feedUrl: "/api/v1/publishers/publishers%3Aalice/feed",
    });
    expect(withIndex).toHaveBeenCalledWith("by_handle", expect.any(Function));
    expect(eq).toHaveBeenCalledWith("handle", "alice");
  });

  it("does not expose personal publishers with inactive linked users", async () => {
    const user = {
      _id: doc<"users">("users:alice"),
      _creationTime: 1,
      handle: "alice",
      name: "Alice",
      displayName: "Alice",
      personalPublisherId: doc<"publishers">("publishers:alice"),
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const publisher = {
      ...makePublisher(),
      kind: "user",
      linkedUserId: user._id,
    };
    const get = vi.fn(async (id: string): Promise<Record<string, unknown> | null> => {
      if (id === user._id) return user;
      if (id === publisher._id) return publisher;
      return null;
    });
    const normalizeId = vi.fn((table: string, id: string) => {
      if (table === "users" && id === user._id) return user._id;
      if (table === "publishers" && id === publisher._id) return publisher._id;
      return null;
    });

    get.mockImplementation(async (id: string) => {
      if (id === user._id) return { ...user, deactivatedAt: 10 };
      if (id === publisher._id) return publisher;
      return null;
    });
    const publisherDetail = await getPublisherDetailHandler(
      { db: { get, normalizeId } },
      { publisherId: String(publisher._id) },
    );
    expect(publisherDetail).toBeNull();
  });

  it("filters skill-family package rows from publisher feeds", async () => {
    const publisher = makePublisher();
    const skillPackage = {
      _id: doc<"packages">("packages:skill-mirror"),
      family: "skill",
      channel: "community",
      scanStatus: "clean",
      name: "@alice/skill-mirror",
      displayName: "Skill Mirror",
      summary: null,
      updatedAt: 20,
    };
    const pluginPackage = {
      _id: doc<"packages">("packages:plugin"),
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      name: "@alice/plugin",
      displayName: "Plugin",
      summary: null,
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );
    const query = vi.fn((table: string) =>
      table === "packages" ? makeQuery([skillPackage, pluginPackage]) : makeQuery([]),
    );

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 10 },
    )) as { status: string; entries: unknown[] };

    expect(result.status).toBe("complete");
    expect(result.entries).toEqual([
      expect.objectContaining({
        kind: "plugin",
        id: "packages:plugin",
        name: "@alice/plugin",
        url: "/alice/plugins/plugin",
      }),
    ]);
  });

  it("uses canonical publisher routes for skill entries", async () => {
    const publisher = makePublisher();
    const skill = {
      _id: "skills:demo",
      slug: "demo",
      displayName: "Demo",
      summary: null,
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
      moderationVerdict: "clean",
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );
    const query = vi.fn((table: string) =>
      table === "skills" ? makeQuery([skill]) : makeQuery([]),
    );

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 10 },
    )) as { entries: Array<{ url: string }> };

    expect(result.entries).toEqual([expect.objectContaining({ url: "/alice/skills/demo" })]);
  });

  it("bounds summaries before persisting publisher snapshots", async () => {
    const publisher = makePublisher();
    const skill = {
      _id: doc<"skills">("skills:verbose"),
      slug: "verbose",
      displayName: "Verbose",
      summary: `${"x".repeat(499)}😀${"y".repeat(1_500)}`,
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
      moderationVerdict: "clean",
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id === publisher._id ? publisher._id : null,
    );
    const query = vi.fn((table: string) =>
      table === "skills" ? makeQuery([skill]) : makeQuery([]),
    );

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id) },
    )) as { entries: Array<{ summary: string }> };

    expect(result.entries[0]?.summary).toBe("x".repeat(499));
  });

  it("includes legacy ownerUserId-only content for personal publishers", async () => {
    const user = {
      _id: doc<"users">("users:alice"),
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const publisher = { ...makePublisher(), kind: "user", linkedUserId: user._id };
    const legacySkill = {
      _id: doc<"skills">("skills:legacy"),
      ownerUserId: user._id,
      ownerPublisherId: undefined,
      slug: "legacy",
      displayName: "Legacy",
      summary: null,
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
      moderationVerdict: "clean",
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => {
      if (id === publisher._id) return publisher;
      if (id === user._id) return user;
      return null;
    });
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id === publisher._id ? publisher._id : null,
    );
    let skillQueryCount = 0;
    const query = vi.fn((table: string) => {
      if (table !== "skills") return makeQuery([]);
      skillQueryCount += 1;
      return skillQueryCount === 1 ? makeQuery([]) : makeQuery([legacySkill]);
    });

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 10 },
    )) as { status: string; entries: Array<{ id: string }> };

    expect(result.status).toBe("complete");
    expect(result.entries.map((entry) => entry.id)).toEqual(["skills:legacy"]);
  });

  it("uses stable entry identity to break equal timestamp ties", async () => {
    const publisher = makePublisher();
    const packages = [
      {
        _id: doc<"packages">("packages:z"),
        family: "code-plugin",
        channel: "community",
        scanStatus: "clean",
        name: "@alice/aaa",
        displayName: "A",
        summary: null,
        updatedAt: 10,
      },
      {
        _id: doc<"packages">("packages:a"),
        family: "code-plugin",
        channel: "community",
        scanStatus: "clean",
        name: "@alice/zzz",
        displayName: "Z",
        summary: null,
        updatedAt: 10,
      },
    ];
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );
    const query = vi.fn((table: string) =>
      table === "packages" ? makeQuery(packages) : makeQuery([]),
    );

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 10 },
    )) as { entries: Array<{ id: string }> };

    expect(result.entries.map((entry) => entry.id)).toEqual(["packages:a", "packages:z"]);
  });

  it("continues past filtered package rows to find older public entries", async () => {
    const publisher = makePublisher();
    const privatePackage = {
      _id: doc<"packages">("packages:private"),
      family: "code-plugin",
      channel: "private",
      scanStatus: "clean",
      name: "@alice/private",
      displayName: "Private",
      summary: null,
      updatedAt: 30,
    };
    const publicPackage = {
      _id: doc<"packages">("packages:public"),
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      name: "@alice/public",
      displayName: "Public",
      summary: null,
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );
    const packagesQuery = makeQuery([[privatePackage], [publicPackage]]);
    const query = vi.fn((table: string) => (table === "packages" ? packagesQuery : makeQuery([])));

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 1 },
    )) as { status: string; entries: unknown[] };

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "packages:public",
        name: "@alice/public",
      }),
    ]);
    expect(result.status).toBe("complete");
  });

  it("bounds scans when package rows keep filtering out", async () => {
    const publisher = makePublisher();
    const privatePackage = {
      _id: doc<"packages">("packages:private"),
      family: "code-plugin",
      channel: "private",
      scanStatus: "clean",
      name: "@alice/private",
      displayName: "Private",
      summary: null,
      updatedAt: 30,
    };
    const publicPackage = {
      _id: doc<"packages">("packages:public"),
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      name: "@alice/public",
      displayName: "Public",
      summary: null,
      updatedAt: 10,
    };
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id.startsWith("publishers:") ? doc<"publishers">(id) : null,
    );
    const packagesQuery = makeQuery([
      [privatePackage],
      [privatePackage],
      [privatePackage],
      [publicPackage],
    ]);
    const query = vi.fn((table: string) => (table === "packages" ? packagesQuery : makeQuery([])));

    const result = (await getPublisherFeedHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), limit: 1 },
    )) as { status: string; entries?: unknown[] };

    expect(result).toEqual({ status: "capacity-exceeded" });
  });

  it("reuses a revision for unchanged content and increments changed content", async () => {
    const publisher = { ...makePublisher(), kind: "org" };
    let existing: Record<string, unknown> | null = null;
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({ unique: vi.fn(async () => existing) })),
    }));
    const revisions: Record<string, unknown>[] = [];
    const changes: Record<string, unknown>[] = [];
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publisherFeedPublications") {
        existing = { _id: "publisherFeedPublications:1", ...value };
        return;
      }
      if (table === "publisherFeedRevisions") revisions.push(value);
      if (table === "publisherFeedChanges") changes.push(value);
    });
    const patch = vi.fn(async (_id: string, value: Record<string, unknown>) => {
      existing = { ...existing, ...value };
    });
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const args = {
      publisherId: publisher._id,
      feedId: "clawhub.publisher.publishers:alice",
      handle: "alice",
      displayName: "Alice",
      entries: [],
    };

    const first = (await publishPublisherFeedRevisionImpl(
      { db: { get, query, insert, patch } } as never,
      args,
    )) as { sequence: number; generatedAt: string };
    const unchanged = (await publishPublisherFeedRevisionImpl(
      { db: { get, query, insert, patch } } as never,
      args,
    )) as { sequence: number; generatedAt: string };
    const changed = (await publishPublisherFeedRevisionImpl(
      { db: { get, query, insert, patch } } as never,
      { ...args, displayName: "Alice Updated" },
    )) as { sequence: number };

    expect(first.sequence).toBe(1);
    expect(unchanged).toMatchObject({ sequence: 1, generatedAt: first.generatedAt });
    expect(changed.sequence).toBe(2);
    expect(
      insert.mock.calls.filter(([table]) => table === "publisherFeedPublications"),
    ).toHaveLength(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(revisions.map((revision) => revision.sequence)).toEqual([1, 2]);
    expect(changes).toMatchObject([
      { sequence: 1, changeNumber: 1, operation: "metadata" },
      { sequence: 2, changeNumber: 2, operation: "metadata" },
    ]);
  });

  it("queries a coherent publisher revision with normalized text and kind filters", () => {
    const publication = {
      publisherId: doc<"publishers">("publishers:alice"),
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 3,
      generatedAt: "2026-07-16T00:00:00.000Z",
      handle: "alice",
      displayName: "Alice",
      cumulativeChangeCount: 4,
      entries: [
        {
          kind: "skill" as const,
          id: "skills:cuda",
          name: "cuda-helper",
          displayName: "CUDA Helper",
          summary: "GPU tools",
          url: "/alice/skills/cuda-helper",
          updatedAt: 2,
        },
        {
          kind: "plugin" as const,
          id: "packages:cuda",
          name: "@alice/cuda-plugin",
          displayName: "CUDA Plugin",
          summary: null,
          url: "/alice/plugins/cuda-plugin",
          updatedAt: 1,
        },
      ],
    };

    const result = queryPublisherFeedPublicationImpl(
      publication,
      { text: "  CUDA\tHelper ", kinds: ["skill", "skill"] },
      0,
      20,
    );

    expect(result).toMatchObject({
      sequence: 3,
      query: { text: "CUDA Helper", kinds: ["skill"] },
      startIndex: 0,
      resultCount: 1,
      entries: [{ id: "skills:cuda" }],
      nextOffset: null,
    });
  });

  it("records entry upserts and removal tombstones in deterministic order", async () => {
    const publisher = { ...makePublisher(), kind: "org" };
    const oldEntry = {
      kind: "skill" as const,
      id: "skills:old",
      name: "old",
      displayName: "Old",
      summary: null,
      url: "/alice/skills/old",
      updatedAt: 1,
    };
    let publication: Record<string, unknown> | null = {
      _id: "publisherFeedPublications:1",
      publisherId: publisher._id,
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 4,
      generatedAt: "2026-07-16T00:00:00.000Z",
      handle: "alice",
      displayName: "Alice",
      entries: [oldEntry],
      contentKey: "old",
      cumulativeChangeCount: 7,
      publishedAt: 1,
    };
    const changes: Record<string, unknown>[] = [];
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({ unique: vi.fn(async () => publication) })),
    }));
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publisherFeedChanges") changes.push(value);
    });
    const patch = vi.fn(async (_id: string, value: Record<string, unknown>) => {
      publication = { ...publication, ...value };
    });
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const newEntry = {
      kind: "plugin" as const,
      id: "packages:new",
      name: "@alice/new",
      displayName: "New",
      summary: null,
      url: "/alice/plugins/new",
      updatedAt: 2,
    };

    const result = (await publishPublisherFeedRevisionImpl(
      { db: { get, query, insert, patch } } as never,
      {
        publisherId: publisher._id,
        feedId: "clawhub.publisher.publishers:alice",
        handle: "alice",
        displayName: "Alice",
        entries: [newEntry],
      },
    )) as { sequence: number };

    expect(result.sequence).toBe(5);
    expect(changes).toMatchObject([
      { sequence: 5, changeNumber: 8, operation: "upsert", entry: { id: "packages:new" } },
      {
        sequence: 5,
        changeNumber: 9,
        operation: "remove",
        entryId: "skills:old",
        entryKind: "skill",
      },
    ]);
  });

  it("returns bounded contiguous changes from a retained revision", async () => {
    const publisher = { ...makePublisher(), kind: "org" };
    const publication = {
      publisherId: publisher._id,
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 2,
      cumulativeChangeCount: 3,
    };
    const revisions = new Map([
      [1, { sequence: 1, cumulativeChangeCount: 1 }],
      [2, { sequence: 2, cumulativeChangeCount: 3 }],
    ]);
    const changes = [
      {
        sequence: 2,
        changeNumber: 2,
        operation: "upsert",
        entry: {
          kind: "skill",
          id: "skills:new",
          name: "new",
          displayName: "New",
          summary: null,
          url: "/alice/skills/new",
          updatedAt: 2,
        },
      },
      {
        sequence: 2,
        changeNumber: 3,
        operation: "remove",
        entryId: "skills:old",
        entryKind: "skill",
      },
    ];
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn((_name: string, applyIndex: (q: unknown) => unknown) => {
        const values = new Map<string, unknown>();
        const q = {
          eq: vi.fn((field: string, value: unknown) => (values.set(field, value), q)),
          gte: vi.fn(() => q),
          lte: vi.fn(() => q),
        };
        applyIndex(q);
        if (table === "publisherFeedPublications") {
          return { unique: vi.fn(async () => publication) };
        }
        if (table === "publisherFeedRevisions") {
          return { unique: vi.fn(async () => revisions.get(Number(values.get("sequence")))) };
        }
        return {
          order: vi.fn(() => ({ take: vi.fn(async () => changes) })),
        };
      }),
    }));
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id === publisher._id ? publisher._id : null,
    );

    const result = await getPublisherFeedChangesHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), fromSequence: 1, offset: 0, limit: 10 },
    );

    expect(result).toMatchObject({
      status: "complete",
      fromSequence: 1,
      toSequence: 2,
      startIndex: 0,
      changeCount: 2,
      changes: [
        { operation: "upsert", entry: { id: "skills:new" } },
        { operation: "remove", entryId: "skills:old" },
      ],
      nextOffset: null,
    });
  });

  it("requires reset when sequence one is only a legacy zero-change baseline", async () => {
    const publisher = { ...makePublisher(), kind: "org" };
    const publication = {
      publisherId: publisher._id,
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 1,
      cumulativeChangeCount: 0,
    };
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () =>
          table === "publisherFeedPublications"
            ? publication
            : { sequence: 1, cumulativeChangeCount: 0 },
        ),
      })),
    }));
    const get = vi.fn(async (id: string) => (id === publisher._id ? publisher : null));
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "publishers" && id === publisher._id ? publisher._id : null,
    );

    const result = await getPublisherFeedChangesHandler(
      { db: { get, normalizeId, query } },
      { publisherId: String(publisher._id), fromSequence: 0, offset: 0, limit: 10 },
    );

    expect(result).toEqual({
      status: "reset-required",
      feedId: "clawhub.publisher.publishers:alice",
      fromSequence: 0,
      currentSequence: 1,
    });
  });
});
