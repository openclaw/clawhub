import { describe, expect, it } from "vitest";
import {
  seedFeaturedPluginPackagesMutation,
  seedRescanUxFixturesHandler,
  seedSkillMutation,
} from "./devSeed";
import { MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE } from "./model/rescans/policy";

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

describe("devSeed rescan UX fixtures", () => {
  it("seeds flagged local owner inventory and deterministic rescan counts idempotently", async () => {
    const { db, tables } = createDb();
    const args = {
      flaggedSkillStorageId: "storage:skill",
      flaggedSkillMd: "# Flagged skill",
      scannedSkillStorageId: "storage:scanned-skill",
      scannedSkillMd: "# Scanned skill",
      flaggedPluginStorageId: "storage:plugin",
      flaggedPluginReadme: "# Flagged plugin",
      scannedPluginStorageId: "storage:scanned-plugin",
      scannedPluginReadme: "# Scanned plugin",
    };

    await seedRescanUxFixturesHandler({ db } as never, args as never);
    await seedRescanUxFixturesHandler({ db } as never, args as never);
    await seedRescanUxFixturesHandler({ db } as never, { ...args, reset: true } as never);

    expect(tables.users).toHaveLength(1);
    expect(tables.users?.[0]).toEqual(
      expect.objectContaining({
        handle: "local",
        role: "admin",
        githubCreatedAt: Date.parse("2020-01-01T00:00:00.000Z"),
      }),
    );
    expect(tables.publishers).toHaveLength(1);
    expect(tables.skills).toHaveLength(2);
    expect(tables.skills?.find((skill) => skill.slug === "local-flagged-wallet-sync")).toEqual(
      expect.objectContaining({
        ownerUserId: tables.users?.[0]?._id,
        ownerPublisherId: tables.publishers?.[0]?._id,
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
      }),
    );
    expect(tables.skills?.find((skill) => skill.slug === "local-agentic-risk-demo")).toEqual(
      expect.objectContaining({
        ownerUserId: tables.users?.[0]?._id,
        ownerPublisherId: tables.publishers?.[0]?._id,
        moderationStatus: "active",
        moderationVerdict: "suspicious",
      }),
    );
    expect(tables.packages).toHaveLength(2);
    expect(tables.packages?.find((pkg) => pkg.name === "local-flagged-runtime-plugin")).toEqual(
      expect.objectContaining({
        ownerUserId: tables.users?.[0]?._id,
        ownerPublisherId: tables.publishers?.[0]?._id,
        scanStatus: "malicious",
      }),
    );
    expect(tables.packages?.find((pkg) => pkg.name === "local-scanned-runtime-plugin")).toEqual(
      expect.objectContaining({
        ownerUserId: tables.users?.[0]?._id,
        ownerPublisherId: tables.publishers?.[0]?._id,
        scanStatus: "suspicious",
      }),
    );

    const scannedPackage = tables.packages?.find(
      (pkg) => pkg.name === "local-scanned-runtime-plugin",
    );
    const scannedRelease = tables.packageReleases?.find(
      (release) => release.packageId === scannedPackage?._id,
    );
    expect(scannedRelease).toEqual(
      expect.objectContaining({
        sha256hash: "seeded-scanned-plugin-hash",
        vtAnalysis: expect.objectContaining({ status: "clean" }),
        llmAnalysis: expect.objectContaining({ status: "suspicious" }),
        staticScan: expect.objectContaining({ status: "suspicious" }),
      }),
    );

    const scannedSkill = tables.skills?.find((skill) => skill.slug === "local-agentic-risk-demo");
    const scannedSkillVersion = tables.skillVersions?.find(
      (version) => version.skillId === scannedSkill?._id,
    );
    expect(scannedSkillVersion).toEqual(
      expect.objectContaining({
        sha256hash: "seeded-agentic-risk-skill-hash",
        vtAnalysis: expect.objectContaining({ status: "clean" }),
        llmAnalysis: expect.objectContaining({
          status: "suspicious",
          riskSummary: expect.objectContaining({
            sensitive_data_protection: expect.objectContaining({ status: "concern" }),
          }),
          agenticRiskFindings: expect.arrayContaining([
            expect.objectContaining({
              categoryId: "ASI06",
              riskBucket: "sensitive_data_protection",
              status: "concern",
              evidence: expect.objectContaining({ path: "SKILL.md" }),
            }),
          ]),
        }),
        staticScan: expect.objectContaining({ status: "suspicious" }),
      }),
    );

    const skillRequests =
      tables.rescanRequests?.filter((request) => request.targetKind === "skill") ?? [];
    const pluginRequests =
      tables.rescanRequests?.filter((request) => request.targetKind === "plugin") ?? [];
    expect(skillRequests).toHaveLength(1);
    expect(pluginRequests).toHaveLength(MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE);
  });
});

describe("devSeed local catalog fixtures", () => {
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

  it("resets core skill fixtures without stale badges or embedding maps", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };

    await seedSkillMutationHandler(ctx as never, seedSkillArgs("storage:first") as never);
    await seedSkillMutationHandler(
      ctx as never,
      { ...seedSkillArgs("storage:second"), reset: true } as never,
    );

    expect(tables.skills).toHaveLength(1);
    expect(tables.skillVersions).toHaveLength(1);
    expect(tables.skillEmbeddings).toHaveLength(1);
    expect(tables.embeddingSkillMap).toHaveLength(1);
    expect(tables.skillBadges).toHaveLength(1);
    expect(tables.skillSearchDigest).toHaveLength(1);
    expect(tables.skills?.[0]?.latestVersionSummary).toBeUndefined();
    expect(tables.skillSearchDigest?.[0]?.latestVersionSummary).toBeUndefined();
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
    const ctx = { db, scheduler: { runAfter: async () => null } };
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

    await seedFeaturedPluginPackagesHandler(ctx as never, args as never);
    const oldPackageId = tables.packages?.[0]?._id;
    const oldReleaseId = tables.packageReleases?.[0]?._id;
    await seedFeaturedPluginPackagesHandler(ctx as never, { ...args, reset: true } as never);

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
