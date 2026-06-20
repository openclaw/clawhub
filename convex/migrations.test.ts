/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { computeRecommendationScore } from "./lib/recommendationScore";
import { INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME } from "./lib/skillInstallBackfill";
import {
  backfillOneSkillInstallEstimate,
  buildCanonicalCatalogMetadataPatch,
  runCatalogMetadataCanonicalization,
  runPluginManifestSummaryBackfill,
  runPluginManifestSummaryBackfillPage,
  runSkillInstallBackfill,
} from "./migrations";

type InstallBackfillWrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean; confirm?: string }) => Promise<unknown>;
};

type PluginManifestSummaryBackfillWrappedHandler = {
  _handler: (
    ctx: unknown,
    args: { dryRun?: boolean; confirm?: string; maxPackages?: number },
  ) => Promise<unknown>;
};

type PluginManifestSummaryBackfillPageWrappedHandler = {
  _handler: (
    ctx: unknown,
    args: {
      family: "code-plugin" | "bundle-plugin";
      cursor?: string | null;
      limit?: number;
      dryRun?: boolean;
      confirm?: string;
    },
  ) => Promise<unknown>;
};

type CatalogMetadataCanonicalizationWrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean; confirm?: string }) => Promise<unknown>;
};

function testId<TableName extends TableNames>(
  tableName: TableName,
  value: `${TableName}:${string}`,
): Id<TableName> {
  if (!value.startsWith(`${tableName}:`)) {
    throw new Error(`Expected ${value} to be a ${tableName} id`);
  }
  return value as Id<TableName>;
}

const skillId = testId("skills", "skills:demo");
const ownerUserId = testId("users", "users:owner");
const publisherId = testId("publishers", "publishers:owner");
const digestId = testId("skillSearchDigest", "skillSearchDigest:demo");
const packageReleaseId = testId("packageReleases", "packageReleases:demo");

function makeSkillDoc(): Doc<"skills"> {
  return {
    _id: skillId,
    _creationTime: 1,
    slug: "demo-skill",
    displayName: "Demo Skill",
    summary: "Demo summary",
    ownerUserId,
    ownerPublisherId: publisherId,
    tags: {},
    statsDownloads: 180_000,
    statsStars: 2,
    statsInstallsCurrent: 4,
    statsInstallsAllTime: 17,
    stats: {
      downloads: 180_000,
      stars: 2,
      installsCurrent: 4,
      installsAllTime: 17,
      versions: 1,
      comments: 0,
    },
    createdAt: 10,
    updatedAt: 20,
  };
}

function makePublisherDoc(): Doc<"publishers"> {
  return {
    _id: publisherId,
    _creationTime: 2,
    kind: "user",
    handle: "owner",
    displayName: "Owner",
    linkedUserId: ownerUserId,
    publishedSkills: 1,
    publishedPackages: 0,
    totalInstalls: 17,
    totalDownloads: 180_000,
    totalStars: 2,
    skillTotalInstalls: 17,
    skillTotalDownloads: 180_000,
    skillTotalStars: 2,
    createdAt: 10,
    updatedAt: 20,
  };
}

function makeSkillSearchDigestDoc(): Doc<"skillSearchDigest"> {
  return {
    _id: digestId,
    _creationTime: 3,
    skillId,
    slug: "demo-skill",
    displayName: "Demo Skill",
    summary: "Demo summary",
    ownerUserId,
    ownerPublisherId: publisherId,
    ownerHandle: "owner",
    ownerKind: "user",
    ownerDisplayName: "Owner",
    tags: {},
    statsDownloads: 180_000,
    statsStars: 2,
    statsInstallsCurrent: 4,
    statsInstallsAllTime: 17,
    stats: {
      downloads: 180_000,
      stars: 2,
      installsCurrent: 4,
      installsAllTime: 17,
      versions: 1,
      comments: 0,
    },
    createdAt: 10,
    updatedAt: 20,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("catalog metadata canonicalization migration", () => {
  it("promotes current inferred categories and topics into canonical fields", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "skill",
        categories: undefined,
        topics: undefined,
        inferredCategories: ["development", "research"],
        inferredTopics: ["TypeScript", "Code Review"],
        currentSourceId: "skillVersions:v1",
        inferredSourceId: "skillVersions:v1",
        inferredCategoryConfidence: "high",
        inferredTopicConfidence: "high",
        inferredClassifierVersion: "taxonomy-prototype-v9",
        inferredTopicClassifierVersion: "topic-prototype-v1",
        inferredInputHash: "category-hash",
        inferredTopicInputHash: "topic-hash",
        inferredAt: 123,
      }),
    ).toEqual({
      categories: ["development", "research"],
      topics: ["TypeScript", "Code Review"],
      inferredCategories: undefined,
      inferredTopics: undefined,
      inferredCategoryConfidence: undefined,
      inferredTopicConfidence: undefined,
      inferredClassifierVersion: undefined,
      inferredTopicClassifierVersion: undefined,
      inferredInputHash: undefined,
      inferredTopicInputHash: undefined,
      inferredAt: undefined,
    });
  });

  it("preserves explicit publisher metadata while clearing inferred metadata", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "plugin",
        categories: ["tools"],
        topics: [],
        inferredCategories: ["models"],
        inferredTopics: ["TypeScript"],
        currentSourceId: "skillVersions:v1",
        inferredSourceId: "skillVersions:v1",
        inferredCategoryConfidence: "medium",
        inferredTopicConfidence: "high",
      }),
    ).toEqual({
      inferredCategories: undefined,
      inferredTopics: undefined,
      inferredCategoryConfidence: undefined,
      inferredTopicConfidence: undefined,
      inferredClassifierVersion: undefined,
      inferredTopicClassifierVersion: undefined,
      inferredInputHash: undefined,
      inferredTopicInputHash: undefined,
      inferredAt: undefined,
    });
  });

  it("does not promote stale inferred metadata", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "skill",
        categories: undefined,
        topics: undefined,
        inferredCategories: ["development"],
        inferredTopics: ["TypeScript"],
        currentSourceId: "skillVersions:v2",
        inferredSourceId: "skillVersions:v1",
        inferredClassifierVersion: "taxonomy-prototype-v9",
        inferredTopicClassifierVersion: "topic-prototype-v1",
      }),
    ).toEqual({
      inferredCategories: undefined,
      inferredTopics: undefined,
      inferredCategoryConfidence: undefined,
      inferredTopicConfidence: undefined,
      inferredClassifierVersion: undefined,
      inferredTopicClassifierVersion: undefined,
      inferredInputHash: undefined,
      inferredTopicInputHash: undefined,
      inferredAt: undefined,
    });
  });

  it("does not promote inferred categories for legacy skill-family package rows", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "none",
        categories: undefined,
        topics: undefined,
        inferredCategories: ["models"],
        inferredTopics: ["TypeScript"],
        currentSourceId: "packageReleases:v1",
        inferredSourceId: "packageReleases:v1",
        inferredCategoryConfidence: "high",
        inferredTopicConfidence: "high",
      }),
    ).toEqual({
      topics: ["TypeScript"],
      inferredCategories: undefined,
      inferredTopics: undefined,
      inferredCategoryConfidence: undefined,
      inferredTopicConfidence: undefined,
      inferredClassifierVersion: undefined,
      inferredTopicClassifierVersion: undefined,
      inferredInputHash: undefined,
      inferredTopicInputHash: undefined,
      inferredAt: undefined,
    });
  });

  it("does not promote inferred metadata after a publisher metadata save", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "skill",
        categories: undefined,
        topics: undefined,
        inferredCategories: ["development"],
        inferredTopics: ["TypeScript"],
        currentSourceId: "skillVersions:v1",
        inferredSourceId: "skillVersions:v1",
        inferredCategoryConfidence: "high",
        inferredTopicConfidence: "high",
        hasPublisherCatalogIntent: true,
      }),
    ).toEqual({
      inferredCategories: undefined,
      inferredTopics: undefined,
      inferredCategoryConfidence: undefined,
      inferredTopicConfidence: undefined,
      inferredClassifierVersion: undefined,
      inferredTopicClassifierVersion: undefined,
      inferredInputHash: undefined,
      inferredTopicInputHash: undefined,
      inferredAt: undefined,
    });
  });

  it("is a no-op when no inferred catalog state exists", () => {
    expect(
      buildCanonicalCatalogMetadataPatch({
        categoryKind: "skill",
        categories: ["development"],
        topics: ["Publisher Topic"],
        currentSourceId: "skillVersions:v1",
      }),
    ).toBeNull();
  });

  it("dry-runs both tracked canonicalization migrations", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (
      runCatalogMetadataCanonicalization as unknown as CatalogMetadataCanonicalizationWrappedHandler
    )._handler;

    const result = await handler({ runMutation }, {});

    expect(runMutation).toHaveBeenNthCalledWith(1, internal.migrations.run, {
      fn: "migrations:canonicalizeSkillCatalogMetadata",
      dryRun: true,
      reset: true,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, internal.migrations.run, {
      fn: "migrations:canonicalizePackageCatalogMetadata",
      dryRun: true,
      reset: true,
    });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      confirmRequired: "canonicalize-catalog-metadata",
    });
  });

  it("requires explicit confirmation before canonicalizing catalog metadata", async () => {
    const handler = (
      runCatalogMetadataCanonicalization as unknown as CatalogMetadataCanonicalizationWrappedHandler
    )._handler;

    await expect(handler({ runMutation: vi.fn() }, { dryRun: false })).rejects.toThrow(
      'Pass confirm="canonicalize-catalog-metadata" to apply.',
    );
  });
});

describe("skill install backfill migration", () => {
  it("dry-runs the install backfill migration through the tracked runner", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runSkillInstallBackfill as unknown as InstallBackfillWrappedHandler)._handler;

    const result = await handler({ runMutation }, {});

    expect(runMutation).toHaveBeenCalledWith(internal.migrations.run, {
      fn: "migrations:backfillSkillInstallEstimates",
      dryRun: true,
      reset: true,
    });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      confirmRequired: "apply-skill-install-backfill",
    });
  });

  it("requires an explicit confirmation before applying the install backfill", async () => {
    const handler = (runSkillInstallBackfill as unknown as InstallBackfillWrappedHandler)._handler;

    await expect(handler({ runMutation: vi.fn() }, { dryRun: false })).rejects.toThrow(
      'Pass confirm="apply-skill-install-backfill" to apply.',
    );
  });

  it("refuses install backfill before clean-window daily stats are caught up", async () => {
    const patch = vi.fn();
    const db = {
      patch,
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn(
          (
            indexName: string,
            queryBuilder: (q: {
              eq: (
                field: string,
                value: unknown,
              ) => {
                eq: (field: string, value: unknown) => unknown;
              };
            }) => unknown,
          ) => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
            };
            queryBuilder(builder);
            return {
              unique: vi.fn(async () => {
                if (tableName === "skillDailyStats" && indexName === "by_skill_day") {
                  return null;
                }
                if (tableName === "skillStatUpdateCursors" && indexName === "by_key") {
                  return {
                    _id: "skillStatUpdateCursors:1",
                    key: filters.key,
                    cursorCreationTime:
                      INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME - 1,
                  };
                }
                return null;
              }),
            };
          },
        ),
      })),
    };

    await expect(
      backfillOneSkillInstallEstimate(
        { db } as unknown as Pick<MutationCtx, "db">,
        makeSkillDoc(),
        INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME - 1,
      ),
    ).rejects.toThrow("requires skill stat daily aggregation through the clean window");
    expect(patch).not.toHaveBeenCalled();
  });

  it("allows install backfill after the clean window when stat events are exhausted", async () => {
    const docs = new Map<string, Record<string, unknown>>([
      [skillId, makeSkillDoc()],
      [publisherId, makePublisherDoc()],
      [digestId, makeSkillSearchDigestDoc()],
      [
        "skillDailyStats:1",
        {
          _id: "skillDailyStats:1",
          _creationTime: 4,
          skillId,
          day: 20616,
          downloads: 245,
          installs: 4,
          updatedAt: 100,
        },
      ],
      [
        "skillStatUpdateCursors:1",
        {
          _id: "skillStatUpdateCursors:1",
          _creationTime: 5,
          key: "skill_stat_events",
          cursorCreationTime: INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME - 1,
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      const existing = docs.get(id);
      if (!existing) throw new Error(`Missing test doc ${id}`);
      docs.set(id, { ...existing, ...value });
    });
    const db = {
      get: vi.fn(async (id: string) => docs.get(id) ?? null),
      patch,
      insert: vi.fn(async (tableName: string, value: Record<string, unknown>) => {
        const id = `${tableName}:inserted`;
        docs.set(id, { ...value, _id: id, _creationTime: 0 });
        return id;
      }),
      delete: vi.fn(async (id: string) => {
        docs.delete(id);
      }),
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn(
          (
            indexName: string,
            queryBuilder: (q: {
              eq: (
                field: string,
                value: unknown,
              ) => {
                eq: (field: string, value: unknown) => unknown;
              };
              gt: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
              gt: (field: string, value: unknown) => {
                filters[`${field}:gt`] = value;
                return builder;
              },
            };
            queryBuilder(builder);
            return {
              unique: vi.fn(async () => {
                if (tableName === "skillDailyStats" && indexName === "by_skill_day") {
                  return (
                    [...docs.values()].find(
                      (doc) =>
                        doc.skillId === filters.skillId &&
                        doc.day === filters.day &&
                        typeof doc.downloads === "number" &&
                        typeof doc.installs === "number",
                    ) ?? null
                  );
                }
                if (tableName === "skillSearchDigest" && indexName === "by_skill") {
                  return (
                    [...docs.values()].find(
                      (doc) => doc.skillId === filters.skillId && doc._id === digestId,
                    ) ?? null
                  );
                }
                if (tableName === "skillStatUpdateCursors" && indexName === "by_key") {
                  return (
                    [...docs.values()].find(
                      (doc) => doc._id === "skillStatUpdateCursors:1" && doc.key === filters.key,
                    ) ?? null
                  );
                }
                return null;
              }),
              collect: vi.fn(async () => []),
              take: vi.fn(async () => {
                if (tableName === "skillStatEvents" && indexName === "by_creation_time") {
                  return [];
                }
                if (tableName === "skillStatEvents" && indexName === "by_skill_processed") {
                  return [];
                }
                return [];
              }),
            };
          },
        ),
      })),
    };

    const changed = await backfillOneSkillInstallEstimate(
      { db } as unknown as Pick<MutationCtx, "db">,
      makeSkillDoc(),
      INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME,
    );

    expect(changed).toBe(true);
    expect(patch).toHaveBeenCalledWith(
      skillId,
      expect.objectContaining({ statsInstallsAllTime: expect.any(Number) }),
    );
  });

  it("backfills a skill and keeps publisher stats plus search digest in sync", async () => {
    const docs = new Map<string, Record<string, unknown>>([
      [skillId, makeSkillDoc()],
      [publisherId, makePublisherDoc()],
      [digestId, makeSkillSearchDigestDoc()],
      [
        "skillDailyStats:1",
        {
          _id: "skillDailyStats:1",
          _creationTime: 4,
          skillId,
          day: 20616,
          downloads: 245,
          installs: 4,
          updatedAt: 100,
        },
      ],
      [
        "skillStatUpdateCursors:1",
        {
          _id: "skillStatUpdateCursors:1",
          _creationTime: 5,
          key: "skill_stat_events",
          cursorCreationTime: INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME,
        },
      ],
      [
        "skillStatEvents:download",
        {
          _id: "skillStatEvents:download",
          _creationTime: 39,
          skillId,
          kind: "download",
          occurredAt: 800,
          processedAt: undefined,
        },
      ],
      [
        "skillStatEvents:1",
        {
          _id: "skillStatEvents:1",
          _creationTime: 40,
          skillId,
          kind: "install_new",
          occurredAt: 900,
          processedAt: undefined,
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      const existing = docs.get(id);
      if (!existing) throw new Error(`Missing test doc ${id}`);
      docs.set(id, { ...existing, ...value });
    });
    const db = {
      get: vi.fn(async (id: string) => docs.get(id) ?? null),
      patch,
      insert: vi.fn(async (tableName: string, value: Record<string, unknown>) => {
        const id = `${tableName}:inserted`;
        docs.set(id, { ...value, _id: id, _creationTime: 0 });
        return id;
      }),
      delete: vi.fn(async (id: string) => {
        docs.delete(id);
      }),
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn(
          (
            indexName: string,
            queryBuilder: (q: {
              eq: (
                field: string,
                value: unknown,
              ) => {
                eq: (field: string, value: unknown) => unknown;
              };
            }) => unknown,
          ) => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
            };
            queryBuilder(builder);
            return {
              unique: vi.fn(async () => {
                if (tableName === "skillDailyStats" && indexName === "by_skill_day") {
                  return (
                    [...docs.values()].find(
                      (doc) =>
                        doc.skillId === filters.skillId &&
                        doc.day === filters.day &&
                        typeof doc.downloads === "number" &&
                        typeof doc.installs === "number",
                    ) ?? null
                  );
                }
                if (tableName === "skillSearchDigest" && indexName === "by_skill") {
                  return (
                    [...docs.values()].find(
                      (doc) => doc.skillId === filters.skillId && doc._id === digestId,
                    ) ?? null
                  );
                }
                if (tableName === "skillStatUpdateCursors" && indexName === "by_key") {
                  return (
                    [...docs.values()].find(
                      (doc) => doc._id === "skillStatUpdateCursors:1" && doc.key === filters.key,
                    ) ?? null
                  );
                }
                return null;
              }),
              collect: vi.fn(async () => []),
              take: vi.fn(async () => {
                if (tableName === "skillStatEvents" && indexName === "by_skill_processed") {
                  return [...docs.values()].filter(
                    (doc) =>
                      doc.skillId === filters.skillId &&
                      doc.processedAt === filters.processedAt &&
                      String(doc._id).startsWith("skillStatEvents:"),
                  );
                }
                return [];
              }),
            };
          },
        ),
      })),
    };

    const changed = await backfillOneSkillInstallEstimate(
      { db } as unknown as Pick<MutationCtx, "db">,
      makeSkillDoc(),
      1_000,
    );

    expect(changed).toBe(true);
    const skill = docs.get(skillId);
    const publisher = docs.get(publisherId);
    const digest = docs.get(digestId);
    expect(skill?.statsInstallsAllTime).toBeGreaterThan(17);
    expect(isRecord(skill?.stats) ? skill.stats.installsAllTime : undefined).toBe(
      skill?.statsInstallsAllTime,
    );
    expect(publisher?.totalInstalls).toBe(skill?.statsInstallsAllTime);
    expect(publisher?.skillTotalInstalls).toBe(skill?.statsInstallsAllTime);
    expect(isRecord(skill?.installBackfill) ? skill.installBackfill.totalDownloads : 0).toBe(
      180_001,
    );
    expect(
      isRecord(skill?.installBackfill) ? skill.installBackfill.pendingSkillDocDownloads : 0,
    ).toBe(1);
    expect(
      isRecord(skill?.installBackfill) ? skill.installBackfill.previousInstallsAllTime : 0,
    ).toBe(18);
    expect(
      isRecord(skill?.installBackfill) ? skill.installBackfill.pendingSkillDocInstallsAllTime : 0,
    ).toBe(1);
    expect(isRecord(skill?.installBackfill) ? skill.installBackfill.targetInstallsAllTime : 0).toBe(
      Number(skill?.statsInstallsAllTime) + 1,
    );
    expect(digest).toEqual(
      expect.objectContaining({
        statsInstallsAllTime: skill?.statsInstallsAllTime,
        recommendedScore: computeRecommendationScore({
          downloads: 180_000,
          installs: Number(skill?.statsInstallsAllTime),
          stars: 2,
        }),
        stats: expect.objectContaining({
          installsAllTime: skill?.statsInstallsAllTime,
        }),
      }),
    );
  });
});

describe("plugin manifest summary backfill migration", () => {
  it("dry-runs latest active plugin release summary backfill by default", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: "",
    });
    const handler = (
      runPluginManifestSummaryBackfill as unknown as PluginManifestSummaryBackfillWrappedHandler
    )._handler;

    const result = await handler({ runQuery, runMutation: vi.fn(), storage: {} }, {});

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      family: "code-plugin",
      cursor: null,
      limit: 50,
    });
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      family: "bundle-plugin",
      cursor: null,
      limit: 50,
    });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      confirmRequired: "backfill-plugin-manifest-summaries",
      scannedPackages: 0,
      eligibleReleases: 0,
      changedReleases: 0,
      patchedReleases: 0,
    });
  });

  it("requires explicit confirmation before applying plugin manifest summary backfill", async () => {
    const handler = (
      runPluginManifestSummaryBackfill as unknown as PluginManifestSummaryBackfillWrappedHandler
    )._handler;

    await expect(
      handler({ runQuery: vi.fn(), runMutation: vi.fn(), storage: {} }, { dryRun: false }),
    ).rejects.toThrow('Pass confirm="backfill-plugin-manifest-summaries" to apply.');
  });

  it("applies one cursor page for a single plugin family", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce({
      page: [
        {
          packageName: "example-ai-plugin",
          displayName: "Example AI Plugin",
          release: {
            _id: packageReleaseId,
            version: "1.0.0",
            files: [],
            compatibility: { builtWithOpenClawVersion: "1.0.0" },
            extractedPluginManifest: {
              configSchema: {
                EXAMPLE_DATABASE_URL: {
                  type: "string",
                  required: true,
                  uiHints: { sensitive: true },
                },
              },
              mcpServers: {
                exampleMcp: {
                  command: "node",
                  args: ["server.js"],
                },
              },
            },
          },
        },
      ],
      isDone: false,
      continueCursor: "next-page",
    });
    const runMutation = vi.fn().mockResolvedValue(true);
    const handler = (
      runPluginManifestSummaryBackfillPage as unknown as PluginManifestSummaryBackfillPageWrappedHandler
    )._handler;

    const result = await handler(
      { runQuery, runMutation, storage: {} },
      {
        family: "bundle-plugin",
        cursor: "current-page",
        limit: 25,
        dryRun: false,
        confirm: "backfill-plugin-manifest-summaries",
      },
    );

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      family: "bundle-plugin",
      cursor: "current-page",
      limit: 25,
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      releaseId: packageReleaseId,
      pluginManifestSummary: expect.objectContaining({
        configFields: [
          {
            name: "EXAMPLE_DATABASE_URL",
            required: true,
            sensitive: true,
          },
        ],
        mcpServers: [{ name: "exampleMcp" }],
      }),
    });
    expect(JSON.stringify(runMutation.mock.calls[0]?.[1]?.pluginManifestSummary)).not.toContain(
      "server.js",
    );
    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      family: "bundle-plugin",
      continueCursor: "next-page",
      isDone: false,
      scannedPackages: 1,
      eligibleReleases: 1,
      changedReleases: 1,
      patchedReleases: 1,
      skillMarkdownReadErrors: 0,
    });
  });

  it("skips applying a degraded summary when skill markdown cannot be read", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        page: [
          {
            packageName: "example-ai-plugin",
            displayName: "Example AI Plugin",
            release: {
              _id: packageReleaseId,
              version: "1.0.0",
              files: [
                {
                  path: "skills/research/SKILL.md",
                  storageId: "storage:missing",
                  size: 128,
                  sha256: "a".repeat(64),
                },
              ],
              extractedPluginManifest: {
                skills: ["skills/research"],
              },
            },
          },
        ],
        isDone: true,
        continueCursor: "",
      })
      .mockResolvedValue({
        page: [],
        isDone: true,
        continueCursor: "",
      });
    const runMutation = vi.fn();
    const handler = (
      runPluginManifestSummaryBackfill as unknown as PluginManifestSummaryBackfillWrappedHandler
    )._handler;

    const result = await handler(
      {
        runQuery,
        runMutation,
        storage: { get: vi.fn(async () => null) },
      },
      { dryRun: false, confirm: "backfill-plugin-manifest-summaries" },
    );

    expect(runMutation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      eligibleReleases: 1,
      changedReleases: 0,
      patchedReleases: 0,
      skippedSkillMarkdownReadErrorReleases: 1,
      skillMarkdownReadErrors: 1,
    });
  });
});
