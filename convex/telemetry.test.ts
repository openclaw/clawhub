/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    skillStatEvents: {
      processSkillStatEventsAction: Symbol("processSkillStatEventsAction"),
      processSkillStatEventsInternal: Symbol("processSkillStatEventsInternal"),
    },
    telemetry: {
      clearUserTelemetryInternal: Symbol("clearUserTelemetryInternal"),
      pruneInstallTelemetryDedupesInternal: Symbol("pruneInstallTelemetryDedupesInternal"),
    },
  },
}));

const {
  clearUserTelemetryInternal,
  pruneInstallTelemetryDedupesInternal,
  reportCliInstallInternal,
} = await import("./telemetry");

const reportCliInstallHandler = (
  reportCliInstallInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        userId: string;
        slug: string;
        version?: string;
        rootId?: string;
        rootLabel?: string;
      },
    ) => Promise<void>;
  }
)._handler;

const pruneInstallTelemetryDedupesHandler = (
  pruneInstallTelemetryDedupesInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<{ deleted: number; hasMore: boolean }>;
  }
)._handler;

const clearUserTelemetryHandler = (
  clearUserTelemetryInternal as unknown as {
    _handler: (ctx: unknown, args: { userId: string }) => Promise<void>;
  }
)._handler;

function makeIndexBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
  };
  return builder;
}

describe("telemetry install events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records the first CLI install as an install stat event", async () => {
    vi.setSystemTime(86_500_000);
    const skill = { _id: "skills:demo", slug: "demo" };
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_root_day") {
                return { unique: async () => null };
              }
              if (table === "userSyncRoots" && indexName === "by_user_root") {
                return { unique: async () => null };
              }
              if (table === "userSkillRootInstalls" && indexName === "by_user_root_skill") {
                return { unique: async () => null };
              }
              if (table === "userSkillInstalls" && indexName === "by_user_skill") {
                return { unique: async () => null };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch: vi.fn(),
      },
    };

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.0",
      rootId: "root",
      rootLabel: "~/skills",
    });

    expect(insert).toHaveBeenCalledWith(
      "installTelemetryDedupes",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:demo",
        rootKey: "root",
        dayStart: 86_400_000,
        createdAt: 86_500_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "userSkillInstalls",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:demo",
        activeRoots: 1,
        lastVersion: "1.0.0",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "userSyncRoots",
      expect.objectContaining({
        userId: "users:one",
        rootId: "root",
        label: "~/skills",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "userSkillRootInstalls",
      expect.objectContaining({
        userId: "users:one",
        rootId: "root",
        skillId: "skills:demo",
        lastVersion: "1.0.0",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:demo",
        kind: "install_new",
      }),
    );
  });

  it("keeps repeated CLI install events idempotent per user and skill", async () => {
    const skill = { _id: "skills:demo", slug: "demo" };
    const existingInstall = {
      _id: "userSkillInstalls:one",
      userId: "users:one",
      skillId: "skills:demo",
      activeRoots: 1,
      lastVersion: "1.0.0",
    };
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_root_day") {
                return { unique: async () => null };
              }
              if (table === "userSkillInstalls" && indexName === "by_user_skill") {
                return { unique: async () => existingInstall };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch,
      },
    };

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
    });

    expect(patch).toHaveBeenCalledWith(
      "userSkillInstalls:one",
      expect.objectContaining({ activeRoots: 1, lastVersion: "1.0.1" }),
    );
    expect(insert).not.toHaveBeenCalledWith("skillStatEvents", expect.anything());
  });

  it("reactivates an inactive CLI install for current install counts", async () => {
    const skill = { _id: "skills:demo", slug: "demo" };
    const existingInstall = {
      _id: "userSkillInstalls:one",
      userId: "users:one",
      skillId: "skills:demo",
      activeRoots: 0,
      lastVersion: "1.0.0",
    };
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_root_day") {
                return { unique: async () => null };
              }
              if (table === "userSkillInstalls" && indexName === "by_user_skill") {
                return { unique: async () => existingInstall };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch,
      },
    };

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
    });

    expect(patch).toHaveBeenCalledWith(
      "userSkillInstalls:one",
      expect.objectContaining({ activeRoots: 1, lastVersion: "1.0.1" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:demo",
        kind: "install_reactivate",
      }),
    );
  });

  it("dedupes repeated install telemetry for the same user, skill, root, and day", async () => {
    vi.setSystemTime(86_500_000);
    const skill = { _id: "skills:demo", slug: "demo" };
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              const builder = makeIndexBuilder();
              callback(builder);
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_root_day") {
                expect(builder.eq).toHaveBeenCalledWith("userId", "users:one");
                expect(builder.eq).toHaveBeenCalledWith("skillId", "skills:demo");
                expect(builder.eq).toHaveBeenCalledWith("rootKey", "root");
                expect(builder.eq).toHaveBeenCalledWith("dayStart", 86_400_000);
                return { unique: async () => ({ _id: "installTelemetryDedupes:existing" }) };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch,
      },
    };

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
      rootId: "root",
      rootLabel: "~/skills",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("records the same skill in a different root on the same day", async () => {
    vi.setSystemTime(86_500_000);
    const skill = { _id: "skills:demo", slug: "demo" };
    const existingInstall = {
      _id: "userSkillInstalls:one",
      userId: "users:one",
      skillId: "skills:demo",
      activeRoots: 1,
      lastVersion: "1.0.0",
    };
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              const builder = makeIndexBuilder();
              callback(builder);
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_root_day") {
                expect(builder.eq).toHaveBeenCalledWith("rootKey", "root-two");
                return { unique: async () => null };
              }
              if (table === "userSyncRoots" && indexName === "by_user_root") {
                return { unique: async () => null };
              }
              if (table === "userSkillRootInstalls" && indexName === "by_user_root_skill") {
                return { unique: async () => null };
              }
              if (table === "userSkillInstalls" && indexName === "by_user_skill") {
                return { unique: async () => existingInstall };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch,
      },
    };

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
      rootId: "root-two",
      rootLabel: "~/other-skills",
    });

    expect(insert).toHaveBeenCalledWith(
      "installTelemetryDedupes",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:demo",
        rootKey: "root-two",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "userSkillRootInstalls",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:demo",
        rootId: "root-two",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "userSkillInstalls:one",
      expect.objectContaining({ activeRoots: 2, lastVersion: "1.0.1" }),
    );
  });

  it("prunes stale install telemetry dedupe rows by day bucket", async () => {
    vi.setSystemTime(15 * 86_400_000 + 123);
    const delete_ = vi.fn();
    const take = vi.fn(async () => [
      { _id: "installTelemetryDedupes:one" },
      { _id: "installTelemetryDedupes:two" },
    ]);
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              const builder = makeIndexBuilder();
              callback(builder);
              expect(table).toBe("installTelemetryDedupes");
              expect(indexName).toBe("by_day");
              expect(builder.lt).toHaveBeenCalledWith("dayStart", 86_400_000);
              return { take };
            },
          ),
        })),
        delete: delete_,
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await pruneInstallTelemetryDedupesHandler(ctx, {});

    expect(take).toHaveBeenCalledWith(200);
    expect(delete_).toHaveBeenCalledWith("installTelemetryDedupes:one");
    expect(delete_).toHaveBeenCalledWith("installTelemetryDedupes:two");
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 2, hasMore: false });
  });

  it("reschedules install telemetry dedupe pruning when one bounded batch fills", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      _id: `installTelemetryDedupes:${index}`,
    }));
    const delete_ = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(
            (_indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              return { take: vi.fn(async () => rows) };
            },
          ),
        })),
        delete: delete_,
      },
      scheduler: { runAfter },
    };

    const result = await pruneInstallTelemetryDedupesHandler(ctx, {});

    expect(delete_).toHaveBeenCalledTimes(200);
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0]?.[0]).toBe(0);
    expect(typeof runAfter.mock.calls[0]?.[1]).toBe("symbol");
    expect(runAfter.mock.calls[0]?.[2]).toEqual({});
    expect(result).toEqual({ deleted: 200, hasMore: true });
  });

  it("clears install telemetry dedupe rows when clearing user telemetry", async () => {
    const delete_ = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "skills:demo" ? { _id: "skills:demo" } : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              const builder = makeIndexBuilder();
              callback(builder);
              if (table === "userSkillInstalls" && indexName === "by_user") {
                return {
                  take: async () => [
                    {
                      _id: "userSkillInstalls:one",
                      skillId: "skills:demo",
                      activeRoots: 1,
                    },
                  ],
                };
              }
              if (table === "userSyncRoots" && indexName === "by_user") {
                return { take: async () => [{ _id: "userSyncRoots:one" }] };
              }
              if (table === "userSkillRootInstalls" && indexName === "by_user") {
                return { take: async () => [{ _id: "userSkillRootInstalls:one" }] };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user") {
                expect(builder.eq).toHaveBeenCalledWith("userId", "users:one");
                return {
                  take: async () => [
                    { _id: "installTelemetryDedupes:one" },
                    { _id: "installTelemetryDedupes:two" },
                  ],
                };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        delete: delete_,
      },
    };

    await clearUserTelemetryHandler(ctx, { userId: "users:one" });

    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:demo",
        kind: "install_clear",
      }),
    );
    expect(delete_).toHaveBeenCalledWith("installTelemetryDedupes:one");
    expect(delete_).toHaveBeenCalledWith("installTelemetryDedupes:two");
  });

  it("reschedules user telemetry clearing when one dedupe batch fills", async () => {
    const dedupeRows = Array.from({ length: 10_000 }, (_, index) => ({
      _id: `installTelemetryDedupes:${index}`,
    }));
    const delete_ = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "userSkillInstalls" && indexName === "by_user") {
                return { take: async () => [] };
              }
              if (table === "userSyncRoots" && indexName === "by_user") {
                return { take: async () => [] };
              }
              if (table === "userSkillRootInstalls" && indexName === "by_user") {
                return { take: async () => [] };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user") {
                return { take: async () => dedupeRows };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert: vi.fn(),
        delete: delete_,
      },
      scheduler: { runAfter },
    };

    await clearUserTelemetryHandler(ctx, { userId: "users:one" });

    expect(delete_).toHaveBeenCalledTimes(10_000);
    expect(runAfter).toHaveBeenCalledWith(0, expect.any(Symbol), { userId: "users:one" });
  });

  it.each([
    {
      table: "userSkillInstalls",
      batchSize: 5_000,
      laterTables: ["userSyncRoots", "userSkillRootInstalls", "installTelemetryDedupes"],
    },
    {
      table: "userSyncRoots",
      batchSize: 5_000,
      laterTables: ["userSkillRootInstalls", "installTelemetryDedupes"],
    },
    {
      table: "userSkillRootInstalls",
      batchSize: 10_000,
      laterTables: ["installTelemetryDedupes"],
    },
  ])(
    "reschedules user telemetry clearing after a full $table batch before reading later tables",
    async ({ table, batchSize, laterTables }) => {
      const rows = Array.from({ length: batchSize }, (_, index) => ({
        _id: `${table}:${index}`,
        skillId: "skills:demo",
        activeRoots: 1,
      }));
      const queriedTables: string[] = [];
      const delete_ = vi.fn();
      const runAfter = vi.fn();
      const ctx = {
        db: {
          get: vi.fn(async () => ({ _id: "skills:demo" })),
          query: vi.fn((queriedTable: string) => {
            queriedTables.push(queriedTable);
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown,
                ) => {
                  expect(indexName).toBe("by_user");
                  callback(makeIndexBuilder());
                  return {
                    take: async () => (queriedTable === table ? rows : []),
                  };
                },
              ),
            };
          }),
          insert: vi.fn(),
          delete: delete_,
        },
        scheduler: { runAfter },
      };

      await clearUserTelemetryHandler(ctx, { userId: "users:one" });

      expect(delete_).toHaveBeenCalledTimes(batchSize);
      expect(runAfter).toHaveBeenCalledWith(0, expect.any(Symbol), { userId: "users:one" });
      for (const laterTable of laterTables) {
        expect(queriedTables).not.toContain(laterTable);
      }
    },
  );
});
