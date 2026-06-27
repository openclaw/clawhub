import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  backfillExistingPublicCorpusBatchRows,
  currentUserSeedPackageName,
  currentUserSeedSkillSlug,
  seedFeaturedPluginPackagesMutation,
  seedGitHubBackedSkillSourceMutation,
  seedLocalFixtures,
  seedLocalModerationFixturesHandler,
  seedLocalPublisherSwitcherContentMutation,
  seedPublicCorpusBatch,
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
const seedLocalPublisherSwitcherContentHandler = (
  seedLocalPublisherSwitcherContentMutation as unknown as WrappedHandler<{ reset?: boolean }>
)._handler;
const seedPublicCorpusBatchActionHandler = (
  seedPublicCorpusBatch as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const seedPublicCorpusBatchHandler = (
  seedPublicCorpusBatchMutation as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const backfillExistingPublicCorpusBatchRowsHandler = (
  backfillExistingPublicCorpusBatchRows as unknown as WrappedHandler<Record<string, unknown>>
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

    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[0]?.args).toMatchObject({
      reset: true,
    });
    expect(mutationCalls[1]?.args).toMatchObject({
      reset: true,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        results: [
          expect.objectContaining({ slug: "local-moderation-fixtures" }),
          expect.objectContaining({ slug: "local-publisher-switcher-content" }),
        ],
      }),
    );
  });

  it("seeds switcher content for the local official member and org publishers", async () => {
    const { db, tables } = createDb();

    await seedLocalPublisherSwitcherContentHandler(createMutationCtx(db) as never, {
      reset: true,
    });

    const memberUser = tables.users?.find((user) => user.handle === "local-official-member");
    const memberPublisher = tables.publishers?.find(
      (publisher) => publisher.handle === "local-official-member",
    );
    const orgPublisher = tables.publishers?.find(
      (publisher) => publisher.handle === "local-official-org",
    );

    expect(memberUser).toEqual(
      expect.objectContaining({
        displayName: "Local Official Org Member",
        name: "Local Official Org Member",
      }),
    );
    expect(memberPublisher).toEqual(
      expect.objectContaining({
        kind: "user",
        linkedUserId: memberUser?._id,
      }),
    );
    expect(orgPublisher).toEqual(
      expect.objectContaining({
        kind: "org",
        displayName: "Local Official Org",
      }),
    );
    expect(tables.publisherMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publisherId: orgPublisher?._id,
          userId: memberUser?._id,
          role: "admin",
        }),
      ]),
    );
    expect(tables.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "member-inbox-triage",
          ownerPublisherId: memberPublisher?._id,
        }),
        expect.objectContaining({
          slug: "org-release-checklist",
          ownerPublisherId: orgPublisher?._id,
        }),
      ]),
    );
    expect(tables.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "member-sandbox-runner",
          ownerPublisherId: memberPublisher?._id,
        }),
        expect.objectContaining({
          name: "org-audit-reporter",
          ownerPublisherId: orgPublisher?._id,
        }),
      ]),
    );
    expect(tables.packageReleases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ packageId: expect.stringMatching(/^packages:/) }),
      ]),
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
    expect(
      (tables.skillDailyStats ?? []).reduce((sum, row) => sum + Number(row.downloads), 0),
    ).toBe(tables.skills?.[0]?.statsDownloads);
    expect((tables.skillDailyStats ?? []).reduce((sum, row) => sum + Number(row.installs), 0)).toBe(
      tables.skills?.[0]?.statsInstallsAllTime,
    );
  });

  it("backfills daily activity for existing public corpus skills", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const publisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;

    await db.insert("skills", {
      slug: "corpus-demo",
      displayName: "Corpus Demo",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      batch: "public-corpus-v1",
      tags: {},
      badges: {},
      statsDownloads: 143,
      statsStars: 7,
      statsInstallsCurrent: 18,
      statsInstallsAllTime: 23,
      stats: {
        downloads: 143,
        stars: 7,
        installsCurrent: 18,
        installsAllTime: 23,
        versions: 1,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await seedPublicCorpusBatchHandler(
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

    const rows = tables.skillDailyStats ?? [];
    expect(result).toEqual({ ok: true, seeded: [], skipped: ["skill:corpus-demo"] });
    expect(rows).toHaveLength(30);
    expect(rows.reduce((sum, row) => sum + Number(row.downloads), 0)).toBe(143);
    expect(rows.reduce((sum, row) => sum + Number(row.installs), 0)).toBe(23);
  });

  it("pre-skips existing public corpus rows before storage and embedding prep", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const publisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;

    await db.insert("skills", {
      slug: "corpus-demo",
      displayName: "Corpus Demo",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      batch: "public-corpus-v1",
      tags: {},
      badges: {},
      statsDownloads: 143,
      statsStars: 7,
      statsInstallsCurrent: 18,
      statsInstallsAllTime: 23,
      stats: {
        downloads: 143,
        stars: 7,
        installsCurrent: 18,
        installsAllTime: 23,
        versions: 1,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    await db.insert("packages", {
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      stats: { downloads: 57, installs: 13, stars: 2, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });

    const mutationCtx = createMutationCtx(db);
    const storageStore = async () => {
      throw new Error("existing public corpus rows should not store files");
    };
    const result = await seedPublicCorpusBatchActionHandler(
      {
        storage: { store: storageStore },
        runMutation: async (_ref: unknown, args: Record<string, unknown>) =>
          backfillExistingPublicCorpusBatchRowsHandler(mutationCtx as never, args),
      } as never,
      {
        rows: [
          {
            kind: "skill",
            slug: "corpus-demo",
            displayName: "Corpus Demo",
            version: "0.1.0",
            skillMd: "---\ndescription: Corpus demo\n---\n# Corpus demo",
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
          {
            kind: "plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "0.1.0",
            readme: "# Demo plugin",
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    expect(result).toEqual({
      ok: true,
      seeded: [],
      skipped: ["skill:corpus-demo", "plugin:demo-plugin"],
    });
    expect(tables.skillDailyStats).toHaveLength(30);
    expect((tables.packageDailyStats ?? []).length).toBeGreaterThan(0);
    expect(
      (tables.packageDailyStats ?? []).reduce((sum, row) => sum + Number(row.downloads), 0),
    ).toBe(57);
    expect(
      (tables.packageDailyStats ?? []).reduce((sum, row) => sum + Number(row.installs), 0),
    ).toBe(13);
  });

  it("seeds daily activity for new public corpus packages", async () => {
    const { db, tables } = createDb();

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "0.1.0",
            readme: "# Demo plugin",
            storageId: "storage:demo-plugin",
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    const pkg = tables.packages?.find((candidate) => candidate.name === "demo-plugin");
    const stats = pkg?.stats;
    const downloads =
      stats &&
      typeof stats === "object" &&
      "downloads" in stats &&
      typeof stats.downloads === "number"
        ? stats.downloads
        : null;
    const installs =
      stats &&
      typeof stats === "object" &&
      "installs" in stats &&
      typeof stats.installs === "number"
        ? stats.installs
        : null;
    expect(pkg).toBeTruthy();
    expect(downloads).not.toBeNull();
    expect(installs).not.toBeNull();
    expect((tables.packageDailyStats ?? []).length).toBeGreaterThan(0);
    expect(
      (tables.packageDailyStats ?? []).reduce((sum, row) => sum + Number(row.downloads), 0),
    ).toBe(downloads);
    expect(
      (tables.packageDailyStats ?? []).reduce((sum, row) => sum + Number(row.installs), 0),
    ).toBe(installs);
  });

  it("populates public corpus plugin catalog metadata, digests, and validation findings", async () => {
    const { db, tables } = createDb();

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "plugin",
            name: "gmail-agent-plugin",
            displayName: "Gmail Agent Plugin",
            version: "0.1.0",
            readme: "# Gmail Agent Plugin\n\nWatches Gmail and notifies an OpenClaw channel.",
            storageId: "storage:gmail-agent-plugin",
            categories: ["channels", "tools"],
            topics: ["Gmail", "Notifications"],
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    const pkg = tables.packages?.find((candidate) => candidate.name === "gmail-agent-plugin");
    const release = tables.packageReleases?.find((candidate) => candidate.packageId === pkg?._id);

    expect(pkg).toEqual(
      expect.objectContaining({
        categories: ["channels", "tools"],
        topics: ["Gmail", "Notifications"],
      }),
    );
    expect(tables.packageSearchDigest?.[0]).toEqual(
      expect.objectContaining({
        packageId: pkg?._id,
        categories: ["channels", "tools"],
        topics: ["Gmail", "Notifications"],
        pluginCategoryTags: ["channels", "tools"],
      }),
    );
    expect(
      tables.packagePluginCategorySearchDigest
        ?.map((row) => String(row.pluginCategory))
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(["channels", "tools"]);
    expect(
      tables.packageTopicSearchDigest
        ?.map((row) => String(row.topic))
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(["gmail", "notifications"]);
    expect(tables.packageInspectorWarnings).toEqual([
      expect.objectContaining({
        packageId: pkg?._id,
        releaseId: release?._id,
        packageName: "gmail-agent-plugin",
        version: "0.1.0",
        findingKind: "warning",
        code: "package-min-host-version-drift",
        authorRemediation: expect.objectContaining({
          docsUrl:
            "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-min-host-version-drift",
        }),
      }),
    ]);
  });

  it("backfills catalog metadata and validation findings for existing public corpus packages", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const publisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "corpus-owner",
      displayName: "Corpus Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;
    const packageId = (await db.insert("packages", {
      name: "gmail-agent-plugin",
      normalizedName: "gmail-agent-plugin",
      displayName: "Gmail Agent Plugin",
      summary: "Existing public corpus plugin fixture.",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      runtimeId: "gmail-agent-plugin",
      latestReleaseId: undefined,
      latestVersionSummary: undefined,
      tags: {},
      compatibility: { pluginApiRange: ">=0.1.0" },
      verification: {
        tier: "structural",
        scope: "artifact-only",
        summary: "Seeded from the public corpus fixture.",
        scanStatus: "clean",
      },
      scanStatus: "clean",
      stats: { downloads: 57, installs: 13, stars: 2, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"packages">;
    const releaseId = (await db.insert("packageReleases", {
      packageId,
      version: "0.1.0",
      changelog: "Existing public corpus fixture.",
      distTags: ["latest"],
      files: [],
      integritySha256: "existing-integrity",
      compatibility: { pluginApiRange: ">=0.1.0" },
      verification: {
        tier: "structural",
        scope: "artifact-only",
        summary: "Seeded from the public corpus fixture.",
        scanStatus: "clean",
      },
      createdBy: userId,
      publishActor: { kind: "user", userId },
      createdAt: 1,
    })) as Id<"packageReleases">;
    await db.patch(packageId, {
      latestReleaseId: releaseId,
      latestVersionSummary: {
        version: "0.1.0",
        createdAt: 1,
        changelog: "Existing public corpus fixture.",
        compatibility: { pluginApiRange: ">=0.1.0" },
        verification: {
          tier: "structural",
          scope: "artifact-only",
          summary: "Seeded from the public corpus fixture.",
          scanStatus: "clean",
        },
      },
    });

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "plugin",
            name: "gmail-agent-plugin",
            displayName: "Gmail Agent Plugin",
            version: "0.1.0",
            readme: "# Gmail Agent Plugin\n\nWatches Gmail and notifies an OpenClaw channel.",
            storageId: "storage:gmail-agent-plugin",
            categories: ["channels", "tools"],
            topics: ["Gmail", "Notifications"],
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    expect(tables.packages?.[0]).toEqual(
      expect.objectContaining({
        categories: ["channels", "tools"],
        topics: ["Gmail", "Notifications"],
      }),
    );
    expect(tables.packageSearchDigest?.[0]).toEqual(
      expect.objectContaining({
        packageId,
        pluginCategoryTags: ["channels", "tools"],
      }),
    );
    expect(tables.packageInspectorWarnings).toHaveLength(1);
  });

  it("does not backfill catalog metadata onto non-corpus package name collisions", async () => {
    const { db, tables } = createDb();
    const userId = (await db.insert("users", {
      handle: "real-owner",
      displayName: "Real Owner",
      role: "user",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"users">;
    const publisherId = (await db.insert("publishers", {
      kind: "user",
      handle: "real-owner",
      displayName: "Real Owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"publishers">;
    const packageId = (await db.insert("packages", {
      name: "gmail-agent-plugin",
      normalizedName: "gmail-agent-plugin",
      displayName: "Gmail Agent Plugin",
      summary: "A real package that happens to collide with the corpus fixture.",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      runtimeId: "gmail-agent-plugin",
      latestReleaseId: undefined,
      latestVersionSummary: undefined,
      tags: {},
      categories: ["models"],
      topics: ["Original Topic"],
      compatibility: { pluginApiRange: ">=0.1.0" },
      verification: {
        tier: "structural",
        scope: "artifact-only",
        summary: "Real package verification.",
        scanStatus: "clean",
      },
      scanStatus: "clean",
      stats: { downloads: 57, installs: 13, stars: 2, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"packages">;
    const releaseId = (await db.insert("packageReleases", {
      packageId,
      version: "0.1.0",
      changelog: "Real package release.",
      distTags: ["latest"],
      files: [],
      integritySha256: "existing-integrity",
      compatibility: { pluginApiRange: ">=0.1.0" },
      verification: {
        tier: "structural",
        scope: "artifact-only",
        summary: "Real package verification.",
        scanStatus: "clean",
      },
      createdBy: userId,
      publishActor: { kind: "user", userId },
      createdAt: 1,
    })) as Id<"packageReleases">;
    await db.patch(packageId, {
      latestReleaseId: releaseId,
      latestVersionSummary: {
        version: "0.1.0",
        createdAt: 1,
        changelog: "Real package release.",
        compatibility: { pluginApiRange: ">=0.1.0" },
        verification: {
          tier: "structural",
          scope: "artifact-only",
          summary: "Real package verification.",
          scanStatus: "clean",
        },
      },
    });

    await backfillExistingPublicCorpusBatchRowsHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "plugin",
            name: "gmail-agent-plugin",
            displayName: "Gmail Agent Plugin",
            version: "0.1.0",
            readme: "# Gmail Agent Plugin\n\nWatches Gmail and notifies an OpenClaw channel.",
            storageId: "storage:gmail-agent-plugin",
            categories: ["channels", "tools"],
            topics: ["Gmail", "Notifications"],
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    expect(tables.packages?.[0]).toEqual(
      expect.objectContaining({
        categories: ["models"],
        topics: ["Original Topic"],
      }),
    );
    expect(tables.packageSearchDigest).toBeUndefined();
    expect(tables.packageDailyStats).toBeUndefined();
    expect(tables.packageInspectorWarnings).toBeUndefined();
  });

  it("caps inferred public corpus plugin categories at the catalog limit", async () => {
    const { db, tables } = createDb();

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      {
        rows: [
          {
            kind: "plugin",
            name: "context-security-openclaw-email-guard-plugin",
            displayName: "Context Security Email Guard Plugin",
            version: "0.1.0",
            readme:
              "# Context Security Email Guard Plugin\n\nA runtime plugin for Gmail, model providers, memory, context, web search, GitHub tools, gateway operations, and OAuth policy checks.",
            storageId: "storage:context-security-openclaw-email-guard-plugin",
            dummyOwner: {
              handle: "corpus-owner",
              displayName: "Corpus Owner",
              image: "https://example.invalid/avatar.png",
            },
          },
        ],
      } as never,
    );

    const pkg = tables.packages?.find(
      (candidate) => candidate.name === "context-security-openclaw-email-guard-plugin",
    );
    const categories = Array.isArray(pkg?.categories) ? pkg.categories : [];

    expect(categories.length).toBeLessThanOrEqual(3);
    expect(categories.length).toBeGreaterThan(0);
  });

  it("removes public corpus daily activity rows during reset", async () => {
    const { db, tables } = createDb();
    await db.insert("globalStats", {
      key: "default",
      activeSkillsCount: 0,
      activePluginsCount: 0,
      updatedAt: 1,
    });
    const rows = [
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
      {
        kind: "plugin",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        version: "0.1.0",
        readme: "# Demo plugin",
        storageId: "storage:demo-plugin",
        dummyOwner: {
          handle: "corpus-owner",
          displayName: "Corpus Owner",
          image: "https://example.invalid/avatar.png",
        },
      },
    ];

    await seedPublicCorpusBatchHandler(createMutationCtx(db) as never, { rows } as never);
    const firstSkillId = tables.skills?.[0]?._id;
    const firstPackageId = tables.packages?.[0]?._id;
    const firstSkillDailyRows = tables.skillDailyStats?.length ?? 0;
    const firstPackageDailyRows = tables.packageDailyStats?.length ?? 0;
    const firstPackageDigestRows = tables.packageSearchDigest?.length ?? 0;
    const firstPackageCategoryDigestRows = tables.packagePluginCategorySearchDigest?.length ?? 0;
    const firstPackageTopicDigestRows = tables.packageTopicSearchDigest?.length ?? 0;
    const firstPackageInspectorWarningRows = tables.packageInspectorWarnings?.length ?? 0;
    const firstActivePluginsCount = tables.globalStats?.[0]?.activePluginsCount;

    await seedPublicCorpusBatchHandler(
      createMutationCtx(db) as never,
      { reset: true, resetOwnerHandles: ["corpus-owner"], rows } as never,
    );

    expect(firstSkillDailyRows).toBeGreaterThan(0);
    expect(firstPackageDailyRows).toBeGreaterThan(0);
    expect(tables.skillDailyStats).toHaveLength(firstSkillDailyRows);
    expect(tables.packageDailyStats).toHaveLength(firstPackageDailyRows);
    expect(tables.skillDailyStats?.some((row) => row.skillId === firstSkillId)).toBe(false);
    expect(tables.packageDailyStats?.some((row) => row.packageId === firstPackageId)).toBe(false);
    expect(firstPackageDigestRows).toBeGreaterThan(0);
    expect(firstPackageCategoryDigestRows).toBeGreaterThan(0);
    expect(firstPackageTopicDigestRows).toBeGreaterThan(0);
    expect(firstPackageInspectorWarningRows).toBeGreaterThan(0);
    expect(tables.packageSearchDigest?.some((row) => row.packageId === firstPackageId)).toBe(false);
    expect(
      tables.packagePluginCategorySearchDigest?.some((row) => row.packageId === firstPackageId),
    ).toBe(false);
    expect(tables.packageTopicSearchDigest?.some((row) => row.packageId === firstPackageId)).toBe(
      false,
    );
    expect(tables.packageInspectorWarnings?.some((row) => row.packageId === firstPackageId)).toBe(
      false,
    );
    expect(firstActivePluginsCount).toBe(1);
    expect(tables.globalStats?.[0]?.activePluginsCount).toBe(1);
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
    expect(tables.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: scannedPluginName,
          icon: "https://cdn.simpleicons.org/github/111111",
          latestVersionSummary: expect.objectContaining({
            icon: "https://cdn.simpleicons.org/github/111111",
          }),
        }),
      ]),
    );
    expect(tables.packageReleases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageId: expect.stringMatching(/^packages:/),
          icon: "https://cdn.simpleicons.org/github/111111",
        }),
      ]),
    );
    const scannedPackageId = tables.packages?.find((pkg) => pkg.name === scannedPluginName)?._id;
    const scannedPackageDailyStats = (tables.packageDailyStats ?? []).filter(
      (row) => row.packageId === scannedPackageId,
    );
    expect(tables.packageDailyStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageId: scannedPackageId,
        }),
      ]),
    );
    expect(scannedPackageDailyStats.reduce((sum, row) => sum + Number(row.downloads), 0)).toBe(7);
    expect(tables.packageInspectorWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: scannedPluginName,
          findingKind: "warning",
          code: "legacy-before-agent-start",
        }),
        expect.objectContaining({
          packageName: scannedPluginName,
          findingKind: "error",
          code: "missing-expected-seam",
          scanSource: "nightly",
        }),
      ]),
    );
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
