/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_generated/server", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

const managementDevSeed = await import("./managementDevSeed");

type Handler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type Wrapped<TArgs, TResult> = { _handler: Handler<TArgs, TResult> };
type TestDoc = Record<string, unknown> & { _id: string };

const seedManagementQueuesHandler = (
  managementDevSeed.seedManagementQueues as unknown as Wrapped<
    Record<string, never>,
    { reportsInserted: number; reportedSkills: number; duplicatePair: number }
  >
)._handler;

const clearManagementQueuesHandler = (
  managementDevSeed.clearManagementQueues as unknown as Wrapped<
    Record<string, never>,
    { reportsDeleted: number; fingerprintsDeleted: number }
  >
)._handler;

const DEMO_REPORT_MARKER = "managementDevSeed:report";
const DEMO_FINGERPRINT = "9f8c2a1b7e4d6c30a5b2f1d089c4e76b";

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
    Object.entries(seedTables).map(([name, docs]) => [name, docs.map((doc) => ({ ...doc }))]),
  );
  const queryCalls: Array<{
    table: string;
    indexName: string;
    constraints: Record<string, unknown>;
  }> = [];
  const inserts: Array<{ table: string; doc: TestDoc }> = [];
  let insertCounter = 0;

  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const takeRows = (table: string, numItems: number, constraints?: Record<string, unknown>) => {
    const rows = constraints ? list(table).filter((doc) => matches(doc, constraints)) : list(table);
    return rows.slice(0, numItems);
  };

  return {
    inserts,
    queryCalls,
    tables,
    db: {
      delete: async (id: string) => {
        const table = id.split(":")[0] ?? "";
        const rows = list(table);
        const index = rows.findIndex((doc) => doc._id === id);
        if (index !== -1) rows.splice(index, 1);
      },
      get: async (id: string) => {
        const table = id.split(":")[0] ?? "";
        return list(table).find((doc) => doc._id === id) ?? null;
      },
      insert: async (table: string, doc: Record<string, unknown>) => {
        const inserted = { ...doc, _id: `${table}:inserted-${insertCounter}` };
        insertCounter += 1;
        list(table).push(inserted);
        inserts.push({ table, doc: inserted });
        return inserted._id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const table = id.split(":")[0] ?? "";
        const row = list(table).find((doc) => doc._id === id);
        if (row) Object.assign(row, patch);
      },
      query: (table: string) => ({
        order: () => ({
          take: async (numItems: number) => takeRows(table, numItems),
        }),
        take: async (numItems: number) => takeRows(table, numItems),
        withIndex: (indexName: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
          const constraints: Record<string, unknown> = {};
          build(chainEq(constraints));
          queryCalls.push({ table, indexName, constraints });
          return {
            order: () => ({
              take: async (numItems: number) => takeRows(table, numItems, constraints),
            }),
            take: async (numItems: number) => takeRows(table, numItems, constraints),
          };
        },
      }),
    },
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("managementDevSeed", () => {
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

    await expect(seedManagementQueuesHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    await expect(clearManagementQueuesHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("honors the explicit fallback deployment when the primary marker is blank", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "prod:wry-manatee-359";
    process.env.DEV_AUTH_ENABLED = "1";
    const query = vi.fn();

    await expect(seedManagementQueuesHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    await expect(clearManagementQueuesHandler({ db: { query } }, {})).rejects.toThrow(
      "disabled outside local/dev deployments",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("seeds content report and duplicate candidate rows for local dashboards", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, inserts, tables } = createDb({
      users: [{ _id: "users:reporter", handle: "local-admin" }],
      skills: [
        { _id: "skills:one", latestVersionId: "skillVersions:one" },
        { _id: "skills:two", latestVersionId: "skillVersions:two" },
        { _id: "skills:three", latestVersionId: "skillVersions:three" },
        { _id: "skills:hidden", latestVersionId: "skillVersions:hidden", softDeletedAt: 1 },
      ],
      skillVersions: [
        { _id: "skillVersions:one" },
        { _id: "skillVersions:two" },
        { _id: "skillVersions:three" },
        { _id: "skillVersions:hidden" },
      ],
      skillReports: [],
      skillVersionFingerprints: [],
    });

    await expect(seedManagementQueuesHandler({ db }, {})).resolves.toEqual({
      reportsInserted: 6,
      reportedSkills: 3,
      duplicatePair: 2,
    });

    expect(tables.skillReports).toHaveLength(6);
    expect(tables.skillReports.every((report) => report.triageNote === DEMO_REPORT_MARKER)).toBe(
      true,
    );
    expect(tables.skills.find((skill) => skill._id === "skills:one")).toEqual(
      expect.objectContaining({ reportCount: 1 }),
    );
    expect(tables.skills.find((skill) => skill._id === "skills:two")).toEqual(
      expect.objectContaining({ reportCount: 2 }),
    );
    expect(tables.skills.find((skill) => skill._id === "skills:three")).toEqual(
      expect.objectContaining({ reportCount: 3 }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:one")).toEqual(
      expect.objectContaining({ fingerprint: DEMO_FINGERPRINT }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:two")).toEqual(
      expect.objectContaining({ fingerprint: DEMO_FINGERPRINT }),
    );
    expect(inserts.filter((insert) => insert.table === "skillVersionFingerprints")).toHaveLength(2);
  });

  it("does not overwrite existing latest-version fingerprints", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, inserts, tables } = createDb({
      users: [{ _id: "users:reporter", handle: "local-admin" }],
      skills: [
        { _id: "skills:one", latestVersionId: "skillVersions:one" },
        { _id: "skills:two", latestVersionId: "skillVersions:two" },
        { _id: "skills:three", latestVersionId: "skillVersions:three" },
        { _id: "skills:four", latestVersionId: "skillVersions:four" },
      ],
      skillVersions: [
        { _id: "skillVersions:one", fingerprint: "real-fingerprint-one" },
        { _id: "skillVersions:two", fingerprint: "real-fingerprint-two" },
        { _id: "skillVersions:three" },
        { _id: "skillVersions:four" },
      ],
      skillReports: [],
      skillVersionFingerprints: [
        {
          _id: "skillVersionFingerprints:real-one",
          skillId: "skills:one",
          versionId: "skillVersions:one",
          fingerprint: "real-fingerprint-one",
        },
        {
          _id: "skillVersionFingerprints:real-two",
          skillId: "skills:two",
          versionId: "skillVersions:two",
          fingerprint: "real-fingerprint-two",
        },
      ],
    });

    await expect(seedManagementQueuesHandler({ db }, {})).resolves.toEqual({
      reportsInserted: 6,
      reportedSkills: 3,
      duplicatePair: 2,
    });

    expect(tables.skillVersions.find((version) => version._id === "skillVersions:one")).toEqual(
      expect.objectContaining({ fingerprint: "real-fingerprint-one" }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:two")).toEqual(
      expect.objectContaining({ fingerprint: "real-fingerprint-two" }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:three")).toEqual(
      expect.objectContaining({ fingerprint: DEMO_FINGERPRINT }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:four")).toEqual(
      expect.objectContaining({ fingerprint: DEMO_FINGERPRINT }),
    );
    expect(
      inserts
        .filter((insert) => insert.table === "skillVersionFingerprints")
        .map((insert) => insert.doc.versionId),
    ).toEqual(["skillVersions:three", "skillVersions:four"]);
  });

  it("clears only marked demo management rows", async () => {
    process.env.CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const { db, queryCalls, tables } = createDb({
      skills: [
        {
          _id: "skills:demo",
          reportCount: 2,
          lastReportedAt: 200,
        },
        {
          _id: "skills:real",
          reportCount: 1,
          lastReportedAt: 200,
        },
      ],
      skillReports: [
        {
          _id: "skillReports:demo",
          skillId: "skills:demo",
          triageNote: DEMO_REPORT_MARKER,
          status: "open",
          createdAt: 100,
        },
        {
          _id: "skillReports:demo-real",
          skillId: "skills:demo",
          triageNote: "real-user-report",
          status: "open",
          createdAt: 200,
        },
        {
          _id: "skillReports:real",
          skillId: "skills:real",
          triageNote: "real-user-report",
          status: "open",
          createdAt: 200,
        },
      ],
      skillVersions: [
        { _id: "skillVersions:demo", fingerprint: DEMO_FINGERPRINT },
        { _id: "skillVersions:real", fingerprint: "real-fingerprint" },
      ],
      skillVersionFingerprints: [
        {
          _id: "skillVersionFingerprints:demo",
          versionId: "skillVersions:demo",
          fingerprint: DEMO_FINGERPRINT,
        },
        {
          _id: "skillVersionFingerprints:real",
          versionId: "skillVersions:real",
          fingerprint: "real-fingerprint",
        },
      ],
    });

    await expect(clearManagementQueuesHandler({ db }, {})).resolves.toEqual({
      reportsDeleted: 1,
      fingerprintsDeleted: 1,
    });

    expect(tables.skillReports.map((report) => report._id)).toEqual([
      "skillReports:demo-real",
      "skillReports:real",
    ]);
    expect(tables.skillVersionFingerprints.map((fingerprint) => fingerprint._id)).toEqual([
      "skillVersionFingerprints:real",
    ]);
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:demo")).toEqual(
      expect.objectContaining({ fingerprint: undefined }),
    );
    expect(tables.skillVersions.find((version) => version._id === "skillVersions:real")).toEqual(
      expect.objectContaining({ fingerprint: "real-fingerprint" }),
    );
    expect(tables.skills.find((skill) => skill._id === "skills:demo")).toEqual(
      expect.objectContaining({ reportCount: 1, lastReportedAt: 200 }),
    );
    expect(tables.skills.find((skill) => skill._id === "skills:real")).toEqual(
      expect.objectContaining({ reportCount: 1, lastReportedAt: 200 }),
    );
    expect(queryCalls).toContainEqual({
      table: "skillVersionFingerprints",
      indexName: "by_fingerprint",
      constraints: { fingerprint: DEMO_FINGERPRINT },
    });
    expect(queryCalls).toContainEqual({
      table: "skillReports",
      indexName: "by_skill_createdAt",
      constraints: { skillId: "skills:demo" },
    });
  });
});
