import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCanonicalSearchTestFixture,
  readCanonicalSearchTestFixture,
  seedCanonicalSearchTestFixture,
} from "./searchTestFixtures";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const seedFixture = (
  seedCanonicalSearchTestFixture as unknown as WrappedHandler<{
    confirm: "manage-claw-577-canonical-search-test-fixture";
  }>
)._handler;
const readFixture = (
  readCanonicalSearchTestFixture as unknown as WrappedHandler<{
    confirm: "manage-claw-577-canonical-search-test-fixture";
  }>
)._handler;
const cleanupFixture = (
  cleanupCanonicalSearchTestFixture as unknown as WrappedHandler<{
    confirm: "manage-claw-577-canonical-search-test-fixture";
    digestId: string;
    runId: string;
  }>
)._handler;

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function createDb() {
  const tables: Record<string, Array<Record<string, unknown> & { _id: string }>> = {};
  const counters: Record<string, number> = {};
  const list = (table: string) => (tables[table] ??= []);
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (arg0: string, arg1?: string) => {
      const id = arg1 ?? arg0;
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const count = (counters[table] ?? 0) + 1;
      counters[table] = count;
      const row = { _id: `${table}:${count}`, _creationTime: count, ...value };
      list(table).push(row);
      return row._id;
    },
    patch: async () => {
      throw new Error("fixture must not patch existing rows");
    },
    delete: async (arg0: string, arg1?: string) => {
      const id = arg1 ?? arg0;
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((row) => row._id === id);
      if (index !== -1) rows.splice(index, 1);
    },
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        const matched = () =>
          list(table).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value),
          );
        return {
          unique: async () => matched()[0] ?? null,
          take: async (limit: number) => matched().slice(0, limit),
        };
      },
    }),
  };
  return { db, tables };
}

describe("canonical search permanent-Test fixture", () => {
  beforeEach(() => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
    vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "academic-chihuahua-392");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("idempotently seeds one owned visible external popularity decoy", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    const args = { confirm: "manage-claw-577-canonical-search-test-fixture" as const };

    const first = await seedFixture(ctx, args);
    const second = await seedFixture(ctx, args);

    expect(first).toEqual(expect.objectContaining({ created: true }));
    expect(second).toEqual(
      expect.objectContaining({
        created: false,
        digestId: (first as { digestId: string }).digestId,
        runId: (first as { runId: string }).runId,
      }),
    );
    expect(tables.skillsShMirrorRuns).toHaveLength(1);
    expect(tables.skillsShMirrorRuns?.[0]).toEqual(
      expect.objectContaining({
        snapshotId: "claw-577-canonical-search-proof-v1",
        actor: "CLAW-577 Test workflow",
        counts: expect.objectContaining({ scansPlanned: 0, scansAdmitted: 0 }),
      }),
    );
    expect(tables.skillsShMirrorDigests).toHaveLength(1);
    expect(tables.skillsShMirrorDigests?.[0]).toEqual(
      expect.objectContaining({
        externalId: "clawhub-test/claw-577/search-popularity-decoy",
        upstreamInstalls: 9_000_000,
        active: true,
        publicVisible: true,
        installable: true,
        sourceFreshnessStatus: "observed-only",
      }),
    );
  });

  it("reads back and exactly cleans up only the owned IDs", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    const confirm = "manage-claw-577-canonical-search-test-fixture" as const;
    const seeded = (await seedFixture(ctx, { confirm })) as {
      digestId: string;
      runId: string;
    };
    const unrelatedRunId = await db.insert("skillsShMirrorRuns", { snapshotId: "unrelated" });

    await expect(readFixture(ctx, { confirm })).resolves.toEqual(
      expect.objectContaining({
        present: true,
        digestId: seeded.digestId,
        runId: seeded.runId,
        upstreamInstalls: 9_000_000,
      }),
    );
    await expect(cleanupFixture(ctx, { confirm, ...seeded })).resolves.toEqual({
      ok: true,
      removed: true,
    });
    await expect(readFixture(ctx, { confirm })).resolves.toEqual({ present: false });
    await expect(cleanupFixture(ctx, { confirm, ...seeded })).resolves.toEqual({
      ok: true,
      removed: false,
    });
    expect(tables.skillsShMirrorRuns).toEqual([
      expect.objectContaining({ _id: unrelatedRunId, snapshotId: "unrelated" }),
    ]);
    expect(tables.skillsShMirrorDigests).toEqual([]);
  });

  it("rejects stale cleanup when a newer owned fixture occupies the exact identity", async () => {
    const { db } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    const confirm = "manage-claw-577-canonical-search-test-fixture" as const;
    const stale = (await seedFixture(ctx, { confirm })) as { digestId: string; runId: string };
    await cleanupFixture(ctx, { confirm, ...stale });
    await seedFixture(ctx, { confirm });

    await expect(cleanupFixture(ctx, { confirm, ...stale })).rejects.toThrow(
      "newer fixture occupies the owned identity",
    );
  });

  it("rejects an unrelated exact-ID collision without writing a run", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    await db.insert("skillsShMirrorDigests", {
      externalId: "clawhub-test/claw-577/search-popularity-decoy",
      sourceSnapshotId: "unrelated",
      observationFingerprint: "unrelated",
      sourceUrl: "https://example.invalid/unrelated",
      lastObservedRunId: "skillsShMirrorRuns:404",
    });

    await expect(
      seedFixture(ctx, { confirm: "manage-claw-577-canonical-search-test-fixture" }),
    ).rejects.toThrow("digest ownership mismatch");
    expect(tables.skillsShMirrorRuns ?? []).toEqual([]);
  });

  it("fails closed on an orphaned owned run", async () => {
    const { db } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    await db.insert("skillsShMirrorRuns", {
      snapshotId: "claw-577-canonical-search-proof-v1",
      sourceView: "leaderboard",
      sourceSnapshotHash: "claw-577-canonical-search-proof-v1-owned",
      status: "completed",
      actor: "CLAW-577 Test workflow",
    });

    await expect(
      readFixture(ctx, { confirm: "manage-claw-577-canonical-search-test-fixture" }),
    ).rejects.toThrow("partial state");
    await expect(
      seedFixture(ctx, { confirm: "manage-claw-577-canonical-search-test-fixture" }),
    ).rejects.toThrow("partial state");
  });

  it("refuses cleanup when the owned fixture gained dependent rows", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };
    const confirm = "manage-claw-577-canonical-search-test-fixture" as const;
    const seeded = (await seedFixture(ctx, { confirm })) as { digestId: string; runId: string };
    await db.insert("skillsShMirrorDetails", { digestId: seeded.digestId });

    await expect(cleanupFixture(ctx, { confirm, ...seeded })).rejects.toThrow("dependent rows");
    expect(tables.skillsShMirrorDigests).toHaveLength(1);
    expect(tables.skillsShMirrorRuns).toHaveLength(1);
  });

  it("rechecks the permanent-Test environment at the mutation boundary", async () => {
    vi.stubEnv("CLAWHUB_ENV", "production");
    const { db } = createDb();

    await expect(
      seedFixture(
        { db, scheduler: { runAfter: async () => null } },
        { confirm: "manage-claw-577-canonical-search-test-fixture" },
      ),
    ).rejects.toThrow("CLAWHUB_ENV=test");
  });
});
