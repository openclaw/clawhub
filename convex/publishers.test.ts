import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import { assertCanManageOwnedResource } from "./lib/publishers";
import {
  addMember,
  listPublicPage,
  listPublic,
  listMine,
  listPublishedPage,
  migrateLegacyPublisherHandleToOrgInternal,
  removeMember,
  setTrustedPublisherInternal,
  updateProfile,
} from "./publishers";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const addMemberHandler = (
  addMember as unknown as WrappedHandler<{
    publisherId: string;
    userHandle: string;
    role: "owner" | "admin" | "publisher";
  }>
)._handler;

const removeMemberHandler = (
  removeMember as unknown as WrappedHandler<{ publisherId: string; userId: string }>
)._handler;

const migrateLegacyPublisherHandleToOrgInternalHandler = (
  migrateLegacyPublisherHandleToOrgInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      fallbackUserHandle?: string;
      displayName?: string;
    },
    {
      ok: true;
      handle: string;
      orgPublisherId: string;
      legacyUserId: string;
      fallbackUserHandle: string;
      personalPublisherId: string | null;
      convertedExistingPublisher: boolean;
      packagesMigrated: number;
    }
  >
)._handler;

const listMineHandler = (
  listMine as unknown as WrappedHandler<Record<string, never>, Array<unknown>>
)._handler;

const listPublicHandler = (
  listPublic as unknown as WrappedHandler<
    { limit?: number; kind?: "user" | "org" },
    {
      items: Array<{ handle: string; kind: "user" | "org"; stats: { downloads: number } }>;
      total: number;
      counts: { all: number; individuals: number; organizations: number };
      limit: number;
    }
  >
)._handler;

const listPublicPageHandler = (
  listPublicPage as unknown as WrappedHandler<
    {
      kind?: "user" | "org";
      query?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{
        handle: string;
        kind: "user" | "org";
        stats: { downloads: number };
        publishedItems: Array<{ displayName: string; downloads: number }>;
      }>;
      counts: { all: number; individuals: number; organizations: number };
      globalCounts: { all: number; individuals: number; organizations: number };
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const listPublishedPageHandler = (
  listPublishedPage as unknown as WrappedHandler<
    {
      handle: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{ displayName: string; href: string }>;
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const updateProfileHandler = (
  updateProfile as unknown as WrappedHandler<{
    publisherId: string;
    displayName: string;
    bio?: string;
    image?: string;
  }>
)._handler;

const setTrustedPublisherInternalHandler = (
  setTrustedPublisherInternal as unknown as WrappedHandler<{
    actorUserId: string;
    publisherId: string;
    trustedPublisher: boolean;
  }>
)._handler;

function indexedRows<T>(rows: T[]) {
  return {
    collect: vi.fn(async () => rows),
    order: vi.fn(() => ({ take: vi.fn(async (limit: number) => rows.slice(0, limit)) })),
  };
}

describe("publishers membership controls", () => {
  it("rejects org handles reserved for public routes", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "users:admin" ? { _id: id, role: "admin" } : null,
        ),
        query: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      migrateLegacyPublisherHandleToOrgInternalHandler(ctx, {
        actorUserId: "users:admin",
        handle: "skills",
      }),
    ).rejects.toThrow('Handle "@skills" is reserved for ClawHub routes');
  });

  it("lists individual and org publishers ranked by aggregate downloads", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice",
        linkedUserId: "users:alice",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const skillRows = [
      {
        _id: "skills:alice",
        ownerPublisherId: "publishers:alice",
        softDeletedAt: undefined,
        statsDownloads: 4,
        statsStars: 1,
        statsInstallsAllTime: 3,
        stats: { downloads: 4, stars: 1, installsCurrent: 1, installsAllTime: 3 },
      },
      {
        _id: "skills:openclaw",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        statsDownloads: 20,
        statsStars: 2,
        statsInstallsAllTime: 15,
        stats: { downloads: 20, stars: 2, installsCurrent: 4, installsAllTime: 15 },
      },
    ];
    const packageRows = [
      {
        _id: "packages:alice",
        ownerPublisherId: "publishers:alice",
        softDeletedAt: undefined,
        stats: { downloads: 5, stars: 0, installs: 2, versions: 1 },
      },
    ];

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(
                skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(
                packageRows.filter((pkg) => pkg.ownerPublisherId === fields.ownerPublisherId),
              );
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicHandler(ctx as never, { limit: 48 });

    expect(result.total).toBe(2);
    expect(result.counts).toEqual({ all: 2, individuals: 1, organizations: 1 });
    expect(result.items.map((item) => item.handle)).toEqual(["openclaw", "alice"]);
    expect(result.items.map((item) => item.kind)).toEqual(["org", "user"]);
    expect(result.items.map((item) => item.stats.downloads)).toEqual([20, 9]);
  });

  it("filters public publisher listings by kind", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice",
        linkedUserId: "users:alice",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 4,
        totalDownloads: 10,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 0,
        publishedPackages: 1,
        totalInstalls: 20,
        totalDownloads: 40,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicHandler(ctx as never, { kind: "org" });

    expect(result.total).toBe(1);
    expect(result.counts).toEqual({ all: 2, individuals: 1, organizations: 1 });
    expect(result.items.map((item) => item.handle)).toEqual(["openclaw"]);
  });

  it("pages public publishers by kind and query", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice Labs",
        linkedUserId: "users:alice",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 4,
        totalDownloads: 10,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:bob",
        _creationTime: 1,
        kind: "user",
        handle: "bob",
        displayName: "Bob Tools",
        linkedUserId: "users:bob",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 2,
        totalDownloads: 8,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 0,
        publishedPackages: 1,
        totalInstalls: 20,
        totalDownloads: 40,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          if (id === "users:bob") return { _id: id, image: "https://github.com/bob.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_kind_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () =>
                    publisherRows.filter((publisher) => publisher.kind === fields.kind),
                  ),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                collect: vi.fn(async () =>
                  publisherRows.filter((publisher) => publisher.kind === fields.kind),
                ),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      kind: "user",
      query: "alice",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.counts).toEqual({ all: 1, individuals: 1, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 3, individuals: 2, organizations: 1 });
    expect(result.page.map((item) => item.handle)).toEqual(["alice"]);
  });

  it("orders public publisher card previews by downloads", async () => {
    const publisherRows = [
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 1,
        publishedPackages: 4,
        totalInstalls: 20,
        totalDownloads: 364,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const skillRows = [
      {
        _id: "skills:popular-skill",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        displayName: "Popular Skill",
        statsDownloads: 98,
        statsStars: 1,
        statsInstallsAllTime: 1,
        stats: { downloads: 98, stars: 1, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 1,
      },
    ];
    const packageRows = [
      {
        _id: "packages:popular-plugin",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Popular Plugin",
        stats: { downloads: 128, stars: 1, installs: 1, versions: 1 },
        updatedAt: 1,
      },
      {
        _id: "packages:recent-plugin",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Plugin",
        stats: { downloads: 12, stars: 1, installs: 1, versions: 1 },
        updatedAt: 5,
      },
      {
        _id: "packages:recent-helper",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Helper",
        stats: { downloads: 11, stars: 1, installs: 1, versions: 1 },
        updatedAt: 4,
      },
      {
        _id: "packages:recent-tool",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Tool",
        stats: { downloads: 10, stars: 1, installs: 1, versions: 1 },
        updatedAt: 3,
      },
    ];
    const rowsByDownloads = <
      T extends { updatedAt: number; stats?: { downloads: number }; statsDownloads?: number },
    >(
      rows: T[],
    ) =>
      [...rows].sort(
        (a, b) =>
          (b.statsDownloads ?? b.stats?.downloads ?? 0) -
            (a.statsDownloads ?? a.stats?.downloads ?? 0) || b.updatedAt - a.updatedAt,
      );
    const ctx = {
      db: {
        get: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
              return indexedRows(
                rowsByDownloads(
                  skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
                ),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
              return indexedRows(
                rowsByDownloads(
                  packageRows.filter((pkg) => pkg.ownerPublisherId === fields.ownerPublisherId),
                ),
              );
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page[0]?.publishedItems.map((item) => item.displayName)).toEqual([
      "Popular Plugin",
      "Popular Skill",
      "Recent Plugin",
    ]);
    expect(result.page[0]?.publishedItems.map((item) => item.downloads)).toEqual([128, 98, 12]);
  });

  it("does not hydrate every publisher before filtering public publisher pages", async () => {
    const publisherRows = Array.from({ length: 120 }, (_, index) => ({
      _id: `publishers:user-${index}`,
      _creationTime: index,
      kind: "user",
      handle: `user-${index}`,
      displayName: `User ${index}`,
      linkedUserId: `users:user-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 120 - index,
      totalDownloads: 120 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const get = vi.fn(async (id: string) => ({ _id: id, image: `https://github.com/${id}.png` }));
    const ownerPublisherQueries: string[] = [];
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              ownerPublisherQueries.push(String(fields.ownerPublisherId));
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((item) => item.handle)).toEqual(["user-0"]);
    expect(result.globalCounts).toEqual({ all: 120, individuals: 120, organizations: 0 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("users:user-0");
    expect(ownerPublisherQueries).toEqual(["publishers:user-0", "publishers:user-0"]);
  });

  it("does not hydrate publishers when a public publisher search has no matches", async () => {
    const publisherRows = Array.from({ length: 120 }, (_, index) => ({
      _id: `publishers:user-${index}`,
      _creationTime: index,
      kind: "user",
      handle: `user-${index}`,
      displayName: `User ${index}`,
      linkedUserId: `users:user-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 120 - index,
      totalDownloads: 120 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const get = vi.fn();
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const q = {
              eq: () => q,
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      query: "no matching publisher",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([]);
    expect(result.counts).toEqual({ all: 0, individuals: 0, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 120, individuals: 120, organizations: 0 });
    expect(get).not.toHaveBeenCalled();
  });

  it("builds scoped plugin profile links with route segments", async () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:openclaw" ? publisher : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () => (fields.handle === "openclaw" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "packages:plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/example-plugin",
                  displayName: "Example Plugin",
                  summary: "Scoped plugin",
                  stats: { downloads: 7, installs: 3, stars: 1, versions: 1 },
                  updatedAt: 5,
                },
              ]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      paginationOpts: { cursor: null, numItems: 12 },
    });

    expect(result.page).toMatchObject([
      { displayName: "Example Plugin", href: "/plugins/@openclaw/example-plugin" },
    ]);
  });

  it("includes skill.icon on catalog items and surfaces null for plugins (F7)", async () => {
    // Regression guard for F2: listPublishedPage must mirror `skills.icon`
    // onto the catalog DTO so the publisher profile page (/p/<handle>) can
    // render the same custom glyph that SkillCard / SkillListItem show on
    // /skills and /search. Plugins always carry `icon: null` in Phase 1.
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:openclaw" ? publisher : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () => (fields.handle === "openclaw" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "skills:icon-skill",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  slug: "icon-skill",
                  displayName: "Icon Skill",
                  summary: "Has a custom icon",
                  icon: "lucide:Plug",
                  stats: {
                    downloads: 10,
                    downloadsAllTime: 10,
                    installs: 5,
                    installsAllTime: 5,
                    stars: 2,
                  },
                  updatedAt: 8,
                },
                {
                  _id: "skills:plain-skill",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  slug: "plain-skill",
                  displayName: "Plain Skill",
                  summary: "No icon set",
                  // icon intentionally absent — must surface as null on the DTO
                  stats: {
                    downloads: 7,
                    downloadsAllTime: 7,
                    installs: 3,
                    installsAllTime: 3,
                    stars: 1,
                  },
                  updatedAt: 6,
                },
              ]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "packages:plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/example-plugin",
                  displayName: "Example Plugin",
                  summary: "A plugin",
                  stats: { downloads: 5, installs: 2, stars: 0, versions: 1 },
                  updatedAt: 4,
                },
              ]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = (await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      paginationOpts: { cursor: null, numItems: 12 },
    })) as unknown as {
      page: Array<{
        displayName: string;
        kind: "skill" | "plugin";
        icon: string | null;
      }>;
    };

    const byName = Object.fromEntries(result.page.map((item) => [item.displayName, item]));
    // Skill with a stored icon must surface it on the DTO.
    expect(byName["Icon Skill"]).toMatchObject({ kind: "skill", icon: "lucide:Plug" });
    // Skill without an icon must surface null (not undefined) so the client
    // type is uniform and MarketplaceIcon can safely pass it to parseSkillIcon.
    expect(byName["Plain Skill"]).toMatchObject({ kind: "skill", icon: null });
    // Plugins always carry null in Phase 1.
    expect(byName["Example Plugin"]).toMatchObject({ kind: "plugin", icon: null });
  });

  it("prevents admins from promoting members to owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "peter", role: "owner" } as never,
      ),
    ).rejects.toThrow("Only org owners can promote members to owner");
  });

  it("prevents removing the last remaining owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_publisher_user") {
                  return {
                    unique: vi
                      .fn()
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-actor",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      })
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      }),
                  };
                }
                if (indexName === "by_publisher") {
                  return {
                    collect: vi.fn().mockResolvedValue([
                      {
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      },
                    ]),
                  };
                }
                throw new Error(`unexpected index ${indexName}`);
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        delete: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      removeMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userId: "users:owner" } as never,
      ),
    ).rejects.toThrow("Publisher must have at least one owner");
  });

  it("adds a member when the requested handle resolves via a personal publisher", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const publisherMembers: Array<Record<string, unknown>> = [
      {
        _id: "publisherMembers:owner",
        publisherId: "publishers:org",
        userId: "users:owner",
        role: "owner",
      },
    ];
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publisherMembers") {
        const row = { _id: "publisherMembers:new", ...value };
        publisherMembers.push(row);
        return row._id;
      }
      if (table === "auditLogs") return "auditLogs:1";
      if (table === "publishers") return "publishers:jaredforreal";
      throw new Error(`unexpected insert ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "users:jared") {
            return {
              _id: id,
              _creationTime: 1,
              handle: undefined,
              name: "JaredForReal",
              displayName: "Jared",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "zai-org",
              displayName: "ZAI Org",
            };
          }
          if (id === "publishers:jaredforreal") {
            return {
              _id: id,
              _creationTime: 1,
              kind: "user",
              handle: "jaredforreal",
              displayName: "Jared",
              linkedUserId: "users:jared",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  if (indexName !== "by_publisher_user") {
                    throw new Error(`unexpected index ${indexName}`);
                  }
                  let publisherId = "";
                  let userId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "publisherId") publisherId = value;
                      if (field === "userId") userId = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(
                      async () =>
                        publisherMembers.find(
                          (member) =>
                            member.publisherId === publisherId && member.userId === userId,
                        ) ?? null,
                    ),
                  };
                },
              ),
            };
          }
          if (table === "users") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  if (indexName !== "handle") {
                    throw new Error(`unexpected index ${indexName}`);
                  }
                  let handle = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "handle") handle = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(async () => {
                      if (handle === "owner") return { _id: "users:owner", handle: "owner" };
                      return null;
                    }),
                  };
                },
              ),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let handle = "";
                  let linkedUserId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "handle") handle = value;
                      if (field === "linkedUserId") linkedUserId = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(async () => {
                      if (indexName === "by_handle" && handle === "jaredforreal") {
                        return {
                          _id: "publishers:jaredforreal",
                          _creationTime: 1,
                          kind: "user",
                          handle: "jaredforreal",
                          displayName: "Jared",
                          linkedUserId: "users:jared",
                          trustedPublisher: false,
                          createdAt: 1,
                          updatedAt: 1,
                        };
                      }
                      if (indexName === "by_linked_user" && linkedUserId === "users:jared") {
                        return {
                          _id: "publishers:jaredforreal",
                          _creationTime: 1,
                          kind: "user",
                          handle: "jaredforreal",
                          displayName: "Jared",
                          linkedUserId: "users:jared",
                          trustedPublisher: false,
                          createdAt: 1,
                          updatedAt: 1,
                        };
                      }
                      return null;
                    }),
                  };
                },
              ),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert,
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "jaredforreal", role: "admin" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(insert).toHaveBeenCalledWith(
      "publisherMembers",
      expect.objectContaining({
        publisherId: "publishers:org",
        userId: "users:jared",
        role: "admin",
      }),
    );
  });

  it("lets org admins update org profile fields", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "shopify",
              displayName: "Shopify",
              image: undefined,
              bio: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert,
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      updateProfileHandler(
        ctx as never,
        {
          publisherId: "publishers:org",
          displayName: "Shopify",
          bio: "Commerce platform",
          image: "https://cdn.example.com/shopify.png",
        } as never,
      ),
    ).resolves.toEqual({
      ok: true,
      publisher: expect.objectContaining({
        _id: "publishers:org",
        displayName: "Shopify",
      }),
    });

    expect(patch).toHaveBeenCalledWith(
      "publishers:org",
      expect.objectContaining({
        displayName: "Shopify",
        bio: "Commerce platform",
        image: "https://cdn.example.com/shopify.png",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.profile.update",
        targetId: "publishers:org",
      }),
    );
  });

  it("rejects invalid org profile image URLs", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "shopify",
              displayName: "Shopify",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      updateProfileHandler(
        ctx as never,
        {
          publisherId: "publishers:org",
          displayName: "Shopify",
          image: "not-a-url",
        } as never,
      ),
    ).rejects.toThrow("Image must be a valid URL");
  });
});

describe("publisher audit logs", () => {
  it("audits org trusted-publisher changes", async () => {
    const patch = vi.fn();
    const insert = vi.fn(async () => "auditLogs:1");
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id, role: "admin" };
          if (id === "publishers:openclaw") {
            return {
              _id: id,
              kind: "org",
              handle: "openclaw",
              trustedPublisher: false,
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await setTrustedPublisherInternalHandler(ctx, {
      actorUserId: "users:admin",
      publisherId: "publishers:openclaw",
      trustedPublisher: true,
    });

    expect(patch).toHaveBeenCalledWith("publishers:openclaw", {
      trustedPublisher: true,
      updatedAt: expect.any(Number),
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.trusted.set",
        actorUserId: "users:admin",
        targetType: "publisher",
        targetId: "publishers:openclaw",
        metadata: {
          handle: "openclaw",
          previousTrustedPublisher: false,
          trustedPublisher: true,
        },
      }),
    );
  });
});

describe("publisher-owned resource authorization", () => {
  function makeOwnerResourceCtx(options: {
    publisher: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
  }) {
    return {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:owner") return options.publisher;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(options.membership ?? null),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
  }

  it("does not let stale ownerUserId bypass org ownership", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: { _id: "publishers:owner", kind: "org", handle: "opik" },
    });

    await expect(
      assertCanManageOwnedResource(
        ctx as never,
        {
          actor: { _id: "users:vincent" },
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:owner",
        } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("keeps linked users authorized for personal publishers", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: "users:vincent",
      },
    });

    await expect(
      assertCanManageOwnedResource(
        ctx as never,
        {
          actor: { _id: "users:vincent" },
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:owner",
        } as never,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("publisher bootstrap", () => {
  function makeSynthesizedPublisherCtx(userId: string, user: Record<string, unknown>) {
    return {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === userId) return { _id: id, ...user };
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
  }

  it("lists a synthesized personal publisher when membership rows are missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "alice",
              displayName: "Alice",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          handle: "alice",
          kind: "user",
          linkedUserId: "users:alice",
        }),
      }),
    ]);
  });

  it("derives route-safe handles for synthesized personal publishers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:local" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:local") {
            return {
              _id: id,
              _creationTime: 1,
              name: "Local Owner",
              displayName: "Local Owner",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          displayName: "Local Owner",
          handle: "local-owner",
          kind: "user",
          linkedUserId: "users:local",
        }),
      }),
    ]);
  });

  it("falls back when synthesized personal publisher handles sanitize to empty", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:symbols" as never);
    const ctx = makeSynthesizedPublisherCtx("users:symbols", {
      _creationTime: 1,
      name: "!!!",
      displayName: "!!!",
      trustedPublisher: false,
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          displayName: "!!!",
          handle: "user",
          kind: "user",
          linkedUserId: "users:symbols",
        }),
      }),
    ]);
  });
});

describe("legacy publisher migration", () => {
  it("converts a legacy personal publisher into an org and rehomes package ownership", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin" }],
      [
        "users:openclaw",
        {
          _id: "users:openclaw",
          _creationTime: 1,
          handle: "openclaw",
          displayName: "OpenClaw",
          trustedPublisher: true,
          personalPublisherId: "publishers:openclaw",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:openclaw",
        {
          _id: "publishers:openclaw",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw",
          displayName: "OpenClaw",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        "publishers:openclaw-user",
        {
          _id: "publishers:openclaw-user",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw-user",
          displayName: "OpenClaw User",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const packages = [
      {
        _id: "packages:demo",
        ownerUserId: "users:openclaw",
        ownerPublisherId: undefined,
        updatedAt: 1,
      },
    ];
    const publisherMembers = [
      {
        _id: "publisherMembers:openclaw-owner",
        publisherId: "publishers:openclaw",
        userId: "users:openclaw",
        role: "owner",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (users.has(id)) {
        users.set(id, { ...users.get(id), ...value });
        return;
      }
      if (publishers.has(id)) {
        publishers.set(id, { ...publishers.get(id), ...value });
        return;
      }
      const pkg = packages.find((entry) => entry._id === id);
      if (pkg) {
        Object.assign(pkg, value);
        return;
      }
      const member = publisherMembers.find((entry) => entry._id === id);
      if (member) {
        Object.assign(member, value);
        return;
      }
      throw new Error(`unexpected patch ${id}`);
    });

    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publishers") {
        const id = "publishers:openclaw-user";
        publishers.set(id, { _id: id, _creationTime: 1, ...value });
        return id;
      }
      if (table === "publisherMembers") {
        const id = `publisherMembers:${publisherMembers.length + 1}`;
        publisherMembers.push({
          _id: id,
          publisherId: String(value.publisherId),
          userId: String(value.userId),
          role: String(value.role),
          createdAt: Number(value.createdAt),
          updatedAt: Number(value.updatedAt),
        });
        return id;
      }
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`unexpected insert ${table}`);
    });

    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () => [...users.values()].find((user) => user.handle === handle) ?? null,
                ),
              };
            },
          ),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              let linkedUserId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  if (field === "linkedUserId") linkedUserId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(async () => {
                  if (handle) {
                    return (
                      [...publishers.values()].find((publisher) => publisher.handle === handle) ??
                      null
                    );
                  }
                  if (linkedUserId) {
                    return (
                      [...publishers.values()].find(
                        (publisher) => publisher.linkedUserId === linkedUserId,
                      ) ?? null
                    );
                  }
                  return null;
                }),
              };
            },
          ),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let publisherId = "";
              let userId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "publisherId") publisherId = value;
                  if (field === "userId") userId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () =>
                    publisherMembers.find(
                      (member) => member.publisherId === publisherId && member.userId === userId,
                    ) ?? null,
                ),
              };
            },
          ),
        };
      }
      if (table === "packages") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let ownerUserId = "";
              let ownerPublisherId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "ownerUserId") ownerUserId = value;
                  if (field === "ownerPublisherId") ownerPublisherId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                collect: vi.fn(async () => {
                  if (ownerUserId) {
                    return packages.filter((pkg) => pkg.ownerUserId === ownerUserId);
                  }
                  if (ownerPublisherId) {
                    return packages.filter((pkg) => pkg.ownerPublisherId === ownerPublisherId);
                  }
                  return [];
                }),
              };
            },
          ),
        };
      }
      if (table === "skills") {
        return {
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await migrateLegacyPublisherHandleToOrgInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => users.get(id) ?? publishers.get(id) ?? null),
          query,
          patch,
          insert,
          delete: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "openclaw",
        fallbackUserHandle: "openclaw-user",
        displayName: "OpenClaw",
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "openclaw",
      orgPublisherId: "publishers:openclaw",
      legacyUserId: "users:openclaw",
      fallbackUserHandle: "openclaw-user",
      personalPublisherId: "publishers:openclaw-user",
      convertedExistingPublisher: true,
      packagesMigrated: 1,
    });
    expect(users.get("users:openclaw")).toEqual(
      expect.objectContaining({
        handle: "openclaw-user",
        personalPublisherId: "publishers:openclaw-user",
      }),
    );
    expect(publishers.get("publishers:openclaw")).toEqual(
      expect.objectContaining({
        kind: "org",
        handle: "openclaw",
        linkedUserId: undefined,
      }),
    );
    expect(publishers.get("publishers:openclaw-user")).toEqual(
      expect.objectContaining({
        kind: "user",
        handle: "openclaw-user",
        linkedUserId: "users:openclaw",
      }),
    );
    expect(packages[0]).toEqual(
      expect.objectContaining({
        ownerPublisherId: "publishers:openclaw",
      }),
    );
  });
});
