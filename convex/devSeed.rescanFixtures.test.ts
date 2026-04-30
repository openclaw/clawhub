import { describe, expect, it } from "vitest";
import { seedRescanUxFixturesHandler } from "./devSeed";
import { MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE } from "./model/rescans/policy";

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

  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const db = {
    get: async (id: string) => {
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
    patch: async (id: string, patch: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const doc = list(table).find((candidate) => candidate._id === id);
      if (doc) Object.assign(doc, patch);
    },
    delete: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((doc) => doc._id === id);
      if (index !== -1) rows.splice(index, 1);
    },
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        const matched = () =>
          list(table).filter((doc) => matches(doc as Record<string, unknown>, constraints));
        return {
          collect: async () => matched(),
          unique: async () => matched()[0] ?? null,
          order: () => ({
            collect: async () => matched(),
          }),
        };
      },
    }),
  };

  return { db, tables };
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
    expect(tables.users?.[0]).toEqual(expect.objectContaining({ handle: "local" }));
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
