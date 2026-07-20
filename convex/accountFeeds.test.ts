/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  buildPublisherFeedProjectionImpl,
  getPublisherDetail,
  publishPublisherFeedRevisionImpl,
} from "./accountFeeds";

type InternalHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

const getPublisherDetailHandler = (getPublisherDetail as unknown as { _handler: InternalHandler })
  ._handler;
const getPublisherFeedHandler = buildPublisherFeedProjectionImpl as InternalHandler;

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
    const insert = vi.fn(async (_table: string, value: Record<string, unknown>) => {
      existing = { _id: "publisherFeedPublications:1", ...value };
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
    expect(insert).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
