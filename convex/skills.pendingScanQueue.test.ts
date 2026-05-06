import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { MODERATION_ENGINE_VERSION } from "./lib/moderationReasonCodes";
import {
  getActiveSkillBatchForStaticScanBackfillInternal,
  getPendingScanSkillsInternal,
  getTrentRescanCandidatesInternal,
  markVersionTrentUnscannableInternal,
} from "./skills";

type PendingScanResult = Array<{
  skillId: string;
  versionId: string | null;
  sha256hash: string | null;
  checkCount: number;
}>;

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getPendingScanSkillsHandler = (
  getPendingScanSkillsInternal as unknown as WrappedHandler<
    Record<string, unknown>,
    PendingScanResult
  >
)._handler;

const getStaticScanBackfillBatchHandler = (
  getActiveSkillBatchForStaticScanBackfillInternal as unknown as WrappedHandler<
    Record<string, unknown>,
    {
      skills: Array<{ skillId: string; versionId: string; slug: string }>;
      nextCursor: number;
      done: boolean;
    }
  >
)._handler;

const getTrentRescanCandidatesHandler = (
  getTrentRescanCandidatesInternal as unknown as WrappedHandler<
    { limit?: number; staleBefore?: number },
    string[]
  >
)._handler;

const markVersionTrentUnscannableHandler = (
  markVersionTrentUnscannableInternal as unknown as WrappedHandler<
    { versionId: string; checkedAt: number },
    void
  >
)._handler;

describe("skills.getPendingScanSkillsInternal", () => {
  it("includes unresolved VT records from the oldest slice and skips finalized ones", async () => {
    const recentSkills = [
      makeSkill("skills:recent-clean", "skillVersions:recent-clean", "scanner.llm.clean"),
      makeSkill("skills:recent-malicious", "skillVersions:recent-malicious", "scanner.vt.pending"),
    ];
    const oldestSkills = [
      makeSkill("skills:old-pending", "skillVersions:old-pending", "scanner.vt.pending"),
      makeSkill("skills:old-stale", "skillVersions:old-stale", "scanner.llm.clean"),
      makeSkill("skills:old-no-hash", "skillVersions:old-no-hash", "scanner.vt.pending"),
    ];

    const versions = new Map<string, unknown>([
      [
        "skillVersions:recent-clean",
        {
          _id: "skillVersions:recent-clean",
          sha256hash: "a".repeat(64),
          vtAnalysis: { status: "clean" },
        },
      ],
      [
        "skillVersions:recent-malicious",
        {
          _id: "skillVersions:recent-malicious",
          sha256hash: "b".repeat(64),
          vtAnalysis: { status: "malicious" },
        },
      ],
      [
        "skillVersions:old-pending",
        {
          _id: "skillVersions:old-pending",
          sha256hash: "c".repeat(64),
          vtAnalysis: { status: "pending" },
        },
      ],
      [
        "skillVersions:old-stale",
        {
          _id: "skillVersions:old-stale",
          sha256hash: "d".repeat(64),
          vtAnalysis: { status: "stale" },
        },
      ],
      ["skillVersions:old-no-hash", { _id: "skillVersions:old-no-hash" }],
    ]);

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: (
              indexName: string,
              builder: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
            ) => {
              builder({ eq: () => ({}) });
              if (indexName === "by_active_updated") {
                return {
                  order: () => ({
                    take: async () => recentSkills,
                  }),
                };
              }
              if (indexName === "by_active_created") {
                return {
                  order: () => ({
                    take: async () => oldestSkills,
                  }),
                };
              }
              throw new Error(`unexpected index ${indexName}`);
            },
          };
        }),
        get: vi.fn(async (id: string) => versions.get(id) ?? null),
      },
    };

    const result = await getPendingScanSkillsHandler(ctx, {
      limit: 25,
      skipRecentMinutes: 0,
    });

    const ids = new Set(result.map((entry) => entry.skillId));
    expect(ids.has("skills:old-pending")).toBe(true);
    expect(ids.has("skills:old-stale")).toBe(true);
    expect(ids.has("skills:recent-clean")).toBe(false);
    expect(ids.has("skills:recent-malicious")).toBe(false);
    expect(ids.has("skills:old-no-hash")).toBe(false);
  });

  it("exhaustive mode ignores recent-check suppression for manual backfills", async () => {
    const now = Date.now();
    const allSkills = [
      makeSkill(
        "skills:recently-checked",
        "skillVersions:recently-checked",
        "scanner.vt.pending",
        now,
      ),
    ];
    const versions = new Map<string, unknown>([
      [
        "skillVersions:recently-checked",
        { _id: "skillVersions:recently-checked", sha256hash: "e".repeat(64) },
      ],
    ]);

    const withIndex = vi.fn(
      (
        indexName: string,
        builder: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        builder({ eq: () => ({}) });
        if (indexName !== "by_active_updated") throw new Error(`unexpected index ${indexName}`);
        return {
          collect: async () => allSkills,
        };
      },
    );

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`unexpected table ${table}`);
          return { withIndex };
        }),
        get: vi.fn(async (id: string) => versions.get(id) ?? null),
      },
    };

    const result = await getPendingScanSkillsHandler(ctx, {
      limit: 25,
      skipRecentMinutes: 60,
      exhaustive: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.skillId).toBe("skills:recently-checked");
  });

  it("does not clamp exhaustive mode to 100 records", async () => {
    const allSkills = Array.from({ length: 150 }, (_, i) =>
      makeSkill(`skills:bulk-${i}`, `skillVersions:bulk-${i}`, "scanner.vt.pending"),
    );
    const versions = new Map<string, unknown>(
      allSkills.map((skill) => {
        const versionId = skill.latestVersionId as string;
        return [
          versionId,
          { _id: versionId, sha256hash: `${versionId.slice(-8)}${"f".repeat(56)}` },
        ];
      }),
    );

    const withIndex = vi.fn(
      (
        indexName: string,
        builder: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        builder({ eq: () => ({}) });
        if (indexName !== "by_active_updated") throw new Error(`unexpected index ${indexName}`);
        return {
          collect: async () => allSkills,
        };
      },
    );

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`unexpected table ${table}`);
          return { withIndex };
        }),
        get: vi.fn(async (id: string) => versions.get(id) ?? null),
      },
    };

    const result = await getPendingScanSkillsHandler(ctx, {
      limit: 10000,
      exhaustive: true,
      skipRecentMinutes: 0,
    });

    expect(result).toHaveLength(150);
  });
});

describe("skills.getTrentRescanCandidatesInternal", () => {
  it("only schedules active scannable Trent rows and gates unknown verdicts by staleness", async () => {
    const versions = [
      { _id: "skillVersions:active-unscanned" },
      { _id: "skillVersions:soft-deleted", softDeletedAt: 10 },
      { _id: "skillVersions:unscannable", trentScanState: "unscannable" },
      { _id: "skillVersions:unknown-recent", trentVerdict: "unknown", trentCheckedAt: 900 },
      { _id: "skillVersions:unknown-stale", trentVerdict: "unknown", trentCheckedAt: 100 },
      { _id: "skillVersions:benign-stale", trentVerdict: "benign", trentCheckedAt: 50 },
    ];
    const ctx = { db: createTrentCandidateDb(versions) };

    const result = await getTrentRescanCandidatesHandler(ctx, {
      limit: 10,
      staleBefore: 500,
    });

    expect(result).toEqual([
      "skillVersions:active-unscanned",
      "skillVersions:unknown-stale",
      "skillVersions:benign-stale",
    ]);
  });
});

describe("skills.markVersionTrentUnscannableInternal", () => {
  it("marks active unhashable versions with a terminal Trent scan state", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        get: vi.fn(async () => ({ _id: "skillVersions:missing-files" })),
        patch: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
          patches.push(patch);
        }),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(() => null),
        system: { get: vi.fn(), query: vi.fn() },
      },
    };

    await markVersionTrentUnscannableHandler(ctx, {
      versionId: "skillVersions:missing-files",
      checkedAt: 123,
    });

    expect(patches).toEqual([
      {
        trentVerdict: "unknown",
        trentCheckedAt: 123,
        trentScanState: "unscannable",
      },
    ]);
  });

  it("does not mark soft-deleted versions", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => ({ _id: "skillVersions:hidden", softDeletedAt: 10 })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(() => null),
        system: { get: vi.fn(), query: vi.fn() },
      },
    };

    await markVersionTrentUnscannableHandler(ctx, {
      versionId: "skillVersions:hidden",
      checkedAt: 123,
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe("skills.getActiveSkillBatchForStaticScanBackfillInternal", () => {
  it("includes latest active skills with missing or stale static scan engine versions", async () => {
    const skills = [
      {
        _id: "skills:missing-static",
        _creationTime: 10,
        softDeletedAt: undefined,
        moderationStatus: "active",
        latestVersionId: "skillVersions:missing-static",
        slug: "missing-static",
      },
      {
        _id: "skills:stale-static",
        _creationTime: 20,
        softDeletedAt: undefined,
        moderationStatus: "active",
        latestVersionId: "skillVersions:stale-static",
        slug: "stale-static",
      },
      {
        _id: "skills:current-static",
        _creationTime: 30,
        softDeletedAt: undefined,
        moderationStatus: "active",
        latestVersionId: "skillVersions:current-static",
        slug: "current-static",
      },
      {
        _id: "skills:hidden-static",
        _creationTime: 40,
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        latestVersionId: "skillVersions:hidden-static",
        slug: "hidden-static",
      },
    ];

    const versions = new Map<string, unknown>([
      ["skillVersions:missing-static", { _id: "skillVersions:missing-static" }],
      [
        "skillVersions:stale-static",
        {
          _id: "skillVersions:stale-static",
          staticScan: { engineVersion: "v2.2.0" },
        },
      ],
      [
        "skillVersions:current-static",
        {
          _id: "skillVersions:current-static",
          staticScan: { engineVersion: MODERATION_ENGINE_VERSION },
        },
      ],
      [
        "skillVersions:hidden-static",
        {
          _id: "skillVersions:hidden-static",
          staticScan: { engineVersion: "v2.2.0" },
        },
      ],
    ]);

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: (
              indexName: string,
              builder: (q: { gt: (field: string, value: unknown) => unknown }) => unknown,
            ) => {
              builder({ gt: () => ({}) });
              if (indexName !== "by_creation_time") {
                throw new Error(`unexpected index ${indexName}`);
              }
              return {
                order: () => ({
                  take: async () => skills,
                }),
              };
            },
          };
        }),
        get: vi.fn(async (id: string) => versions.get(id) ?? null),
      },
    };

    const result = await getStaticScanBackfillBatchHandler(ctx, {
      batchSize: 10,
      cursor: 0,
    });

    expect(result.skills).toEqual([
      {
        skillId: "skills:missing-static",
        versionId: "skillVersions:missing-static",
        slug: "missing-static",
      },
      {
        skillId: "skills:stale-static",
        versionId: "skillVersions:stale-static",
        slug: "stale-static",
      },
    ]);
    expect(result.done).toBe(true);
  });
});

function makeSkill(
  id: string,
  versionId: string,
  moderationReason: string,
  scanLastCheckedAt?: number,
) {
  return {
    _id: id,
    moderationStatus: "active",
    moderationReason,
    latestVersionId: versionId,
    scanLastCheckedAt,
  };
}

function createTrentCandidateDb(versions: Array<Record<string, unknown>>) {
  return {
    query: vi.fn((table: string) => {
      if (table !== "skillVersions") throw new Error(`unexpected table ${table}`);
      return {
        withIndex: (
          indexName: string,
          builder: (q: {
            eq: (field: string, value: unknown) => unknown;
            lt: (field: string, value: number) => unknown;
          }) => unknown,
        ) => {
          const constraints: Record<string, unknown> = {};
          const lessThan: Record<string, number> = {};
          const query = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return query;
            },
            lt(field: string, value: number) {
              lessThan[field] = value;
              return query;
            },
          };
          builder(query);
          return {
            take: async (limit: number) =>
              versions
                .filter((version) => matchesTrentCandidate(version, constraints, lessThan))
                .slice(0, limit),
          };
        },
      };
    }),
  };
}

function matchesTrentCandidate(
  version: Record<string, unknown>,
  constraints: Record<string, unknown>,
  lessThan: Record<string, number>,
) {
  for (const [field, value] of Object.entries(constraints)) {
    if (version[field] !== value) return false;
  }
  for (const [field, value] of Object.entries(lessThan)) {
    if (typeof version[field] !== "number" || version[field] >= value) return false;
  }
  return true;
}
