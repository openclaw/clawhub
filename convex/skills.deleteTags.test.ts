import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { deleteTags, updateSummary, updateTags } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const deleteTagsHandler = (
  deleteTags as unknown as WrappedHandler<{
    skillId: string;
    tags: string[];
  }>
)._handler;
const updateSummaryHandler = (
  updateSummary as unknown as WrappedHandler<{
    skillId: string;
    summary: string;
  }>
)._handler;
const updateTagsHandler = (
  updateTags as unknown as WrappedHandler<{
    skillId: string;
    tags: Array<{ tag: string; versionId: string }>;
  }>
)._handler;

function buildGlobalStatsQuery(table: string) {
  if (table !== "globalStats") return null;
  return {
    withIndex: () => ({
      unique: async () => ({ _id: "globalStats:1", activeSkillsCount: 100 }),
    }),
  };
}

function buildDigestQuery(table: string, digest?: () => Record<string, unknown> | null) {
  if (table !== "skillSearchDigest") return null;
  return {
    withIndex: () => ({
      unique: async () => digest?.() ?? null,
    }),
  };
}

function makeCtx(params: {
  user: Record<string, unknown>;
  skill: Record<string, unknown> | null;
  publisher?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  versionsById?: Record<string, Record<string, unknown>>;
  digest?: Record<string, unknown> | null;
  enableTriggers?: boolean;
}) {
  vi.mocked(getAuthUserId).mockResolvedValue(params.user._id as never);
  const docs = new Map<string, Record<string, unknown>>();
  docs.set(params.user._id as string, params.user);
  if (params.skill) docs.set(params.skill._id as string, params.skill);
  if (params.publisher) docs.set(params.publisher._id as string, params.publisher);
  if (params.digest) docs.set(params.digest._id as string, params.digest);
  for (const [id, version] of Object.entries(params.versionsById ?? {})) {
    docs.set(id, version);
  }
  const findDigest = () => {
    for (const doc of docs.values()) {
      if (typeof doc._id === "string" && doc._id.startsWith("skillSearchDigest:")) return doc;
    }
    return null;
  };
  const patch = vi.fn(
    async (
      arg0: string,
      arg1: string | Record<string, unknown>,
      arg2?: Record<string, unknown>,
    ) => {
      const id = typeof arg1 === "string" ? arg1 : arg0;
      const value = typeof arg1 === "string" ? arg2 : arg1;
      if (!value) throw new Error(`Missing patch value for ${id}`);
      const existing = docs.get(id);
      if (existing) docs.set(id, { ...existing, ...value });
      return value;
    },
  );
  const db = {
    get: vi.fn(async (arg0: string, arg1?: string) => {
      return docs.get(arg1 ?? arg0) ?? null;
    }),
    query: vi.fn((table: string) => {
      const globalStatsQuery = buildGlobalStatsQuery(table);
      if (globalStatsQuery) return globalStatsQuery;
      const digestQuery = buildDigestQuery(table, findDigest);
      if (digestQuery) return digestQuery;
      if (table === "publisherMembers") {
        return {
          withIndex: () => ({
            unique: async () => params.membership ?? null,
          }),
        };
      }
      if (table === "skillEmbeddings") {
        return {
          withIndex: () => ({
            collect: async () => [],
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    insert: vi.fn(),
    patch,
    delete: vi.fn(),
    replace: vi.fn(),
    normalizeId: vi.fn((tableName: string, id: string) =>
      params.enableTriggers && id.startsWith(`${tableName}:`) ? id : null,
    ),
  };
  const auth = { getUserIdentity: vi.fn(async () => ({ tokenIdentifier: "test" })) };
  return { db, auth, patch };
}

const ownerUser = {
  _id: "users:owner",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: undefined,
};

const modUser = {
  _id: "users:mod",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: "moderator",
};

const otherUser = {
  _id: "users:other",
  deletedAt: undefined,
  deactivatedAt: undefined,
  role: undefined,
};

const baseSkill = {
  _id: "skills:1",
  _creationTime: 1,
  slug: "demo-skill",
  displayName: "Demo Skill",
  summary: "Old summary",
  icon: undefined,
  ownerUserId: "users:owner",
  ownerPublisherId: undefined,
  canonicalSkillId: undefined,
  forkOf: undefined,
  latestVersionId: undefined,
  installKind: undefined,
  githubHasSkillCard: undefined,
  githubCurrentStatus: undefined,
  githubScanStatus: undefined,
  latestVersionSummary: undefined,
  tags: {
    latest: "versions:3",
    stable: "versions:2",
    beta: "versions:3",
    "old-tag": "versions:1",
  },
  capabilityTags: undefined,
  badges: {},
  statsDownloads: 0,
  statsStars: 0,
  statsInstallsCurrent: 0,
  statsInstallsAllTime: 0,
  stats: {
    downloads: 0,
    stars: 0,
    installsCurrent: 0,
    installsAllTime: 0,
    versions: 0,
    comments: 0,
  },
  moderationStatus: "active",
  moderationFlags: undefined,
  moderationVerdict: undefined,
  moderationReason: undefined,
  isSuspicious: undefined,
  softDeletedAt: undefined,
  createdAt: 1,
  updatedAt: 1,
};

const publisherSkill = {
  ...baseSkill,
  ownerPublisherId: "publishers:org",
};

const activePublisher = {
  _id: "publishers:org",
  kind: "org",
  deletedAt: undefined,
  deactivatedAt: undefined,
};

describe("deleteTags", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("deletes specified tags and keeps latest", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["stable", "old-tag"] } as never,
    );
    expect(patch).toHaveBeenCalledOnce();
    const patchArgs = patch.mock.calls[0];
    expect(patchArgs[1]).toHaveProperty("tags");
    const newTags = (patchArgs[1] as Record<string, unknown>).tags as Record<string, string>;
    expect(newTags).toHaveProperty("latest");
    expect(newTags).toHaveProperty("beta");
    expect(newTags).not.toHaveProperty("stable");
    expect(newTags).not.toHaveProperty("old-tag");
  });

  it("protects the latest tag from deletion", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["latest"] } as never,
    );
    // No actual tag removed → no db.patch call
    expect(patch).not.toHaveBeenCalled();
  });

  it("skips db write when no tags are actually removed", async () => {
    const { db, auth, patch } = makeCtx({ user: ownerUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["nonexistent", "latest"] } as never,
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("throws for non-owner non-moderator user", async () => {
    const { db, auth } = makeCtx({ user: otherUser, skill: baseSkill });
    await expect(
      deleteTagsHandler({ db, auth } as never, { skillId: "skills:1", tags: ["stable"] } as never),
    ).rejects.toThrow();
  });

  it("allows moderator to delete tags on other user's skill", async () => {
    const { db, auth, patch } = makeCtx({ user: modUser, skill: baseSkill });
    await deleteTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: ["beta"] } as never,
    );
    expect(patch).toHaveBeenCalledOnce();
    const newTags = (patch.mock.calls[0][1] as Record<string, unknown>).tags as Record<
      string,
      string
    >;
    expect(newTags).not.toHaveProperty("beta");
    expect(newTags).toHaveProperty("latest");
    expect(newTags).toHaveProperty("stable");
  });

  it("throws when skill not found", async () => {
    const { db, auth } = makeCtx({ user: ownerUser, skill: null });
    await expect(
      deleteTagsHandler(
        { db, auth } as never,
        { skillId: "skills:missing", tags: ["stable"] } as never,
      ),
    ).rejects.toThrow("Skill not found");
  });
});

describe("updateTags", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("updates tags only to versions that belong to the skill", async () => {
    const { db, auth, patch } = makeCtx({
      user: ownerUser,
      skill: baseSkill,
      versionsById: {
        "versions:2": {
          _id: "versions:2",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 10,
          changelog: "stable",
          changelogSource: "user",
          parsed: { clawdis: { os: ["macos"] } },
          capabilityTags: ["posts-externally"],
          softDeletedAt: undefined,
        },
      },
    });

    await updateTagsHandler(
      { db, auth } as never,
      { skillId: "skills:1", tags: [{ tag: "stable", versionId: "versions:2" }] } as never,
    );

    expect(patch).toHaveBeenCalledOnce();
    expect(patch.mock.calls[0][1]).toMatchObject({
      tags: expect.objectContaining({ stable: "versions:2" }),
    });
  });

  it("rejects tag updates to another skill's version", async () => {
    const { db, auth, patch } = makeCtx({
      user: ownerUser,
      skill: baseSkill,
      versionsById: {
        "versions:other": {
          _id: "versions:other",
          skillId: "skills:other",
          version: "9.9.9",
          createdAt: 10,
          changelog: "other",
          softDeletedAt: undefined,
        },
      },
    });

    await expect(
      updateTagsHandler(
        { db, auth } as never,
        {
          skillId: "skills:1",
          tags: [{ tag: "stable", versionId: "versions:other" }],
        } as never,
      ),
    ).rejects.toThrow("Version not found");
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects tag updates to soft-deleted versions", async () => {
    const { db, auth, patch } = makeCtx({
      user: ownerUser,
      skill: baseSkill,
      versionsById: {
        "versions:deleted": {
          _id: "versions:deleted",
          skillId: "skills:1",
          version: "0.9.0",
          createdAt: 9,
          changelog: "deleted",
          softDeletedAt: 123,
        },
      },
    });

    await expect(
      updateTagsHandler(
        { db, auth } as never,
        {
          skillId: "skills:1",
          tags: [{ tag: "stable", versionId: "versions:deleted" }],
        } as never,
      ),
    ).rejects.toThrow("Version not found");
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("updateSummary", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("allows the skill owner to update a trimmed summary", async () => {
    const { db, auth, patch } = makeCtx({
      user: ownerUser,
      skill: baseSkill,
      digest: { _id: "skillSearchDigest:1", skillId: "skills:1", summary: "Old summary" },
      enableTriggers: true,
    });
    await updateSummaryHandler(
      { db, auth } as never,
      { skillId: "skills:1", summary: "  Updated summary  " } as never,
    );
    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills",
      "skills:1",
      expect.objectContaining({ summary: "Updated summary" }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "skillSearchDigest:1",
      expect.objectContaining({ summary: "Updated summary" }),
    );
  });

  it("allows publisher admins to update org-owned skill summaries", async () => {
    const { db, auth, patch } = makeCtx({
      user: otherUser,
      skill: publisherSkill,
      publisher: activePublisher,
      digest: { _id: "skillSearchDigest:1", skillId: "skills:1", summary: "Old summary" },
      enableTriggers: true,
      membership: {
        _id: "publisherMembers:1",
        publisherId: "publishers:org",
        userId: "users:other",
        role: "admin",
      },
    });
    await updateSummaryHandler(
      { db, auth } as never,
      { skillId: "skills:1", summary: "Org summary" } as never,
    );
    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills",
      "skills:1",
      expect.objectContaining({ summary: "Org summary" }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "skillSearchDigest:1",
      expect.objectContaining({ summary: "Org summary" }),
    );
  });

  it("rejects publisher members without manage access", async () => {
    const { db, auth } = makeCtx({
      user: otherUser,
      skill: publisherSkill,
      publisher: activePublisher,
      membership: {
        _id: "publisherMembers:1",
        publisherId: "publishers:org",
        userId: "users:other",
        role: "publisher",
      },
    });
    await expect(
      updateSummaryHandler(
        { db, auth } as never,
        { skillId: "skills:1", summary: "Nope" } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects overly long summaries", async () => {
    const { db, auth } = makeCtx({ user: ownerUser, skill: baseSkill });
    await expect(
      updateSummaryHandler(
        { db, auth } as never,
        { skillId: "skills:1", summary: "x".repeat(501) } as never,
      ),
    ).rejects.toThrow("Summary must be 500 characters or less");
  });
});
