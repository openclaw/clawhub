import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import { assertCanManageOwnedResource, requirePublisherRole } from "./lib/publishers";
import {
  addMember,
  listPublicPage,
  listPublic,
  listMine,
  listPublishedPage,
  getPublishedDisplayManifest,
  migrateLegacyPublisherHandleToOrgInternal,
  ensureOrgPublisherHandleInternal,
  removeOrgPublisherMemberInternal,
  createOrg,
  removeMember,
  createOrgPublisherForUserInternal,
  resolvePublishTargetForUserInternal,
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

const ensureOrgPublisherHandleInternalHandler = (
  ensureOrgPublisherHandleInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      displayName?: string;
      memberHandle?: string;
      memberRole?: "owner" | "admin" | "publisher";
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      created: boolean;
      member?: { userId: string; handle: string; role: "owner" | "admin" | "publisher" };
    }
  >
)._handler;

const removeOrgPublisherMemberInternalHandler = (
  removeOrgPublisherMemberInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      memberHandle: string;
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      removed: boolean;
      member: { userId: string; handle: string; role: "owner" | "admin" | "publisher" };
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
      items: Array<{
        handle: string;
        kind: "user" | "org";
        stats: { downloads: number };
        publishedItems?: Array<{ displayName: string }>;
      }>;
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

const getPublishedDisplayManifestHandler = (
  getPublishedDisplayManifest as unknown as WrappedHandler<
    {
      handle: string;
      kind?: "skill" | "plugin";
      sort?: "downloads" | "recent";
    },
    {
      mode: "grouped";
      sourceRepos: string[];
      sections: Array<{
        title: string;
        sourceRepo: string | null;
        items: Array<{ displayName: string }>;
      }>;
    } | null
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

const createOrgPublisherForUserInternalHandler = (
  createOrgPublisherForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      displayName?: string;
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      created: true;
      trusted: false;
    }
  >
)._handler;

const createOrgHandler = (
  createOrg as unknown as WrappedHandler<
    {
      handle: string;
      displayName: string;
      bio?: string;
    },
    {
      publisher: { handle: string; bio?: string };
      role: "owner";
    }
  >
)._handler;

const resolvePublishTargetForUserInternalHandler = (
  resolvePublishTargetForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      ownerHandle?: string;
      minimumRole?: "owner" | "admin" | "publisher";
    },
    {
      publisherId: string;
      handle: string;
      kind: "user" | "org";
      linkedUserId?: string;
    } | null
  >
)._handler;

function indexedRows<T>(rows: T[]) {
  return {
    collect: vi.fn(async () => rows),
    order: vi.fn(() => ({
      take: vi.fn(async (limit: number) => rows.slice(0, limit)),
      paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const offset = cursor ? Number(cursor) : 0;
        const page = rows.slice(offset, offset + numItems);
        const nextOffset = offset + page.length;
        const isDone = nextOffset >= rows.length;
        return {
          page,
          isDone,
          continueCursor: isDone ? "" : String(nextOffset),
        };
      }),
    })),
  };
}

function emptyOfficialPublishersQuery() {
  return {
    withIndex: vi.fn((indexName: string) => {
      if (indexName !== "by_publisher") {
        throw new Error(`unexpected officialPublishers index ${indexName}`);
      }
      return { unique: vi.fn(async () => null) };
    }),
  };
}

function makeResolvePublishTargetCtx(options: {
  targetPublisher: Record<string, unknown>;
  targetMembership?: Record<string, unknown> | null;
}) {
  const actor = {
    _id: "users:vincent",
    handle: "vincent",
    name: "Vincent",
    displayName: "Vincent",
    image: null,
    trustedPublisher: false,
    personalPublisherId: "publishers:vincent",
  };
  const actorPersonalPublisher = {
    _id: "publishers:vincent",
    kind: "user",
    handle: "vincent",
    displayName: "Vincent",
    linkedUserId: "users:vincent",
  };
  const actorOwnerMembership = {
    _id: "publisherMembers:vincent-owner",
    publisherId: "publishers:vincent",
    userId: "users:vincent",
    role: "owner",
  };
  const queryValues = (
    builder: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) => {
    const values = new Map<string, unknown>();
    const q = {
      eq(field: string, value: unknown) {
        values.set(field, value);
        return q;
      },
    };
    builder(q);
    return values;
  };
  const query = vi.fn((table: string) => {
    if (table === "publishers") {
      return {
        withIndex: vi.fn((_indexName: string, builder) => {
          const values = queryValues(builder);
          return {
            unique: vi.fn(async () => {
              if (values.get("linkedUserId") === "users:vincent") return actorPersonalPublisher;
              if (values.get("handle") === "vincent") return actorPersonalPublisher;
              if (values.get("handle") === options.targetPublisher.handle) {
                return options.targetPublisher;
              }
              return null;
            }),
          };
        }),
      };
    }
    if (table === "publisherMembers") {
      return {
        withIndex: vi.fn((_indexName: string, builder) => {
          const values = queryValues(builder);
          return {
            unique: vi.fn(async () => {
              if (
                values.get("publisherId") === "publishers:vincent" &&
                values.get("userId") === "users:vincent"
              ) {
                return actorOwnerMembership;
              }
              if (
                values.get("publisherId") === options.targetPublisher._id &&
                values.get("userId") === "users:vincent"
              ) {
                return options.targetMembership ?? null;
              }
              return null;
            }),
          };
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return {
    db: {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const id = maybeId ?? tableOrId;
        if (id === "users:vincent") return actor;
        if (id === "publishers:vincent") return actorPersonalPublisher;
        if (id === options.targetPublisher._id) return options.targetPublisher;
        return null;
      }),
      query,
      patch: vi.fn(),
      insert: vi.fn(async () => "auditLogs:resolve"),
      delete: vi.fn(),
      replace: vi.fn(),
      normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
      system: {},
    },
  };
}

describe("publishers membership controls", () => {
  it("does not resolve another personal publisher through a stale membership", async () => {
    const ctx = makeResolvePublishTargetCtx({
      targetPublisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "owner",
        displayName: "Owner",
        linkedUserId: "users:owner",
      },
      targetMembership: {
        _id: "publisherMembers:stale",
        publisherId: "publishers:owner",
        userId: "users:vincent",
        role: "publisher",
      },
    });

    await expect(
      resolvePublishTargetForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        ownerHandle: "owner",
        minimumRole: "publisher",
      }),
    ).rejects.toThrow('publish access for "@owner"');
  });

  it("keeps org publisher memberships valid for publish target resolution", async () => {
    const ctx = makeResolvePublishTargetCtx({
      targetPublisher: {
        _id: "publishers:openclaw",
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
      },
      targetMembership: {
        _id: "publisherMembers:openclaw",
        publisherId: "publishers:openclaw",
        userId: "users:vincent",
        role: "publisher",
      },
    });

    await expect(
      resolvePublishTargetForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        ownerHandle: "openclaw",
        minimumRole: "publisher",
      }),
    ).resolves.toMatchObject({
      publisherId: "publishers:openclaw",
      handle: "openclaw",
      kind: "org",
    });
  });

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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
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
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_installs"
            ) {
              return indexedRows([]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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

  it("omits hidden publisher preview skills without scanning extra pages", async () => {
    const publisherRows = [
      {
        _id: "publishers:nvidia",
        _creationTime: 1,
        kind: "org",
        handle: "nvidia",
        displayName: "NVIDIA",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 0,
        totalDownloads: 70,
        totalStars: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const skillRows = [
      ...Array.from({ length: 3 }, (_, index) => 100 - index).map((installs, index) => ({
        _id: `skills:hidden-${index}`,
        ownerPublisherId: "publishers:nvidia",
        ownerUserId: "users:nvidia",
        slug: `hidden-${index}`,
        displayName: `Hidden ${index}`,
        summary: "Pending verification.",
        icon: null,
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        statsDownloads: 1000 - index,
        statsStars: 0,
        statsInstallsAllTime: installs,
        stats: {
          downloads: 1000 - index,
          stars: 0,
          installsCurrent: installs,
          installsAllTime: installs,
        },
        updatedAt: installs,
      })),
      {
        _id: "skills:visible",
        ownerPublisherId: "publishers:nvidia",
        ownerUserId: "users:nvidia",
        slug: "visible",
        displayName: "Visible Skill",
        summary: "Shown.",
        icon: null,
        softDeletedAt: undefined,
        moderationStatus: "active",
        statsDownloads: 70,
        statsStars: 0,
        statsInstallsAllTime: 1,
        stats: { downloads: 70, stars: 0, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 70,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async () => null),
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
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async (limit: number) =>
                    skillRows
                      .filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId)
                      .slice(0, limit),
                  ),
                })),
              };
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_installs") {
              return {
                order: vi.fn(() => ({ take: vi.fn(async () => []) })),
              };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicHandler(ctx as never, { limit: 48 });

    expect(result.items[0]?.publishedItems).toEqual([]);
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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
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
              indexName === "by_owner_publisher_active_installs"
            ) {
              return indexedRows([]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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

  it("orders public publisher card previews by installs while rendering downloads", async () => {
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
        statsInstallsAllTime: 35,
        stats: { downloads: 98, stars: 1, installsCurrent: 35, installsAllTime: 35 },
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
        stats: { downloads: 128, stars: 1, installs: 5, versions: 1 },
        updatedAt: 1,
      },
      {
        _id: "packages:recent-plugin",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Plugin",
        stats: { downloads: 12, stars: 1, installs: 50, versions: 1 },
        updatedAt: 5,
      },
      {
        _id: "packages:recent-helper",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Helper",
        stats: { downloads: 11, stars: 1, installs: 20, versions: 1 },
        updatedAt: 4,
      },
      {
        _id: "packages:recent-tool",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Tool",
        stats: { downloads: 10, stars: 1, installs: 40, versions: 1 },
        updatedAt: 3,
      },
    ];
    const rowsByInstalls = <
      T extends {
        updatedAt: number;
        stats?: { installs?: number; installsAllTime?: number };
        statsInstallsAllTime?: number;
      },
    >(
      rows: T[],
    ) =>
      [...rows].sort(
        (a, b) =>
          (b.statsInstallsAllTime ?? b.stats?.installs ?? b.stats?.installsAllTime ?? 0) -
            (a.statsInstallsAllTime ?? a.stats?.installs ?? a.stats?.installsAllTime ?? 0) ||
          b.updatedAt - a.updatedAt,
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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_installs") {
              return indexedRows(
                rowsByInstalls(
                  skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
                ),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_installs") {
              return indexedRows(
                rowsByInstalls(
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
      "Recent Plugin",
      "Recent Tool",
      "Popular Skill",
    ]);
    expect(result.page[0]?.publishedItems.map((item) => item.downloads)).toEqual([12, 10, 98]);
    expect(result.page[0]?.publishedItems[0]).not.toHaveProperty("installs");
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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_installs"
            ) {
              ownerPublisherQueries.push(String(fields.ownerPublisherId));
              return indexedRows([]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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

  it("excludes hidden and removed skills from publisher catalogs", async () => {
    const publisher = {
      _id: "publishers:nvidia",
      _creationTime: 1,
      kind: "org",
      handle: "nvidia",
      displayName: "NVIDIA",
      createdAt: 1,
      updatedAt: 1,
    };
    const skillRows = [
      {
        _id: "skills:visible",
        ownerPublisherId: "publishers:nvidia",
        ownerUserId: "users:nvidia",
        slug: "visible",
        displayName: "Visible Skill",
        summary: "Shown.",
        icon: null,
        moderationStatus: "active",
        stats: { downloads: 3, stars: 1, installsCurrent: 0, installsAllTime: 0 },
        updatedAt: 5,
      },
      {
        _id: "skills:hidden",
        ownerPublisherId: "publishers:nvidia",
        ownerUserId: "users:nvidia",
        slug: "hidden",
        displayName: "Hidden Skill",
        summary: "Pending verification.",
        icon: null,
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        stats: { downloads: 10, stars: 1, installsCurrent: 0, installsAllTime: 0 },
        updatedAt: 6,
      },
      {
        _id: "skills:removed",
        ownerPublisherId: "publishers:nvidia",
        ownerUserId: "users:nvidia",
        slug: "removed",
        displayName: "Removed Skill",
        summary: "Removed upstream.",
        icon: null,
        moderationStatus: "removed",
        moderationReason: "github.upstream.removed",
        stats: { downloads: 9, stars: 1, installsCurrent: 0, installsAllTime: 0 },
        updatedAt: 7,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:nvidia" ? publisher : null)),
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
                unique: vi.fn(async () => (fields.handle === "nvidia" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(skillRows);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublishedPageHandler(ctx as never, {
      handle: "nvidia",
      paginationOpts: { cursor: null, numItems: 12 },
    });

    expect(result.page.map((item) => item.displayName)).toEqual(["Visible Skill"]);
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
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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

  it("returns GitHub-backed display manifest groups for publisher catalogs", async () => {
    const publisher = {
      _id: "publishers:nvidia",
      _creationTime: 1,
      kind: "org",
      handle: "nvidia",
      displayName: "NVIDIA",
      createdAt: 1,
      updatedAt: 1,
    };
    const githubSource = {
      _id: "githubSkillSources:nvidia",
      repo: "NVIDIA/skills",
      ownerPublisherId: "publishers:nvidia",
      displayManifestStatus: "ok",
      displayManifest: {
        notGrouped: "bottom",
        groupings: [
          {
            title: "Agentic AI",
            description: "Agentic AI skills.",
            skills: ["aiq-deploy", "missing-entry"],
          },
          {
            title: "Vision AI",
            skills: ["vision-helper"],
          },
        ],
      },
    };
    const skillRows = [
      {
        _id: "skills:aiq-deploy",
        ownerPublisherId: "publishers:nvidia",
        softDeletedAt: undefined,
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        summary: "Deploy AgentIQ workflows.",
        icon: null,
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        stats: { downloads: 10, stars: 2, installsCurrent: 1, installsAllTime: 3 },
        updatedAt: 8,
      },
      {
        _id: "skills:vision-helper",
        ownerPublisherId: "publishers:nvidia",
        softDeletedAt: undefined,
        slug: "vision-helper",
        displayName: "Vision Helper",
        summary: "Vision tools.",
        icon: null,
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/vision-helper",
        stats: { downloads: 7, stars: 1, installsCurrent: 1, installsAllTime: 2 },
        updatedAt: 6,
      },
      {
        _id: "skills:other",
        ownerPublisherId: "publishers:nvidia",
        softDeletedAt: undefined,
        slug: "other",
        displayName: "Other Skill",
        summary: "Not listed in the manifest.",
        icon: null,
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/other",
        stats: { downloads: 1, stars: 0, installsCurrent: 0, installsAllTime: 0 },
        updatedAt: 2,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:nvidia" ? publisher : null)),
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
                unique: vi.fn(async () => (fields.handle === "nvidia" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(skillRows);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (table === "githubSkillSources" && indexName === "by_owner_publisher") {
              return indexedRows([githubSource]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await getPublishedDisplayManifestHandler(ctx as never, {
      handle: "nvidia",
      kind: "skill",
    });

    expect(result).toMatchObject({
      mode: "grouped",
      sourceRepos: ["NVIDIA/skills"],
      sections: [
        {
          title: "Agentic AI",
          sourceRepo: "NVIDIA/skills",
          items: [{ displayName: "AIQ Deploy", sourceBacked: true }],
        },
        {
          title: "Vision AI",
          sourceRepo: "NVIDIA/skills",
          items: [{ displayName: "Vision Helper", sourceBacked: true }],
        },
        {
          title: "Other skills",
          sourceRepo: null,
          items: [{ displayName: "Other Skill", sourceBacked: true }],
        },
      ],
    });
  });

  it("falls back to the normal catalog when no valid display manifest exists", async () => {
    const publisher = {
      _id: "publishers:nvidia",
      _creationTime: 1,
      kind: "org",
      handle: "nvidia",
      displayName: "NVIDIA",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:nvidia" ? publisher : null)),
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
                unique: vi.fn(async () => (fields.handle === "nvidia" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "skills:aiq-deploy",
                  ownerPublisherId: "publishers:nvidia",
                  softDeletedAt: undefined,
                  slug: "aiq-deploy",
                  displayName: "AIQ Deploy",
                  summary: "Deploy AgentIQ workflows.",
                  icon: null,
                  installKind: "github",
                  githubSourceId: "githubSkillSources:nvidia",
                  stats: { downloads: 10, stars: 2, installsCurrent: 1, installsAllTime: 3 },
                  updatedAt: 8,
                },
              ]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (table === "githubSkillSources" && indexName === "by_owner_publisher") {
              return indexedRows([
                {
                  _id: "githubSkillSources:nvidia",
                  repo: "NVIDIA/skills",
                  ownerPublisherId: "publishers:nvidia",
                  displayManifestStatus: "invalid",
                },
              ]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    await expect(
      getPublishedDisplayManifestHandler(ctx as never, {
        handle: "nvidia",
        kind: "skill",
      }),
    ).resolves.toBeNull();
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

  it("prevents adding members to personal publishers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:personal") {
            return {
              _id: id,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: "users:owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:owner",
                  publisherId: "publishers:personal",
                  userId: "users:owner",
                  role: "owner",
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
        { publisherId: "publishers:personal", userHandle: "friend", role: "admin" } as never,
      ),
    ).rejects.toThrow("Personal publishers do not support member management");

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("lets linked owners remove stale members from personal publishers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:personal") {
            return {
              _id: id,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: "users:owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:friend",
                  publisherId: "publishers:personal",
                  userId: "users:friend",
                  role: "admin",
                }),
              })),
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
        { publisherId: "publishers:personal", userId: "users:friend" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(ctx.db.delete).toHaveBeenCalledWith("publisherMembers:friend");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.member.remove",
        targetId: "publishers:personal",
        metadata: { memberUserId: "users:friend" },
      }),
    );
  });

  it("lets legacy no-link personal owners remove stale members by personal publisher link", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const memberships: Record<string, Record<string, unknown>> = {
      "users:friend": {
        _id: "publisherMembers:friend",
        publisherId: "publishers:personal",
        userId: "users:friend",
        role: "admin",
      },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id, personalPublisherId: "publishers:personal" };
          if (id === "publishers:personal") {
            return {
              _id: id,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(
                (
                  _indexName: string,
                  builder: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let userId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "userId") userId = value;
                      return q;
                    },
                  };
                  builder(q);
                  return {
                    unique: vi.fn().mockResolvedValue(memberships[userId] ?? null),
                  };
                },
              ),
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
        { publisherId: "publishers:personal", userId: "users:friend" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(ctx.db.delete).toHaveBeenCalledWith("publisherMembers:friend");
  });

  it("lets legacy no-link personal owners remove stale members by owner membership", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const memberships: Record<string, Record<string, unknown>> = {
      "users:owner": {
        _id: "publisherMembers:owner",
        publisherId: "publishers:personal",
        userId: "users:owner",
        role: "owner",
      },
      "users:friend": {
        _id: "publisherMembers:friend",
        publisherId: "publishers:personal",
        userId: "users:friend",
        role: "admin",
      },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:personal") {
            return {
              _id: id,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(
                (
                  _indexName: string,
                  builder: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let userId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "userId") userId = value;
                      return q;
                    },
                  };
                  builder(q);
                  return {
                    unique: vi.fn().mockResolvedValue(memberships[userId] ?? null),
                  };
                },
              ),
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
        { publisherId: "publishers:personal", userId: "users:friend" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(ctx.db.delete).toHaveBeenCalledWith("publisherMembers:friend");
  });

  it("prevents removing the linked owner from personal publishers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:personal") {
            return {
              _id: id,
              kind: "user",
              handle: "owner",
              displayName: "Owner",
              linkedUserId: "users:owner",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:owner",
                  publisherId: "publishers:personal",
                  userId: "users:owner",
                  role: "owner",
                }),
              })),
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
        { publisherId: "publishers:personal", userId: "users:owner" } as never,
      ),
    ).rejects.toThrow("Personal publisher owner membership cannot be removed");

    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
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
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
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

  it("keeps legacy personal publishers without linked users manageable by the resource owner", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: undefined,
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

  it("does not honor extra memberships on personal publishers", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: "users:vincent",
      },
      membership: {
        _id: "publisherMembers:stale",
        publisherId: "publishers:owner",
        userId: "users:friend",
        role: "owner",
      },
    });

    await expect(
      assertCanManageOwnedResource(
        ctx as never,
        {
          actor: { _id: "users:friend" },
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:owner",
        } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("does not authorize personal publisher roles for non-linked members", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: "users:vincent",
      },
      membership: {
        _id: "publisherMembers:stale",
        publisherId: "publishers:owner",
        userId: "users:friend",
        role: "owner",
      },
    });

    await expect(
      requirePublisherRole(
        ctx as never,
        {
          publisherId: "publishers:owner",
          userId: "users:friend",
          allowed: ["owner"],
        } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("treats linked users as personal publisher owners even with stale membership roles", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: "users:vincent",
      },
      membership: {
        _id: "publisherMembers:stale",
        publisherId: "publishers:owner",
        userId: "users:vincent",
        role: "publisher",
      },
    });

    await expect(
      requirePublisherRole(
        ctx as never,
        {
          publisherId: "publishers:owner",
          userId: "users:vincent",
          allowed: ["admin"],
        } as never,
      ),
    ).resolves.toBeDefined();
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
                if (indexName === "by_handle") return { unique: vi.fn().mockResolvedValue(null) };
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
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
                if (indexName === "by_handle") return { unique: vi.fn().mockResolvedValue(null) };
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
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
                if (indexName === "by_handle") return { unique: vi.fn().mockResolvedValue(null) };
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
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

  it("filters stale personal memberships from mine listings", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:friend" as never);
    const memberships = [
      {
        _id: "publisherMembers:stale-personal",
        publisherId: "publishers:owner",
        userId: "users:friend",
        role: "owner",
      },
      {
        _id: "publisherMembers:own-personal",
        publisherId: "publishers:friend",
        userId: "users:friend",
        role: "publisher",
      },
      {
        _id: "publisherMembers:team",
        publisherId: "publishers:team",
        userId: "users:friend",
        role: "admin",
      },
    ];
    const publishers = {
      "publishers:owner": {
        _id: "publishers:owner",
        _creationTime: 1,
        kind: "user",
        handle: "owner",
        displayName: "Owner",
        linkedUserId: "users:owner",
        trustedPublisher: false,
        createdAt: 1,
        updatedAt: 1,
      },
      "publishers:friend": {
        _id: "publishers:friend",
        _creationTime: 1,
        kind: "user",
        handle: "friend",
        displayName: "Friend",
        linkedUserId: "users:friend",
        trustedPublisher: false,
        createdAt: 1,
        updatedAt: 1,
      },
      "publishers:team": {
        _id: "publishers:team",
        _creationTime: 1,
        kind: "org",
        handle: "team",
        displayName: "Team",
        trustedPublisher: false,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:friend") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "friend",
              displayName: "Friend",
              personalPublisherId: "publishers:friend",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return publishers[id as keyof typeof publishers] ?? null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue(memberships) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_handle") return { unique: vi.fn().mockResolvedValue(null) };
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = await listMineHandler(ctx as never, {} as never);

    expect(result).toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          _id: "publishers:friend",
          handle: "friend",
          kind: "user",
          linkedUserId: "users:friend",
        }),
      }),
      expect.objectContaining({
        role: "admin",
        publisher: expect.objectContaining({
          _id: "publishers:team",
          handle: "team",
          kind: "org",
        }),
      }),
    ]);
  });
});

describe("self-serve org publisher creation", () => {
  function makeCreateOrgPublisherCtx(options: {
    existingPublisher?: Record<string, unknown> | null;
    existingUser?: Record<string, unknown> | null;
    reservedHandle?: Record<string, unknown> | null;
    actor?: Record<string, unknown> | null;
  }) {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const query = vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(options.existingPublisher ?? null) };
          }),
        };
      }
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(options.existingUser ?? null) };
          }),
        };
      }
      if (table === "reservedHandles") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle_active_updatedAt") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return {
              order: vi.fn(() => ({
                take: vi.fn(async () => (options.reservedHandle ? [options.reservedHandle] : [])),
              })),
            };
          }),
        };
      }
      if (table === "officialPublishers") {
        return emptyOfficialPublishersQuery();
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (...args: string[]) => {
          const id = args.length === 2 ? args[1] : args[0];
          if (id === "users:vincent") return options.actor ?? { _id: id, handle: "vincentkoc" };
          const inserted = inserts.find((entry) => entry.value._id === id);
          if (inserted) return inserted.value;
          return null;
        }),
        query,
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          const id = `${table}:${inserts.length + 1}`;
          inserts.push({ table, value: { _id: id, ...value } });
          return id;
        }),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
      },
    };
    return { ctx, inserts };
  }

  it("creates an untrusted org publisher and makes the actor owner", async () => {
    const { ctx, inserts } = makeCreateOrgPublisherCtx({});

    const result = await createOrgPublisherForUserInternalHandler(ctx as never, {
      actorUserId: "users:vincent",
      handle: "Opik",
      displayName: "Opik",
    });

    expect(result).toMatchObject({
      ok: true,
      publisherId: "publishers:1",
      handle: "opik",
      created: true,
      trusted: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "publishers",
          value: expect.objectContaining({
            kind: "org",
            handle: "opik",
            displayName: "Opik",
            trustedPublisher: undefined,
          }),
        }),
        expect.objectContaining({
          table: "publisherMembers",
          value: expect.objectContaining({
            publisherId: "publishers:1",
            userId: "users:vincent",
            role: "owner",
          }),
        }),
        expect.objectContaining({
          table: "auditLogs",
          value: expect.objectContaining({
            actorUserId: "users:vincent",
            action: "publisher.org.create",
            targetType: "publisher",
            targetId: "publishers:1",
          }),
        }),
      ]),
    );
  });

  it("rejects creation when the org publisher already exists", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingPublisher: { _id: "publishers:opik", kind: "org", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Publisher "@opik" already exists');
  });

  it("rejects creation when the handle belongs to a user or personal publisher", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingUser: { _id: "users:opik", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is already used by a user or personal publisher');
  });

  it("rejects creation when the handle belongs to a personal publisher", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingPublisher: { _id: "publishers:opik", kind: "user", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is already used by a user or personal publisher');
  });

  it("rejects creation when the handle is reserved for another user", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:opik",
      },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is reserved for another user');
  });

  it("allows creation when the handle is reserved for the actor", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:vincent",
      },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).resolves.toMatchObject({ ok: true, handle: "opik" });
  });

  function makeSettingsCreateOrgCtx(options: {
    reservedHandle?: Record<string, unknown> | null;
    existingOrgPublisher?: Record<string, unknown> | null;
  }) {
    const actor = {
      _id: "users:vincent",
      _creationTime: 1,
      handle: "vincentkoc",
      displayName: "Vincent",
      personalPublisherId: "publishers:vincent",
      createdAt: 1,
      updatedAt: 1,
    };
    const personalPublisher = {
      _id: "publishers:vincent",
      _creationTime: 1,
      kind: "user",
      handle: "vincentkoc",
      displayName: "Vincent",
      linkedUserId: "users:vincent",
      createdAt: 1,
      updatedAt: 1,
    };
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const insertCounts = new Map<string, number>();
    const insertedById = new Map<string, Record<string, unknown>>();
    const query = vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: vi.fn((indexName: string, builder: (q: unknown) => unknown) => {
            const eqValues: Record<string, unknown> = {};
            builder({
              eq: vi.fn((field: string, value: unknown) => {
                eqValues[field] = value;
                return { eq: vi.fn() };
              }),
            });
            if (indexName === "by_linked_user") {
              return { unique: vi.fn().mockResolvedValue(personalPublisher) };
            }
            if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
            const handle = eqValues.handle;
            const publisher =
              handle === "vincentkoc"
                ? personalPublisher
                : handle === "opik"
                  ? options.existingOrgPublisher
                  : null;
            return { unique: vi.fn().mockResolvedValue(publisher ?? null) };
          }),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_publisher_user") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return { unique: vi.fn().mockResolvedValue({ _id: "publisherMembers:personal" }) };
          }),
        };
      }
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(null) };
          }),
        };
      }
      if (table === "reservedHandles") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle_active_updatedAt") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return {
              order: vi.fn(() => ({
                take: vi.fn(async () => (options.reservedHandle ? [options.reservedHandle] : [])),
              })),
            };
          }),
        };
      }
      if (table === "officialPublishers") {
        return emptyOfficialPublishersQuery();
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (...args: string[]) => {
          const id = args.length === 2 ? args[1] : args[0];
          if (id === actor._id) return actor;
          if (id === personalPublisher._id) return personalPublisher;
          return insertedById.get(id) ?? null;
        }),
        query,
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          const next = (insertCounts.get(table) ?? 0) + 1;
          insertCounts.set(table, next);
          const id = `${table}:${next}`;
          const doc = { _id: id, _creationTime: next, ...value };
          inserts.push({ table, value: doc });
          insertedById.set(id, doc);
          return id;
        }),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
      },
    };
    return { ctx, inserts };
  }

  it("rejects Settings org creation when the handle is reserved for another user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:vincent" as never);
    const { ctx } = makeSettingsCreateOrgCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:opik",
      },
    });

    await expect(
      createOrgHandler(ctx as never, {
        handle: "opik",
        displayName: "Opik",
      }),
    ).rejects.toThrow('Handle "@opik" is reserved for another user');
  });

  it("lets Settings org creation use handles reserved for the actor", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:vincent" as never);
    const { ctx, inserts } = makeSettingsCreateOrgCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:vincent",
      },
    });

    await expect(
      createOrgHandler(ctx as never, {
        handle: "Opik",
        displayName: "Opik",
        bio: "Team publisher",
      }),
    ).resolves.toMatchObject({
      publisher: { handle: "opik", bio: "Team publisher" },
      role: "owner",
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "publishers",
          value: expect.objectContaining({
            kind: "org",
            handle: "opik",
            displayName: "Opik",
            bio: "Team publisher",
          }),
        }),
        expect.objectContaining({
          table: "publisherMembers",
          value: expect.objectContaining({
            userId: "users:vincent",
            role: "owner",
          }),
        }),
      ]),
    );
  });
});

describe("legacy publisher migration", () => {
  it("lets admins create a missing org publisher with only the legacy package owner as owner", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin", handle: "admin" }],
      [
        "users:vincent",
        {
          _id: "users:vincent",
          handle: "vincentkoc",
          displayName: "Vincent Koc",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>();
    const publisherMembers: Array<Record<string, unknown>> = [];
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${inserts.length + 1}`;
      const row = { _id: id, _creationTime: 1, ...value };
      inserts.push({ table, value: row });
      if (table === "publishers") publishers.set(id, row);
      if (table === "publisherMembers") publisherMembers.push(row);
      return id;
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
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () =>
                    [...publishers.values()].find((publisher) => publisher.handle === handle) ??
                    null,
                ),
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
      throw new Error(`unexpected table ${table}`);
    });

    const result = await ensureOrgPublisherHandleInternalHandler(
      {
        db: {
          get: vi.fn(async (...args: string[]) => {
            const id = args.length === 2 ? args[1] : args[0];
            const inserted = inserts.find((entry) => entry.value._id === id);
            return users.get(id) ?? publishers.get(id) ?? inserted?.value ?? null;
          }),
          query,
          insert,
          patch: vi.fn(),
          delete: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "opik",
        displayName: "Opik",
        memberHandle: "vincentkoc",
        memberRole: "owner",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "opik",
      created: true,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "publishers",
        value: expect.objectContaining({ kind: "org", handle: "opik", displayName: "Opik" }),
      }),
    );
    const memberInserts = inserts.filter(
      (entry) =>
        entry.table === "publisherMembers" && entry.value.publisherId === result.publisherId,
    );
    expect(memberInserts).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          publisherId: result.publisherId,
          userId: "users:vincent",
          role: "owner",
        }),
      }),
    ]);
  });

  it("lets an admin remove one org owner when another owner remains", async () => {
    const publisherMembers = [
      {
        _id: "publisherMembers:patrick",
        publisherId: "publishers:opik",
        userId: "users:patrick",
        role: "owner",
      },
      {
        _id: "publisherMembers:vincent",
        publisherId: "publishers:opik",
        userId: "users:vincent",
        role: "owner",
      },
    ];
    const deleted: string[] = [];
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
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
                unique: vi.fn(async () =>
                  handle === "patrick-erichsen-2"
                    ? { _id: "users:patrick", handle: "patrick-erichsen-2" }
                    : null,
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
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(async () =>
                  handle === "opik" ? { _id: "publishers:opik", kind: "org", handle } : null,
                ),
              };
            },
          ),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn(
            (
              indexName: string,
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
                unique: vi.fn(async () => {
                  if (indexName !== "by_publisher_user") return null;
                  return (
                    publisherMembers.find(
                      (member) => member.publisherId === publisherId && member.userId === userId,
                    ) ?? null
                  );
                }),
                collect: vi.fn(async () =>
                  publisherMembers.filter((member) => member.publisherId === publisherId),
                ),
              };
            },
          ),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await removeOrgPublisherMemberInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) =>
            id === "users:admin" ? { _id: id, role: "admin" } : null,
          ),
          query,
          insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
            inserts.push({ table, value });
            return `${table}:audit`;
          }),
          patch: vi.fn(),
          delete: vi.fn(async (id: string) => {
            deleted.push(id);
          }),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "opik",
        memberHandle: "patrick-erichsen-2",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "opik",
      removed: true,
      member: { handle: "patrick-erichsen-2", role: "owner" },
    });
    expect(deleted).toEqual(["publisherMembers:patrick"]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "auditLogs",
        value: expect.objectContaining({
          actorUserId: "users:admin",
          action: "publisher.member.remove",
          targetId: "publishers:opik",
        }),
      }),
    );
  });

  it("rejects removing the last org owner", async () => {
    const publisherMembers = [
      {
        _id: "publisherMembers:patrick",
        publisherId: "publishers:opik",
        userId: "users:patrick",
        role: "owner",
      },
    ];
    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => ({ _id: "users:patrick", handle: "patrick-erichsen-2" })),
          })),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => ({ _id: "publishers:opik", kind: "org", handle: "opik" })),
          })),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => publisherMembers[0]),
            collect: vi.fn(async () => publisherMembers),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      removeOrgPublisherMemberInternalHandler(
        {
          db: {
            get: vi.fn(async (id: string) =>
              id === "users:admin" ? { _id: id, role: "admin" } : null,
            ),
            query,
            insert: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
            replace: vi.fn(),
            normalizeId: vi.fn(),
          },
        } as never,
        {
          actorUserId: "users:admin",
          handle: "opik",
          memberHandle: "patrick-erichsen-2",
        },
      ),
    ).rejects.toThrow("Publisher must have at least one owner");
  });

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
