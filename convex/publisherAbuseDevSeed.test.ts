/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const publisherAbuseDevSeed = await import("./publisherAbuseDevSeed");

type Handler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type Wrapped<TArgs, TResult> = { _handler: Handler<TArgs, TResult> };

const clearSeedHandler = (
  publisherAbuseDevSeed.clearSeed as unknown as Wrapped<
    Record<string, never>,
    {
      runs: number;
      scores: number;
      nominations: number;
      events: number;
      signals: number;
      users: number;
      hasMore: boolean;
    }
  >
)._handler;

const seedHandler = (
  publisherAbuseDevSeed.seed as unknown as Wrapped<
    Record<string, never>,
    { runId: string; inserted: number }
  >
)._handler;

type TestDoc = Record<string, unknown> & { _id: string };

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: TestDoc, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb(seedTables: Record<string, TestDoc[]>) {
  const tables = Object.fromEntries(
    Object.entries(seedTables).map(([name, docs]) => [name, [...docs]]),
  );
  let insertCounter = 0;
  const queryCalls: Array<{
    table: string;
    indexName: string;
    constraints: Record<string, unknown>;
  }> = [];

  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  return {
    tables,
    queryCalls,
    db: {
      get: async (id: string) => {
        const table = id.split(":")[0] ?? "";
        return list(table).find((doc) => doc._id === id) ?? null;
      },
      insert: async (table: string, doc: Record<string, unknown>) => {
        const id = `${table}:inserted-${insertCounter}`;
        insertCounter += 1;
        list(table).push({ ...doc, _id: id });
        return id;
      },
      delete: async (id: string) => {
        const table = id.split(":")[0] ?? "";
        const rows = list(table);
        const index = rows.findIndex((doc) => doc._id === id);
        if (index !== -1) rows.splice(index, 1);
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const table = id.split(":")[0] ?? "";
        const doc = list(table).find((candidate) => candidate._id === id);
        if (doc) Object.assign(doc, patch);
      },
      query: (table: string) => ({
        withIndex: (indexName: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
          const constraints: Record<string, unknown> = {};
          build(chainEq(constraints));
          queryCalls.push({ table, indexName, constraints });
          const matched = () => list(table).filter((doc) => matches(doc, constraints));
          return {
            collect: async () => {
              throw new Error("clearSeed must not collect whole tables");
            },
            paginate: async () => {
              throw new Error("clearSeed must not use built-in pagination");
            },
            take: async (numItems: number) => {
              return matched().slice(0, numItems);
            },
          };
        },
      }),
    },
  };
}

describe("publisherAbuseDevSeed.clearSeed", () => {
  const previousDeployment = process.env.CONVEX_DEPLOYMENT;
  const previousDevAuthDeployment = process.env.DEV_AUTH_CONVEX_DEPLOYMENT;
  const previousDevAuthEnabled = process.env.DEV_AUTH_ENABLED;
  const previousDevImpersonation = process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;

  afterEach(() => {
    restoreEnv("CONVEX_DEPLOYMENT", previousDeployment);
    restoreEnv("DEV_AUTH_CONVEX_DEPLOYMENT", previousDevAuthDeployment);
    restoreEnv("DEV_AUTH_ENABLED", previousDevAuthEnabled);
    restoreEnv("CLAW_HUB_ENABLE_DEV_IMPERSONATION", previousDevImpersonation);
  });

  it("rejects production deployments before reading tables", async () => {
    process.env.CONVEX_DEPLOYMENT = "prod:wry-manatee-359";
    const query = vi.fn();

    await expect(clearSeedHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("honors the explicit fallback deployment when the primary marker is blank", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "prod:wry-manatee-359";
    process.env.DEV_AUTH_ENABLED = "1";
    const query = vi.fn();

    await expect(clearSeedHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("deletes demo rows through bounded indexed pages", async () => {
    process.env.CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, queryCalls, tables } = createDb({
      publisherAbuseScores: [
        {
          _id: "publisherAbuseScores:demo",
          ownerKey: "user:demo-01",
          handleSnapshot: "demo-abuse-pub-01",
          runId: "publisherAbuseScoreRuns:demo",
        },
        {
          _id: "publisherAbuseScores:real",
          ownerKey: "user:real",
          handleSnapshot: "real",
          runId: "publisherAbuseScoreRuns:real",
        },
      ],
      publisherAbuseReviewNominations: [
        {
          _id: "publisherAbuseReviewNominations:demo",
          ownerKey: "user:demo-01",
          handleSnapshot: "demo-abuse-pub-01",
          openedByRunId: "publisherAbuseScoreRuns:demo",
        },
        {
          _id: "publisherAbuseReviewNominations:real",
          ownerKey: "user:real",
          handleSnapshot: "real",
          openedByRunId: "publisherAbuseScoreRuns:real",
        },
      ],
      publisherAbuseScoreRuns: [
        { _id: "publisherAbuseScoreRuns:demo" },
        { _id: "publisherAbuseScoreRuns:real" },
      ],
      publisherAbuseReviewEvents: [
        {
          _id: "publisherAbuseReviewEvents:demo",
          ownerKey: "user:demo-01",
          nominationId: "publisherAbuseReviewNominations:demo",
        },
        {
          _id: "publisherAbuseReviewEvents:real",
          ownerKey: "user:real",
          nominationId: "publisherAbuseReviewNominations:real",
        },
      ],
      users: [
        { _id: "users:demo", handle: "demo-abuse-pub-01" },
        { _id: "users:real", handle: "real" },
      ],
    });

    await expect(clearSeedHandler({ db }, {})).resolves.toEqual({
      runs: 1,
      scores: 1,
      nominations: 1,
      events: 1,
      signals: 0,
      users: 1,
      hasMore: false,
    });

    expect(tables.publisherAbuseScores.map((doc) => doc._id)).toEqual([
      "publisherAbuseScores:real",
    ]);
    expect(tables.publisherAbuseReviewNominations.map((doc) => doc._id)).toEqual([
      "publisherAbuseReviewNominations:real",
    ]);
    expect(tables.publisherAbuseScoreRuns.map((doc) => doc._id)).toEqual([
      "publisherAbuseScoreRuns:real",
    ]);
    expect(tables.publisherAbuseReviewEvents.map((doc) => doc._id)).toEqual([
      "publisherAbuseReviewEvents:real",
    ]);
    expect(tables.users.map((doc) => doc._id)).toEqual(["users:real"]);
    expect(queryCalls).toContainEqual({
      table: "publisherAbuseScores",
      indexName: "by_owner_key_and_created_at",
      constraints: { ownerKey: "user:demo-01" },
    });
    expect(queryCalls).toContainEqual({
      table: "publisherAbuseReviewNominations",
      indexName: "by_owner_key_and_model_version",
      constraints: { ownerKey: "user:demo-01" },
    });
    expect(queryCalls).toContainEqual({
      table: "publisherAbuseReviewEvents",
      indexName: "by_owner_key_and_created_at",
      constraints: { ownerKey: "user:demo-01" },
    });
    expect(queryCalls).toContainEqual({
      table: "users",
      indexName: "handle",
      constraints: { handle: "demo-abuse-pub-01" },
    });
  });

  it("preserves the shared local abuse persona and personal publisher", async () => {
    process.env.CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, tables } = createDb({
      users: [{ _id: "users:local-abuse", handle: "local-abuse" }],
      publishers: [
        {
          _id: "publishers:local-abuse",
          kind: "user",
          handle: "local-abuse",
          linkedUserId: "users:local-abuse",
          publishedSkills: 3,
          publishedPackages: 1,
          totalInstalls: 10,
          totalDownloads: 20,
          totalStars: 2,
          skillTotalInstalls: 10,
          skillTotalDownloads: 20,
          skillTotalStars: 2,
        },
      ],
    });

    await clearSeedHandler({ db }, {});

    expect(tables.users).toEqual([
      expect.objectContaining({ _id: "users:local-abuse", handle: "local-abuse" }),
    ]);
    expect(tables.publishers).toEqual([
      expect.objectContaining({
        _id: "publishers:local-abuse",
        handle: "local-abuse",
        linkedUserId: "users:local-abuse",
      }),
    ]);
  });
});

describe("publisherAbuseDevSeed.seed", () => {
  const previousDeployment = process.env.CONVEX_DEPLOYMENT;
  const previousDevAuthDeployment = process.env.DEV_AUTH_CONVEX_DEPLOYMENT;

  afterEach(() => {
    restoreEnv("CONVEX_DEPLOYMENT", previousDeployment);
    restoreEnv("DEV_AUTH_CONVEX_DEPLOYMENT", previousDevAuthDeployment);
  });

  it("seeds a prod-scale nomination distribution across labels", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, tables } = createDb({});

    const result = await seedHandler({ db }, {});

    const nominations = tables.publisherAbuseReviewNominations ?? [];
    const pendingBan = nominations.filter(
      (doc) => doc.label === "potential_ban_candidate" && doc.status === "pending",
    );
    const pendingReview = nominations.filter(
      (doc) => doc.label === "review" && doc.status === "pending",
    );

    expect(pendingBan).toHaveLength(15);
    expect(pendingReview).toHaveLength(125);
    expect(result.inserted).toBe(nominations.length);
    // Every ban candidate links a demo user so the inspector ban action is
    // exercisable; review nominations do not create users.
    expect(tables.users ?? []).toHaveLength(16);
    expect(tables.skills?.some((doc) => doc.slug === "demo-temporal-download-burst")).toBe(true);
    expect(tables.skills?.some((doc) => doc.slug === "demo-temporal-install-ratio")).toBe(true);
    const burstSkill = tables.skills?.find((doc) => doc.slug === "demo-temporal-download-burst");
    const ratioSkill = tables.skills?.find((doc) => doc.slug === "demo-temporal-install-ratio");
    const burstRecentStats = (tables.skillDailyStats ?? [])
      .filter((doc) => doc.skillId === burstSkill?._id)
      .sort((left, right) => Number(left.day) - Number(right.day))
      .slice(-30);
    const ratioRecentStats = (tables.skillDailyStats ?? [])
      .filter((doc) => doc.skillId === ratioSkill?._id)
      .sort((left, right) => Number(left.day) - Number(right.day));

    expect(burstRecentStats.map((doc) => doc.downloads)).toHaveLength(30);
    expect(new Set(burstRecentStats.map((doc) => doc.downloads)).size).toBeGreaterThan(10);
    expect(burstRecentStats.reduce((sum, doc) => sum + Number(doc.downloads), 0)).toBe(16_200);
    expect(burstRecentStats.reduce((sum, doc) => sum + Number(doc.installs), 0)).toBe(8);
    expect(ratioRecentStats.reduce((sum, doc) => sum + Number(doc.downloads), 0)).toBe(2_400);
    expect(ratioRecentStats.reduce((sum, doc) => sum + Number(doc.installs), 0)).toBe(288);
    expect(tables.publisherAbuseSignals).toEqual([
      expect.objectContaining({
        signalType: "sustained_abnormal_download_days",
        skillSlug: "demo-temporal-download-burst",
        temporalBenchmark: expect.objectContaining({
          scope: "all_active_skills",
          sampleSize: 1000,
        }),
        sustainedDaysAboveThreshold: 14,
        sustainedWindowDays: 14,
        sustainedDailyDownloadThreshold: 61.142857142857146,
        sustainedExpectedDailyDownloads: 4,
        sustainedWindowDownloads: 14_269,
        sustainedWindowInstalls: 8,
      }),
      expect.objectContaining({
        signalType: "high_install_download_ratio",
        skillSlug: "demo-temporal-install-ratio",
      }),
    ]);
    expect(tables.publisherAbuseScoreRuns?.find((doc) => doc.temporalBenchmark)?.modelVersion).toBe(
      "publisher-abuse-temporal.v1",
    );
    expect(
      tables.publisherAbuseScores?.find((doc) => doc.ownerKey === "user:demo-temporal-cohort")
        ?.modelVersion,
    ).toBe("publisher-abuse-temporal.v1");
    expect(
      tables.publisherAbuseReviewNominations?.find((doc) => doc.handleSnapshot === "local-abuse")
        ?.modelVersion,
    ).toBe("publisher-abuse-temporal.v1");
    expect(tables.users?.some((doc) => doc.handle === "local-abuse")).toBe(true);
  });

  it("reuses the shared local abuse persona and personal publisher", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, tables } = createDb({
      users: [{ _id: "users:local-abuse", handle: "local-abuse", role: "user" }],
      publishers: [
        {
          _id: "publishers:local-abuse",
          kind: "user",
          handle: "local-abuse",
          linkedUserId: "users:local-abuse",
          publishedSkills: 3,
          publishedPackages: 1,
          totalInstalls: 10,
          totalDownloads: 20,
          totalStars: 2,
          skillTotalInstalls: 10,
          skillTotalDownloads: 20,
          skillTotalStars: 2,
        },
      ],
    });

    await seedHandler({ db }, {});

    expect(tables.users.filter((doc) => doc.handle === "local-abuse")).toHaveLength(1);
    expect(tables.publishers.filter((doc) => doc.handle === "local-abuse")).toHaveLength(1);
    expect(tables.publishers.find((doc) => doc.handle === "local-abuse")).toMatchObject({
      publishedSkills: 5,
      publishedPackages: 1,
      totalInstalls: 306,
      totalDownloads: 18_620,
      totalStars: 2,
      skillTotalInstalls: 306,
      skillTotalDownloads: 18_620,
      skillTotalStars: 2,
    });
    expect(
      tables.skills
        ?.filter((doc) => doc.slug?.toString().startsWith("demo-temporal-"))
        .every((doc) => doc.ownerPublisherId === "publishers:local-abuse"),
    ).toBe(true);
  });

  it("clears existing demo rows before inserting repeatable seed data", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, tables } = createDb({
      publisherAbuseScores: [
        {
          _id: "publisherAbuseScores:old-demo",
          ownerKey: "user:demo-01",
          handleSnapshot: "demo-abuse-pub-01",
          runId: "publisherAbuseScoreRuns:old-demo",
        },
      ],
      publisherAbuseReviewNominations: [
        {
          _id: "publisherAbuseReviewNominations:old-demo",
          ownerKey: "user:demo-01",
          handleSnapshot: "demo-abuse-pub-01",
          openedByRunId: "publisherAbuseScoreRuns:old-demo",
        },
      ],
      publisherAbuseScoreRuns: [{ _id: "publisherAbuseScoreRuns:old-demo" }],
      publisherAbuseReviewEvents: [
        {
          _id: "publisherAbuseReviewEvents:old-demo",
          ownerKey: "user:demo-01",
          nominationId: "publisherAbuseReviewNominations:old-demo",
        },
      ],
      skills: [
        {
          _id: "skills:old-temporal",
          slug: "demo-temporal-download-burst",
          moderationStatus: "active",
          statsDownloads: 0,
          statsStars: 0,
          statsInstallsCurrent: 0,
          statsInstallsAllTime: 0,
          stats: {
            downloads: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            stars: 0,
          },
        },
      ],
      skillDailyStats: [
        {
          _id: "skillDailyStats:old-temporal",
          skillId: "skills:old-temporal",
          day: 19_000,
        },
      ],
      publisherAbuseSignals: [
        {
          _id: "publisherAbuseSignals:old-temporal",
          signalType: "sustained_downloads_flat_installs",
          skillId: "skills:old-temporal",
        },
      ],
      users: [{ _id: "users:old-demo", handle: "demo-abuse-pub-01" }],
    });

    await seedHandler({ db }, {});

    expect(tables.publisherAbuseScores.map((doc) => doc._id)).not.toContain(
      "publisherAbuseScores:old-demo",
    );
    expect(tables.publisherAbuseReviewNominations.map((doc) => doc._id)).not.toContain(
      "publisherAbuseReviewNominations:old-demo",
    );
    expect(tables.publisherAbuseScoreRuns.map((doc) => doc._id)).not.toContain(
      "publisherAbuseScoreRuns:old-demo",
    );
    expect(tables.publisherAbuseReviewEvents.map((doc) => doc._id)).not.toContain(
      "publisherAbuseReviewEvents:old-demo",
    );
    expect(tables.skills.map((doc) => doc._id)).not.toContain("skills:old-temporal");
    expect(tables.skillDailyStats.map((doc) => doc._id)).not.toContain(
      "skillDailyStats:old-temporal",
    );
    expect(tables.publisherAbuseSignals.map((doc) => doc._id)).not.toContain(
      "publisherAbuseSignals:old-temporal",
    );
    expect(tables.users.map((doc) => doc._id)).not.toContain("users:old-demo");
    expect(tables.users.filter((doc) => doc.handle === "demo-abuse-pub-01")).toHaveLength(1);
    expect(tables.users).toHaveLength(16);
    expect(tables.publisherAbuseReviewNominations).toHaveLength(146);
    expect(tables.publisherAbuseSignals).toHaveLength(2);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
