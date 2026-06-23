import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import { assertCanManageOwnedResource, requirePublisherRole } from "./lib/publishers";
import {
  addMember,
  listPublicPage,
  listPublic,
  listMine,
  getMyProfileHandle,
  getProfileByHandle,
  listMembers,
  listPublishedPage,
  listStarredPage,
  getPublishedDisplayManifest,
  migrateLegacyPublisherHandleToOrgInternal,
  ensureOrgPublisherHandleInternal,
  removeOrgPublisherMemberInternal,
  recoverPersonalPublisherInternal,
  createOrg,
  deleteOrg,
  removeMember,
  addOfficialPublisherInternal,
  createOrgPublisherForUserInternal,
  deleteSoleOwnerOrgsForAccountDeletionInternal,
  resolvePublishTargetForUserInternal,
  setTrustedPublisherInternal,
  updateProfile,
} from "./publishers";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
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

const addOfficialPublisherInternalHandler = (
  addOfficialPublisherInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      reason: string;
    },
    {
      ok: true;
      added: boolean;
      publisherId: string;
      handle: string;
      officialPublisherId: string;
    }
  >
)._handler;

const recoverPersonalPublisherInternalHandler = (
  recoverPersonalPublisherInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      publisherHandle: string;
      previousGitHubProviderAccountId: string;
      nextGitHubProviderAccountId: string;
      nextUserHandle?: string;
      retiredUserHandle?: string;
      reason: string;
      confirmIdentityVerified: boolean;
      dryRun?: boolean;
    },
    {
      ok: true;
      dryRun: boolean;
      recovered: boolean;
      publisherId: string;
      handle: string;
      previousUser: { userId: string; handle: string | null; nextHandle: string | null };
      nextUser: { userId: string; handle: string | null; nextHandle: string };
      retiredPersonalPublisher: {
        publisherId: string;
        handle: string;
        skills: number;
        packages: number;
        githubSources: number;
      } | null;
      resourceOwnerMigration: {
        limitPerTable: number;
        skills: number;
        skillSlugAliases: number;
        packages: number;
        packageInspectorWarnings: number;
        githubSourcesChecked: number;
        handleReservations: number;
      };
    }
  >
)._handler;

const listMineHandler = (
  listMine as unknown as WrappedHandler<Record<string, never>, Array<unknown>>
)._handler;

const getMyProfileHandleHandler = (
  getMyProfileHandle as unknown as WrappedHandler<Record<string, never>, string | null>
)._handler;

const listPublicHandler = (
  listPublic as unknown as WrappedHandler<
    { limit?: number; kind?: "user" | "org" },
    {
      items: Array<{
        handle: string;
        kind: "user" | "org";
        stats: { downloads: number; installs: number };
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
      official?: boolean;
      query?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{
        handle: string;
        displayName?: string;
        kind: "user" | "org";
        official?: boolean;
        stats: { downloads: number; installs: number };
        publishedItems: Array<{ displayName: string; installs: number; downloads: number }>;
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
      kind?: "skill" | "plugin";
      sort?: "installs" | "recent" | "downloads";
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{ displayName: string; href: string }>;
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const listStarredPageHandler = (
  listStarredPage as unknown as WrappedHandler<
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

const listMembersHandler = (
  listMembers as unknown as WrappedHandler<
    { publisherHandle: string },
    {
      publisher: unknown;
      members: Array<unknown>;
    } | null
  >
)._handler;

const getProfileByHandleHandler = (
  getProfileByHandle as unknown as WrappedHandler<{ handle: string }>
)._handler;

const getPublishedDisplayManifestHandler = (
  getPublishedDisplayManifest as unknown as WrappedHandler<
    {
      handle: string;
      kind?: "skill" | "plugin";
      sort?: "installs" | "recent" | "downloads";
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

const deleteOrgHandler = (
  deleteOrg as unknown as WrappedHandler<
    {
      publisherId: string;
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      hiddenSkills: number;
      deletedPackages: number;
      revokedPackageTokens: number;
      scheduled: boolean;
    }
  >
)._handler;

const deleteSoleOwnerOrgsForAccountDeletionInternalHandler = (
  deleteSoleOwnerOrgsForAccountDeletionInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      deletedAt: number;
    },
    {
      ok: true;
      deletedOrgs: number;
      hiddenSkills: number;
      deletedPackages: number;
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

function indexedRows(rows: unknown[]) {
  return {
    collect: vi.fn(async () => rows),
    order: vi.fn(() => ({
      collect: vi.fn(async () => rows),
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

function makePublicPublisherVisibilityCtx(options?: {
  linkedUser?: Record<string, unknown> | null;
  legacyPersonalPublisher?: boolean;
}) {
  const legacyPersonalPublisher = options?.legacyPersonalPublisher ?? false;
  const publisher = {
    _id: "publishers:proof-banned-builder",
    _creationTime: 1,
    kind: "user",
    handle: "proof-banned-builder",
    displayName: "Proof Banned Builder",
    linkedUserId: legacyPersonalPublisher ? undefined : "users:proof-banned-builder",
    trustedPublisher: false,
    publishedSkills: 1,
    publishedPackages: 0,
    totalInstalls: 1,
    totalDownloads: 4,
    totalStars: 2,
    createdAt: 1,
    updatedAt: 2,
  };
  const linkedUser =
    options && "linkedUser" in options
      ? options.linkedUser
      : {
          _id: "users:proof-banned-builder",
          _creationTime: 1,
          handle: "proof-banned-builder",
          displayName: "Proof Banned Builder",
          createdAt: 1,
          updatedAt: 2,
        };
  const githubSource = {
    _id: "githubSkillSources:proof-banned-builder",
    repo: "proof-banned-builder/skills",
    ownerPublisherId: "publishers:proof-banned-builder",
    displayManifestStatus: "ok",
    displayManifest: {
      groupings: [{ title: "Skills", skills: ["demo"] }],
    },
  };
  const skill = {
    _id: "skills:demo",
    ownerPublisherId: "publishers:proof-banned-builder",
    softDeletedAt: undefined,
    slug: "demo",
    displayName: "Demo Skill",
    summary: "Demo summary",
    icon: null,
    installKind: "github",
    githubSourceId: "githubSkillSources:proof-banned-builder",
    githubPath: "skills/demo",
    stats: {
      downloads: 4,
      downloadsAllTime: 4,
      installs: 1,
      installsAllTime: 1,
      stars: 2,
    },
    updatedAt: 2,
  };
  const memberships = [
    {
      _id: "publisherMembers:owner",
      publisherId: "publishers:proof-banned-builder",
      userId: "users:proof-banned-builder",
      role: "owner",
    },
  ];
  const query = vi.fn((table: string) => ({
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
          unique: vi.fn(async () => (fields.handle === "proof-banned-builder" ? publisher : null)),
        };
      }
      if (table === "publishers" && indexName === "by_linked_user") {
        return {
          unique: vi.fn(async () =>
            fields.linkedUserId === "users:proof-banned-builder" ? publisher : null,
          ),
        };
      }
      if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
        return indexedRows(fields.ownerPublisherId === publisher._id ? [skill] : []);
      }
      if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
        return indexedRows(fields.ownerPublisherId === publisher._id ? [skill] : []);
      }
      if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
        return indexedRows([]);
      }
      if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
        return indexedRows([]);
      }
      if (table === "stars" && indexName === "by_user") {
        return indexedRows(
          fields.userId === "users:proof-banned-builder"
            ? [{ _id: "stars:demo", userId: "users:proof-banned-builder", skillId: "skills:demo" }]
            : [],
        );
      }
      if (table === "publisherMembers" && indexName === "by_publisher") {
        return indexedRows(fields.publisherId === publisher._id ? memberships : []);
      }
      if (table === "publisherMembers" && indexName === "by_user") {
        return indexedRows([]);
      }
      if (table === "githubSkillSources" && indexName === "by_owner_publisher") {
        return indexedRows(fields.ownerPublisherId === publisher._id ? [githubSource] : []);
      }
      if (table === "officialPublishers" && indexName === "by_publisher") {
        return { unique: vi.fn(async () => null) };
      }

      throw new Error(`unexpected ${table} index ${indexName}`);
    }),
  }));

  return {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:proof-banned-builder") return linkedUser;
        if (id === "publishers:proof-banned-builder") return publisher;
        if (id === "skills:demo") return skill;
        return null;
      }),
      query,
    },
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

function emptyOwnedResourcesQuery() {
  return {
    withIndex: vi.fn(() => ({
      collect: vi.fn(async () => []),
      order: vi.fn(() => ({
        take: vi.fn(async () => []),
      })),
    })),
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
  it("lets an org owner delete an org and cascade owned resources", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 1, revokedTokenCount: 1, scheduled: false });
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:gladia") {
            return {
              _id: id,
              kind: "org",
              handle: "gladia",
              displayName: "Gladia",
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "githubSkillSources" || table === "githubSkillContents") {
            return emptyOwnedResourcesQuery();
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
          }
          if (table !== "publisherMembers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string) => ({
              unique: vi.fn(async () =>
                indexName === "by_publisher_user"
                  ? {
                      _id: "publisherMembers:owner",
                      publisherId: "publishers:gladia",
                      userId: "users:owner",
                      role: "owner",
                    }
                  : null,
              ),
              collect: vi.fn(async () =>
                indexName === "by_publisher"
                  ? [
                      {
                        _id: "publisherMembers:owner",
                        publisherId: "publishers:gladia",
                        userId: "users:owner",
                        role: "owner",
                      },
                    ]
                  : [],
              ),
            })),
          };
        }),
        patch,
        insert,
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
      },
    };

    const result = await deleteOrgHandler(ctx as never, { publisherId: "publishers:gladia" });

    expect(result).toMatchObject({
      handle: "gladia",
      hiddenSkills: 2,
      deletedPackages: 1,
      revokedPackageTokens: 1,
    });
    expect(patch).toHaveBeenCalledWith(
      "publishers:gladia",
      expect.objectContaining({
        deletedAt: expect.any(Number),
        deactivatedAt: expect.any(Number),
      }),
    );
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.org.delete",
        targetId: "publishers:gladia",
        metadata: expect.objectContaining({
          handle: "gladia",
          source: "settings",
          hiddenSkills: 2,
          deletedPackages: 1,
        }),
      }),
    );
  });

  it("rejects org deletion by non-owner members", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:publisher" as never);
    const runMutation = vi.fn();
    const patch = vi.fn();
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:publisher") return { _id: id };
          if (id === "publishers:gladia") {
            return {
              _id: id,
              kind: "org",
              handle: "gladia",
              displayName: "Gladia",
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "githubSkillSources" || table === "githubSkillContents") {
            return emptyOwnedResourcesQuery();
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
          }
          if (table !== "publisherMembers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn(async () => ({
                _id: "publisherMembers:publisher",
                publisherId: "publishers:gladia",
                userId: "users:publisher",
                role: "publisher",
              })),
            })),
          };
        }),
        patch,
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
      },
    };

    await expect(
      deleteOrgHandler(ctx as never, { publisherId: "publishers:gladia" }),
    ).rejects.toThrow("Only org owners can delete an organization");
    expect(patch).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("deletes sole-owner account orgs when other owner memberships are inactive", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 1, revokedTokenCount: 1, scheduled: false });
    const actorMembership = {
      _id: "publisherMembers:owner",
      publisherId: "publishers:gladia",
      userId: "users:owner",
      role: "owner",
    };
    const inactiveOwnerMembership = {
      _id: "publisherMembers:inactive-owner",
      publisherId: "publishers:gladia",
      userId: "users:inactive-owner",
      role: "owner",
    };
    const ctx = {
      runMutation,
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "users:inactive-owner") return { _id: id, deactivatedAt: 2_000 };
          if (id === "publishers:gladia") {
            return {
              _id: id,
              kind: "org",
              handle: "gladia",
              displayName: "Gladia",
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "githubSkillSources" || table === "githubSkillContents") {
            return emptyOwnedResourcesQuery();
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
          }
          if (table !== "publisherMembers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName === "by_user") {
                return { collect: vi.fn(async () => [actorMembership]) };
              }
              if (indexName === "by_publisher") {
                return {
                  collect: vi.fn(async () => [actorMembership, inactiveOwnerMembership]),
                };
              }
              if (indexName === "by_publisher_user") {
                return { unique: vi.fn(async () => actorMembership) };
              }
              throw new Error(`unexpected index ${indexName}`);
            }),
          };
        }),
        patch,
        insert,
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
      },
    };

    const result = await deleteSoleOwnerOrgsForAccountDeletionInternalHandler(ctx as never, {
      actorUserId: "users:owner",
      deletedAt: 3_000,
    });

    expect(result).toMatchObject({ deletedOrgs: 1, hiddenSkills: 2, deletedPackages: 1 });
    expect(patch).toHaveBeenCalledWith(
      "publishers:gladia",
      expect.objectContaining({
        deletedAt: 3_000,
        deactivatedAt: 3_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.org.delete",
        metadata: expect.objectContaining({ source: "account.delete" }),
      }),
    );
  });

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

  it.each(["admin", "docs", "skills"])(
    "rejects org handle %s reserved for public routes",
    async (handle) => {
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
          handle,
        }),
      ).rejects.toThrow(`Handle "@${handle}" is reserved for ClawHub routes`);
    },
  );

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
              indexName === "by_owner_publisher_active_downloads"
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
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
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
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
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
            const range: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
              gte: (field: string, value: unknown) => {
                range.gte = { field, value };
                return q;
              },
              lt: (field: string, value: unknown) => {
                range.lt = { field, value };
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
                  collect: vi.fn(async () =>
                    publisherRows.filter((publisher) => publisher.kind === fields.kind),
                  ),
                  take: vi.fn(async () =>
                    publisherRows.filter((publisher) => publisher.kind === fields.kind),
                  ),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_total_installs") {
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
                  collect: vi.fn(async () => publisherRows),
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                take: vi.fn(async () => {
                  const prefix = (range.gte as { value: string } | undefined)?.value ?? "";
                  return publisherRows.filter(
                    (publisher) =>
                      publisher.kind === fields.kind && publisher.handle.startsWith(prefix),
                  );
                }),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
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

  it("finds publishers outside the popular install window via handle prefix search", async () => {
    const popularRows = Array.from({ length: 500 }, (_, index) => ({
      _id: `publishers:popular-${index}`,
      _creationTime: index,
      kind: "user" as const,
      handle: `popular-${index}`,
      displayName: `Popular ${index}`,
      linkedUserId: `users:popular-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 500 - index,
      totalDownloads: 500 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const vincentkoc = {
      _id: "publishers:vincentkoc",
      _creationTime: 1,
      kind: "user" as const,
      handle: "vincentkoc",
      displayName: "Vincent Koc",
      linkedUserId: "users:vincentkoc",
      publishedSkills: 0,
      publishedPackages: 0,
      totalInstalls: 0,
      totalDownloads: 0,
      totalStars: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:vincentkoc") {
            return { _id: id, image: "https://github.com/vincentkoc.png" };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const range: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
              gte: (field: string, value: unknown) => {
                range.gte = { field, value };
                return q;
              },
              lt: (field: string, value: unknown) => {
                range.lt = { field, value };
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () =>
                  fields.handle === "vincent"
                    ? null
                    : fields.handle === "vincentkoc"
                      ? vincentkoc
                      : null,
                ),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => popularRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => popularRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                take: vi.fn(async () => {
                  const prefix = (range.gte as { value: string } | undefined)?.value ?? "";
                  const upper = (range.lt as { value: string } | undefined)?.value ?? "";
                  if (fields.kind === "user" && prefix === "vincent" && upper === "vincent\uffff") {
                    return [vincentkoc];
                  }
                  return [];
                }),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
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
      query: "vincent",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page.map((item) => item.handle)).toEqual(["vincentkoc"]);
    expect(result.counts).toEqual({ all: 1, individuals: 1, organizations: 0 });
  });

  it("finds publishers with published skills outside the popular install window", async () => {
    const popularRows = Array.from({ length: 500 }, (_, index) => ({
      _id: `publishers:popular-${index}`,
      _creationTime: index,
      kind: "user" as const,
      handle: `popular-${index}`,
      displayName: `Popular ${index}`,
      linkedUserId: `users:popular-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 500 - index,
      totalDownloads: 500 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const vyctorbrzezowski = {
      _id: "publishers:vyctorbrzezowski",
      _creationTime: 1,
      kind: "user" as const,
      handle: "vyctorbrzezowski",
      displayName: "Vyctor Brzezowski",
      linkedUserId: "users:vyctorbrzezowski",
      publishedSkills: 5,
      publishedPackages: 1,
      totalInstalls: 46,
      totalDownloads: 1288,
      totalStars: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:vyctorbrzezowski") {
            return { _id: id, image: "https://github.com/vyctorbrzezowski.png" };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const range: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
              gte: (field: string, value: unknown) => {
                range.gte = { field, value };
                return q;
              },
              lt: (field: string, value: unknown) => {
                range.lt = { field, value };
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () =>
                  fields.handle === "vyctorbrzezowski" ? vyctorbrzezowski : null,
                ),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => popularRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                take: vi.fn(async () => {
                  const prefix = (range.gte as { value: string } | undefined)?.value ?? "";
                  const upper = (range.lt as { value: string } | undefined)?.value ?? "";
                  if (fields.kind === "user" && prefix === "vyctor" && upper === "vyctor\uffff") {
                    return [vyctorbrzezowski];
                  }
                  return [];
                }),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_installs") {
              return indexedRows([
                {
                  _id: "skills:vyctor-demo",
                  ownerPublisherId: "publishers:vyctorbrzezowski",
                  softDeletedAt: undefined,
                  displayName: "Demo Skill",
                  statsInstallsAllTime: 46,
                  statsDownloads: 1288,
                  statsStars: 0,
                  updatedAt: 1,
                },
              ]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_installs") {
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

    const prefixResult = await listPublicPageHandler(ctx as never, {
      query: "vyctor",
      paginationOpts: { cursor: null, numItems: 25 },
    });
    const exactResult = await listPublicPageHandler(ctx as never, {
      query: "vyctorbrzezowski",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(prefixResult.page.map((item) => item.handle)).toEqual(["vyctorbrzezowski"]);
    expect(prefixResult.page[0]?.stats.skills).toBe(5);
    expect(exactResult.page.map((item) => item.handle)).toEqual(["vyctorbrzezowski"]);
  });

  it("filters hidden legacy user publishers before counting and paginating public publisher pages", async () => {
    const publisherRows = [
      {
        _id: "publishers:proof-banned-builder",
        _creationTime: 1,
        kind: "user",
        handle: "proof-banned-builder",
        displayName: "Proof Banned Builder",
        linkedUserId: undefined,
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 10,
        totalDownloads: 100,
        totalStars: 5,
        createdAt: 1,
        updatedAt: 1,
      },
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
    ];
    const get = vi.fn(async (id: string) => {
      if (id === "users:proof-banned-builder") {
        return { _id: id, deletedAt: 1_700_000_000_000 };
      }
      if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
      return null;
    });
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
                  collect: vi.fn(async () => publisherRows),
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
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
            if (table === "publisherMembers" && indexName === "by_publisher") {
              return indexedRows(
                fields.publisherId === "publishers:proof-banned-builder"
                  ? [
                      {
                        _id: "publisherMembers:proof-banned-builder",
                        publisherId: "publishers:proof-banned-builder",
                        userId: "users:proof-banned-builder",
                        role: "owner",
                      },
                    ]
                  : [],
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

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((item) => item.handle)).toEqual(["alice"]);
    expect(result.counts).toEqual({ all: 1, individuals: 1, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 1, individuals: 1, organizations: 0 });
    expect(result.continueCursor).toBe("");
    expect(result.isDone).toBe(true);
    expect(get).toHaveBeenCalledWith("users:proof-banned-builder");
    expect(get).toHaveBeenCalledWith("users:alice");
    expect(ownerPublisherQueries).toEqual(["publishers:alice", "publishers:alice"]);
  });

  it("lists official creators and organizations from the official publisher index", async () => {
    const publishers = [
      {
        _id: "publishers:steipete",
        _creationTime: 1,
        kind: "user",
        handle: "steipete",
        displayName: "steipete",
        linkedUserId: "users:steipete",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 85_400,
        totalDownloads: 100_000,
        totalStars: 100,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 2,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 6,
        publishedPackages: 59,
        totalInstalls: 130,
        totalDownloads: 95_000,
        totalStars: 4,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "publishers:community",
        _creationTime: 3,
        kind: "org",
        handle: "community",
        displayName: "Community",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 1_000,
        totalDownloads: 1_000,
        totalStars: 1,
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    const officialRows = [
      {
        _id: "officialPublishers:steipete",
        publisherId: "publishers:steipete",
        createdAt: 1,
      },
      {
        _id: "officialPublishers:openclaw",
        publisherId: "publishers:openclaw",
        createdAt: 2,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:steipete") {
            return {
              _id: id,
              displayName: "Peter Steinberger",
              image: "https://github.com/steipete.png",
            };
          }
          return publishers.find((publisher) => publisher._id === id) ?? null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery?: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery?.(q);

            if (table === "officialPublishers" && indexName === "by_created") {
              return {
                order: vi.fn(() => ({ take: vi.fn(async () => officialRows) })),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return {
                unique: vi.fn(async () =>
                  officialRows.find((row) => row.publisherId === fields.publisherId),
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
      official: true,
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page.map((publisher) => publisher.handle)).toEqual(["steipete", "openclaw"]);
    expect(result.page.map((publisher) => publisher.kind)).toEqual(["user", "org"]);
    expect(result.page[0]?.displayName).toBe("Peter Steinberger");
    expect(result.page.every((publisher) => publisher.official)).toBe(true);
    expect(result.isDone).toBe(true);

    const creators = await listPublicPageHandler(ctx as never, {
      official: true,
      kind: "user",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(creators.page.map((publisher) => publisher.handle)).toEqual(["steipete"]);
    expect(creators.globalCounts).toEqual({ all: 2, individuals: 1, organizations: 1 });
  });

  it("orders and renders public publisher card previews by downloads", async () => {
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
    const rowsByDownloads = <
      T extends {
        updatedAt: number;
        stats?: { downloads?: number };
        statsDownloads?: number;
      },
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
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  collect: vi.fn(async () => publisherRows),
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
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
    expect(result.page[0]?.publishedItems.map((item) => item.installs)).toEqual([5, 35, 50]);
    expect(result.page[0]?.publishedItems.map((item) => item.downloads)).toEqual([128, 98, 12]);
  });

  it("does not hydrate every publisher catalog preview before filtering public publisher pages", async () => {
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
                  collect: vi.fn(async () => publisherRows),
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
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
    expect(get).toHaveBeenCalledTimes(120);
    expect(get).toHaveBeenCalledWith("users:user-0");
    expect(ownerPublisherQueries).toEqual(["publishers:user-0", "publishers:user-0"]);
  });

  it("ranks bounded legacy publishers missing download aggregates before paginating", async () => {
    const rankedPublisherRows = Array.from({ length: 2 }, (_, index) => ({
      _id: `publishers:user-${index}`,
      _creationTime: index,
      kind: "user",
      handle: `user-${index}`,
      displayName: `User ${index}`,
      linkedUserId: `users:user-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 500 - index,
      totalDownloads: 500 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const legacyFillerRows = Array.from({ length: 500 }, (_, index) => ({
      _id: `publishers:legacy-filler-${index}`,
      _creationTime: 100 + index,
      kind: "user",
      handle: `legacy-filler-${index}`,
      displayName: `Legacy Filler ${index}`,
      linkedUserId: `users:legacy-filler-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 500 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1_000 - index,
    }));
    const legacyPublisher = {
      _id: "publishers:legacy-popular",
      _creationTime: 600,
      kind: "user",
      handle: "legacy-popular",
      displayName: "Legacy Popular",
      linkedUserId: "users:legacy-popular",
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 1_000,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const legacyRowsByDownloadsIndex = [...legacyFillerRows, legacyPublisher];
    const legacyRowsByInstallsIndex = [legacyPublisher, ...legacyFillerRows];
    const skillRows = [
      {
        _id: "skills:legacy-popular",
        ownerPublisherId: "publishers:legacy-popular",
        softDeletedAt: undefined,
        displayName: "Legacy Popular Skill",
        moderationStatus: "active",
        statsDownloads: 1000,
        statsStars: 1,
        statsInstallsAllTime: 1,
        stats: { downloads: 1000, stars: 1, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 1,
      },
    ];
    const get = vi.fn(async (id: string) => ({ _id: id, image: `https://github.com/${id}.png` }));
    const legacyFallbackCollect = vi.fn(async () => {
      throw new Error("legacy publisher fallback must stay bounded");
    });
    const legacyDownloadsFallbackTake = vi.fn(async (limit: number) =>
      legacyRowsByDownloadsIndex.slice(0, limit),
    );
    const legacyInstallsFallbackTake = vi.fn(async (limit: number) =>
      legacyRowsByInstallsIndex.slice(0, limit),
    );
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const explicitFields = new Set<string>();
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                explicitFields.add(field);
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              const rows = explicitFields.has("totalDownloads")
                ? legacyRowsByDownloadsIndex
                : rankedPublisherRows;
              return {
                order: vi.fn(() => ({
                  collect: explicitFields.has("totalDownloads")
                    ? legacyFallbackCollect
                    : vi.fn(async () => rows),
                  take: explicitFields.has("totalDownloads")
                    ? legacyDownloadsFallbackTake
                    : vi.fn(async (limit: number) => rows.slice(0, limit)),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  collect: legacyFallbackCollect,
                  take: legacyInstallsFallbackTake,
                })),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(
                skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              return indexedRows(
                table === "skills"
                  ? skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId)
                  : [],
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

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((item) => item.handle)).toEqual(["legacy-popular"]);
    expect(result.page.map((item) => item.stats.downloads)).toEqual([1000]);
    expect(legacyDownloadsFallbackTake).not.toHaveBeenCalled();
    expect(legacyInstallsFallbackTake).toHaveBeenCalledWith(500);
    expect(legacyFallbackCollect).not.toHaveBeenCalled();
  });

  it("does not hydrate publisher catalog previews when a public publisher search has no matches", async () => {
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
    const get = vi.fn(async (id: string) => ({ _id: id }));
    const ownerPublisherQueries: string[] = [];
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const range: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
              gte: (field: string, value: unknown) => {
                range.gte = { field, value };
                return q;
              },
              lt: (field: string, value: unknown) => {
                range.lt = { field, value };
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  collect: vi.fn(async () => publisherRows),
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publishers" && indexName === "by_active_total_installs") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                take: vi.fn(async () => []),
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
      query: "no matching publisher",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([]);
    expect(result.counts).toEqual({ all: 0, individuals: 0, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 120, individuals: 120, organizations: 0 });
    expect(get).toHaveBeenCalledTimes(120);
    expect(ownerPublisherQueries).toEqual([]);
  });

  it("orders profile catalog items by downloads", async () => {
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
                  _id: "packages:low-download-plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/low-download-plugin",
                  displayName: "Low Download Plugin",
                  summary: "Scoped plugin",
                  stats: { downloads: 7, installs: 300, stars: 1, versions: 1 },
                  updatedAt: 6,
                },
                {
                  _id: "packages:high-download-plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/high-download-plugin",
                  displayName: "High Download Plugin",
                  summary: "Scoped plugin",
                  stats: { downloads: 70, installs: 3, stars: 1, versions: 1 },
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
      sort: "downloads",
      paginationOpts: { cursor: null, numItems: 12 },
    });

    expect(result.page).toMatchObject([
      {
        displayName: "High Download Plugin",
        downloads: 70,
        href: "/plugins/@openclaw/high-download-plugin",
        installs: 3,
      },
      {
        displayName: "Low Download Plugin",
        downloads: 7,
        href: "/plugins/@openclaw/low-download-plugin",
        installs: 300,
      },
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

  it("includes catalog icons but suppresses private plugin icon URLs (F7)", async () => {
    // Regression guard for F2: listPublishedPage must mirror `skills.icon`
    // onto the catalog DTO so the publisher profile page (/p/<handle>) can
    // render the same custom glyph that SkillCard / SkillListItem show on
    // /skills and /search. Public plugin icons mirror browse cards, but private
    // plugin URLs must not leak through public publisher profiles.
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
                  channel: "community",
                  scanStatus: "clean",
                  icon: "https://cdn.simpleicons.org/github/111111",
                  stats: { downloads: 5, installs: 2, stars: 0, versions: 1 },
                  updatedAt: 4,
                },
                {
                  _id: "packages:blocked-plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/blocked-plugin",
                  displayName: "Blocked Plugin",
                  summary: "A blocked plugin",
                  channel: "community",
                  scanStatus: "malicious",
                  icon: "https://malicious.example/icon.png",
                  stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
                  updatedAt: 3,
                },
                {
                  _id: "packages:private-plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/private-plugin",
                  displayName: "Private Plugin",
                  summary: "A private plugin",
                  channel: "private",
                  scanStatus: "clean",
                  icon: "https://private.example/icon.png",
                  stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
                  updatedAt: 2,
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
    // Skill without a legacy icon must surface null (not undefined) so cached
    // clients keep receiving a uniform response shape.
    expect(byName["Plain Skill"]).toMatchObject({ kind: "skill", icon: null });
    // Public plugins mirror the manifest icon used on browse cards.
    expect(byName["Example Plugin"]).toMatchObject({
      kind: "plugin",
      icon: "https://cdn.simpleicons.org/github/111111",
    });
    // Blocked plugin icon URLs also stay out of public publisher profiles.
    expect(byName["Blocked Plugin"]).toMatchObject({ kind: "plugin", icon: null });
    // Private plugin icon URLs must not leak through public publisher profiles.
    expect(byName["Private Plugin"]).toMatchObject({ kind: "plugin", icon: null });
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

  it.each([
    ["missing", null],
    ["deleted", { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 }],
    ["deactivated", { _id: "users:proof-banned-builder", deactivatedAt: 1_700_000_000_000 }],
  ])("hides user publisher profiles when the linked user is %s", async (_state, linkedUser) => {
    const ctx = makePublicPublisherVisibilityCtx({ linkedUser });

    await expect(
      getProfileByHandleHandler(ctx as never, { handle: "proof-banned-builder" }),
    ).resolves.toBeNull();
  });

  it.each([
    ["missing", null],
    ["deleted", { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 }],
    ["deactivated", { _id: "users:proof-banned-builder", deactivatedAt: 1_700_000_000_000 }],
  ])(
    "hides legacy no-link user publisher profiles when the owner user is %s",
    async (_state, linkedUser) => {
      const ctx = makePublicPublisherVisibilityCtx({
        legacyPersonalPublisher: true,
        linkedUser,
      });

      await expect(
        getProfileByHandleHandler(ctx as never, { handle: "proof-banned-builder" }),
      ).resolves.toBeNull();
    },
  );

  it("keeps active legacy no-link user publisher profiles visible through owner membership", async () => {
    const ctx = makePublicPublisherVisibilityCtx({ legacyPersonalPublisher: true });

    const profile = await getProfileByHandleHandler(ctx as never, {
      handle: "proof-banned-builder",
    });

    expect(profile).toEqual(expect.objectContaining({ handle: "proof-banned-builder" }));
    expect(profile).toEqual(expect.objectContaining({ starredCount: 1 }));
  });

  it("hides published items for a user publisher whose linked user is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      listPublishedPageHandler(ctx as never, {
        handle: "proof-banned-builder",
        paginationOpts: { cursor: null, numItems: 12 },
      }),
    ).resolves.toEqual({ page: [], continueCursor: "", isDone: true });
  });

  it("hides published items for a legacy no-link user publisher whose owner is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      legacyPersonalPublisher: true,
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      listPublishedPageHandler(ctx as never, {
        handle: "proof-banned-builder",
        paginationOpts: { cursor: null, numItems: 12 },
      }),
    ).resolves.toEqual({ page: [], continueCursor: "", isDone: true });
  });

  it("hides display manifests for a user publisher whose linked user is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      getPublishedDisplayManifestHandler(ctx as never, {
        handle: "proof-banned-builder",
        kind: "skill",
      }),
    ).resolves.toBeNull();
  });

  it("hides starred items for a user publisher whose linked user is deactivated", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      linkedUser: { _id: "users:proof-banned-builder", deactivatedAt: 1_700_000_000_000 },
    });

    await expect(
      listStarredPageHandler(ctx as never, {
        handle: "proof-banned-builder",
        paginationOpts: { cursor: null, numItems: 12 },
      }),
    ).resolves.toEqual({ page: [], continueCursor: "", isDone: true });
  });

  it("uses the active legacy no-link user publisher owner for starred items", async () => {
    const ctx = makePublicPublisherVisibilityCtx({ legacyPersonalPublisher: true });

    const result = await listStarredPageHandler(ctx as never, {
      handle: "proof-banned-builder",
      paginationOpts: { cursor: null, numItems: 12 },
    });

    expect(result.page.map((item) => item.displayName)).toEqual(["Demo Skill"]);
  });

  it("hides members for a user publisher whose linked user is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      listMembersHandler(ctx as never, { publisherHandle: "proof-banned-builder" }),
    ).resolves.toBeNull();
  });

  it("hides members for a legacy no-link user publisher whose owner is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      legacyPersonalPublisher: true,
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      listMembersHandler(ctx as never, { publisherHandle: "proof-banned-builder" }),
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

describe("official publisher administration", () => {
  it("marks personal publishers official", async () => {
    const actor = { _id: "users:admin", role: "admin" };
    const publisher = {
      _id: "publishers:steipete",
      kind: "user",
      handle: "steipete",
      displayName: "Peter Steinberger",
      linkedUserId: "users:steipete",
    };
    const inserted: Array<{ table: string; doc: Record<string, unknown> }> = [];
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(
        (
          indexName: string,
          builder: (q: { eq: (field: string, value: string) => unknown }) => unknown,
        ) => {
          const fields: Record<string, string> = {};
          const q = {
            eq: (field: string, value: string) => {
              fields[field] = value;
              return q;
            },
          };
          builder(q);
          if (table === "publishers" && indexName === "by_handle") {
            return {
              unique: vi.fn(async () => (fields.handle === "steipete" ? publisher : null)),
            };
          }
          if (table === "officialPublishers" && indexName === "by_publisher") {
            return { unique: vi.fn(async () => null) };
          }
          throw new Error(`unexpected ${table} index ${indexName}`);
        },
      ),
    }));
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "users:admin" ? actor : null)),
        query,
        patch: vi.fn(),
        delete: vi.fn(),
        insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
          inserted.push({ table, doc });
          return table === "officialPublishers"
            ? "officialPublishers:steipete"
            : `auditLogs:${inserted.length}`;
        }),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addOfficialPublisherInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        handle: "@steipete",
        reason: "Verified individual publisher",
      }),
    ).resolves.toMatchObject({
      ok: true,
      added: true,
      publisherId: "publishers:steipete",
      handle: "steipete",
      officialPublisherId: "officialPublishers:steipete",
    });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "officialPublishers",
      expect.objectContaining({
        publisherId: "publishers:steipete",
        reason: "Verified individual publisher",
        createdByUserId: "users:admin",
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.official.add",
        targetId: "publishers:steipete",
        metadata: { handle: "steipete", reason: "Verified individual publisher" },
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
          if (table === "skills" || table === "packages") {
            return emptyOwnedResourcesQuery();
          }
          if (table === "officialPublishers") {
            return emptyOfficialPublishersQuery();
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
  }

  it("returns the real personal publisher handle when it differs from the user handle", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              handle: "claimed",
              personalPublisherId: "publishers:alice-profile",
              createdAt: 1,
            };
          }
          if (id === "publishers:alice-profile") {
            return {
              _id: id,
              kind: "user",
              handle: "alice-profile",
              linkedUserId: "users:alice",
            };
          }
          return null;
        }),
        query: vi.fn(() => {
          throw new Error("unexpected query");
        }),
      },
    };

    await expect(getMyProfileHandleHandler(ctx as never, {} as never)).resolves.toBe(
      "alice-profile",
    );
  });

  it("falls back to the linked personal publisher when the direct pointer is stale", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              handle: "claimed",
              personalPublisherId: "publishers:stale",
              createdAt: 1,
            };
          }
          if (id === "publishers:stale") {
            return {
              _id: id,
              kind: "user",
              handle: "stale",
              linkedUserId: "users:bob",
              deactivatedAt: 2,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "publishers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName !== "by_linked_user") throw new Error(`unexpected index ${indexName}`);
              return {
                unique: vi.fn().mockResolvedValue({
                  _id: "publishers:alice-profile",
                  kind: "user",
                  handle: "alice-profile",
                  linkedUserId: "users:alice",
                }),
              };
            }),
          };
        }),
      },
    };

    await expect(getMyProfileHandleHandler(ctx as never, {} as never)).resolves.toBe(
      "alice-profile",
    );
  });

  it.each([
    {
      name: "hides a legacy pointer without an owner membership",
      memberships: [],
      expected: null,
    },
    {
      name: "returns a legacy pointer with the signed-in owner's membership",
      memberships: [
        {
          _id: "publisherMembers:alice",
          publisherId: "publishers:legacy-alice",
          userId: "users:alice",
          role: "owner",
        },
      ],
      expected: "legacy-alice",
    },
  ])("$name", async ({ memberships, expected }) => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              handle: "alice",
              personalPublisherId: "publishers:legacy-alice",
              createdAt: 1,
            };
          }
          if (id === "publishers:legacy-alice") {
            return {
              _id: id,
              kind: "user",
              handle: "legacy-alice",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "publisherMembers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName !== "by_publisher") throw new Error(`unexpected index ${indexName}`);
              return { collect: vi.fn().mockResolvedValue(memberships) };
            }),
          };
        }),
      },
    };

    await expect(getMyProfileHandleHandler(ctx as never, {} as never)).resolves.toBe(expected);
  });

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
          if (table === "skills" || table === "packages") {
            return emptyOwnedResourcesQuery();
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
          if (table === "skills" || table === "packages") {
            return emptyOwnedResourcesQuery();
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
          if (table === "skills" || table === "packages") {
            return emptyOwnedResourcesQuery();
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

  it("returns every published item for mine listings so deletion confirmations are complete", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const publisher = {
      _id: "publishers:alice",
      _creationTime: 1,
      kind: "user",
      handle: "alice",
      displayName: "Alice",
      linkedUserId: "users:alice",
      trustedPublisher: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const skills = Array.from({ length: 4 }, (_, index) => ({
      _id: `skills:tool-${index}`,
      _creationTime: index,
      ownerPublisherId: "publishers:alice",
      softDeletedAt: undefined,
      moderationStatus: "active",
      displayName: `Skill ${index + 1}`,
      updatedAt: index,
      stats: {
        downloads: index,
        stars: 0,
        installsCurrent: index,
        installsAllTime: index,
      },
    }));
    const packages = [
      {
        _id: "packages:plugin-1",
        _creationTime: 10,
        ownerPublisherId: "publishers:alice",
        family: "plugin",
        softDeletedAt: undefined,
        displayName: "Plugin 1",
        stats: { downloads: 8, stars: 0, installs: 8, versions: 1 },
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "alice",
              displayName: "Alice",
              personalPublisherId: "publishers:alice",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          if (id === "publishers:alice") return publisher;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return {
                  collect: vi.fn(async () => [
                    {
                      _id: "publisherMembers:alice",
                      publisherId: "publishers:alice",
                      userId: "users:alice",
                      role: "owner",
                    },
                  ]),
                };
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_owner_publisher_active_updated") {
                  throw new Error(`unexpected skills index ${indexName}`);
                }
                return indexedRows(skills);
              }),
            };
          }
          if (table === "packages") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_owner_publisher_active_updated") {
                  throw new Error(`unexpected packages index ${indexName}`);
                }
                return indexedRows(packages);
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

    const result = (await listMineHandler(ctx as never, {} as never)) as Array<{
      publisher: { publishedItems: Array<{ displayName: string }> };
    }>;

    expect(result[0]?.publisher.publishedItems.map((item) => item.displayName)).toEqual([
      "Plugin 1",
      "Skill 4",
      "Skill 3",
      "Skill 2",
      "Skill 1",
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

  it("creates org publishers for npm-compatible scoped package handles", async () => {
    const examples = ["example.tools", "lab_1", "studio_tools", "market_square"];

    for (const handle of examples) {
      const { ctx, inserts } = makeCreateOrgPublisherCtx({});

      await expect(
        createOrgPublisherForUserInternalHandler(ctx as never, {
          actorUserId: "users:vincent",
          handle,
          displayName: handle,
        }),
      ).resolves.toMatchObject({
        ok: true,
        handle,
        created: true,
      });
      expect(inserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "publishers",
            value: expect.objectContaining({
              kind: "org",
              handle,
              displayName: handle,
            }),
          }),
        ]),
      );
    }
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
  function makePersonalPublisherRecoveryCtx(
    options: {
      destinationHasResources?: boolean;
      legacyResources?: boolean;
      mixedCaseUserHandles?: boolean;
      tooManyLegacySkills?: boolean;
      unexpectedResourceOwner?: boolean;
      unexpectedReservationOwner?: boolean;
    } = {},
  ) {
    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin", handle: "admin" }],
      [
        "users:legacy",
        {
          _id: "users:legacy",
          role: "user",
          handle: options.mixedCaseUserHandles ? "Gingiris" : "gingiris",
          personalPublisherId: "publishers:gingiris",
          publishedSkills: 5,
          totalDownloads: 100,
          totalStars: 20,
          updatedAt: 1,
        },
      ],
      [
        "users:current",
        {
          _id: "users:current",
          role: "user",
          handle: options.mixedCaseUserHandles ? "Gingiris-1031" : "gingiris-1031",
          personalPublisherId: "publishers:gingiris-1031",
          publishedSkills: 2,
          totalDownloads: 40,
          totalStars: 4,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:gingiris",
        {
          _id: "publishers:gingiris",
          kind: "user",
          handle: "gingiris",
          displayName: "gingiris",
          linkedUserId: "users:legacy",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        "publishers:gingiris-1031",
        {
          _id: "publishers:gingiris-1031",
          kind: "user",
          handle: "gingiris-1031",
          displayName: "gingiris-1031",
          linkedUserId: "users:current",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const authAccounts = [
      {
        _id: "authAccounts:legacy",
        provider: "github",
        providerAccountId: "111",
        userId: "users:legacy",
      },
      {
        _id: "authAccounts:current",
        provider: "github",
        providerAccountId: "222",
        userId: "users:current",
      },
    ];
    const publisherMembers = new Map<string, Record<string, unknown>>([
      [
        "publisherMembers:legacy",
        {
          _id: "publisherMembers:legacy",
          publisherId: "publishers:gingiris",
          userId: "users:legacy",
          role: "owner",
        },
      ],
      [
        "publisherMembers:current",
        {
          _id: "publisherMembers:current",
          publisherId: "publishers:gingiris-1031",
          userId: "users:current",
          role: "owner",
        },
      ],
    ]);
    const baseSkill = {
      _id: "skills:legacy-skill",
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Recovered skill",
      ownerUserId: options.unexpectedResourceOwner ? "users:someone-else" : "users:legacy",
      ownerPublisherId: "publishers:gingiris",
      forkOf: undefined,
      tags: {},
      badges: {},
      stats: {
        downloads: 99,
        stars: 19,
        comments: 0,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      statsDownloads: 12,
      statsStars: 3,
      moderationStatus: "approved",
      createdAt: 1,
      updatedAt: 1,
    };
    const skills = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [["skills:legacy-skill", baseSkill]]
        : options.tooManyLegacySkills
          ? Array.from({ length: 101 }, (_, index) => [
              `skills:legacy-${index}`,
              {
                ...baseSkill,
                _id: `skills:legacy-${index}`,
                slug: `demo-skill-${index}`,
              },
            ])
          : [],
    );
    const skillSlugAliases = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "skillSlugAliases:legacy",
              {
                _id: "skillSlugAliases:legacy",
                slug: "old-demo-skill",
                skillId: "skills:legacy-skill",
                ownerUserId: "users:legacy",
                ownerPublisherId: "publishers:gingiris",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          ]
        : [],
    );
    const skillSearchDigest = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "skillSearchDigest:legacy",
              {
                _id: "skillSearchDigest:legacy",
                skillId: "skills:legacy-skill",
                ownerUserId: "users:legacy",
                ownerPublisherId: "publishers:gingiris",
              },
            ],
          ]
        : [],
    );
    const basePackage = {
      _id: "packages:legacy-package",
      name: "@gingiris/demo-plugin",
      normalizedName: "@gingiris/demo-plugin",
      displayName: "Demo Plugin",
      ownerUserId: "users:legacy",
      ownerPublisherId: "publishers:gingiris",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      compatibility: {},
      verification: {},
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const packages = new Map<string, Record<string, unknown>>(
      options.legacyResources ? [["packages:legacy-package", basePackage]] : [],
    );
    const packageSearchDigest = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "packageSearchDigest:legacy",
              {
                _id: "packageSearchDigest:legacy",
                packageId: "packages:legacy-package",
                ownerUserId: "users:legacy",
                ownerPublisherId: "publishers:gingiris",
              },
            ],
          ]
        : [],
    );
    const packageCapabilitySearchDigest = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "packageCapabilitySearchDigest:legacy-tools",
              {
                _id: "packageCapabilitySearchDigest:legacy-tools",
                packageId: "packages:legacy-package",
                capabilityTag: "tools",
                ownerUserId: "users:legacy",
                ownerPublisherId: "publishers:gingiris",
              },
            ],
          ]
        : [],
    );
    const packageTopicSearchDigest = new Map<string, Record<string, unknown>>();
    const packagePluginCategorySearchDigest = new Map<string, Record<string, unknown>>();
    const packageInspectorWarnings = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "packageInspectorWarnings:legacy",
              {
                _id: "packageInspectorWarnings:legacy",
                packageId: "packages:legacy-package",
                releaseId: "packageReleases:legacy",
                ownerUserId: "users:legacy",
                ownerPublisherId: "publishers:gingiris",
                createdAt: 1,
              },
            ],
          ]
        : [],
    );
    const githubSkillSources = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "githubSkillSources:legacy",
              {
                _id: "githubSkillSources:legacy",
                repo: "gingiris/skills",
                ownerPublisherId: "publishers:gingiris",
              },
            ],
          ]
        : [],
    );
    const reservedHandles = new Map<string, Record<string, unknown>>(
      options.legacyResources
        ? [
            [
              "reservedHandles:gingiris",
              {
                _id: "reservedHandles:gingiris",
                handle: "gingiris",
                rightfulOwnerUserId: options.unexpectedReservationOwner
                  ? "users:someone-else"
                  : "users:legacy",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          ]
        : [],
    );
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const deletes: string[] = [];

    const allRows = [
      users,
      publishers,
      publisherMembers,
      skills,
      skillSlugAliases,
      skillSearchDigest,
      packages,
      packageSearchDigest,
      packageCapabilitySearchDigest,
      packageTopicSearchDigest,
      packagePluginCategorySearchDigest,
      packageInspectorWarnings,
      githubSkillSources,
      reservedHandles,
    ];
    const get = vi.fn(async (id: string) => {
      return allRows.map((rows) => rows.get(id)).find(Boolean) ?? null;
    });
    const patch = vi.fn(async (id: string, patchValue: Record<string, unknown>) => {
      patches.push({ id, patch: patchValue });
      const row = allRows.map((rows) => rows.get(id)).find(Boolean);
      if (row) Object.assign(row, patchValue);
    });
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:inserted-${inserts.length + 1}`;
      const row = { _id: id, ...value };
      inserts.push({ table, value: row });
      if (table === "publisherMembers") publisherMembers.set(id, row);
      if (table === "skillSearchDigest") skillSearchDigest.set(id, row);
      if (table === "packageSearchDigest") packageSearchDigest.set(id, row);
      if (table === "packageCapabilitySearchDigest") packageCapabilitySearchDigest.set(id, row);
      if (table === "packageTopicSearchDigest") packageTopicSearchDigest.set(id, row);
      if (table === "packagePluginCategorySearchDigest") {
        packagePluginCategorySearchDigest.set(id, row);
      }
      return id;
    });
    const deleteFn = vi.fn(async (id: string) => {
      deletes.push(id);
      publisherMembers.delete(id);
      packageCapabilitySearchDigest.delete(id);
      packageTopicSearchDigest.delete(id);
      packagePluginCategorySearchDigest.delete(id);
    });
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(
        (
          _indexName: string,
          builder?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          const fields: Record<string, unknown> = {};
          const q = {
            eq: (field: string, value: unknown) => {
              fields[field] = value;
              return q;
            },
          };
          builder?.(q);
          const indexedQuery = {
            unique: vi.fn(async () => {
              if (table === "users") {
                return [...users.values()].find((user) => user.handle === fields.handle) ?? null;
              }
              if (table === "publishers" && fields.handle) {
                return (
                  [...publishers.values()].find(
                    (publisher) => publisher.handle === fields.handle,
                  ) ?? null
                );
              }
              if (table === "publishers" && fields.linkedUserId) {
                return (
                  [...publishers.values()].find(
                    (publisher) => publisher.linkedUserId === fields.linkedUserId,
                  ) ?? null
                );
              }
              if (table === "skillSearchDigest" && fields.skillId) {
                return (
                  [...skillSearchDigest.values()].find(
                    (digest) => digest.skillId === fields.skillId,
                  ) ?? null
                );
              }
              if (table === "packageSearchDigest" && fields.packageId) {
                return (
                  [...packageSearchDigest.values()].find(
                    (digest) => digest.packageId === fields.packageId,
                  ) ?? null
                );
              }
              return null;
            }),
            take: vi.fn(async () => {
              if (table === "authAccounts") {
                return authAccounts.filter(
                  (account) =>
                    account.provider === fields.provider &&
                    account.providerAccountId === fields.providerAccountId,
                );
              }
              if (table === "publisherMembers") {
                return [...publisherMembers.values()].filter(
                  (member) => member.publisherId === fields.publisherId,
                );
              }
              if (table === "reservedHandles") {
                return [...reservedHandles.values()].filter(
                  (reservation) =>
                    reservation.handle === fields.handle &&
                    reservation.releasedAt === fields.releasedAt,
                );
              }
              if (table === "skills" && fields.ownerPublisherId === "publishers:gingiris") {
                return [...skills.values()];
              }
              if (
                table === "skillSlugAliases" &&
                fields.ownerPublisherId === "publishers:gingiris"
              ) {
                return [...skillSlugAliases.values()];
              }
              if (table === "packages" && fields.ownerPublisherId === "publishers:gingiris") {
                return [...packages.values()];
              }
              if (
                table === "packageInspectorWarnings" &&
                fields.ownerPublisherId === "publishers:gingiris"
              ) {
                return [...packageInspectorWarnings.values()];
              }
              if (
                table === "githubSkillSources" &&
                fields.ownerPublisherId === "publishers:gingiris"
              ) {
                return [...githubSkillSources.values()];
              }
              if (
                options.destinationHasResources &&
                (table === "skills" || table === "packages" || table === "githubSkillSources") &&
                fields.ownerPublisherId === "publishers:gingiris-1031"
              ) {
                return [{ _id: `${table}:resource` }];
              }
              return [];
            }),
            collect: vi.fn(async () => {
              if (table === "packageCapabilitySearchDigest" && fields.packageId) {
                return [...packageCapabilitySearchDigest.values()].filter(
                  (digest) => digest.packageId === fields.packageId,
                );
              }
              if (table === "packageTopicSearchDigest" && fields.packageId) {
                return [...packageTopicSearchDigest.values()].filter(
                  (digest) => digest.packageId === fields.packageId,
                );
              }
              if (table === "packagePluginCategorySearchDigest" && fields.packageId) {
                return [...packagePluginCategorySearchDigest.values()].filter(
                  (digest) => digest.packageId === fields.packageId,
                );
              }
              return [];
            }),
          };
          return {
            ...indexedQuery,
            order: vi.fn(() => indexedQuery),
          };
        },
      ),
    }));

    return {
      ctx: {
        db: {
          get,
          patch,
          insert,
          delete: deleteFn,
          query,
          normalizeId: vi.fn(),
        },
      },
      users,
      publishers,
      inserts,
      patches,
      deletes,
      skills,
      skillSlugAliases,
      skillSearchDigest,
      packages,
      packageSearchDigest,
      packageCapabilitySearchDigest,
      packageInspectorWarnings,
      githubSkillSources,
      reservedHandles,
    };
  }

  it("recovers a personal publisher for a verified replacement GitHub principal", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const {
      ctx,
      users,
      publishers,
      inserts,
      patches,
      deletes,
      skills,
      skillSlugAliases,
      skillSearchDigest,
      packages,
      packageSearchDigest,
      packageCapabilitySearchDigest,
      packageInspectorWarnings,
      reservedHandles,
    } = makePersonalPublisherRecoveryCtx({ legacyResources: true });

    const result = await recoverPersonalPublisherInternalHandler(ctx as never, {
      actorUserId: "users:admin",
      publisherHandle: "gingiris",
      previousGitHubProviderAccountId: "111",
      nextGitHubProviderAccountId: "222",
      nextUserHandle: "gingiris-1031",
      reason: "Verified account continuity for issue #2555",
      confirmIdentityVerified: true,
      dryRun: false,
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      recovered: true,
      publisherId: "publishers:gingiris",
      handle: "gingiris",
      previousUser: { userId: "users:legacy", nextHandle: "gingiris-recovered" },
      nextUser: { userId: "users:current", nextHandle: "gingiris" },
      retiredPersonalPublisher: {
        publisherId: "publishers:gingiris-1031",
        handle: "gingiris-1031",
      },
      resourceOwnerMigration: {
        skills: 1,
        skillSlugAliases: 1,
        packages: 1,
        packageInspectorWarnings: 1,
        githubSourcesChecked: 1,
        handleReservations: 1,
      },
    });
    expect(users.get("users:legacy")).toMatchObject({
      handle: "gingiris-recovered",
      personalPublisherId: undefined,
      publishedSkills: 4,
      totalDownloads: 88,
      totalStars: 17,
    });
    expect(users.get("users:current")).toMatchObject({
      handle: "gingiris",
      personalPublisherId: "publishers:gingiris",
      publishedSkills: 3,
      totalDownloads: 52,
      totalStars: 7,
    });
    expect(publishers.get("publishers:gingiris")).toMatchObject({
      linkedUserId: "users:current",
    });
    expect(publishers.get("publishers:gingiris-1031")).toMatchObject({
      linkedUserId: undefined,
      deactivatedAt: 1_700_000_000_000,
    });
    expect(skills.get("skills:legacy-skill")).toMatchObject({
      ownerUserId: "users:current",
      updatedAt: 1_700_000_000_000,
    });
    expect(skillSlugAliases.get("skillSlugAliases:legacy")).toMatchObject({
      ownerUserId: "users:current",
      updatedAt: 1_700_000_000_000,
    });
    expect(skillSearchDigest.get("skillSearchDigest:legacy")).toMatchObject({
      ownerUserId: "users:current",
      ownerPublisherId: "publishers:gingiris",
      ownerHandle: "gingiris",
      ownerKind: "user",
    });
    expect(packages.get("packages:legacy-package")).toMatchObject({
      ownerUserId: "users:current",
      updatedAt: 1_700_000_000_000,
    });
    expect(packageSearchDigest.get("packageSearchDigest:legacy")).toMatchObject({
      ownerUserId: "users:current",
      ownerPublisherId: "publishers:gingiris",
      ownerHandle: "gingiris",
      ownerKind: "user",
    });
    expect(
      packageCapabilitySearchDigest.get("packageCapabilitySearchDigest:legacy-tools"),
    ).toBeDefined();
    expect(packageInspectorWarnings.get("packageInspectorWarnings:legacy")).toMatchObject({
      ownerUserId: "users:current",
    });
    expect(reservedHandles.get("reservedHandles:gingiris")).toMatchObject({
      rightfulOwnerUserId: "users:current",
      updatedAt: 1_700_000_000_000,
    });
    expect(deletes).toContain("publisherMembers:legacy");
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "publisherMembers",
        value: expect.objectContaining({
          publisherId: "publishers:gingiris",
          userId: "users:current",
          role: "owner",
        }),
      }),
    );
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "auditLogs",
        value: expect.objectContaining({
          actorUserId: "users:admin",
          action: "publisher.personal.recover",
          targetType: "publisher",
          targetId: "publishers:gingiris",
          metadata: expect.objectContaining({
            previousGitHubProviderAccountId: "111",
            nextGitHubProviderAccountId: "222",
            identityVerified: true,
            resourceOwnerMigration: expect.objectContaining({
              skills: 1,
              packages: 1,
              packageInspectorWarnings: 1,
            }),
          }),
        }),
      }),
    );
    expect(patches.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "publishers:gingiris-1031",
        "users:legacy",
        "users:current",
        "publishers:gingiris",
        "skills:legacy-skill",
        "skillSearchDigest:legacy",
        "skillSlugAliases:legacy",
        "packages:legacy-package",
        "packageSearchDigest:legacy",
        "packageInspectorWarnings:legacy",
        "reservedHandles:gingiris",
      ]),
    );
  });

  it("recovers users whose stored handles retain mixed-case GitHub casing", async () => {
    const { ctx, users } = makePersonalPublisherRecoveryCtx({
      mixedCaseUserHandles: true,
    });

    const result = await recoverPersonalPublisherInternalHandler(ctx as never, {
      actorUserId: "users:admin",
      publisherHandle: "gingiris",
      previousGitHubProviderAccountId: "111",
      nextGitHubProviderAccountId: "222",
      nextUserHandle: "gingiris-1031",
      reason: "Verified account continuity for issue #2555",
      confirmIdentityVerified: true,
      dryRun: false,
    });

    expect(result).toMatchObject({
      previousUser: { nextHandle: "gingiris-recovered" },
      nextUser: { nextHandle: "gingiris" },
    });
    expect(users.get("users:legacy")).toMatchObject({
      handle: "gingiris-recovered",
      personalPublisherId: undefined,
    });
    expect(users.get("users:current")).toMatchObject({
      handle: "gingiris",
      personalPublisherId: "publishers:gingiris",
    });
  });

  it("fails closed when the destination personal publisher has resources", async () => {
    const { ctx, inserts, patches } = makePersonalPublisherRecoveryCtx({
      destinationHasResources: true,
    });

    await expect(
      recoverPersonalPublisherInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        publisherHandle: "gingiris",
        previousGitHubProviderAccountId: "111",
        nextGitHubProviderAccountId: "222",
        nextUserHandle: "gingiris-1031",
        reason: "Verified account continuity for issue #2555",
        confirmIdentityVerified: true,
        dryRun: false,
      }),
    ).rejects.toThrow(/has resources/i);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("fails closed when recovered publisher resources belong to another user", async () => {
    const { ctx, inserts, patches } = makePersonalPublisherRecoveryCtx({
      legacyResources: true,
      unexpectedResourceOwner: true,
    });

    await expect(
      recoverPersonalPublisherInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        publisherHandle: "gingiris",
        previousGitHubProviderAccountId: "111",
        nextGitHubProviderAccountId: "222",
        nextUserHandle: "gingiris-1031",
        reason: "Verified account continuity for issue #2555",
        confirmIdentityVerified: true,
        dryRun: false,
      }),
    ).rejects.toThrow(/another user/i);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("fails closed when the recovered handle reservation belongs to another user", async () => {
    const { ctx, inserts, patches } = makePersonalPublisherRecoveryCtx({
      legacyResources: true,
      unexpectedReservationOwner: true,
    });

    await expect(
      recoverPersonalPublisherInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        publisherHandle: "gingiris",
        previousGitHubProviderAccountId: "111",
        nextGitHubProviderAccountId: "222",
        nextUserHandle: "gingiris-1031",
        reason: "Verified account continuity for issue #2555",
        confirmIdentityVerified: true,
        dryRun: false,
      }),
    ).rejects.toThrow(/reservation .* belongs to another user/i);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("fails closed when recovered publisher resource migration exceeds the bounded batch", async () => {
    const { ctx, inserts, patches } = makePersonalPublisherRecoveryCtx({
      tooManyLegacySkills: true,
    });

    await expect(
      recoverPersonalPublisherInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        publisherHandle: "gingiris",
        previousGitHubProviderAccountId: "111",
        nextGitHubProviderAccountId: "222",
        nextUserHandle: "gingiris-1031",
        reason: "Verified account continuity for issue #2555",
        confirmIdentityVerified: true,
        dryRun: false,
      }),
    ).rejects.toThrow(/resumable owner migration/i);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

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
