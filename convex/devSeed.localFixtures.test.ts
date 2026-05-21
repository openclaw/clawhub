import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  currentUserSeedPackageName,
  currentUserSeedSkillSlug,
  seedFeaturedPluginPackagesMutation,
  seedLocalModerationFixturesHandler,
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
