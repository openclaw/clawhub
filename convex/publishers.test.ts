import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import {
  assertCanManageOwnedResource,
  ensurePersonalPublisherForUser,
  requirePublisherRole,
} from "./lib/publishers";
import {
  addMember,
  acceptMemberInvite,
  listInvitesForPublisher,
  listMyInvites,
  listPublicPage,
  listPublic,
  listMine,
  getDeletionInventory,
  getMyProfileHandle,
  getHomeOfficialCreatorSummaries,
  getHomeOfficialCreatorSummariesPageInternal,
  getHomePublisherSummaries,
  getProfileByHandle,
  createMemberInvite,
  declineMemberInvite,
  getOgMetaByHandle,
  listMembers,
  listPublishedPage,
  listStarredPage,
  revokeMemberInvite,
  getPublishedDisplayManifest,
  migrateLegacyPublisherHandleToOrgInternal,
  ensureOrgPublisherHandleInternal,
  removeOrgPublisherMemberInternal,
  recoverPersonalPublisherInternal,
  createOrg,
  createImageUpload,
  deleteOrg,
  reclaimDeletedOrgHandleInternal,
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

const createMemberInviteHandler = (
  createMemberInvite as unknown as WrappedHandler<
    {
      publisherId: string;
      userHandle: string;
      role: "owner" | "admin" | "publisher";
    },
    { ok: true; inviteId: string }
  >
)._handler;

const revokeMemberInviteHandler = (
  revokeMemberInvite as unknown as WrappedHandler<{ inviteId: string }, { ok: true }>
)._handler;

const declineMemberInviteHandler = (
  declineMemberInvite as unknown as WrappedHandler<{ inviteId: string }, { ok: true }>
)._handler;

const acceptMemberInviteHandler = (
  acceptMemberInvite as unknown as WrappedHandler<{ inviteId: string }, { ok: true }>
)._handler;

const listInvitesForPublisherHandler = (
  listInvitesForPublisher as unknown as WrappedHandler<
    { publisherId: string },
    Array<{ _id: string; targetHandle: string }>
  >
)._handler;

const listMyInvitesHandler = (
  listMyInvites as unknown as WrappedHandler<Record<string, never>, Array<{ _id: string }>>
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
  listMine as unknown as WrappedHandler<{ includePublishedItems?: boolean }, Array<unknown>>
)._handler;

const getDeletionInventoryHandler = (
  getDeletionInventory as unknown as WrappedHandler<
    { publisherId?: string },
    Array<{
      handle: string;
      publishedItems: Array<{ displayName: string }>;
    }>
  >
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
      page: Array<{ displayName: string; href: string; kind: "skill" | "plugin" }>;
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

const getHomePublisherSummariesHandler = (
  getHomePublisherSummaries as unknown as WrappedHandler<{ handles: string[] }>
)._handler;

const getHomeOfficialCreatorSummariesHandler = (
  getHomeOfficialCreatorSummaries as unknown as WrappedHandler<{ limit?: number }>
)._handler;

const getHomeOfficialCreatorSummariesPageInternalHandler = (
  getHomeOfficialCreatorSummariesPageInternal as unknown as WrappedHandler<{
    cursor: string | null;
  }>
)._handler;

const getOgMetaByHandleHandler = (
  getOgMetaByHandle as unknown as WrappedHandler<
    { handle: string },
    {
      displayName?: string | null;
      affiliations?: Array<{
        publisher?: {
          handle?: string | null;
          displayName?: string | null;
          image?: string | null;
        } | null;
        role?: string;
      }>;
      stats: { downloads: number; installs: number; stars: number };
    } | null
  >
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
    imageStorageId?: string;
    imageUploadTicket?: string;
  }>
)._handler;

const createImageUploadHandler = (
  createImageUpload as unknown as WrappedHandler<{ publisherId: string }>
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

const reclaimDeletedOrgHandleInternalHandler = (
  reclaimDeletedOrgHandleInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      reason: string;
      dryRun?: boolean;
      confirmationToken?: string;
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      dryRun: boolean;
      hardDeleted: boolean;
      activeSkills: number;
      activePackages: number;
      memberCount: number;
      githubSources: number;
      githubSourceContents: number;
      officialPublisher: boolean;
      confirmationToken: string;
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
  const paginate = vi.fn(
    async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
      const offset = cursor ? Number(cursor) : 0;
      const page = rows.slice(offset, offset + numItems);
      const nextOffset = offset + page.length;
      const isDone = nextOffset >= rows.length;
      return {
        page,
        isDone,
        continueCursor: isDone ? "" : String(nextOffset),
      };
    },
  );
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
    collect: vi.fn(async () => rows),
    first: vi.fn(async (): Promise<unknown> => null),
    take: vi.fn(async (limit: number) => rows.slice(0, limit)),
    paginate,
    order: vi.fn(() => ({
      collect: vi.fn(async () => rows),
      take: vi.fn(async (limit: number) => rows.slice(0, limit)),
      paginate,
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

function emptyPublisherFeedPublicationQuery() {
  return {
    withIndex: vi.fn((indexName: string) => {
      if (indexName !== "by_publisher") {
        throw new Error(`unexpected publisherFeedPublications index ${indexName}`);
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

function emptyPublisherInvitesQuery() {
  return {
    withIndex: vi.fn((indexName: string) => {
      if (indexName !== "by_publisher_status_expires") {
        throw new Error(`unexpected publisherInvites index ${indexName}`);
      }
      return { collect: vi.fn(async () => []) };
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

function makeHomeSummaryPublisher(handle: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: `publishers:${handle}`,
    _creationTime: 1,
    kind: "org",
    handle,
    displayName: handle,
    publishedSkills: 2,
    publishedPackages: 1,
    totalInstalls: 3,
    totalDownloads: 4,
    totalStars: 5,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeHomePublisherSummariesCtx(
  publishers: Array<ReturnType<typeof makeHomeSummaryPublisher>>,
  users: Record<string, Record<string, unknown> | null> = {},
) {
  const publishersByHandle = new Map(publishers.map((publisher) => [publisher.handle, publisher]));
  const publisherReads: string[] = [];
  const query = vi.fn((table: string) => {
    if (table !== "publishers") throw new Error(`unexpected table ${table}`);
    return {
      withIndex: vi.fn(
        (
          indexName: string,
          buildQuery: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
          let handle: string | undefined;
          const q = {
            eq(field: string, value: unknown) {
              if (field === "handle") handle = String(value);
              return q;
            },
          };
          buildQuery(q);
          return {
            unique: vi.fn(async () => {
              if (!handle) return null;
              publisherReads.push(handle);
              return publishersByHandle.get(handle) ?? null;
            }),
          };
        },
      ),
    };
  });
  const get = vi.fn(async (id: string) => users[id] ?? null);

  return { ctx: { db: { query, get } }, publisherReads, query, get };
}

describe("home publisher summaries", () => {
  it("rejects more than ten input handles before reading the database", async () => {
    const query = vi.fn();
    const get = vi.fn();

    await expect(
      getHomePublisherSummariesHandler({ db: { query, get } } as never, {
        handles: Array.from({ length: 11 }, () => "duplicate"),
      }),
    ).rejects.toThrow("at most 10");
    expect(query).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("normalizes and deduplicates handles while preserving first-seen order", async () => {
    const bravo = makeHomeSummaryPublisher("bravo", {
      kind: "user",
      linkedUserId: "users:bravo",
      displayName: "Publisher fallback",
    });
    const alpha = makeHomeSummaryPublisher("alpha");
    const { ctx, publisherReads, get } = makeHomePublisherSummariesCtx([bravo, alpha], {
      "users:bravo": {
        _id: "users:bravo",
        displayName: "Bravo Builder",
        image: "https://example.test/bravo.png",
        bio: "Builds useful tools.",
      },
    });

    const summaries = await getHomePublisherSummariesHandler(ctx as never, {
      handles: [" @Bravo ", "alpha", "BRAVO"],
    });

    expect(summaries).toEqual([
      expect.objectContaining({
        handle: "bravo",
        displayName: "Bravo Builder",
        image: "https://example.test/bravo.png",
        bio: "Builds useful tools.",
        stats: { skills: 2, packages: 1, installs: 3, downloads: 4, stars: 5 },
      }),
      expect.objectContaining({
        handle: "alpha",
        displayName: "alpha",
        stats: { skills: 2, packages: 1, installs: 3, downloads: 4, stars: 5 },
      }),
    ]);
    expect(publisherReads).toEqual(["bravo", "alpha"]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("users:bravo");
  });

  it("omits incomplete or invisible summaries without reading catalog or membership tables", async () => {
    const publishers = [
      makeHomeSummaryPublisher("incomplete", { totalStars: undefined }),
      makeHomeSummaryPublisher("deactivated", { deactivatedAt: 2 }),
      makeHomeSummaryPublisher("deleted", { deletedAt: 2 }),
      makeHomeSummaryPublisher("missing-user", {
        kind: "user",
        linkedUserId: "users:missing",
      }),
      makeHomeSummaryPublisher("deleted-user", {
        kind: "user",
        linkedUserId: "users:deleted",
      }),
      makeHomeSummaryPublisher("deactivated-user", {
        kind: "user",
        linkedUserId: "users:deactivated",
      }),
      makeHomeSummaryPublisher("legacy-unlinked", { kind: "user" }),
    ];
    const { ctx, query, get } = makeHomePublisherSummariesCtx(publishers, {
      "users:deleted": { _id: "users:deleted", deletedAt: 2 },
      "users:deactivated": { _id: "users:deactivated", deactivatedAt: 2 },
    });

    await expect(
      getHomePublisherSummariesHandler(ctx as never, {
        handles: [...publishers.map((publisher) => publisher.handle), "not-found"],
      }),
    ).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(8);
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe("home official creator summaries", () => {
  it("pages the official publisher index and returns only active organizations with content", async () => {
    const publishers = [
      makeHomeSummaryPublisher("high", { totalInstalls: 100 }),
      makeHomeSummaryPublisher("person", {
        kind: "user",
        linkedUserId: "users:person",
        totalInstalls: 80,
      }),
      makeHomeSummaryPublisher("empty", {
        publishedSkills: 0,
        publishedPackages: 0,
        totalInstalls: 70,
      }),
      makeHomeSummaryPublisher("inactive", { deactivatedAt: 2, totalInstalls: 50 }),
    ];
    const officialRows = publishers.map((publisher, index) => ({
      _id: `officialPublishers:${index}`,
      publisherId: publisher._id,
      createdAt: index,
      updatedAt: index,
    }));
    const query = vi.fn((table: string) => {
      if (table === "officialPublishers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            expect(indexName).toBe("by_created");
            return indexedRows(officialRows);
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:person") return { _id: id, displayName: "Person" };
      return publishers.find((publisher) => publisher._id === id) ?? null;
    });

    const result = (await getHomeOfficialCreatorSummariesPageInternalHandler(
      { db: { query, get } } as never,
      { cursor: null },
    )) as {
      summaries: Array<{ handle: string; kind: string }>;
      isDone: boolean;
      continueCursor: string;
    };

    expect(result.summaries.map((summary) => summary.handle)).toEqual(["high"]);
    expect(result.summaries.every((summary) => summary.kind === "org")).toBe(true);
    expect(result.isDone).toBe(true);
  });

  it("collects every official page, orders by installs, and clamps the result to sixteen", async () => {
    const makeSummary = (index: number, installs: number) => ({
      ...makeHomeSummaryPublisher(`org-${index}`, { totalInstalls: installs }),
      stats: { skills: 2, packages: 1, installs, downloads: installs, stars: 5 },
    });
    const firstPage = Array.from({ length: 12 }, (_, index) => makeSummary(index, 20 - index));
    const secondPage = Array.from({ length: 8 }, (_, index) =>
      makeSummary(index + 12, 100 - index),
    );
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        summaries: firstPage,
        continueCursor: "page-2",
        isDone: false,
      })
      .mockResolvedValueOnce({
        summaries: secondPage,
        continueCursor: "",
        isDone: true,
      });

    const summaries = (await getHomeOfficialCreatorSummariesHandler({ runQuery } as never, {
      limit: 99,
    })) as Array<{ handle: string; stats: { installs: number } }>;

    expect(summaries).toHaveLength(16);
    expect(summaries.map((summary) => summary.stats.installs)).toEqual([
      100, 99, 98, 97, 96, 95, 94, 93, 20, 19, 18, 17, 16, 15, 14, 13,
    ]);
    expect(runQuery).toHaveBeenNthCalledWith(1, expect.anything(), { cursor: null });
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.anything(), { cursor: "page-2" });
  });

  it("fails closed when legacy official rows exceed the bounded curation limit", async () => {
    const runQuery = vi.fn();
    for (let page = 0; page < 4; page += 1) {
      runQuery.mockResolvedValueOnce({
        summaries: [],
        continueCursor: `page-${page + 1}`,
        isDone: false,
      });
    }

    await expect(getHomeOfficialCreatorSummariesHandler({ runQuery } as never, {})).rejects.toThrow(
      "Official publisher limit exceeded",
    );
    expect(runQuery).toHaveBeenCalledTimes(4);
  });
});

describe("publishers membership controls", () => {
  it("lets an org owner delete an org and cascade owned resources", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 1, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValue({ deleted: 0, scheduled: false });
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
          if (table === "publisherFeedPublications") {
            return emptyPublisherFeedPublicationQuery();
          }
          if (table === "publisherInvites") {
            return emptyPublisherInvitesQuery();
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
    expect(runMutation).toHaveBeenCalledTimes(4);
    expect(runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      publisherId: "publishers:gladia",
    });
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
          if (table === "publisherInvites") {
            return emptyPublisherInvitesQuery();
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

  function makeReclaimDeletedOrgCtx(
    options: {
      publisher?: Record<string, unknown> | null;
      activeSkills?: Array<Record<string, unknown>>;
      activePackages?: Array<Record<string, unknown>>;
      invites?: Array<Record<string, unknown>>;
    } = {},
  ) {
    const publisher = options.publisher ?? {
      _id: "publishers:tencent",
      kind: "org",
      handle: "tencent",
      displayName: "TENCENT",
      deletedAt: 2_000,
      deactivatedAt: 2_000,
      createdAt: 1,
      updatedAt: 2_000,
    };
    const members = [
      {
        _id: "publisherMembers:owner",
        publisherId: "publishers:tencent",
        userId: "users:spammer",
        role: "owner",
      },
    ];
    const deleted = vi.fn();
    const insert = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn(async () => publisher) };
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_owner_publisher_active_updated") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return { take: vi.fn(async () => options.activeSkills ?? []) };
          }),
        };
      }
      if (table === "packages") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_owner_publisher_active_updated") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return { take: vi.fn(async () => options.activePackages ?? []) };
          }),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_publisher") throw new Error(`unexpected index ${indexName}`);
            return { collect: vi.fn(async () => members) };
          }),
        };
      }
      if (table === "publisherInvites") {
        return {
          withIndex: vi.fn(
            (
              indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              if (indexName !== "by_publisher_status_expires") {
                throw new Error(`unexpected index ${indexName}`);
              }
              const fields: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  fields[field] = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                collect: vi.fn(async () =>
                  (options.invites ?? []).filter(
                    (invite) =>
                      invite.publisherId === fields.publisherId && invite.status === fields.status,
                  ),
                ),
              };
            },
          ),
        };
      }
      if (table === "githubSkillSources" || table === "githubSkillContents") {
        return emptyOwnedResourcesQuery();
      }
      if (table === "officialPublishers") return emptyOfficialPublishersQuery();
      if (table === "publisherFeedPublications") return emptyPublisherFeedPublicationQuery();
      throw new Error(`unexpected table ${table}`);
    });
    return {
      ctx: {
        runMutation: vi.fn(async () => ({ deleted: 0, scheduled: false })),
        scheduler: { runAfter: vi.fn() },
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:admin") return { _id: id, role: "admin" };
            return null;
          }),
          query,
          insert,
          delete: deleted,
          patch: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
      },
      deleted,
      insert,
    };
  }

  it("dry-runs hard deletion for a deleted empty org handle", async () => {
    const { ctx, deleted, insert } = makeReclaimDeletedOrgCtx();

    const result = await reclaimDeletedOrgHandleInternalHandler(ctx as never, {
      actorUserId: "users:admin",
      handle: "Tencent",
      reason: "Free spam org handle",
    });

    expect(result).toMatchObject({
      ok: true,
      publisherId: "publishers:tencent",
      handle: "tencent",
      dryRun: true,
      hardDeleted: false,
      activeSkills: 0,
      activePackages: 0,
      memberCount: 1,
      confirmationToken: "reclaim-deleted-org:tencent",
    });
    expect(deleted).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires the confirmation token before hard deleting", async () => {
    const { ctx, deleted } = makeReclaimDeletedOrgCtx();

    await expect(
      reclaimDeletedOrgHandleInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        handle: "tencent",
        reason: "Free spam org handle",
        dryRun: false,
      }),
    ).rejects.toThrow('Confirmation token must be "reclaim-deleted-org:tencent"');
    expect(deleted).not.toHaveBeenCalled();
  });

  it("hard deletes the deleted org publisher row and records an audit log", async () => {
    const { ctx, deleted, insert } = makeReclaimDeletedOrgCtx({
      invites: [
        {
          _id: "publisherInvites:pending",
          publisherId: "publishers:tencent",
          status: "pending",
        },
      ],
    });

    const result = await reclaimDeletedOrgHandleInternalHandler(ctx as never, {
      actorUserId: "users:admin",
      handle: "tencent",
      reason: "Free spam org handle",
      dryRun: false,
      confirmationToken: "reclaim-deleted-org:tencent",
    });

    expect(result).toMatchObject({
      dryRun: false,
      hardDeleted: true,
      memberCount: 1,
      inviteCount: 1,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:admin",
        action: "publisher.org.reclaim_deleted_handle",
        targetType: "publisher",
        targetId: "publishers:tencent",
        metadata: expect.objectContaining({
          handle: "tencent",
          reason: "Free spam org handle",
        }),
      }),
    );
    expect(deleted).toHaveBeenCalledWith("publisherMembers:owner");
    expect(deleted).toHaveBeenCalledWith("publisherInvites:pending");
    expect(deleted).toHaveBeenCalledWith("publishers:tencent");
  });

  it("refuses to reclaim an active org handle", async () => {
    const { ctx } = makeReclaimDeletedOrgCtx({
      publisher: {
        _id: "publishers:tencent",
        kind: "org",
        handle: "tencent",
        displayName: "TENCENT",
        createdAt: 1,
        updatedAt: 2,
      },
    });

    await expect(
      reclaimDeletedOrgHandleInternalHandler(ctx as never, {
        actorUserId: "users:admin",
        handle: "tencent",
        reason: "Free spam org handle",
      }),
    ).rejects.toThrow("Publisher is active; use org delete before reclaiming the handle");
  });

  it("deletes sole-owner account orgs when other owner memberships are inactive", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 1, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValue({ deleted: 0, scheduled: false });
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
          if (table === "publisherFeedPublications") {
            return emptyPublisherFeedPublicationQuery();
          }
          if (table === "publisherInvites") {
            return emptyPublisherInvitesQuery();
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
                  if (fields.kind === "user" && prefix === "vyctor" && upper === "vyctor\uffff") {
                    return [vyctorbrzezowski];
                  }
                  return [];
                }),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
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
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
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
    const packageRows = [
      {
        _id: "packages:high-download-plugin",
        _creationTime: 2,
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        name: "@openclaw/high-download-plugin",
        displayName: "High Download Plugin",
        summary: "Scoped plugin",
        stats: { downloads: 70, installs: 3, stars: 1, versions: 1 },
        updatedAt: 5,
      },
      {
        _id: "packages:low-download-plugin",
        _creationTime: 1,
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        name: "@openclaw/low-download-plugin",
        displayName: "Low Download Plugin",
        summary: "Scoped plugin",
        stats: { downloads: 7, installs: 300, stars: 1, versions: 1 },
        updatedAt: 6,
      },
    ];
    const packagePage = indexedRows(packageRows);
    const legacyPackageRows = indexedRows(packageRows);
    packagePage.collect.mockImplementation(async () => {
      throw new Error("catalog pagination must not collect the package table");
    });
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
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
              return packagePage;
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return legacyPackageRows;
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const firstPage = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      kind: "plugin",
      sort: "downloads",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    const secondPage = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      kind: "plugin",
      sort: "downloads",
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
    });
    const resumedLegacyPage = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      kind: "plugin",
      sort: "downloads",
      paginationOpts: { cursor: "1", numItems: 1 },
    });

    expect([...firstPage.page, ...secondPage.page]).toMatchObject([
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
    expect(packagePage.order).toHaveBeenCalledWith("desc");
    expect(packagePage.paginate).toHaveBeenNthCalledWith(1, { cursor: null, numItems: 1 });
    expect(packagePage.paginate).toHaveBeenNthCalledWith(2, { cursor: "1", numItems: 1 });
    expect(firstPage.continueCursor).toBe("indexed:1");
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.isDone).toBe(true);
    expect(resumedLegacyPage.page.map((item) => item.displayName)).toEqual(["Low Download Plugin"]);
    expect(resumedLegacyPage.isDone).toBe(true);
  });

  it("preserves mixed catalog pagination when kind is omitted", async () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const skill = {
      _id: "skills:demo",
      _creationTime: 2,
      ownerPublisherId: publisher._id,
      ownerUserId: "users:owner",
      softDeletedAt: undefined,
      slug: "demo",
      displayName: "Demo Skill",
      moderationStatus: "active",
      stats: { downloads: 10, stars: 1, installsCurrent: 1, installsAllTime: 2 },
      updatedAt: 5,
    };
    const pkg = {
      _id: "packages:demo",
      _creationTime: 3,
      ownerPublisherId: publisher._id,
      softDeletedAt: undefined,
      family: "code-plugin",
      name: "@openclaw/demo",
      displayName: "Demo Plugin",
      stats: { downloads: 5, installs: 1, stars: 0, versions: 1 },
      updatedAt: 4,
    };
    const ctx = {
      db: {
        get: vi.fn(async () => null),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string) => {
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => publisher) };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([skill]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([pkg]);
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const firstPage = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      sort: "downloads",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    const secondPage = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      sort: "downloads",
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
    });

    expect(firstPage.page.map((item) => item.kind)).toEqual(["skill"]);
    expect(firstPage.continueCursor).toBe("1");
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page.map((item) => item.kind)).toEqual(["plugin"]);
    expect(secondPage.isDone).toBe(true);
  });

  it("preserves canonical download order for legacy skills across pages", async () => {
    const publisher = {
      _id: "publishers:legacy",
      _creationTime: 1,
      kind: "org",
      handle: "legacy",
      displayName: "Legacy",
      publishedSkills: 2,
      publishedPackages: 0,
      totalInstalls: 4,
      totalDownloads: 77,
      totalStars: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const highDownloadLegacySkill = {
      _id: "skills:legacy-high",
      _creationTime: 1,
      ownerPublisherId: publisher._id,
      ownerUserId: "users:legacy",
      softDeletedAt: undefined,
      slug: "legacy-high",
      displayName: "Legacy High",
      moderationStatus: "active",
      stats: { downloads: 70, stars: 1, installsCurrent: 1, installsAllTime: 2 },
      updatedAt: 5,
    };
    const lowDownloadSkill = {
      _id: "skills:modern-low",
      _creationTime: 2,
      ownerPublisherId: publisher._id,
      ownerUserId: "users:legacy",
      softDeletedAt: undefined,
      slug: "modern-low",
      displayName: "Modern Low",
      moderationStatus: "active",
      statsDownloads: 7,
      stats: { downloads: 7, stars: 1, installsCurrent: 1, installsAllTime: 2 },
      updatedAt: 6,
    };
    const legacyLookup = indexedRows([]);
    legacyLookup.first.mockResolvedValue(highDownloadLegacySkill);
    const legacyRows = indexedRows([lowDownloadSkill, highDownloadLegacySkill]);
    const queriedTables: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === publisher._id ? publisher : null)),
        query: vi.fn((table: string) => {
          queriedTables.push(table);
          return {
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
                return { unique: vi.fn(async () => publisher) };
              }
              if (table === "officialPublishers" && indexName === "by_publisher") {
                return { unique: vi.fn(async () => null) };
              }
              if (
                table === "skills" &&
                indexName === "by_owner_publisher_active_downloads" &&
                "statsDownloads" in fields
              ) {
                return legacyLookup;
              }
              if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
                return legacyRows;
              }
              throw new Error(`unexpected ${table} index ${indexName}`);
            }),
          };
        }),
      },
    };

    const firstPage = await listPublishedPageHandler(ctx as never, {
      handle: "legacy",
      kind: "skill",
      sort: "downloads",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    legacyLookup.first.mockResolvedValue(null);
    const secondPage = await listPublishedPageHandler(ctx as never, {
      handle: "legacy",
      kind: "skill",
      sort: "downloads",
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
    });

    expect([...firstPage.page, ...secondPage.page].map((item) => item.displayName)).toEqual([
      "Legacy High",
      "Modern Low",
    ]);
    expect(firstPage.continueCursor).toBe("legacy:1");
    expect(secondPage.isDone).toBe(true);
    expect(legacyLookup.first).toHaveBeenCalledTimes(1);
    expect(legacyRows.collect).toHaveBeenCalledTimes(2);
    expect(queriedTables).not.toContain("packages");
  });

  it("resumes untagged pre-index cursors with the original comparator across backfill", async () => {
    const publisher = {
      _id: "publishers:preindex",
      _creationTime: 1,
      kind: "org",
      handle: "preindex",
      displayName: "Pre-index",
      publishedSkills: 3,
      publishedPackages: 0,
      totalInstalls: 3,
      totalDownloads: 30,
      totalStars: 6,
      createdAt: 1,
      updatedAt: 1,
    };
    const originalRows = [
      {
        _id: "skills:old-a",
        _creationTime: 1,
        ownerPublisherId: publisher._id,
        ownerUserId: "users:preindex",
        softDeletedAt: undefined,
        slug: "old-a",
        displayName: "Old A",
        moderationStatus: "active",
        stats: { downloads: 10, stars: 3, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 1,
      },
      {
        _id: "skills:old-b",
        _creationTime: 3,
        ownerPublisherId: publisher._id,
        ownerUserId: "users:preindex",
        softDeletedAt: undefined,
        slug: "old-b",
        displayName: "Old B",
        moderationStatus: "active",
        stats: { downloads: 10, stars: 2, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 3,
      },
      {
        _id: "skills:old-c",
        _creationTime: 2,
        ownerPublisherId: publisher._id,
        ownerUserId: "users:preindex",
        softDeletedAt: undefined,
        slug: "old-c",
        displayName: "Old C",
        moderationStatus: "active",
        stats: { downloads: 10, stars: 1, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 2,
      },
    ];
    let rows = originalRows;
    const collect = vi.fn(async () => rows);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === publisher._id ? publisher : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string) => {
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: vi.fn(async () => publisher) };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return { collect };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const resumedPage = await listPublishedPageHandler(ctx as never, {
      handle: "preindex",
      kind: "skill",
      sort: "downloads",
      paginationOpts: { cursor: "1", numItems: 1 },
    });
    rows = originalRows.map((row) => ({ ...row, statsDownloads: row.stats.downloads }));
    const pageAfterBackfill = await listPublishedPageHandler(ctx as never, {
      handle: "preindex",
      kind: "skill",
      sort: "downloads",
      paginationOpts: { cursor: resumedPage.continueCursor, numItems: 1 },
    });

    expect(resumedPage.continueCursor).toBe("preindex:2");
    expect([
      "Old A",
      ...resumedPage.page.map((item) => item.displayName),
      ...pageAfterBackfill.page.map((item) => item.displayName),
    ]).toEqual(["Old A", "Old B", "Old C"]);
    expect(pageAfterBackfill.isDone).toBe(true);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("uses complete profile counters without reading resource or star tables", async () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      publishedSkills: 3,
      publishedPackages: 2,
      totalInstalls: 50,
      totalDownloads: 80,
      totalStars: 7,
      createdAt: 1,
      updatedAt: 1,
    };
    const queriedTables: string[] = [];
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          queriedTables.push(table);
          return {
            withIndex: vi.fn((indexName: string) => {
              if (table === "publishers" && indexName === "by_handle") {
                return { unique: vi.fn(async () => publisher) };
              }
              if (table === "officialPublishers" && indexName === "by_publisher") {
                return { unique: vi.fn(async () => null) };
              }
              throw new Error(`unexpected ${table} index ${indexName}`);
            }),
          };
        }),
      },
    };

    const result = await getProfileByHandleHandler(ctx as never, { handle: "openclaw" });

    expect(result).toEqual(
      expect.objectContaining({
        stats: { skills: 3, packages: 2, installs: 50, downloads: 80, stars: 7 },
      }),
    );
    expect(result).not.toHaveProperty("publishedItems");
    expect(queriedTables).not.toContain("skills");
    expect(queriedTables).not.toContain("packages");
    expect(queriedTables).not.toContain("stars");
  });

  it("computes OG metadata stats when publisher denormalized stats are missing", async () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const skill = {
      _id: "skills:demo",
      ownerPublisherId: "publishers:openclaw",
      softDeletedAt: undefined,
      moderationStatus: "active",
      stats: { downloads: 42, stars: 2, installsCurrent: 4, installsAllTime: 7 },
    };
    const pkg = {
      _id: "packages:demo",
      ownerPublisherId: "publishers:openclaw",
      softDeletedAt: undefined,
      stats: { downloads: 8, installs: 5, stars: 1 },
    };
    const ctx = {
      db: {
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
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(fields.ownerPublisherId === publisher._id ? [skill] : []);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(fields.ownerPublisherId === publisher._id ? [pkg] : []);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await getOgMetaByHandleHandler(ctx as never, { handle: "openclaw" });

    expect(result?.stats).toEqual({
      skills: 1,
      packages: 1,
      installs: 12,
      downloads: 50,
      stars: 3,
    });
  });

  it("returns verified visible organization affiliations for user OG metadata", async () => {
    const personalPublisher = {
      _id: "publishers:teoslayer",
      _creationTime: 1,
      kind: "user",
      userId: "users:teoslayer",
      linkedUserId: "users:teoslayer",
      handle: "teoslayer",
      displayName: null,
      createdAt: 1,
      updatedAt: 1,
      publishedSkills: 0,
      publishedPackages: 0,
      totalInstalls: 3,
      totalDownloads: 10,
      totalStars: 4,
      statsDownloads: 10,
      statsInstallsCurrent: 2,
      statsInstallsAllTime: 3,
      statsStars: 4,
      stats: { downloads: 10, installsCurrent: 2, installsAllTime: 3, stars: 4 },
    };
    const user = {
      _id: "users:teoslayer",
      handle: "teoslayer",
      displayName: "Calin Teodor",
      image: "https://example.com/avatar.png",
      bio: "Publisher @teoslayer on ClawHub.",
    };
    const openclawPublisher = {
      _id: "publishers:openclaw",
      _creationTime: 2,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      image: "https://example.com/openclaw.png",
      createdAt: 1,
      updatedAt: 1,
    };
    const deactivatedPublisher = {
      _id: "publishers:archived",
      _creationTime: 3,
      kind: "org",
      handle: "archived",
      displayName: "Archived",
      image: "https://example.com/archived.png",
      createdAt: 1,
      updatedAt: 1,
      deactivatedAt: 2,
    };
    const irrelevantMemberships = Array.from({ length: 70 }, (_, index) => ({
      _id: `publisherMembers:missing-${index}`,
      publisherId: `publishers:missing-${index}`,
      userId: user._id,
      role: "publisher",
    }));
    const memberships = [
      {
        _id: "publisherMembers:self",
        publisherId: personalPublisher._id,
        userId: user._id,
        role: "owner",
      },
      ...irrelevantMemberships,
      {
        _id: "publisherMembers:openclaw",
        publisherId: openclawPublisher._id,
        userId: user._id,
        role: "publisher",
      },
      {
        _id: "publisherMembers:archived",
        publisherId: deactivatedPublisher._id,
        userId: user._id,
        role: "publisher",
      },
    ];
    const publishersById = new Map<string, unknown>([
      [personalPublisher._id, personalPublisher],
      [openclawPublisher._id, openclawPublisher],
      [deactivatedPublisher._id, deactivatedPublisher],
    ]);
    const usersById = new Map<string, unknown>([[user._id, user]]);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => publishersById.get(id) ?? usersById.get(id) ?? null),
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
                unique: vi.fn(async () =>
                  fields.handle === personalPublisher.handle ? personalPublisher : null,
                ),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publisherMembers" && indexName === "by_user") {
              return indexedRows(fields.userId === user._id ? memberships : []);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await getOgMetaByHandleHandler(ctx as never, { handle: "teoslayer" });

    expect(result?.displayName).toBe("Calin Teodor");
    expect(result?.affiliations).toEqual([
      {
        publisher: expect.objectContaining({
          handle: "openclaw",
          displayName: "OpenClaw",
          image: "https://example.com/openclaw.png",
        }),
        role: "publisher",
      },
    ]);
  });

  it("bounds raw membership rows scanned for user OG metadata", async () => {
    const personalPublisher = {
      _id: "publishers:teoslayer",
      _creationTime: 1,
      kind: "user",
      linkedUserId: "users:teoslayer",
      handle: "teoslayer",
      displayName: null,
      createdAt: 1,
      updatedAt: 1,
      publishedSkills: 0,
      publishedPackages: 0,
      totalInstalls: 3,
      totalDownloads: 10,
      totalStars: 4,
      statsDownloads: 10,
      statsInstallsCurrent: 2,
      statsInstallsAllTime: 3,
      statsStars: 4,
      stats: { downloads: 10, installsCurrent: 2, installsAllTime: 3, stars: 4 },
    };
    const user = {
      _id: "users:teoslayer",
      handle: "teoslayer",
      displayName: "Calin Teodor",
      image: "https://example.com/avatar.png",
      bio: "Publisher @teoslayer on ClawHub.",
    };
    const memberships = [
      {
        _id: "publisherMembers:self",
        publisherId: personalPublisher._id,
        userId: user._id,
        role: "owner",
      },
      ...Array.from({ length: 600 }, (_, index) => ({
        _id: `publisherMembers:missing-${index}`,
        publisherId: `publishers:missing-${index}`,
        userId: user._id,
        role: "publisher",
      })),
    ];
    const usersById = new Map<string, unknown>([[user._id, user]]);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => usersById.get(id) ?? null),
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
                unique: vi.fn(async () =>
                  fields.handle === personalPublisher.handle ? personalPublisher : null,
                ),
              };
            }
            if (table === "officialPublishers" && indexName === "by_publisher") {
              return { unique: vi.fn(async () => null) };
            }
            if (table === "publisherMembers" && indexName === "by_user") {
              return indexedRows(fields.userId === user._id ? memberships : []);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await getOgMetaByHandleHandler(ctx as never, { handle: "teoslayer" });

    expect(result?.affiliations).toEqual([]);
    expect(ctx.db.get).toHaveBeenCalledWith("publishers:missing-510");
    expect(ctx.db.get).not.toHaveBeenCalledWith("publishers:missing-511");
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
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
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
      kind: "skill",
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
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
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
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
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

    const skillResult = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      kind: "skill",
      paginationOpts: { cursor: null, numItems: 12 },
    });
    const pluginResult = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      kind: "plugin",
      paginationOpts: { cursor: null, numItems: 12 },
    });
    const result = {
      page: [...skillResult.page, ...pluginResult.page],
    } as unknown as {
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
    expect(profile).not.toHaveProperty("starredCount");
  });

  it("hides published items for a user publisher whose linked user is deleted", async () => {
    const ctx = makePublicPublisherVisibilityCtx({
      linkedUser: { _id: "users:proof-banned-builder", deletedAt: 1_700_000_000_000 },
    });

    await expect(
      listPublishedPageHandler(ctx as never, {
        handle: "proof-banned-builder",
        kind: "skill",
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
        kind: "skill",
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

  it("ignores inactive owner rows when removing org owners", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "users:inactive-owner") {
            return {
              _id: id,
              handle: "inactive-owner",
              deactivatedAt: 9_000,
            };
          }
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
                      {
                        _id: "publisherMembers:inactive-owner",
                        publisherId: "publishers:org",
                        userId: "users:inactive-owner",
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

    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it("prevents adding a new org member without invitation acceptance", async () => {
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
    ).rejects.toThrow(
      "New organization members must accept an invitation before they can be added",
    );

    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  function makeInviteCtx(options?: {
    authUserId?: string;
    actorRole?: "owner" | "admin" | "publisher";
    invites?: Array<Record<string, unknown>>;
    strangerHandle?: string;
    targetIsMember?: boolean;
    targetRole?: "owner" | "admin" | "publisher";
    inactiveOwnerMember?: boolean;
  }) {
    const publisherMembers: Array<Record<string, unknown>> = [
      {
        _id: "publisherMembers:owner",
        publisherId: "publishers:org",
        userId: "users:owner",
        role: options?.actorRole ?? "owner",
      },
    ];
    if (options?.targetIsMember) {
      publisherMembers.push({
        _id: "publisherMembers:target",
        publisherId: "publishers:org",
        userId: "users:target",
        role: options.targetRole ?? "publisher",
      });
    }
    if (options?.inactiveOwnerMember) {
      publisherMembers.push({
        _id: "publisherMembers:inactive-owner",
        publisherId: "publishers:org",
        userId: "users:inactive-owner",
        role: "owner",
      });
    }
    const publisherInvites = new Map<string, Record<string, unknown>>();
    for (const invite of options?.invites ?? []) {
      publisherInvites.set(String(invite._id), invite);
    }
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publisherInvites") {
        const id = `publisherInvites:${publisherInvites.size + 1}`;
        publisherInvites.set(id, { _id: id, ...value });
        return id;
      }
      if (table === "publisherMembers") {
        const id = `publisherMembers:${publisherMembers.length + 1}`;
        publisherMembers.push({ _id: id, ...value });
        return id;
      }
      if (table === "auditLogs") return `auditLogs:${insert.mock.calls.length}`;
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      const invite = publisherInvites.get(id);
      if (invite) {
        Object.assign(invite, value);
        return;
      }
      const member = publisherMembers.find((row) => row._id === id);
      if (member) {
        Object.assign(member, value);
        return;
      }
      throw new Error(`unexpected patch ${id}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id, handle: "owner", displayName: "Owner" };
          if (id === "users:target") return { _id: id, handle: "target", displayName: "Target" };
          if (id === "users:inactive-owner") {
            return {
              _id: id,
              handle: "inactive-owner",
              displayName: "Inactive Owner",
              deactivatedAt: 9_000,
            };
          }
          if (id === "users:stranger") {
            return {
              _id: id,
              handle: options?.strangerHandle ?? "stranger",
              displayName: "Stranger",
            };
          }
          if (id === "publishers:org") {
            return { _id: id, kind: "org", handle: "acme", displayName: "Acme" };
          }
          if (id === "publishers:target") {
            return {
              _id: id,
              kind: "user",
              handle: "target",
              displayName: "Target",
              linkedUserId: "users:target",
            };
          }
          return publisherInvites.get(id) ?? null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (
              indexName: string,
              builder?: (q: {
                eq: (field: string, value: string) => unknown;
                gte: (field: string, value: number) => unknown;
              }) => unknown,
            ) => {
              const fields: Record<string, string> = {};
              const lowerBounds: Record<string, number> = {};
              const q = {
                eq: (field: string, value: string) => {
                  fields[field] = value;
                  return q;
                },
                gte: (field: string, value: number) => {
                  lowerBounds[field] = value;
                  return q;
                },
              };
              builder?.(q);
              if (table === "publisherMembers" && indexName === "by_publisher_user") {
                return {
                  unique: vi.fn(
                    async () =>
                      publisherMembers.find(
                        (member) =>
                          member.publisherId === fields.publisherId &&
                          member.userId === fields.userId,
                      ) ?? null,
                  ),
                };
              }
              if (table === "publisherMembers" && indexName === "by_publisher") {
                return {
                  collect: vi.fn(async () =>
                    publisherMembers.filter((member) => member.publisherId === fields.publisherId),
                  ),
                };
              }
              if (table === "users" && indexName === "handle") {
                return {
                  unique: vi.fn(async () => {
                    if (fields.handle === "owner") {
                      return { _id: "users:owner", handle: "owner", displayName: "Owner" };
                    }
                    if (fields.handle === "target") {
                      return { _id: "users:target", handle: "target", displayName: "Target" };
                    }
                    return null;
                  }),
                };
              }
              if (table === "publishers" && indexName === "by_handle") {
                return { unique: vi.fn(async () => null) };
              }
              if (table === "publishers" && indexName === "by_linked_user") {
                return {
                  unique: vi.fn(async () =>
                    fields.linkedUserId === "users:target"
                      ? {
                          _id: "publishers:target",
                          kind: "user",
                          handle: "target",
                          displayName: "Target",
                          linkedUserId: "users:target",
                        }
                      : null,
                  ),
                };
              }
              if (table === "publisherInvites" && indexName === "by_publisher_status_expires") {
                return {
                  take: vi.fn(async (limit: number) =>
                    [...publisherInvites.values()]
                      .filter(
                        (invite) =>
                          invite.publisherId === fields.publisherId &&
                          invite.status === fields.status &&
                          Number(invite.expiresAt) >= lowerBounds.expiresAt,
                      )
                      .sort((left, right) => Number(left.expiresAt) - Number(right.expiresAt))
                      .slice(0, limit),
                  ),
                };
              }
              if (
                table === "publisherInvites" &&
                indexName === "by_publisher_target_status_expires"
              ) {
                return {
                  take: vi.fn(async (limit: number) =>
                    [...publisherInvites.values()]
                      .filter(
                        (invite) =>
                          invite.publisherId === fields.publisherId &&
                          invite.targetHandle === fields.targetHandle &&
                          invite.status === fields.status &&
                          Number(invite.expiresAt) >= lowerBounds.expiresAt,
                      )
                      .sort((left, right) => Number(left.expiresAt) - Number(right.expiresAt))
                      .slice(0, limit),
                  ),
                };
              }
              if (table === "publisherInvites" && indexName === "by_target_handle_status_expires") {
                return {
                  take: vi.fn(async (limit: number) =>
                    [...publisherInvites.values()]
                      .filter(
                        (invite) =>
                          invite.targetHandle === fields.targetHandle &&
                          invite.status === fields.status &&
                          Number(invite.expiresAt) >= lowerBounds.expiresAt,
                      )
                      .sort((left, right) => Number(left.expiresAt) - Number(right.expiresAt))
                      .slice(0, limit),
                  ),
                };
              }
              if (
                table === "publisherInvites" &&
                indexName === "by_publisher_target_user_status_expires"
              ) {
                return {
                  take: vi.fn(async (limit: number) =>
                    [...publisherInvites.values()]
                      .filter(
                        (invite) =>
                          invite.publisherId === fields.publisherId &&
                          invite.targetUserId === fields.targetUserId &&
                          invite.status === fields.status &&
                          Number(invite.expiresAt) >= lowerBounds.expiresAt,
                      )
                      .sort((left, right) => Number(left.expiresAt) - Number(right.expiresAt))
                      .slice(0, limit),
                  ),
                };
              }
              if (table === "publisherInvites" && indexName === "by_target_user_status_expires") {
                return {
                  take: vi.fn(async (limit: number) =>
                    [...publisherInvites.values()]
                      .filter(
                        (invite) =>
                          invite.targetUserId === fields.targetUserId &&
                          invite.status === fields.status &&
                          Number(invite.expiresAt) >= lowerBounds.expiresAt,
                      )
                      .sort((left, right) => Number(left.expiresAt) - Number(right.expiresAt))
                      .slice(0, limit),
                  ),
                };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch,
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };
    vi.mocked(getAuthUserId).mockResolvedValue((options?.authUserId ?? "users:owner") as never);
    return { ctx, insert, patch, publisherInvites, publisherMembers };
  }

  it("creates pending organization member invitations instead of membership rows", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx();
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).resolves.toEqual({ ok: true, inviteId: "publisherInvites:1" });
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).toHaveBeenCalledWith(
      "publisherInvites",
      expect.objectContaining({
        publisherId: "publishers:org",
        inviterUserId: "users:owner",
        targetHandle: "target",
        targetUserId: "users:target",
        role: "admin",
        status: "pending",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.member.invite.create",
        targetId: "publishers:org",
      }),
    );
  });

  it("prevents admins from inviting new org owners", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx({ actorRole: "admin" });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "owner" } as never,
        ),
      ).rejects.toThrow("Only org owners can invite new owners");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherInvites", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
  });

  it("prevents admins from demoting org owners through member role updates", async () => {
    const { ctx, patch } = makeInviteCtx({
      actorRole: "admin",
      targetIsMember: true,
      targetRole: "owner",
    });

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "target", role: "publisher" } as never,
      ),
    ).rejects.toThrow("Only org owners can demote owners");

    expect(patch).not.toHaveBeenCalled();
  });

  it("prevents demoting the last remaining org owner through member role updates", async () => {
    const { ctx, patch } = makeInviteCtx();

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "owner", role: "admin" } as never,
      ),
    ).rejects.toThrow("Publisher must have at least one owner");

    expect(patch).not.toHaveBeenCalled();
  });

  it("ignores inactive owner rows when demoting org owners", async () => {
    const { ctx, patch } = makeInviteCtx({ inactiveOwnerMember: true });

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "owner", role: "admin" } as never,
      ),
    ).rejects.toThrow("Publisher must have at least one owner");

    expect(patch).not.toHaveBeenCalled();
  });

  it("lets org owners demote another owner when one owner remains", async () => {
    const { ctx, patch } = makeInviteCtx({ targetIsMember: true, targetRole: "owner" });

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "publisherMembers:target",
      expect.objectContaining({ role: "admin" }),
    );
  });

  it("rejects invitations for unresolved handles", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx();
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "typo-target", role: "admin" } as never,
        ),
      ).rejects.toThrow('User "@typo-target" not found');
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherInvites", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
  });

  it("rejects duplicate active member invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:existing",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).rejects.toThrow("@target already has a pending invitation");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects duplicate active invitations when an older pending invite is expired", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:expired",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 1_000,
          updatedAt: 1_000,
          expiresAt: 9_000,
        },
        {
          _id: "publisherInvites:active",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).rejects.toThrow("@target already has a pending invitation");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherInvites", expect.anything());
  });

  it("allows a fresh invitation when the only matching pending invite is expired", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:expired",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 1_000,
          updatedAt: 1_000,
          expiresAt: 9_000,
        },
      ],
    });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).resolves.toEqual({ ok: true, inviteId: "publisherInvites:2" });
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).toHaveBeenCalledWith(
      "publisherInvites",
      expect.objectContaining({
        publisherId: "publishers:org",
        targetHandle: "target",
        targetUserId: "users:target",
        role: "admin",
      }),
    );
  });

  it("rejects duplicate active invitations for the same resolved user", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:active",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target-personal",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).rejects.toThrow("@target already has a pending invitation");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherInvites", expect.anything());
  });

  it("allows a fresh invitation when a handle was reclaimed from another pending invite target", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:old-target",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:stranger",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        createMemberInviteHandler(
          ctx as never,
          { publisherId: "publishers:org", userHandle: "target", role: "admin" } as never,
        ),
      ).resolves.toEqual({ ok: true, inviteId: "publisherInvites:2" });
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).toHaveBeenCalledWith(
      "publisherInvites",
      expect.objectContaining({
        publisherId: "publishers:org",
        targetHandle: "target",
        targetUserId: "users:target",
        role: "admin",
      }),
    );
  });

  it("accepts a matching invitation and creates the membership row", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert, patch } = makeInviteCtx({
      authUserId: "users:target",
      invites: [
        {
          _id: "publisherInvites:accepted",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        acceptMemberInviteHandler(
          ctx as never,
          {
            inviteId: "publisherInvites:accepted",
          } as never,
        ),
      ).resolves.toEqual({ ok: true });
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).toHaveBeenCalledWith(
      "publisherMembers",
      expect.objectContaining({
        publisherId: "publishers:org",
        userId: "users:target",
        role: "admin",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherInvites:accepted",
      expect.objectContaining({
        status: "accepted",
        acceptedByUserId: "users:target",
      }),
    );
  });

  it("rejects accepting expired pending invitations before they are pruned", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert, patch } = makeInviteCtx({
      authUserId: "users:target",
      invites: [
        {
          _id: "publisherInvites:expired",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 1_000,
          updatedAt: 1_000,
          expiresAt: 9_000,
        },
      ],
    });
    try {
      await expect(
        acceptMemberInviteHandler(
          ctx as never,
          {
            inviteId: "publisherInvites:expired",
          } as never,
        ),
      ).rejects.toThrow("Invitation has expired");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not let stale invitations overwrite an existing member role", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert, patch, publisherMembers } = makeInviteCtx({
      authUserId: "users:target",
      targetIsMember: true,
      invites: [
        {
          _id: "publisherInvites:accepted",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "owner",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        acceptMemberInviteHandler(
          ctx as never,
          {
            inviteId: "publisherInvites:accepted",
          } as never,
        ),
      ).resolves.toEqual({ ok: true });
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(publisherMembers).toContainEqual(
      expect.objectContaining({
        _id: "publisherMembers:target",
        role: "publisher",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publisherInvites:accepted",
      expect.objectContaining({
        status: "accepted",
        acceptedByUserId: "users:target",
      }),
    );
  });

  it("does not let non-target users accept member invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert, patch } = makeInviteCtx({
      authUserId: "users:stranger",
      invites: [
        {
          _id: "publisherInvites:target",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });

    try {
      await expect(
        acceptMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:target" } as never),
      ).rejects.toThrow("Forbidden");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not let a reclaimed handle accept an invitation bound to another user", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, insert, patch } = makeInviteCtx({
      authUserId: "users:stranger",
      strangerHandle: "target",
      invites: [
        {
          _id: "publisherInvites:target",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });

    try {
      await expect(
        acceptMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:target" } as never),
      ).rejects.toThrow("Forbidden");
    } finally {
      nowSpy.mockRestore();
    }

    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not list handle-matched invitations bound to another user", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx } = makeInviteCtx({
      authUserId: "users:stranger",
      strangerHandle: "target",
      invites: [
        {
          _id: "publisherInvites:bound-to-original",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 8_000,
          updatedAt: 8_000,
          expiresAt: 20_000,
        },
        {
          _id: "publisherInvites:handle-only",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });

    try {
      await expect(listMyInvitesHandler(ctx as never, {})).resolves.toEqual([
        expect.objectContaining({ _id: "publisherInvites:handle-only" }),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("lets the invite target decline member invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, patch, insert } = makeInviteCtx({
      authUserId: "users:target",
      invites: [
        {
          _id: "publisherInvites:target",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        declineMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:target" } as never),
      ).resolves.toEqual({ ok: true });
    } finally {
      nowSpy.mockRestore();
    }

    expect(patch).toHaveBeenCalledWith(
      "publisherInvites:target",
      expect.objectContaining({
        status: "declined",
        declinedByUserId: "users:target",
        targetUserId: "users:target",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.member.invite.decline",
        targetId: "publishers:org",
      }),
    );
  });

  it("does not let non-target users decline member invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, patch, insert } = makeInviteCtx({
      authUserId: "users:stranger",
      invites: [
        {
          _id: "publisherInvites:target",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });

    try {
      await expect(
        declineMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:target" } as never),
      ).rejects.toThrow("Forbidden");
    } finally {
      nowSpy.mockRestore();
    }

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalledWith("auditLogs", expect.anything());
  });

  it("lets org managers revoke pending member invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, patch, insert } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:pending",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        revokeMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:pending" } as never),
      ).resolves.toEqual({ ok: true });
    } finally {
      nowSpy.mockRestore();
    }

    expect(patch).toHaveBeenCalledWith(
      "publisherInvites:pending",
      expect.objectContaining({
        status: "revoked",
        revokedByUserId: "users:owner",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "publisher.member.invite.revoke" }),
    );
  });

  it("prevents admins from revoking pending owner invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx, patch } = makeInviteCtx({
      actorRole: "admin",
      invites: [
        {
          _id: "publisherInvites:pending",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "owner",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        revokeMemberInviteHandler(ctx as never, { inviteId: "publisherInvites:pending" } as never),
      ).rejects.toThrow("Only org owners can revoke owner invitations");
    } finally {
      nowSpy.mockRestore();
    }

    expect(patch).not.toHaveBeenCalled();
  });

  it("lists only pending non-expired publisher invitations for org managers", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx } = makeInviteCtx({
      invites: [
        {
          _id: "publisherInvites:active",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "admin",
          status: "pending",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
        {
          _id: "publisherInvites:expired",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "pending",
          createdAt: 1_000,
          updatedAt: 1_000,
          expiresAt: 9_000,
        },
        {
          _id: "publisherInvites:revoked",
          publisherId: "publishers:org",
          inviterUserId: "users:owner",
          targetHandle: "target",
          targetUserId: "users:target",
          role: "publisher",
          status: "revoked",
          createdAt: 9_000,
          updatedAt: 9_000,
          expiresAt: 20_000,
        },
      ],
    });
    try {
      await expect(
        listInvitesForPublisherHandler(
          ctx as never,
          {
            publisherId: "publishers:org",
          } as never,
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          _id: "publisherInvites:active",
          targetHandle: "target",
          role: "admin",
          publisher: expect.objectContaining({ handle: "acme" }),
          inviter: expect.objectContaining({ handle: "owner" }),
          targetUser: expect.objectContaining({ handle: "target" }),
        }),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("prevents publisher-role members from listing pending publisher invitations", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { ctx } = makeInviteCtx({ actorRole: "publisher" });
    try {
      await expect(
        listInvitesForPublisherHandler(
          ctx as never,
          {
            publisherId: "publishers:org",
          } as never,
        ),
      ).rejects.toThrow("Forbidden");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("lets org owners update an existing member role", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const publisherMembers: Array<Record<string, unknown>> = [
      {
        _id: "publisherMembers:owner",
        publisherId: "publishers:org",
        userId: "users:owner",
        role: "owner",
      },
      {
        _id: "publisherMembers:jared",
        publisherId: "publishers:org",
        userId: "users:jared",
        role: "publisher",
      },
    ];
    const insert = vi.fn(async (table: string) => {
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`unexpected insert ${table}`);
    });
    const patch = vi.fn(async () => {});
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "users:jared") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "jaredforreal",
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
                    unique: vi.fn(async () =>
                      handle === "jaredforreal"
                        ? {
                            _id: "users:jared",
                            handle: "jaredforreal",
                            displayName: "Jared",
                          }
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
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let linkedUserId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "linkedUserId") linkedUserId = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(async () => {
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
        patch,
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

    expect(patch).toHaveBeenCalledWith(
      "publisherMembers:jared",
      expect.objectContaining({ role: "admin" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.member.upsert",
        targetId: "publishers:org",
        metadata: {
          memberUserId: "users:jared",
          memberHandle: "jaredforreal",
          role: "admin",
        },
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

  it("issues logo upload tickets only to org admins", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const insert = vi.fn(async () => "publisherImageUploadTickets:1");
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return { _id: id, kind: "org", handle: "shopify", displayName: "Shopify" };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
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
      storage: {
        generateUploadUrl: vi.fn(async () => "https://storage.example/upload"),
      },
    };

    await expect(
      createImageUploadHandler(ctx as never, { publisherId: "publishers:org" }),
    ).resolves.toEqual({
      uploadUrl: "https://storage.example/upload",
      uploadTicket: "publisherImageUploadTickets:1",
    });
    expect(insert).toHaveBeenCalledWith(
      "publisherImageUploadTickets",
      expect.objectContaining({
        publisherId: "publishers:org",
        userId: "users:admin",
        expiresAt: expect.any(Number),
      }),
    );
  });

  it("accepts a validated uploaded logo and removes the previous stored image", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const publisher = {
      _id: "publishers:org",
      kind: "org",
      handle: "shopify",
      displayName: "Shopify",
      image: "https://storage.example/old",
      imageStorageId: "storage:old",
    };
    let publisherReadCount = 0;
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const deleteStorage = vi.fn(async () => {});
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            publisherReadCount += 1;
            return publisherReadCount === 1
              ? publisher
              : {
                  ...publisher,
                  image: "https://storage.example/new-logo",
                  imageStorageId: "storage:new",
                };
          }
          if (id === "publisherImageUploadTickets:1") {
            return {
              _id: id,
              publisherId: "publishers:org",
              userId: "users:admin",
              createdAt: 10,
              expiresAt: Date.now() + 10_000,
            };
          }
          return null;
        }),
        system: {
          get: vi.fn(async () => ({
            _creationTime: 20,
            contentType: "image/webp",
            size: 1000,
          })),
        },
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          if (table === "officialPublishers") return emptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert,
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
      storage: {
        getUrl: vi.fn(async () => "https://storage.example/new-logo"),
        delete: deleteStorage,
      },
    };

    await expect(
      updateProfileHandler(ctx as never, {
        publisherId: "publishers:org",
        displayName: "Shopify",
        imageStorageId: "storage:new",
        imageUploadTicket: "publisherImageUploadTickets:1",
      }),
    ).resolves.toEqual({
      ok: true,
      publisher: expect.objectContaining({
        _id: "publishers:org",
        image: "https://storage.example/new-logo",
      }),
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherImageUploadTickets:1",
      expect.objectContaining({ storageId: "storage:new", usedAt: expect.any(Number) }),
    );
    expect(patch).toHaveBeenCalledWith(
      "publishers:org",
      expect.objectContaining({
        image: "https://storage.example/new-logo",
        imageStorageId: "storage:new",
      }),
    );
    expect(deleteStorage).toHaveBeenCalledWith("storage:old");
  });

  it("preserves an existing stored logo during ordinary profile edits", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const patch = vi.fn(async () => {});
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "shopify",
              displayName: "Shopify Labs",
              image: "https://storage.example/current-logo",
              imageStorageId: "storage:current",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          if (table === "officialPublishers") return emptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      updateProfileHandler(ctx as never, {
        publisherId: "publishers:org",
        displayName: "Shopify Labs",
        image: "https://storage.example/current-logo",
      }),
    ).resolves.toEqual({
      ok: true,
      publisher: expect.objectContaining({
        handle: "shopify",
        image: "https://storage.example/current-logo",
      }),
    });
    expect(patch).toHaveBeenCalledWith(
      "publishers:org",
      expect.objectContaining({
        displayName: "Shopify Labs",
        image: "https://storage.example/current-logo",
        imageStorageId: "storage:current",
      }),
    );
  });

  it("rejects direct org profile image URL changes", async () => {
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
    ).rejects.toThrow("Logo changes require an uploaded image");
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
          if (table === "officialPublishers" && indexName === "by_created") {
            return { take: vi.fn(async () => []) };
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

  it("rejects personal publisher handles containing openclaw", async () => {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:openclaw-china") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "openclaw-china",
              displayName: "Openclaw China",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_linked_user") {
                  return { unique: vi.fn().mockResolvedValue(null) };
                }
                if (indexName === "by_handle") {
                  return { unique: vi.fn().mockResolvedValue(null) };
                }
                throw new Error(`unexpected index ${indexName}`);
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return `${table}:${inserts.length}`;
        }),
        patch: vi.fn(),
      },
    };

    await expect(
      ensurePersonalPublisherForUser(
        ctx as never,
        {
          _id: "users:openclaw-china",
          _creationTime: 1,
          handle: "openclaw-china",
          displayName: "Openclaw China",
          trustedPublisher: false,
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ),
    ).rejects.toThrow('Handle "@openclaw-china" is reserved for OpenClaw publishers');
    expect(inserts).toHaveLength(0);
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

  it("uses complete counters for mine summaries without reading resource tables", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const publisher = {
      _id: "publishers:alice",
      _creationTime: 1,
      kind: "user",
      handle: "alice",
      displayName: "Alice",
      linkedUserId: "users:alice",
      publishedSkills: 4,
      publishedPackages: 1,
      totalInstalls: 14,
      totalDownloads: 14,
      totalStars: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              personalPublisherId: publisher._id,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return id === publisher._id ? publisher : null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "publisherMembers:alice",
                    publisherId: publisher._id,
                    userId: "users:alice",
                    role: "owner",
                  },
                ]),
              ),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn(async () => publisher) })),
            };
          }
          if (table === "officialPublishers") return emptyOfficialPublishersQuery();
          throw new Error(`mine summary must not query ${table}`);
        }),
      },
    };

    const result = (await listMineHandler(ctx as never, {
      includePublishedItems: false,
    })) as Array<{
      publisher: Record<string, unknown>;
    }>;

    expect(result[0]?.publisher).toEqual(
      expect.objectContaining({
        stats: { skills: 4, packages: 1, installs: 14, downloads: 14, stars: 0 },
      }),
    );
    expect(result[0]?.publisher).not.toHaveProperty("publishedItems");
  });

  it("keeps complete published items for listMine callers without the lightweight opt-out", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const publisher = {
      _id: "publishers:alice",
      _creationTime: 1,
      kind: "user",
      handle: "alice",
      displayName: "Alice",
      linkedUserId: "users:alice",
      publishedSkills: 1,
      publishedPackages: 1,
      totalInstalls: 3,
      totalDownloads: 5,
      totalStars: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return { _id: id, personalPublisherId: publisher._id, createdAt: 1, updatedAt: 1 };
          }
          return id === publisher._id ? publisher : null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "publisherMembers:alice",
                    publisherId: publisher._id,
                    userId: "users:alice",
                    role: "owner",
                  },
                ]),
              ),
            };
          }
          if (table === "publishers") {
            return { withIndex: vi.fn(() => ({ unique: vi.fn(async () => publisher) })) };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "skills:alice-tool",
                    _creationTime: 1,
                    ownerPublisherId: publisher._id,
                    softDeletedAt: undefined,
                    moderationStatus: "active",
                    displayName: "Alice Tool",
                    updatedAt: 1,
                    stats: {
                      downloads: 3,
                      stars: 0,
                      installsCurrent: 1,
                      installsAllTime: 1,
                    },
                  },
                ]),
              ),
            };
          }
          if (table === "packages") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "packages:alice-plugin",
                    _creationTime: 2,
                    ownerPublisherId: publisher._id,
                    family: "code-plugin",
                    softDeletedAt: undefined,
                    displayName: "Alice Plugin",
                    stats: { downloads: 2, stars: 0, installs: 2, versions: 1 },
                  },
                ]),
              ),
            };
          }
          if (table === "officialPublishers") return emptyOfficialPublishersQuery();
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    const result = (await listMineHandler(ctx as never, {})) as Array<{
      publisher: { publishedItems: Array<{ displayName: string }> };
    }>;

    expect(result[0]?.publisher.publishedItems.map((item) => item.displayName)).toEqual([
      "Alice Tool",
      "Alice Plugin",
    ]);
  });

  it("loads every published item only from deletion inventory", async () => {
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

    const result = await getDeletionInventoryHandler(ctx as never, {});

    expect(result[0]?.publishedItems.map((item) => item.displayName)).toEqual([
      "Plugin 1",
      "Skill 4",
      "Skill 3",
      "Skill 2",
      "Skill 1",
    ]);
  });

  it("rejects organization deletion inventory for non-owners", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const publisher = {
      _id: "publishers:team",
      kind: "org",
      handle: "team",
      displayName: "Team",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, createdAt: 1, updatedAt: 1 };
          return id === publisher._id ? publisher : null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "publisherMembers") {
            throw new Error(`inventory authorization must not query ${table}`);
          }
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName !== "by_publisher_user") {
                throw new Error(`unexpected membership index ${indexName}`);
              }
              return {
                unique: vi.fn(async () => ({
                  publisherId: publisher._id,
                  userId: "users:alice",
                  role: "admin",
                })),
              };
            }),
          };
        }),
      },
    };

    await expect(
      getDeletionInventoryHandler(ctx as never, { publisherId: publisher._id }),
    ).rejects.toThrow("Forbidden");
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

  it("rejects self-serve org handles containing openclaw", async () => {
    const { ctx, inserts } = makeCreateOrgPublisherCtx({});

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "openclaw-china",
        displayName: "Openclaw China",
      }),
    ).rejects.toThrow('Handle "@openclaw-china" is reserved for OpenClaw publishers');
    expect(inserts).toHaveLength(0);
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

  it("lets admins create a missing reserved OpenClaw org publisher with only the legacy package owner as owner", async () => {
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
        handle: "openclaw",
        displayName: "OpenClaw",
        memberHandle: "vincentkoc",
        memberRole: "owner",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "openclaw",
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
        value: expect.objectContaining({
          kind: "org",
          handle: "openclaw",
          displayName: "OpenClaw",
        }),
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
            id === "users:admin"
              ? { _id: id, role: "admin" }
              : id === "users:vincent"
                ? { _id: id, handle: "vincentkoc" }
                : null,
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

  it("converts a reserved OpenClaw legacy personal publisher into an org with a safe default fallback", async () => {
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
        const id = "publishers:user";
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
          get: vi.fn(async (...args: string[]) => {
            const id = args.length === 2 ? args[1] : args[0];
            return users.get(id) ?? publishers.get(id) ?? null;
          }),
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
        displayName: "OpenClaw",
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "openclaw",
      orgPublisherId: "publishers:openclaw",
      legacyUserId: "users:openclaw",
      fallbackUserHandle: "user",
      personalPublisherId: "publishers:user",
      convertedExistingPublisher: true,
      packagesMigrated: 1,
    });
    expect(users.get("users:openclaw")).toEqual(
      expect.objectContaining({
        handle: "user",
        personalPublisherId: "publishers:user",
      }),
    );
    expect(publishers.get("publishers:openclaw")).toEqual(
      expect.objectContaining({
        kind: "org",
        handle: "openclaw",
        linkedUserId: undefined,
      }),
    );
    expect(publishers.get("publishers:user")).toEqual(
      expect.objectContaining({
        kind: "user",
        handle: "user",
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
