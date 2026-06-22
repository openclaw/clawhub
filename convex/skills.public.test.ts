/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", () => ({
  getSkillBadgeMap: vi.fn(),
  getSkillBadgeMaps: vi.fn(),
  isSkillHighlighted: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getSkillBadgeMap } = await import("./lib/badges");
const skillsModule = await import("./skills");
const {
  getActivityTrendForSlug,
  getBySlug,
  getVerifyTargetBySlugInternal,
  listSkillReportsInternal,
  resolveVersionByHash,
  resolveSkillAppealForUserInternal,
  submitSkillAppealForUserInternal,
  triageSkillReportForUserInternal,
} = skillsModule;

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<
    {
      slug: string;
    },
    {
      skill?: {
        canonicalSkillId?: string;
        forkOf?: unknown;
      };
      owner?: {
        _id: string;
        _creationTime: number;
        handle: string | null;
        name: string | null;
        displayName: string | null;
        image: string | null;
        bio?: string | null;
      } | null;
      latestVersion?: {
        files?: Array<{
          path: string;
          contentType?: string;
        }>;
      } | null;
      githubScan?: {
        contentHash: string;
        commit: string;
        status: string;
        llmAnalysis?: { status: string };
      } | null;
      forkOf?: {
        skill: {
          slug: string;
          displayName: string;
        };
        owner: {
          handle: string | null;
          userId: string | null;
        };
      } | null;
      canonical?: {
        skill: {
          slug: string;
          displayName: string;
        };
        owner: {
          handle: string | null;
          userId: string | null;
        };
      } | null;
    } | null
  >
)._handler;

const getActivityTrendForSlugHandler = (
  getActivityTrendForSlug as unknown as WrappedHandler<
    {
      slug: string;
      ownerHandle?: string;
      endDay: number;
    },
    {
      downloads: {
        range: "daily";
        days: number;
        total: number;
        points: Array<{ day: number; value: number }>;
      };
    } | null
  >
)._handler;

const getGitHubScanForAuditHandler = (
  skillsModule as typeof skillsModule & {
    getGitHubScanForAudit?: WrappedHandler<
      { slug: string },
      {
        contentHash: string;
        commit: string;
        path: string;
        status: string;
        version: string;
        llmAnalysis?: { status: string };
      } | null
    >;
  }
).getGitHubScanForAudit?._handler;

const getVerifyTargetBySlugInternalHandler = (
  getVerifyTargetBySlugInternal as unknown as WrappedHandler<
    {
      slug: string;
    },
    {
      skill?: {
        slug: string;
        displayName: string;
      } | null;
      moderationInfo?: {
        isMalwareBlocked: boolean;
      } | null;
    } | null
  >
)._handler;

const resolveVersionByHashHandler = (
  resolveVersionByHash as unknown as WrappedHandler<
    {
      slug: string;
      hash: string;
    },
    {
      match: { version: string } | null;
      latestVersion: { version: string } | null;
    } | null
  >
)._handler;

const submitSkillAppealForUserInternalHandler = (
  submitSkillAppealForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      slug: string;
      version?: string;
      message: string;
    },
    {
      ok: true;
      submitted: boolean;
      alreadyOpen: boolean;
      appealId: string;
      skillId: string;
      status: string;
    }
  >
)._handler;

const listSkillReportsInternalHandler = (
  listSkillReportsInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      cursor?: string | null;
      limit?: number;
      status?: "open" | "confirmed" | "dismissed" | "all";
    },
    {
      items: Array<{ reportId: string; slug: string; status: string }>;
      nextCursor: string | null;
      done: boolean;
    }
  >
)._handler;

const triageSkillReportForUserInternalHandler = (
  triageSkillReportForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      reportId: string;
      status: "open" | "confirmed" | "dismissed";
      note?: string;
      finalAction?: "none" | "hide";
    },
    {
      ok: true;
      reportId: string;
      skillId: string;
      status: string;
      reportCount: number;
      actionTaken?: string;
    }
  >
)._handler;

const resolveSkillAppealForUserInternalHandler = (
  resolveSkillAppealForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      appealId: string;
      status: "open" | "accepted" | "rejected";
      note?: string;
      finalAction?: "none" | "restore";
    },
    {
      ok: true;
      appealId: string;
      skillId: string;
      status: string;
      actionTaken?: string;
    }
  >
)._handler;

function makeCtx(args: {
  skill: Record<string, unknown> | null;
  owner: Record<string, unknown> | null;
  ownerPublisher?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  latestVersion?: Record<string, unknown> | null;
  githubScan?: Record<string, unknown> | null;
  skillDailyStats?: Array<Record<string, unknown>>;
  skillsById?: Record<string, Record<string, unknown>>;
  ownersById?: Record<string, Record<string, unknown>>;
}) {
  const unique = vi.fn().mockResolvedValue(args.skill);
  const withIndex = vi.fn(() => ({ unique }));
  const query = vi.fn((table: string) => {
    if (table === "publisherMembers") {
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn().mockResolvedValue(args.membership ?? null),
        })),
      };
    }
    if (table === "skillSlugAliases") {
      return {
        withIndex: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      };
    }
    if (table === "githubSkillScans") {
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn().mockResolvedValue(args.githubScan ?? null),
        })),
      };
    }
    if (table === "skillDailyStats") {
      return {
        withIndex: vi.fn(() => ({
          take: vi.fn().mockResolvedValue(args.skillDailyStats ?? []),
        })),
      };
    }
    if (table !== "skills") throw new Error(`Unexpected query table: ${table}`);
    return { withIndex };
  });
  const get = vi.fn(async (id: string) => {
    if (!args.skill) return null;
    if (id === args.skill._id) return args.skill;
    if (args.skillsById?.[id]) return args.skillsById[id];
    if (args.ownersById?.[id]) return args.ownersById[id];
    if (id === args.skill.ownerPublisherId) return args.ownerPublisher ?? null;
    if (id === args.skill.ownerUserId) return args.owner;
    if (id === args.skill.latestVersionId) return args.latestVersion ?? null;
    return null;
  });
  return { db: { query, get } } as never;
}

function makeOwner(id: string, handle: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: 1,
    handle,
    name: handle,
    displayName: handle,
    image: null,
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:1",
    _creationTime: 1,
    slug: "demo",
    displayName: "Demo",
    summary: "Public demo skill",
    ownerUserId: "users:1",
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: null,
    tags: {},
    stats: {
      downloads: 10,
      installsCurrent: 2,
      installsAllTime: 5,
      stars: 3,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 2,
    moderationStatus: "active",
    moderationFlags: undefined,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeResolveCtx(args: {
  skill: Record<string, unknown>;
  latestVersion?: Record<string, unknown> | null;
  matchVersion?: Record<string, unknown> | null;
  fingerprintMatches?: Array<Record<string, unknown>>;
}) {
  const fingerprintMatches = args.fingerprintMatches ?? [
    { versionId: "skillVersions:match", createdAt: 10 },
  ];
  const query = vi.fn((table: string) => {
    if (table === "skills") {
      return { withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(args.skill) })) };
    }
    if (table === "skillVersionFingerprints") {
      return { withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue(fingerprintMatches) })) };
    }
    if (table === "skillVersions") {
      return {
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })),
        })),
      };
    }
    if (table === "skillSlugAliases") {
      return {
        withIndex: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      };
    }
    throw new Error(`Unexpected query table: ${table}`);
  });
  const get = vi.fn(async (id: string) => {
    if (id === args.skill.latestVersionId) return args.latestVersion ?? null;
    if (id === "skillVersions:match") return args.matchVersion ?? null;
    return null;
  });
  return { db: { query, get } } as never;
}

describe("skills.getBySlug", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getSkillBadgeMap).mockReset();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    vi.mocked(getSkillBadgeMap).mockResolvedValue({} as never);
  });

  it("sanitizes owner fields in the public response", async () => {
    const ctx = makeCtx({
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Public demo skill",
        ownerUserId: "users:1",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: null,
        tags: {},
        stats: {
          downloads: 10,
          installsCurrent: 2,
          installsAllTime: 5,
          stars: 3,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        moderationStatus: "active",
        moderationFlags: undefined,
        softDeletedAt: undefined,
      },
      owner: {
        _id: "users:1",
        _creationTime: 1,
        handle: "demo-owner",
        name: "Demo Owner",
        displayName: "Demo Owner",
        image: null,
        bio: "Ships demo skills",
        email: "owner@example.com",
        emailVerificationTime: 123,
        githubCreatedAt: 456,
        githubFetchedAt: 789,
        githubProfileSyncedAt: 999,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.owner).toEqual({
      _id: "publishers:demo-owner",
      _creationTime: 1,
      kind: "user",
      handle: "demo-owner",
      displayName: "Demo Owner",
      image: null,
      bio: "Ships demo skills",
      linkedUserId: "users:1",
    });
    expect(result?.owner).not.toHaveProperty("email");
    expect(result?.owner).not.toHaveProperty("emailVerificationTime");
    expect(result?.owner).not.toHaveProperty("githubCreatedAt");
    expect(result?.owner).not.toHaveProperty("githubFetchedAt");
    expect(result?.owner).not.toHaveProperty("githubProfileSyncedAt");
  });

  it("does not load the durable current-content scan in the general skill lookup", async () => {
    const contentHash = "a".repeat(64);
    const currentCommit = "b".repeat(40);
    const scanOriginCommit = "c".repeat(40);
    const ctx = makeCtx({
      skill: makeSkill({
        installKind: "github",
        githubPath: "skills/demo",
        githubCurrentCommit: currentCommit,
        githubCurrentContentHash: contentHash,
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
        latestVersionSummary: {
          version: "1.2.3",
          createdAt: 2,
          changelog: "Synced from GitHub source.",
        },
      }),
      owner: makeOwner("users:1", "demo-owner"),
      githubScan: {
        _id: "githubSkillScans:1",
        skillId: "skills:1",
        githubSourceId: "githubSkillSources:1",
        contentHash,
        commit: scanOriginCommit,
        path: "skills/old-demo",
        status: "clean",
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No findings.",
          engineVersion: "test",
          checkedAt: 2,
        },
        llmAnalysis: { status: "clean", checkedAt: 3 },
        createdAt: 2,
        updatedAt: 3,
        completedAt: 3,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.latestVersion).toBeNull();
    expect(result).not.toHaveProperty("githubScan");
    expect(
      (ctx as unknown as { db: { query: ReturnType<typeof vi.fn> } }).db.query,
    ).not.toHaveBeenCalledWith("githubSkillScans");
  });

  it("returns the durable current-content scan from the audit-specific query", async () => {
    expect(getGitHubScanForAuditHandler).toBeTypeOf("function");
    if (!getGitHubScanForAuditHandler) return;

    const contentHash = "a".repeat(64);
    const currentCommit = "b".repeat(40);
    const scanOriginCommit = "c".repeat(40);
    const ctx = makeCtx({
      skill: makeSkill({
        installKind: "github",
        githubPath: "skills/demo",
        githubCurrentCommit: currentCommit,
        githubCurrentContentHash: contentHash,
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
        latestVersionSummary: {
          version: "1.2.3",
          createdAt: 2,
          changelog: "Synced from GitHub source.",
        },
      }),
      owner: makeOwner("users:1", "demo-owner"),
      githubScan: {
        _id: "githubSkillScans:1",
        skillId: "skills:1",
        githubSourceId: "githubSkillSources:1",
        contentHash,
        commit: scanOriginCommit,
        path: "skills/old-demo",
        status: "clean",
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No findings.",
          engineVersion: "test",
          checkedAt: 2,
        },
        llmAnalysis: { status: "clean", checkedAt: 3 },
        createdAt: 2,
        updatedAt: 3,
        completedAt: 3,
      },
    });

    const result = await getGitHubScanForAuditHandler(ctx, { slug: "demo" });

    expect(result).toMatchObject({
      contentHash,
      commit: currentCommit,
      path: "skills/demo",
      status: "clean",
      version: "1.2.3",
      llmAnalysis: { status: "clean", checkedAt: 3 },
    });
  });

  it("hides skills whose owner is deleted or banned", async () => {
    const ctx = makeCtx({
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Public demo skill",
        ownerUserId: "users:1",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: null,
        tags: {},
        stats: {
          downloads: 10,
          installsCurrent: 2,
          installsAllTime: 5,
          stars: 3,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        moderationStatus: "active",
        moderationFlags: undefined,
        softDeletedAt: undefined,
      },
      owner: {
        _id: "users:1",
        _creationTime: 1,
        handle: "demo-owner",
        name: "Demo Owner",
        displayName: "Demo Owner",
        image: null,
        deletedAt: 123,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });

  it("hides activity trends when the skill owner is not public", async () => {
    const ctx = makeCtx({
      skill: makeSkill(),
      owner: makeOwner("users:1", "demo-owner", { deletedAt: 123 }),
      skillDailyStats: [{ day: 25, downloads: 4, installs: 2 }],
    });

    const result = await getActivityTrendForSlugHandler(ctx, { slug: "demo", endDay: 25 } as never);

    expect(result).toBeNull();
  });

  it("returns daily activity trends for public skills", async () => {
    const ctx = makeCtx({
      skill: makeSkill(),
      owner: makeOwner("users:1", "demo-owner"),
      skillDailyStats: [
        { day: 24, downloads: 4, installs: 2 },
        { day: 25, downloads: 3, installs: 1 },
      ],
    });

    const result = await getActivityTrendForSlugHandler(ctx, { slug: "demo", endDay: 25 } as never);

    expect(result?.downloads.range).toBe("daily");
    expect(result?.downloads.days).toBe(30);
    expect(result?.downloads.total).toBe(7);
    expect(result?.downloads.points).toHaveLength(30);
    expect(result?.downloads.points[0]).toEqual({ day: -4, value: 0 });
    expect(result?.downloads.points.at(-1)).toEqual({ day: 25, value: 3 });
    expect(result && "installs" in result).toBe(false);
  });

  it("clamps future activity trend end days to the current UTC day", async () => {
    const now = Date.UTC(2026, 5, 19, 12);
    const todayDay = Math.floor(now / 86_400_000);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const ctx = makeCtx({
        skill: makeSkill(),
        owner: makeOwner("users:1", "demo-owner"),
        skillDailyStats: [{ day: todayDay, downloads: 5, installs: 2 }],
      });

      const result = await getActivityTrendForSlugHandler(ctx, {
        slug: "demo",
        endDay: todayDay + 10,
      } as never);

      expect(result?.downloads.points.at(-1)).toEqual({ day: todayDay, value: 5 });
      expect(result?.downloads.total).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not honor stale personal memberships for hidden skill owner views", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:stranger" as never);
    const ctx = makeCtx({
      skill: makeSkill({
        ownerPublisherId: "publishers:owner",
        moderationStatus: "hidden",
        moderationReason: "manual.review",
      }),
      owner: makeOwner("users:1", "owner"),
      ownerPublisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "owner",
        displayName: "Owner",
        linkedUserId: "users:1",
      },
      ownersById: {
        "users:stranger": makeOwner("users:stranger", "stranger"),
      },
      membership: {
        _id: "publisherMembers:stale",
        publisherId: "publishers:owner",
        userId: "users:stranger",
        role: "owner",
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });

  it("does not treat stale ownerUserId as owner for hidden publisher-owned skills", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:1" as never);
    const ctx = makeCtx({
      skill: makeSkill({
        ownerPublisherId: "publishers:org",
        moderationStatus: "hidden",
        moderationReason: "manual.review",
      }),
      owner: makeOwner("users:1", "owner"),
      ownerPublisher: {
        _id: "publishers:org",
        kind: "org",
        handle: "team",
        displayName: "Team",
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });

  it("keeps legacy no-link personal publisher owners authorized for hidden skill views", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:1" as never);
    const ctx = makeCtx({
      skill: makeSkill({
        ownerPublisherId: "publishers:owner",
        moderationStatus: "hidden",
        moderationReason: "manual.review",
      }),
      owner: makeOwner("users:1", "owner"),
      ownerPublisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "owner",
        displayName: "Owner",
        linkedUserId: undefined,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.skill).toMatchObject({ slug: "demo" });
  });

  it("keeps org memberships authorized for hidden skill owner views", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:member" as never);
    const ctx = makeCtx({
      skill: makeSkill({
        ownerPublisherId: "publishers:org",
        moderationStatus: "hidden",
        moderationReason: "manual.review",
      }),
      owner: makeOwner("users:1", "owner"),
      ownerPublisher: {
        _id: "publishers:org",
        kind: "org",
        handle: "team",
        displayName: "Team",
      },
      ownersById: {
        "users:member": makeOwner("users:member", "member"),
      },
      membership: {
        _id: "publisherMembers:member",
        publisherId: "publishers:org",
        userId: "users:member",
        role: "publisher",
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.skill).toMatchObject({ slug: "demo" });
  });

  it("omits duplicate references to nonpublic skills", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        canonicalSkillId: "skills:hidden-canonical",
        forkOf: {
          skillId: "skills:deleted-fork",
          kind: "duplicate",
          version: "1.0.0",
        },
      }),
      owner: makeOwner("users:1", "demo-owner", { displayName: "Demo Owner" }),
      skillsById: {
        "skills:deleted-fork": makeSkill({
          _id: "skills:deleted-fork",
          _creationTime: 2,
          slug: "deleted-fork",
          displayName: "Deleted Fork",
          summary: "Deleted duplicate source",
          ownerUserId: "users:fork-owner",
          softDeletedAt: 123,
        }),
        "skills:hidden-canonical": makeSkill({
          _id: "skills:hidden-canonical",
          _creationTime: 3,
          slug: "hidden-canonical",
          displayName: "Hidden Canonical",
          summary: "Hidden canonical source",
          ownerUserId: "users:canonical-owner",
          moderationStatus: "hidden",
        }),
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.forkOf).toBeNull();
    expect(result?.canonical).toBeNull();
    expect(result?.skill?.forkOf).toBeUndefined();
    expect(result?.skill?.canonicalSkillId).toBeUndefined();
  });

  it("keeps duplicate references to public skills", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        canonicalSkillId: "skills:canonical",
        forkOf: {
          skillId: "skills:fork",
          kind: "duplicate",
          version: "1.0.0",
        },
      }),
      owner: makeOwner("users:1", "demo-owner", { displayName: "Demo Owner" }),
      skillsById: {
        "skills:fork": makeSkill({
          _id: "skills:fork",
          _creationTime: 2,
          slug: "fork-source",
          displayName: "Fork Source",
          summary: "Public duplicate source",
          ownerUserId: "users:fork-owner",
        }),
        "skills:canonical": makeSkill({
          _id: "skills:canonical",
          _creationTime: 3,
          slug: "canonical-source",
          displayName: "Canonical Source",
          summary: "Public canonical source",
          ownerUserId: "users:canonical-owner",
        }),
      },
      ownersById: {
        "users:fork-owner": makeOwner("users:fork-owner", "fork-owner", {
          _creationTime: 2,
          displayName: "Fork Owner",
        }),
        "users:canonical-owner": makeOwner("users:canonical-owner", "canonical-owner", {
          _creationTime: 3,
          displayName: "Canonical Owner",
        }),
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.forkOf).toMatchObject({
      kind: "duplicate",
      version: "1.0.0",
      skill: {
        slug: "fork-source",
        displayName: "Fork Source",
      },
      owner: {
        handle: "fork-owner",
        userId: "users:fork-owner",
      },
    });
    expect(result?.canonical).toMatchObject({
      skill: {
        slug: "canonical-source",
        displayName: "Canonical Source",
      },
      owner: {
        handle: "canonical-owner",
        userId: "users:canonical-owner",
      },
    });
    expect(result?.skill?.forkOf).toBeDefined();
    expect(result?.skill?.canonicalSkillId).toBe("skills:canonical");
  });

  it("normalizes misleading file MIME types in public version metadata", async () => {
    const ctx = makeCtx({
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Public demo skill",
        ownerUserId: "users:1",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: "skillVersions:1",
        tags: {},
        stats: {
          downloads: 10,
          installsCurrent: 2,
          installsAllTime: 5,
          stars: 3,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        moderationStatus: "active",
        moderationFlags: undefined,
        softDeletedAt: undefined,
      },
      owner: {
        _id: "users:1",
        _creationTime: 1,
        handle: "demo-owner",
        name: "Demo Owner",
        displayName: "Demo Owner",
        image: null,
      },
      latestVersion: {
        _id: "skillVersions:1",
        _creationTime: 2,
        skillId: "skills:1",
        version: "1.0.0",
        fingerprint: "abc",
        changelog: "",
        changelogSource: "user",
        files: [
          {
            path: "src/index.ts",
            size: 10,
            sha256: "deadbeef",
            contentType: "video/mp2t",
          },
        ],
        createdBy: "users:1",
        createdAt: 2,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.latestVersion?.files).toEqual([
      expect.objectContaining({
        path: "src/index.ts",
        contentType: "application/typescript",
      }),
    ]);
  });

  it("does not expose a latest version that belongs to another skill", async () => {
    const ctx = makeCtx({
      skill: makeSkill({ latestVersionId: "skillVersions:other" }),
      owner: makeOwner("users:1", "demo-owner"),
      latestVersion: {
        _id: "skillVersions:other",
        _creationTime: 2,
        skillId: "skills:other",
        version: "9.9.9",
        fingerprint: "abc",
        changelog: "",
        changelogSource: "user",
        files: [],
        createdBy: "users:2",
        createdAt: 2,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.skill).toMatchObject({ latestVersionId: "skillVersions:other" });
    expect(result?.latestVersion).toBeNull();
  });

  it("does not expose a soft-deleted latest version", async () => {
    const ctx = makeCtx({
      skill: makeSkill({ latestVersionId: "skillVersions:deleted" }),
      owner: makeOwner("users:1", "demo-owner"),
      latestVersion: {
        _id: "skillVersions:deleted",
        _creationTime: 2,
        skillId: "skills:1",
        version: "2.0.0",
        fingerprint: "abc",
        changelog: "",
        changelogSource: "user",
        files: [],
        createdBy: "users:1",
        createdAt: 2,
        softDeletedAt: 3,
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result?.latestVersion).toBeNull();
  });

  it("hides malware-blocked skills from the public detail query", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
      owner: makeOwner("users:1", "demo-owner"),
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });

  it("hides active skills with a malicious moderation verdict from owners too", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:1" as never);
    const ctx = makeCtx({
      skill: makeSkill({
        moderationStatus: "active",
        moderationVerdict: "malicious",
      }),
      owner: makeOwner("users:1", "demo-owner"),
      ownersById: {
        "users:1": makeOwner("users:1", "demo-owner"),
      },
    });

    const result = await getBySlugHandler(ctx, { slug: "demo" } as never);

    expect(result).toBeNull();
  });

  it("keeps malware-blocked skills available to verification lookups", async () => {
    const ctx = makeCtx({
      skill: makeSkill({
        moderationStatus: "active",
        moderationVerdict: "malicious",
      }),
      owner: makeOwner("users:1", "demo-owner"),
    });

    const result = await getVerifyTargetBySlugInternalHandler(ctx, { slug: "demo" } as never);

    expect(result?.skill?.slug).toBe("demo");
    expect(result?.moderationInfo?.isMalwareBlocked).toBe(true);
  });
});

describe("skills.resolveVersionByHash", () => {
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("does not expose a soft-deleted latest version", async () => {
    const ctx = makeResolveCtx({
      skill: makeSkill({ latestVersionId: "skillVersions:deleted" }),
      latestVersion: {
        _id: "skillVersions:deleted",
        skillId: "skills:1",
        version: "2.0.0",
        softDeletedAt: 3,
      },
      matchVersion: {
        _id: "skillVersions:match",
        skillId: "skills:1",
        version: "1.0.0",
        files: [],
      },
    });

    const result = await resolveVersionByHashHandler(ctx, { slug: "demo", hash });

    expect(result).toMatchObject({ match: { version: "1.0.0" }, latestVersion: null });
  });

  it("does not expose a latest version that belongs to another skill", async () => {
    const ctx = makeResolveCtx({
      skill: makeSkill({ latestVersionId: "skillVersions:other" }),
      latestVersion: {
        _id: "skillVersions:other",
        skillId: "skills:other",
        version: "9.9.9",
      },
      matchVersion: {
        _id: "skillVersions:match",
        skillId: "skills:1",
        version: "1.0.0",
        files: [],
      },
    });

    const result = await resolveVersionByHashHandler(ctx, { slug: "demo", hash });

    expect(result).toMatchObject({ match: { version: "1.0.0" }, latestVersion: null });
  });
});

describe("skill artifact moderation", () => {
  it("lets owners appeal soft-deleted moderated skills", async () => {
    const skill = makeSkill({
      softDeletedAt: 123,
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      latestVersionId: undefined,
    });
    const insert = vi.fn(async (table: string) => {
      if (table === "skillAppeals") return "skillAppeals:1";
      if (table === "skillModerationEventLogs") return "skillModerationEventLogs:1";
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`Unexpected insert table: ${table}`);
    });

    const result = await submitSkillAppealForUserInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:1") return makeOwner("users:1", "owner");
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue(skill),
                })),
              };
            }
            if (table === "skillAppeals") {
              return {
                withIndex: vi.fn(() => ({
                  order: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue(null),
                  })),
                })),
              };
            }
            if (table === "skillSlugAliases") {
              return { withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })) };
            }
            throw new Error(`Unexpected query table: ${table}`);
          }),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:1",
        slug: "demo",
        message: "please review",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      submitted: true,
      appealId: "skillAppeals:1",
      skillId: "skills:1",
      status: "open",
    });
    expect(insert).toHaveBeenCalledWith("skillAppeals", {
      skillId: "skills:1",
      userId: "users:1",
      message: "please review",
      status: "open",
      createdAt: expect.any(Number),
    });
    expect(insert).toHaveBeenCalledWith(
      "skillModerationEventLogs",
      expect.objectContaining({
        kind: "appeal",
        appealId: "skillAppeals:1",
        action: "skill.appeal.submit",
      }),
    );
  });

  it("does not let stale personal memberships submit skill appeals", async () => {
    const skill = makeSkill({
      softDeletedAt: 123,
      ownerPublisherId: "publishers:owner",
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      latestVersionId: undefined,
    });

    await expect(
      submitSkillAppealForUserInternalHandler(
        {
          db: {
            get: vi.fn(async (id: string) => {
              if (id === "users:stranger") return makeOwner("users:stranger", "stranger");
              if (id === "publishers:owner") {
                return {
                  _id: "publishers:owner",
                  kind: "user",
                  handle: "owner",
                  displayName: "Owner",
                  linkedUserId: "users:1",
                };
              }
              return null;
            }),
            query: vi.fn((table: string) => {
              if (table === "skills") {
                return {
                  withIndex: vi.fn(() => ({
                    unique: vi.fn().mockResolvedValue(skill),
                  })),
                };
              }
              if (table === "publisherMembers") {
                return {
                  withIndex: vi.fn(() => ({
                    unique: vi.fn().mockResolvedValue({
                      _id: "publisherMembers:stale",
                      publisherId: "publishers:owner",
                      userId: "users:stranger",
                      role: "owner",
                    }),
                  })),
                };
              }
              if (table === "skillSlugAliases") {
                return { withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })) };
              }
              throw new Error(`Unexpected query table: ${table}`);
            }),
            insert: vi.fn(),
            patch: vi.fn(),
            replace: vi.fn(),
            delete: vi.fn(),
            normalizeId: vi.fn(),
          },
        } as never,
        {
          actorUserId: "users:stranger",
          slug: "demo",
          message: "please review",
        },
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("does not let stale ownerUserId submit skill appeals for publisher-owned skills", async () => {
    const skill = makeSkill({
      softDeletedAt: 123,
      ownerPublisherId: "publishers:org",
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      latestVersionId: undefined,
    });

    await expect(
      submitSkillAppealForUserInternalHandler(
        {
          db: {
            get: vi.fn(async (id: string) => {
              if (id === "users:1") return makeOwner("users:1", "owner");
              if (id === "publishers:org") {
                return {
                  _id: "publishers:org",
                  kind: "org",
                  handle: "team",
                  displayName: "Team",
                };
              }
              return null;
            }),
            query: vi.fn((table: string) => {
              if (table === "skills") {
                return {
                  withIndex: vi.fn(() => ({
                    unique: vi.fn().mockResolvedValue(skill),
                  })),
                };
              }
              if (table === "publisherMembers") {
                return {
                  withIndex: vi.fn(() => ({
                    unique: vi.fn().mockResolvedValue(null),
                  })),
                };
              }
              if (table === "skillSlugAliases") {
                return { withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })) };
              }
              throw new Error(`Unexpected query table: ${table}`);
            }),
            insert: vi.fn(),
            patch: vi.fn(),
            replace: vi.fn(),
            delete: vi.fn(),
            normalizeId: vi.fn(),
          },
        } as never,
        {
          actorUserId: "users:1",
          slug: "demo",
          message: "please review",
        },
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("lets org members submit skill appeals", async () => {
    const skill = makeSkill({
      softDeletedAt: 123,
      ownerPublisherId: "publishers:org",
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      latestVersionId: undefined,
    });
    const insert = vi.fn(async (table: string) => {
      if (table === "skillAppeals") return "skillAppeals:1";
      if (table === "skillModerationEventLogs") return "skillModerationEventLogs:1";
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`Unexpected insert table: ${table}`);
    });

    const result = await submitSkillAppealForUserInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:member") return makeOwner("users:member", "member");
            if (id === "publishers:org") {
              return {
                _id: "publishers:org",
                kind: "org",
                handle: "team",
                displayName: "Team",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue(skill),
                })),
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue({
                    _id: "publisherMembers:member",
                    publisherId: "publishers:org",
                    userId: "users:member",
                    role: "publisher",
                  }),
                })),
              };
            }
            if (table === "skillAppeals") {
              return {
                withIndex: vi.fn(() => ({
                  order: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue(null),
                  })),
                })),
              };
            }
            if (table === "skillSlugAliases") {
              return { withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })) };
            }
            throw new Error(`Unexpected query table: ${table}`);
          }),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:member",
        slug: "demo",
        message: "please review",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      submitted: true,
      appealId: "skillAppeals:1",
      skillId: "skills:1",
    });
  });

  it("keeps hidden skill reports visible in the moderator queue", async () => {
    const result = await listSkillReportsInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: id, role: "moderator" };
            if (id === "skills:hidden") {
              return makeSkill({
                _id: "skills:hidden",
                slug: "hidden-demo",
                softDeletedAt: 123,
                moderationStatus: "hidden",
              });
            }
            if (id === "users:reporter") return makeOwner("users:reporter", "reporter");
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skillReports") {
              return {
                withIndex: vi.fn(() => ({
                  order: vi.fn(() => ({
                    paginate: vi.fn().mockResolvedValue({
                      page: [
                        {
                          _id: "skillReports:1",
                          skillId: "skills:hidden",
                          userId: "users:reporter",
                          reason: "suspicious",
                          status: "open",
                          createdAt: 1,
                        },
                      ],
                      isDone: true,
                      continueCursor: "",
                    }),
                  })),
                })),
              };
            }
            throw new Error(`Unexpected query table: ${table}`);
          }),
        },
      } as never,
      {
        actorUserId: "users:moderator",
        status: "open",
      },
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        reportId: "skillReports:1",
        slug: "hidden-demo",
        status: "open",
      }),
    ]);
  });

  it("can hide a skill while triaging a valid report", async () => {
    const skill = makeSkill({ reportCount: 1 });
    const patch = vi.fn();
    const insert = vi.fn(async (table: string) => `${table}:1`);

    const result = await triageSkillReportForUserInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: id, role: "moderator" };
            if (id === "skillReports:1") {
              return {
                _id: id,
                skillId: "skills:1",
                userId: "users:reporter",
                status: "open",
                createdAt: 1,
              };
            }
            if (id === "skills:1") return skill;
            return null;
          }),
          patch,
          insert,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          query: vi.fn((table: string) => {
            if (table === "skillEmbeddings") {
              return { withIndex: vi.fn(() => ({ collect: vi.fn().mockResolvedValue([]) })) };
            }
            if (table === "globalStats") {
              return { withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })) };
            }
            throw new Error(`Unexpected query table: ${table}`);
          }),
        },
      } as never,
      {
        actorUserId: "users:moderator",
        reportId: "skillReports:1",
        status: "confirmed",
        note: "confirmed malicious behavior",
        finalAction: "hide",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "confirmed",
      actionTaken: "hide",
    });
    expect(patch).toHaveBeenCalledWith("skillReports:1", {
      status: "confirmed",
      triagedAt: expect.any(Number),
      triagedBy: "users:moderator",
      triageNote: "confirmed malicious behavior",
      actionTaken: "hide",
    });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        softDeletedAt: expect.any(Number),
        moderationStatus: "hidden",
        moderationReason: "manual.report",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.report.final_action",
        targetType: "skill",
      }),
    );
  });

  it("can restore a skill while accepting an appeal", async () => {
    const skill = makeSkill({
      softDeletedAt: 123,
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      moderationFlags: ["blocked.malware"],
    });
    const patch = vi.fn();
    const insert = vi.fn(async (table: string) => `${table}:1`);

    const result = await resolveSkillAppealForUserInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: id, role: "moderator" };
            if (id === "skillAppeals:1") {
              return {
                _id: id,
                skillId: "skills:1",
                userId: "users:owner",
                message: "false positive",
                status: "open",
                createdAt: 1,
              };
            }
            if (id === "skills:1") return skill;
            return null;
          }),
          patch,
          insert,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          query: vi.fn((table: string) => {
            if (table === "skillEmbeddings") {
              return { withIndex: vi.fn(() => ({ collect: vi.fn().mockResolvedValue([]) })) };
            }
            if (table === "globalStats") {
              return { withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })) };
            }
            throw new Error(`Unexpected query table: ${table}`);
          }),
        },
      } as never,
      {
        actorUserId: "users:moderator",
        appealId: "skillAppeals:1",
        status: "accepted",
        note: "false positive confirmed",
        finalAction: "restore",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "accepted",
      actionTaken: "restore",
    });
    expect(patch).toHaveBeenCalledWith("skillAppeals:1", {
      status: "accepted",
      resolvedAt: expect.any(Number),
      resolvedBy: "users:moderator",
      resolutionNote: "false positive confirmed",
      actionTaken: "restore",
    });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "manual.override.clean",
        moderationFlags: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.appeal.final_action",
        targetType: "skill",
      }),
    );
  });
});
