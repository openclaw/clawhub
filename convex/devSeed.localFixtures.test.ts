import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  currentUserSeedPackageName,
  currentUserSeedSkillSlug,
  seedFeaturedPluginPackagesMutation,
  seedGitHubBackedSkillSourceMutation,
  seedLocalFixtures,
  seedLocalModerationFixturesHandler,
  seedPublicCorpusBatchMutation,
  seedSkillMutation,
} from "./devSeed";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const seedSkillMutationHandler = (
  seedSkillMutation as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const seedFeaturedPluginPackagesHandler = (
  seedFeaturedPluginPackagesMutation as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const seedGitHubBackedSkillSourceHandler = (
  seedGitHubBackedSkillSourceMutation as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const seedLocalFixturesHandler = (
  seedLocalFixtures as unknown as WrappedHandler<{ reset?: boolean }>
)._handler;
const seedPublicCorpusBatchHandler = (
  seedPublicCorpusBatchMutation as unknown as WrappedHandler<Record<string, unknown>>
)._handler;

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Record<string, unknown>, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb() {
  const tables: Record<string, Array<Record<string, unknown> & { _id: string }>> = {};
  const counters: Record<string, number> = {};
  const operations: Array<{ type: "delete"; table: string; id: string }> = [];

  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const db = {
    get: async (arg0: string, arg1?: string) => {
      const id = arg1 ?? arg0;
      const table = id.split(":")[0] ?? "";
      return list(table).find((doc) => doc._id === id) ?? null;
    },
    insert: async (table: string, doc: Record<string, unknown>) => {
      counters[table] = (counters[table] ?? 0) + 1;
      const inserted = {
        _id: `${table}:${counters[table]}`,
        _creationTime: counters[table],
        ...doc,
      };
      list(table).push(inserted);
      return inserted._id;
    },
    patch: async (
      arg0: string,
      arg1: string | Record<string, unknown>,
      arg2?: Record<string, unknown>,
    ) => {
      const id = arg2 ? (arg1 as string) : arg0;
      const patch = arg2 ?? (arg1 as Record<string, unknown>);
      const table = id.split(":")[0] ?? "";
      const doc = list(table).find((candidate) => candidate._id === id);
      if (doc) Object.assign(doc, patch);
    },
    replace: async (
      arg0: string,
      arg1: string | Record<string, unknown>,
      arg2?: Record<string, unknown>,
    ) => {
      const id = arg2 ? (arg1 as string) : arg0;
      const replacement = arg2 ?? (arg1 as Record<string, unknown>);
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((doc) => doc._id === id);
      if (index !== -1) rows[index] = { ...rows[index], ...replacement, _id: id };
    },
    delete: async (arg0: string, arg1?: string) => {
      const id = arg1 ?? arg0;
      const table = id.split(":")[0] ?? "";
      operations.push({ type: "delete", table, id });
      const rows = list(table);
      const index = rows.findIndex((doc) => doc._id === id);
      if (index !== -1) rows.splice(index, 1);
    },
    normalizeId: (tableName: string, id: string) => (id.startsWith(`${tableName}:`) ? id : null),
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        const matched = () =>
          list(table).filter((doc) => matches(doc as Record<string, unknown>, constraints));
        return {
          collect: async () => matched(),
          unique: async () => matched()[0] ?? null,
          paginate: async () => ({
            page: matched(),
            isDone: true,
            continueCursor: null,
          }),
          order: () => ({
            collect: async () => matched(),
            paginate: async () => ({
              page: matched(),
              isDone: true,
              continueCursor: null,
            }),
          }),
        };
      },
    }),
  };

  return { db, tables, operations };
}

function createMutationCtx(db: ReturnType<typeof createDb>["db"]) {
  return { db, scheduler: { runAfter: async () => null } };
}

function seedSkillArgs(storageId: string) {
  const clawdis = {
    os: ["linux"],
    nix: {
      plugin: "github:example/catalog-demo",
      systems: ["x86_64-linux"],
    },
  };
  return {
    storageId,
    metadata: { clawdbot: { nix: clawdis.nix } },
    frontmatter: { name: "catalog-demo", description: "Catalog demo" },
    clawdis,
    skillMd: "# Catalog demo",
    slug: "catalog-demo",
    displayName: "Catalog Demo",
    summary: "Seeded catalog demo.",
    version: "0.1.0",
  };
}

describe("devSeed local fixtures", () => {
  it("does not preconfigure GitHub-backed source fixtures in the local seed action", async () => {
    const mutationCalls: Array<{ args: Record<string, unknown> }> = [];
    let storageCounter = 0;
    const ctx = {
      storage: {
        store: async () => `storage:${++storageCounter}`,
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ args });
        return { ok: true, seeded: ["local-moderation-fixtures"], skipped: [] };
      },
    };

    const result = await seedLocalFixturesHandler(ctx as never, { reset: true });

    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0]?.args).toMatchObject({
      reset: true,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        results: [expect.objectContaining({ slug: "local-moderation-fixtures" })],
      }),
    );
  });

  it("seeds core skill fixtures for an explicit local user without creating @local", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "fuller-stack-dev",
      displayName: "Fuller Stack Dev",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const scopedSlug = currentUserSeedSkillSlug(userId, "catalog-demo");

    await seedSkillMutationHandler(
      createMutationCtx(db) as never,
      {
        ...seedSkillArgs("storage:first"),
        ownerUserId: userId,
        slug: scopedSlug,
      } as never,
    );
    await seedSkillMutationHandler(
      createMutationCtx(db) as never,
      {
        ...seedSkillArgs("storage:second"),
        ownerUserId: userId,
        slug: scopedSlug,
      } as never,
    );

    expect(tables.users).toHaveLength(1);
    expect(tables.users?.[0]).toEqual(expect.objectContaining({ handle: "fuller-stack-dev" }));
    expect(tables.publishers).toHaveLength(1);
    expect(tables.publishers?.[0]).toEqual(
      expect.objectContaining({ handle: "fuller-stack-dev", linkedUserId: userId }),
    );
    expect(tables.skills).toHaveLength(1);
    expect(tables.skills?.[0]).toEqual(
      expect.objectContaining({
        slug: scopedSlug,
        ownerUserId: userId,
        ownerPublisherId: tables.publishers?.[0]?._id,
      }),
    );
  });

  it("does not copy publisher ownership onto public corpus skill embeddings", async () => {
    const { db, tables } = createDb();

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "skill",
            slug: "corpus-demo",
            displayName: "Corpus Demo",
            version: "0.1.0",
            skillMd: "---\ndescription: Corpus demo\n---\n# Corpus demo",
            storageId: "storage:corpus-demo",
            embedding: [0, 1, 2],
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    expect(tables.skills?.[0]).toEqual(
      expect.objectContaining({
        slug: "corpus-demo",
        ownerPublisherId: tables.publishers?.[0]?._id,
      }),
    );
    expect(tables.skillEmbeddings?.[0]).not.toHaveProperty("ownerPublisherId");
  });

  it("seeds a GitHub-backed source and skills without creating mirrored versions", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "nvidia-dev",
      displayName: "NVIDIA Dev",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;

    const result = await seedGitHubBackedSkillSourceHandler(
      createMutationCtx(db) as never,
      {
        ownerUserId: userId,
        repo: "NVIDIA/skills",
        defaultBranch: "main",
        displayManifestKind: "skills.sh",
        displayManifestHash: "manifest-sha256",
        displayManifestCommit: "0".repeat(40),
        displayManifestFetchedAt: 123,
        displayManifestStatus: "ok",
        displayManifest: {
          notGrouped: "bottom",
          groupings: [
            {
              title: "Agentic AI",
              description: "Agentic AI skills.",
              skills: ["aiq-deploy", "nemoclaw-user-configure-security"],
            },
          ],
        },
        skills: [
          {
            slug: "aiq-deploy",
            displayName: "AIQ Deploy",
            summary: "Deploy AgentIQ workflows.",
            githubPath: "skills/aiq-deploy",
            githubCurrentCommit: "1".repeat(40),
            githubCurrentContentHash: "hash-aiq-deploy",
            githubScanStatus: "clean",
            githubCurrentCheckedAt: 456,
          },
          {
            slug: "nemoclaw-user-configure-security",
            displayName: "NeMoClaw User Configure Security",
            summary: "Configure NeMoClaw user security.",
            githubPath: "skills/nemoclaw-user-configure-security",
            githubCurrentCommit: "2".repeat(40),
            githubCurrentContentHash: "hash-nemoclaw",
            githubScanStatus: "clean",
            githubCurrentCheckedAt: 789,
            githubRemovedAt: 900,
          },
        ],
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      seeded: ["aiq-deploy", "nemoclaw-user-configure-security"],
      skipped: [],
    });
    expect(tables.githubSkillSources).toHaveLength(1);
    expect(tables.githubSkillSources?.[0]).toEqual(
      expect.objectContaining({
        repo: "NVIDIA/skills",
        ownerPublisherId: tables.publishers?.[0]?._id,
        defaultBranch: "main",
        displayManifestKind: "skills.sh",
        displayManifestHash: "manifest-sha256",
        displayManifestCommit: "0".repeat(40),
        displayManifestFetchedAt: 123,
        displayManifestStatus: "ok",
        displayManifest: {
          notGrouped: "bottom",
          groupings: [
            {
              title: "Agentic AI",
              description: "Agentic AI skills.",
              skills: ["aiq-deploy", "nemoclaw-user-configure-security"],
            },
          ],
        },
      }),
    );
    expect(tables.skills).toHaveLength(2);
    expect(tables.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "aiq-deploy",
          installKind: "github",
          githubSourceId: tables.githubSkillSources?.[0]?._id,
          githubPath: "skills/aiq-deploy",
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: "hash-aiq-deploy",
          githubScanStatus: "clean",
          githubCurrentCheckedAt: 456,
          latestVersionId: undefined,
          latestVersionSummary: undefined,
          tags: {},
          stats: expect.objectContaining({ versions: 0 }),
        }),
        expect.objectContaining({
          slug: "nemoclaw-user-configure-security",
          installKind: "github",
          githubSourceId: tables.githubSkillSources?.[0]?._id,
          githubPath: "skills/nemoclaw-user-configure-security",
          githubCurrentContentHash: "hash-nemoclaw",
          githubRemovedAt: 900,
          moderationStatus: "hidden",
          moderationReason: "github.upstream.removed",
          moderationVerdict: undefined,
          isSuspicious: false,
          latestVersionId: undefined,
          tags: {},
        }),
      ]),
    );
    expect(tables.skillVersions ?? []).toHaveLength(0);
  });

  it("keeps unscanned GitHub-backed skills hidden from public listings", async () => {
    const { db, tables } = createDb();

    await seedGitHubBackedSkillSourceHandler(
      createMutationCtx(db) as never,
      {
        repo: "NVIDIA/skills",
        displayManifestStatus: "ok",
        skills: [
          {
            slug: "pending-github-skill",
            displayName: "Pending GitHub Skill",
            githubPath: "skills/pending-github-skill",
            githubCurrentCommit: "1".repeat(40),
            githubCurrentContentHash: "hash-pending",
            githubScanStatus: "pending",
          },
          {
            slug: "failed-scan-github-skill",
            displayName: "Failed Scan GitHub Skill",
            githubPath: "skills/failed-scan-github-skill",
            githubCurrentCommit: "2".repeat(40),
            githubCurrentContentHash: "hash-failed-scan",
            githubScanStatus: "failed",
          },
        ],
      } as never,
    );

    expect(tables.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "pending-github-skill",
          moderationStatus: "hidden",
          moderationReason: "pending.scan",
          moderationVerdict: undefined,
          isSuspicious: false,
        }),
        expect.objectContaining({
          slug: "failed-scan-github-skill",
          moderationStatus: "hidden",
          moderationReason: "scanner.failed",
          moderationVerdict: undefined,
          isSuspicious: false,
        }),
      ]),
    );
  });

  it("seeds moderation and plugin fixtures for an explicit local user with scoped identifiers", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "fuller-stack-dev",
      displayName: "Fuller Stack Dev",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const flaggedSkillSlug = currentUserSeedSkillSlug(userId, "local-flagged-wallet-sync");
    const scannedSkillSlug = currentUserSeedSkillSlug(userId, "local-agentic-risk-demo");
    const flaggedPluginName = currentUserSeedPackageName(userId, "local-flagged-runtime-plugin");
    const scannedPluginName = currentUserSeedPackageName(userId, "local-scanned-runtime-plugin");

    await seedLocalModerationFixturesHandler(
      createMutationCtx(db) as never,
      {
        ownerUserId: userId,
        flaggedSkillSlug,
        scannedSkillSlug,
        flaggedPluginName,
        scannedPluginName,
        flaggedSkillStorageId: "storage:skill",
        flaggedSkillMd: `---\nname: ${flaggedSkillSlug}\n---\n# Flagged skill`,
        scannedSkillStorageId: "storage:scanned-skill",
        scannedSkillMd: `---\nname: ${scannedSkillSlug}\n---\n# Scanned skill`,
        flaggedPluginStorageId: "storage:plugin",
        flaggedPluginReadme: "# Flagged plugin",
        scannedPluginStorageId: "storage:scanned-plugin",
        scannedPluginReadme: "# Scanned plugin",
      } as never,
    );
    await seedFeaturedPluginPackagesHandler(
      createMutationCtx(db) as never,
      {
        ownerUserId: userId,
        packages: [
          {
            name: currentUserSeedPackageName(userId, "local-merge-notes-plugin"),
            displayName: "Local Merge Notes",
            summary: "Seeded local owner plugin.",
            version: "0.1.0",
            runtimeId: "local.merge.notes",
            sourceRepo: "openclaw/local-merge-notes-plugin",
            isOfficial: false,
            capabilityTags: ["notes"],
            stats: { downloads: 1, installs: 1, stars: 1, versions: 1 },
            storageId: "storage:plugin-notes",
            readmeSize: 16,
          },
        ],
      } as never,
    );

    expect(tables.users).toHaveLength(1);
    expect(tables.users?.[0]).toEqual(expect.objectContaining({ handle: "fuller-stack-dev" }));
    expect(
      tables.skills?.map((skill) => String(skill.slug)).sort((a, b) => a.localeCompare(b)),
    ).toEqual([scannedSkillSlug, flaggedSkillSlug]);
    expect(tables.skills?.every((skill) => skill.ownerUserId === userId)).toBe(true);
    expect(
      tables.packages?.map((pkg) => String(pkg.name)).sort((a, b) => a.localeCompare(b)),
    ).toEqual([
      flaggedPluginName,
      currentUserSeedPackageName(userId, "local-merge-notes-plugin"),
      scannedPluginName,
    ]);
    expect(tables.packages?.every((pkg) => pkg.ownerUserId === userId)).toBe(true);
  });

  it("retires legacy @local-owner seed publishers so dev-auth users can claim the handle", async () => {
    const { db, tables } = createDb();
    const legacyUserId = (await db.insert("users", {
      handle: "Local Owner",
      displayName: "Local Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const legacyPublisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "local-owner",
      displayName: "Local Owner",
      linkedUserId: legacyUserId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;
    await db.patch(legacyUserId, { personalPublisherId: legacyPublisherId });
    await db.insert("publisherMembers", {
      publisherId: legacyPublisherId,
      userId: legacyUserId,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.insert("packages", {
      name: "local-scanned-runtime-plugin",
      normalizedName: "local-scanned-runtime-plugin",
      ownerUserId: legacyUserId,
      ownerPublisherId: legacyPublisherId,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 1,
    });

    await seedLocalModerationFixturesHandler(
      createMutationCtx(db) as never,
      {
        flaggedSkillStorageId: "storage:skill",
        flaggedSkillMd: "# Flagged skill",
        scannedSkillStorageId: "storage:scanned-skill",
        scannedSkillMd: "# Scanned skill",
        flaggedPluginStorageId: "storage:plugin",
        flaggedPluginReadme: "# Flagged plugin",
        scannedPluginStorageId: "storage:scanned-plugin",
        scannedPluginReadme: "# Scanned plugin",
      } as never,
    );

    expect(tables.publishers?.some((publisher) => publisher.handle === "local-owner")).toBe(false);
    expect(tables.publishers).toContainEqual(
      expect.objectContaining({
        _id: legacyPublisherId,
        handle: expect.stringMatching(/^legacy-local-owner-/),
        deactivatedAt: expect.any(Number),
        deletedAt: expect.any(Number),
      }),
    );
    expect(
      tables.packages?.find((pkg) => pkg.name === "local-scanned-runtime-plugin")?.ownerPublisherId,
    ).not.toBe(legacyPublisherId);
  });

  it("adopts a legacy @local publisher instead of creating a conflicting seed user", async () => {
    const { db, tables } = createDb();
    const legacyUserId = (await db.insert("users", {
      handle: "Local Owner",
      displayName: "Local Owner",
      name: "Local Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const legacyPublisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "local",
      displayName: "Local Owner",
      linkedUserId: legacyUserId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;
    await db.patch(legacyUserId, { personalPublisherId: legacyPublisherId });
    await db.insert("publisherMembers", {
      publisherId: legacyPublisherId,
      userId: legacyUserId,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    });

    await seedLocalModerationFixturesHandler(
      createMutationCtx(db) as never,
      {
        flaggedSkillStorageId: "storage:skill",
        flaggedSkillMd: "# Flagged skill",
        scannedSkillStorageId: "storage:scanned-skill",
        scannedSkillMd: "# Scanned skill",
        flaggedPluginStorageId: "storage:plugin",
        flaggedPluginReadme: "# Flagged plugin",
        scannedPluginStorageId: "storage:scanned-plugin",
        scannedPluginReadme: "# Scanned plugin",
      } as never,
    );

    expect(tables.users).toHaveLength(1);
    expect(tables.users?.[0]).toEqual(
      expect.objectContaining({
        _id: legacyUserId,
        handle: "local",
        role: "admin",
        personalPublisherId: legacyPublisherId,
      }),
    );
    expect(tables.publishers?.filter((publisher) => publisher.handle === "local")).toHaveLength(1);
  });

  it("resets core skill fixtures without stale badges or embedding maps", async () => {
    const { db, tables } = createDb();

    await seedSkillMutationHandler(
      createMutationCtx(db) as never,
      seedSkillArgs("storage:first") as never,
    );
    await seedSkillMutationHandler(
      createMutationCtx(db) as never,
      { ...seedSkillArgs("storage:second"), reset: true } as never,
    );

    expect(tables.skills).toHaveLength(1);
    expect(tables.skillVersions).toHaveLength(1);
    expect(tables.skillEmbeddings).toHaveLength(1);
    expect(tables.embeddingSkillMap).toHaveLength(1);
    expect(tables.skillBadges).toHaveLength(1);
    expect(tables.skills?.[0]?.latestVersionSummary).toBeUndefined();
    expect(tables.skillVersions?.[0]).toEqual(
      expect.objectContaining({
        parsed: expect.objectContaining({
          clawdis: expect.objectContaining({
            os: ["linux"],
            nix: expect.objectContaining({ systems: ["x86_64-linux"] }),
          }),
        }),
      }),
    );
  });

  it("resets featured plugin fixtures without stale package badges", async () => {
    const { db, tables, operations } = createDb();
    const args = {
      packages: [
        {
          name: "@local/catalog-plugin",
          displayName: "Catalog Plugin",
          summary: "Seeded catalog plugin.",
          version: "1.0.0",
          runtimeId: "catalog-plugin",
          sourceRepo: "openclaw/catalog-plugin",
          isOfficial: false,
          capabilityTags: ["catalog"],
          stats: { downloads: 1, installs: 1, stars: 1, versions: 1 },
          storageId: "storage:plugin",
          readmeSize: 16,
        },
      ],
    };

    await seedFeaturedPluginPackagesHandler(createMutationCtx(db) as never, args as never);
    const oldPackageId = tables.packages?.[0]?._id;
    const oldReleaseId = tables.packageReleases?.[0]?._id;
    await seedFeaturedPluginPackagesHandler(
      createMutationCtx(db) as never,
      { ...args, reset: true } as never,
    );

    expect(tables.packages).toHaveLength(1);
    expect(tables.packageReleases).toHaveLength(1);
    expect(tables.packageBadges).toHaveLength(1);
    const oldPackageDeleteIndex = operations.findIndex(
      (op) => op.table === "packages" && op.id === oldPackageId,
    );
    const oldReleaseDeleteIndex = operations.findIndex(
      (op) => op.table === "packageReleases" && op.id === oldReleaseId,
    );
    expect(oldPackageDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(oldReleaseDeleteIndex).toBeGreaterThan(oldPackageDeleteIndex);
  });
});
