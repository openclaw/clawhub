import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

vi.mock("./lib/publishers", async () => {
  const actual = await vi.importActual<typeof import("./lib/publishers")>("./lib/publishers");
  return {
    ...actual,
    requirePublisherRole: vi.fn(),
  };
});

const { requireUser } = await import("./lib/access");
const { requirePublisherRole } = await import("./lib/publishers");
const { cleanupDeletedSourceScansHandler, deleteForPublisherHandler } =
  await import("./githubSkillSources");
const { buildSkillInstallResolution } = await import("./lib/installResolver");

type Row = Record<string, unknown> & { _id: string };

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Row, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([table, rows]) => [table, [...rows]]),
  );
  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const db = {
    get: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const row = list(table).find((candidate) => candidate._id === id);
      if (!row) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    insert: async (table: string, doc: Record<string, unknown>) => {
      const id = `${table}:${list(table).length + 1}`;
      list(table).push({ _id: id, ...doc });
      return id;
    },
    delete: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    query: (table: string) => ({
      withIndex: (_indexName: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        const matched = () => list(table).filter((row) => matches(row, constraints));
        return {
          collect: async () => matched(),
          take: async (limit: number) => matched().slice(0, limit),
          unique: async () => matched()[0] ?? null,
        };
      },
    }),
  };

  return { db, tables };
}

describe("githubSkillSources.deleteForPublisherHandler", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "users:owner" } as never);
    vi.mocked(requirePublisherRole).mockResolvedValue(undefined as never);
  });

  it("deletes a source and removes only GitHub-backed skills from that source", async () => {
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:matt",
          repo: "mattpocock/skills",
          ownerPublisherId: "publishers:openclaw",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      githubSkillContents: [
        {
          _id: "githubSkillContents:one",
          skillId: "skills:github",
          githubSourceId: "githubSkillSources:matt",
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:matt",
          skillId: "skills:github",
          githubSourceId: "githubSkillSources:matt",
          contentHash: "hash-source-backed",
        },
        {
          _id: "githubSkillScans:other",
          skillId: "skills:other-source",
          githubSourceId: "githubSkillSources:other",
          contentHash: "hash-other-source",
        },
      ],
      skills: [
        {
          _id: "skills:github",
          slug: "source-backed",
          displayName: "Source Backed",
          installKind: "github",
          githubSourceId: "githubSkillSources:matt",
          githubPath: "skills/source-backed",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "hash-source-backed",
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          ownerUserId: "users:owner",
          ownerPublisherId: "publishers:openclaw",
          forkOf: undefined,
          tags: {},
          capabilityTags: undefined,
          badges: {},
          stats: {
            comments: 0,
            downloads: 0,
            installsAllTime: 0,
            installsCurrent: 0,
            stars: 0,
            versions: 0,
          },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 2,
          softDeletedAt: undefined,
        },
        {
          _id: "skills:direct",
          slug: "direct-upload",
          displayName: "Direct Upload",
          ownerPublisherId: "publishers:openclaw",
          softDeletedAt: undefined,
        },
        {
          _id: "skills:other-source",
          slug: "other-source",
          displayName: "Other Source",
          installKind: "github",
          githubSourceId: "githubSkillSources:other",
          githubPath: "skills/other-source",
          githubCurrentCommit: "b".repeat(40),
          githubCurrentContentHash: "hash-other-source",
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          ownerPublisherId: "publishers:openclaw",
          softDeletedAt: undefined,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      deleteForPublisherHandler({ db, scheduler } as never, {
        ownerPublisherId: "publishers:openclaw" as never,
        sourceId: "githubSkillSources:matt" as never,
        now: 123,
      }),
    ).resolves.toEqual({ ok: true, deletedSkills: 1 });

    expect(requirePublisherRole).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publisherId: "publishers:openclaw",
        userId: "users:owner",
        allowed: ["admin"],
      }),
    );
    expect(tables.githubSkillSources).toHaveLength(0);
    expect(tables.githubSkillContents).toHaveLength(0);
    expect(tables.githubSkillScans).toHaveLength(2);
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      sourceId: "githubSkillSources:matt",
    });
    const deletedSkill = tables.skills.find((skill) => skill._id === "skills:github");
    expect(deletedSkill).toMatchObject({
      softDeletedAt: 123,
      githubRemovedAt: 123,
      githubCurrentStatus: "missing",
      updatedAt: 123,
    });
    expect(tables.skillSearchDigest).toEqual([
      expect.objectContaining({
        skillId: "skills:github",
        githubCurrentStatus: "missing",
        githubScanStatus: "clean",
        softDeletedAt: 123,
      }),
    ]);
    expect(
      buildSkillInstallResolution({
        origin: "https://clawhub.ai",
        skill: deletedSkill as never,
        source: null,
      }),
    ).toMatchObject({
      ok: false,
      reason: "github_upstream_removed",
      status: 410,
    });
    expect(tables.skills.find((skill) => skill._id === "skills:direct")).toMatchObject({
      softDeletedAt: undefined,
    });
    expect(tables.skills.find((skill) => skill._id === "skills:other-source")).toMatchObject({
      githubCurrentStatus: "present",
      softDeletedAt: undefined,
    });
  });

  it("cleans deleted-source scan history in bounded batches", async () => {
    const { db, tables } = createDb({
      githubSkillScans: [
        {
          _id: "githubSkillScans:matt",
          githubSourceId: "githubSkillSources:matt",
          skillScanRequestId: "skillScanRequests:matt",
        },
        {
          _id: "githubSkillScans:other",
          githubSourceId: "githubSkillSources:other",
        },
      ],
      securityScanJobs: [
        {
          _id: "securityScanJobs:matt",
          targetKind: "skillScanRequest",
          status: "queued",
        },
      ],
      skillScanRequests: [
        {
          _id: "skillScanRequests:matt",
          sourceKind: "github",
          status: "queued",
          securityScanJobId: "securityScanJobs:matt",
          githubSkillScanId: "githubSkillScans:matt",
          expiresAt: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      cleanupDeletedSourceScansHandler({ db, scheduler } as never, {
        sourceId: "githubSkillSources:matt" as never,
      }),
    ).resolves.toEqual({ ok: true, deleted: 1, done: true });

    expect(tables.githubSkillScans).toEqual([
      expect.objectContaining({ _id: "githubSkillScans:other" }),
    ]);
    expect(tables.securityScanJobs).toEqual([]);
    expect(tables.skillScanRequests).toEqual([
      expect.objectContaining({
        _id: "skillScanRequests:matt",
        status: "failed",
      }),
    ]);
    expect(tables.skillScanRequests?.[0]).not.toHaveProperty("githubSkillScanId");
    expect(tables.skillScanRequests?.[0]).not.toHaveProperty("securityScanJobId");
    expect(tables.skillScanRequests?.[0]?.expiresAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), { batchSize: 10 });
  });

  it("rejects deleting a source from another publisher", async () => {
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:matt",
          repo: "mattpocock/skills",
          ownerPublisherId: "publishers:other",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      deleteForPublisherHandler({ db } as never, {
        ownerPublisherId: "publishers:openclaw" as never,
        sourceId: "githubSkillSources:matt" as never,
        now: 123,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});
