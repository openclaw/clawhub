/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { getAccountDetail, getPublisherFeed } from "./accountFeeds";

type InternalHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

const getAccountDetailHandler = (getAccountDetail as unknown as { _handler: InternalHandler })
  ._handler;
const getPublisherFeedHandler = (getPublisherFeed as unknown as { _handler: InternalHandler })
  ._handler;

function doc<T extends "users" | "publishers" | "packages">(id: string) {
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

describe("account feed projection", () => {
  it("rejects account ids that do not normalize to the users table", async () => {
    const get = vi.fn();
    const normalizeId = vi.fn((table: string, id: string) =>
      table === "users" && id.startsWith("users:") ? doc<"users">(id) : null,
    );

    const result = await getAccountDetailHandler(
      { db: { get, normalizeId } },
      { accountId: "publishers:alice" },
    );

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
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
    )) as { entries: unknown[]; nextCursor: string | null };

    expect(result.entries).toEqual([
      expect.objectContaining({
        kind: "plugin",
        id: "packages:plugin",
        name: "@alice/plugin",
      }),
    ]);
    expect(result.nextCursor).toBeNull();
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
    )) as { entries: unknown[]; nextCursor: string | null };

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "packages:public",
        name: "@alice/public",
      }),
    ]);
    expect(result.nextCursor).toBeNull();
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
    )) as { entries: unknown[]; nextCursor: string | null };

    expect(result.entries).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
