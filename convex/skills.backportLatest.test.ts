import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { insertVersion } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler;

const OWNER_USER_ID = "users:owner";
const OWNER_PUBLISHER_ID = "publishers:owner";
const SKILL_ID = "skills:1";
const PREV_LATEST_VERSION_ID = "skillVersions:prev";
const PREV_EMBEDDING_ID = "skillEmbeddings:prev";
const NEW_VERSION_ID = "skillVersions:new";
const NEW_EMBEDDING_ID = "skillEmbeddings:new";

type SkillDoc = {
  _id: string;
  slug: string;
  displayName: string;
  summary: string;
  ownerUserId: string;
  ownerPublisherId: string;
  latestVersionId: string | undefined;
  latestVersionSummary:
    | {
        version: string;
        createdAt: number;
        changelog: string;
        changelogSource?: "auto" | "user";
        clawdis?: unknown;
      }
    | undefined;
  tags: Record<string, string>;
  capabilityTags: string[] | undefined;
  stats: {
    downloads: number;
    installsCurrent: number;
    installsAllTime: number;
    stars: number;
    versions: number;
    comments: number;
  };
  badges: Record<string, unknown>;
  moderationStatus: string;
  moderationReason: string;
  moderationFlags: string[] | undefined;
  isSuspicious: boolean;
  softDeletedAt: number | undefined;
  createdAt: number;
  updatedAt: number;
  manualOverride?: unknown;
  [key: string]: unknown;
};

function buildExistingSkill(overrides: Partial<SkillDoc> = {}): SkillDoc {
  return {
    _id: SKILL_ID,
    slug: "my-skill",
    displayName: "My Skill v2",
    summary: "Summary of v2.0.0",
    ownerUserId: OWNER_USER_ID,
    ownerPublisherId: OWNER_PUBLISHER_ID,
    latestVersionId: PREV_LATEST_VERSION_ID,
    latestVersionSummary: {
      version: "2.0.0",
      createdAt: 1,
      changelog: "Major release",
      changelogSource: "user",
      clawdis: {},
    },
    tags: { latest: PREV_LATEST_VERSION_ID },
    capabilityTags: ["cap-v2"],
    stats: {
      downloads: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    badges: {
      redactionApproved: undefined,
      highlighted: undefined,
      official: undefined,
      deprecated: undefined,
    },
    moderationStatus: "active",
    moderationReason: "pending.scan",
    moderationFlags: undefined,
    isSuspicious: false,
    softDeletedAt: undefined,
    createdAt: 1,
    updatedAt: 1,
    manualOverride: undefined,
    ...overrides,
  };
}

function buildPublishArgs(overrides?: Partial<Record<string, unknown>>) {
  return {
    userId: OWNER_USER_ID,
    slug: "my-skill",
    displayName: "My Skill v1 backport",
    version: "1.0.1",
    changelog: "Backport fix",
    changelogSource: "user",
    tags: [] as string[],
    capabilityTags: ["cap-v1-backport"],
    summary: "Summary of v1.0.1 backport",
    fingerprint: "f".repeat(64),
    files: [
      {
        path: "SKILL.md",
        size: 128,
        storageId: "_storage:1",
        sha256: "a".repeat(64),
        contentType: "text/markdown",
      },
    ],
    parsed: {
      frontmatter: { description: "backport summary from frontmatter" },
      metadata: {},
      clawdis: {},
    },
    staticScan: {
      status: "clean",
      reasonCodes: [],
      findings: [],
      summary: "",
      engineVersion: "v2.2.0",
      checkedAt: Date.now(),
    },
    embedding: [0.1, 0.2],
    ...overrides,
  };
}

type Captured = {
  skillPatches: Array<Record<string, unknown>>;
  embeddingInserts: Array<Record<string, unknown>>;
  embeddingPatches: Array<{ id: string; value: Record<string, unknown> }>;
  versionInserted: Record<string, unknown> | null;
  allPatches: Array<{ id: string; value: Record<string, unknown> }>;
};

function buildDb(skill: SkillDoc, captured: Captured) {
  // Trigger-driven code (syncSkillSearchDigestForSkill -> getOwnerPublisher)
  // will ask for publishers via `db.get(ownerPublisherId)`. Return null so
  // getOwnerPublisher falls back to resolving the publisher from the owner user.
  const publisherTableQuery = () => ({
    withIndex: () => ({
      unique: async () => null,
      take: async () => [],
    }),
  });

  const db = {
    get: vi.fn(async (arg0: string, arg1?: string) => {
      // triggers.wrapDB calls innerDb.get(tableName, id) for tables with
      // registered triggers; other call sites use db.get(id).
      const id = arg1 !== undefined ? arg1 : arg0;
      if (id === OWNER_USER_ID) {
        return {
          _id: OWNER_USER_ID,
          _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
          createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
          handle: "alice",
          name: "Alice",
          email: "alice@example.com",
          displayName: "Alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
          trustedPublisher: true,
          role: "user",
          personalPublisherId: OWNER_PUBLISHER_ID,
        };
      }
      if (id === OWNER_PUBLISHER_ID) {
        // Returning null lets getOwnerPublisher fall back to user-based
        // resolution, which then hits the synthesize fallback.
        return null;
      }
      if (id === SKILL_ID) return skill;
      return null;
    }),
    query: vi.fn((table: string) => {
      if (table === "publishers" || table === "publisherMembers") {
        // ensurePersonalPublisherForUser / getOwnerPublisher may poll these
        // tables during triggers. Returning an empty index matches the state
        // of a fresh test environment without real publisher rows.
        return publisherTableQuery();
      }
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name === "by_slug") {
              return { unique: async () => skill };
            }
            if (name === "by_owner") {
              return { order: () => ({ take: async () => [skill] }) };
            }
            throw new Error(`unexpected skills index ${name}`);
          },
        };
      }
      if (table === "skillSlugAliases") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug") {
              throw new Error(`unexpected skillSlugAliases index ${name}`);
            }
            return { unique: async () => null };
          },
        };
      }
      if (table === "skillVersions") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_skill_version") {
              throw new Error(`unexpected skillVersions index ${name}`);
            }
            return { unique: async () => null };
          },
        };
      }
      if (table === "skillVersionFingerprints") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_fingerprint") {
              throw new Error(`unexpected skillVersionFingerprints index ${name}`);
            }
            return { take: async () => [] };
          },
        };
      }
      if (table === "skillBadges") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_skill") {
              throw new Error(`unexpected skillBadges index ${name}`);
            }
            return { take: async () => [] };
          },
        };
      }
      if (table === "skillEmbeddings") {
        return {
          withIndex: (
            name: string,
            build:
              | ((q: { eq: (field: string, value: string) => unknown }) => unknown)
              | undefined,
          ) => {
            if (name !== "by_version") {
              throw new Error(`unexpected skillEmbeddings index ${name}`);
            }
            let requestedVersionId: string | null = null;
            const q = {
              eq: (field: string, value: string) => {
                if (field !== "versionId") throw new Error(`unexpected field ${field}`);
                requestedVersionId = value;
                return q;
              },
            };
            build?.(q);
            return {
              unique: async () => {
                if (requestedVersionId === PREV_LATEST_VERSION_ID) {
                  return {
                    _id: PREV_EMBEDDING_ID,
                    versionId: PREV_LATEST_VERSION_ID,
                    isLatest: true,
                    isApproved: false,
                    visibility: "public",
                  };
                }
                return null;
              },
            };
          },
        };
      }
      if (table === "globalStats") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_key") {
              throw new Error(`unexpected globalStats index ${name}`);
            }
            return {
              unique: async () => ({
                _id: "globalStats:1",
                activeSkillsCount: 100,
              }),
            };
          },
        };
      }
      if (table === "skillSearchDigest") {
        return {
          withIndex: () => ({
            unique: async () => null,
          }),
        };
      }
      if (table === "reservedSlugs") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected reservedSlugs index ${name}`);
            }
            return { order: () => ({ take: async () => [] }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    patch: vi.fn(async (arg0: unknown, arg1: unknown, arg2?: unknown) => {
      // convex-helpers `triggers` calls innerDb.patch(tableName, id, value)
      // for tables with registered triggers (e.g. "skills"); otherwise it
      // falls back to innerDb.patch(id, value).
      const [id, value] =
        arg2 !== undefined ? [arg1 as string, arg2] : [arg0 as string, arg1];

      captured.allPatches.push({
        id: id,
        value: value as Record<string, unknown>,
      });

      if (id === SKILL_ID) {
        captured.skillPatches.push(value as Record<string, unknown>);
        Object.assign(skill, value as Record<string, unknown>);
        return;
      }
      if (id === PREV_EMBEDDING_ID) {
        captured.embeddingPatches.push({ id, value: value as Record<string, unknown> });
        return;
      }
      if (typeof id === "string" && id.startsWith("users:")) return;
      if (typeof id === "string" && id.startsWith("publishers:")) return;
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skillVersions") {
        captured.versionInserted = value;
        return NEW_VERSION_ID;
      }
      if (table === "skillEmbeddings") {
        captured.embeddingInserts.push(value);
        return NEW_EMBEDDING_ID;
      }
      if (table === "embeddingSkillMap") {
        return "embeddingSkillMap:1";
      }
      if (table === "skillVersionFingerprints") {
        return "skillVersionFingerprints:1";
      }
      // Trigger side-effect / digest tables: accept silently so the async
      // digest plumbing invoked by the skills trigger doesn't fail the test.
      if (table === "skillSearchDigest") {
        return `${table}:mock`;
      }
      // Intentionally throw for publishers / publisherMembers so
      // ensurePersonalPublisherForUser's `isMissingPublisherTableError` branch
      // takes the synthesize fallback, avoiding the publishers trigger chain.
      throw new Error(`unexpected insert table ${table}`);
    }),
    normalizeId: vi.fn((tableName: string, id: string) =>
      id.startsWith(`${tableName}:`) ? id : null,
    ),
  };
  return db;
}

function buildCtx(skill: SkillDoc) {
  const captured: Captured = {
    skillPatches: [],
    embeddingInserts: [],
    embeddingPatches: [],
    versionInserted: null,
    allPatches: [],
  };
  const db = buildDb(skill, captured);
  const ctx = {
    db,
    scheduler: { runAfter: vi.fn() },
  };
  return { ctx, captured, db };
}

describe("skills.insertVersion latest-tag protection", () => {
  it("promotes latest when publishing a strictly higher version", async () => {
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    const result = await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "2.1.0",
        displayName: "My Skill v2.1",
        summary: "Summary of v2.1.0",
        capabilityTags: ["cap-v2.1"],
      }) as never,
    );

    expect(result).toEqual({
      skillId: SKILL_ID,
      versionId: NEW_VERSION_ID,
      embeddingId: NEW_EMBEDDING_ID,
    });

    const finalPatch = captured.skillPatches.at(-1);
    expect(finalPatch).toBeDefined();
    expect(finalPatch).toMatchObject({
      latestVersionId: NEW_VERSION_ID,
      displayName: "My Skill v2.1",
      capabilityTags: ["cap-v2.1"],
      tags: expect.objectContaining({ latest: NEW_VERSION_ID }),
    });
    expect((finalPatch as Record<string, unknown>).latestVersionSummary).toMatchObject({
      version: "2.1.0",
    });

    // New embedding is the latest; the previous latest embedding is demoted.
    expect(captured.embeddingInserts[0]).toMatchObject({
      versionId: NEW_VERSION_ID,
      isLatest: true,
    });
    expect(captured.embeddingPatches).toHaveLength(1);
    expect(captured.embeddingPatches[0]).toMatchObject({
      id: PREV_EMBEDDING_ID,
      value: expect.objectContaining({ isLatest: false }),
    });
  });

  it("does not clobber latest when publishing an older (backport) version", async () => {
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    const result = await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "1.0.1",
        displayName: "My Skill v1 backport",
        summary: "Summary of v1.0.1 backport",
        capabilityTags: ["cap-v1-backport"],
      }) as never,
    );

    expect(result).toEqual({
      skillId: SKILL_ID,
      versionId: NEW_VERSION_ID,
      embeddingId: NEW_EMBEDDING_ID,
    });

    const finalPatch = captured.skillPatches.at(-1) as Record<string, unknown>;
    expect(finalPatch).toBeDefined();

    // Latest pointer is preserved.
    expect(finalPatch.latestVersionId).toBe(PREV_LATEST_VERSION_ID);
    expect(finalPatch.latestVersionSummary).toMatchObject({ version: "2.0.0" });

    // Skill card fields must keep tracking the existing latest, not the backport.
    expect(finalPatch.displayName).toBe("My Skill v2");
    expect(finalPatch.summary).toBe("Summary of v2.0.0");
    expect(finalPatch.capabilityTags).toEqual(["cap-v2"]);

    // `tags.latest` still points to the previous version.
    expect(finalPatch.tags).toEqual(
      expect.objectContaining({ latest: PREV_LATEST_VERSION_ID }),
    );

    // versions counter still increments on every publish, regardless of version order.
    expect(finalPatch.stats).toMatchObject({ versions: 2 });
  });

  it("keeps the previous latest embedding untouched on backport publishes", async () => {
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    await insertVersionHandler(
      ctx as never,
      buildPublishArgs({ version: "1.0.1" }) as never,
    );

    // New version embedding is NOT marked latest.
    expect(captured.embeddingInserts).toHaveLength(1);
    expect(captured.embeddingInserts[0]).toMatchObject({
      versionId: NEW_VERSION_ID,
      isLatest: false,
    });

    // Previous latest embedding must not be demoted.
    expect(captured.embeddingPatches).toHaveLength(0);
  });

  it("routes a custom tag to the backport version but leaves latest alone", async () => {
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "1.0.1",
        tags: ["lts"],
      }) as never,
    );

    const finalPatch = captured.skillPatches.at(-1) as Record<string, unknown>;
    expect(finalPatch.tags).toEqual(
      expect.objectContaining({
        latest: PREV_LATEST_VERSION_ID,
        lts: NEW_VERSION_ID,
      }),
    );
  });

  it("ignores an explicit `latest` in args.tags for a backport publish", async () => {
    // Security regression: a caller must not be able to defeat the semver
    // guard by smuggling `latest` through the custom-tag loop.
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "1.0.1",
        tags: ["latest", "lts"],
      }) as never,
    );

    const finalPatch = captured.skillPatches.at(-1) as Record<string, unknown>;
    expect(finalPatch.latestVersionId).toBe(PREV_LATEST_VERSION_ID);
    expect(finalPatch.latestVersionSummary).toMatchObject({ version: "2.0.0" });
    expect(finalPatch.tags).toEqual(
      expect.objectContaining({
        latest: PREV_LATEST_VERSION_ID,
        lts: NEW_VERSION_ID,
      }),
    );
    // New embedding must still be marked non-latest.
    expect(captured.embeddingInserts[0]).toMatchObject({ isLatest: false });
    expect(captured.embeddingPatches).toHaveLength(0);
  });

  it("ignores case-variant `LaTeSt` in args.tags for a backport publish", async () => {
    // Defense in depth against case-only bypass attempts.
    const skill = buildExistingSkill();
    const { ctx, captured } = buildCtx(skill);

    await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "1.0.1",
        tags: ["LaTeSt"],
      }) as never,
    );

    const finalPatch = captured.skillPatches.at(-1) as Record<string, unknown>;
    expect(finalPatch.latestVersionId).toBe(PREV_LATEST_VERSION_ID);
    expect(finalPatch.tags).toEqual(
      expect.objectContaining({ latest: PREV_LATEST_VERSION_ID }),
    );
    // The case-variant tag must not leak into the stored tag map either.
    const tags = finalPatch.tags as Record<string, string>;
    expect(tags.LaTeSt).toBeUndefined();
  });

  it("treats the very first publish as latest even when the version is low", async () => {
    const skill = buildExistingSkill({
      latestVersionId: undefined,
      latestVersionSummary: undefined,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 0,
        comments: 0,
      },
    });
    const { ctx, captured } = buildCtx(skill);

    await insertVersionHandler(
      ctx as never,
      buildPublishArgs({
        version: "0.0.1",
        displayName: "My Skill v0",
        summary: "Summary of v0.0.1",
        capabilityTags: ["cap-v0"],
      }) as never,
    );

    const finalPatch = captured.skillPatches.at(-1) as Record<string, unknown>;
    expect(finalPatch.latestVersionId).toBe(NEW_VERSION_ID);
    expect(finalPatch.latestVersionSummary).toMatchObject({ version: "0.0.1" });
    expect(finalPatch.tags).toEqual(expect.objectContaining({ latest: NEW_VERSION_ID }));
    expect(finalPatch.displayName).toBe("My Skill v0");
    expect(finalPatch.capabilityTags).toEqual(["cap-v0"]);
    expect(captured.embeddingInserts[0]).toMatchObject({ isLatest: true });
  });
});
