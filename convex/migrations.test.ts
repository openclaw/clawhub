/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { computeRecommendationScore } from "./lib/recommendationScore";
import {
  backfillOneSkillInstallEstimate,
  runCatalogClassificationApply,
  runCatalogTaxonomyPrerequisites,
  runSkillInstallBackfill,
} from "./migrations";

type WrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean }) => Promise<unknown>;
};

type ClassificationApplyWrappedHandler = {
  _handler: (
    ctx: unknown,
    args: { dryRun?: boolean; minimumConfidence: "high" | "medium"; confirm?: string },
  ) => Promise<unknown>;
};

type InstallBackfillWrappedHandler = {
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

describe("catalog taxonomy migrations", () => {
  it("dry-runs both tracked digest migrations", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runCatalogTaxonomyPrerequisites as unknown as WrappedHandler)._handler;

    await handler({ runMutation }, { dryRun: true });

    expect(runMutation).toHaveBeenNthCalledWith(1, internal.migrations.run, {
      fn: "migrations:rebuildCatalogTaxonomyPackageDigests",
      dryRun: true,
      reset: true,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, internal.migrations.run, {
      fn: "migrations:rebuildCatalogTaxonomySkillDigests",
      dryRun: true,
      reset: true,
    });
  });

  it("dry-runs the selected classification apply migration", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runCatalogClassificationApply as unknown as ClassificationApplyWrappedHandler)
      ._handler;

    await handler({ runMutation }, { minimumConfidence: "medium" });

    expect(runMutation).toHaveBeenCalledWith(internal.migrations.run, {
      fn: "migrations:applyMediumConfidenceCatalogClassifications",
      dryRun: true,
      reset: true,
    });
  });

  it("requires an explicit confidence-specific confirmation before applying", async () => {
    const handler = (runCatalogClassificationApply as unknown as ClassificationApplyWrappedHandler)
      ._handler;

    await expect(
      handler({ runMutation: vi.fn() }, { dryRun: false, minimumConfidence: "high" }),
    ).rejects.toThrow('Pass confirm="apply-high-confidence-catalog-classifications" to apply.');
  });

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
          cursorCreationTime: 50,
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
              eq: (field: string, value: unknown) => {
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
                      (doc) =>
                        doc._id === "skillStatUpdateCursors:1" && doc.key === filters.key,
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
    expect(isRecord(skill?.installBackfill) ? skill.installBackfill.pendingSkillDocDownloads : 0).toBe(
      1,
    );
    expect(isRecord(skill?.installBackfill) ? skill.installBackfill.previousInstallsAllTime : 0).toBe(
      18,
    );
    expect(
      isRecord(skill?.installBackfill) ? skill.installBackfill.pendingSkillDocInstallsAllTime : 0,
    ).toBe(1);
    expect(
      isRecord(skill?.installBackfill) ? skill.installBackfill.targetInstallsAllTime : 0,
    ).toBe(Number(skill?.statsInstallsAllTime) + 1);
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
