/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

const telemetryRefs = vi.hoisted(() => ({
  clearUserTelemetryInternal: Symbol("clearUserTelemetryInternal"),
  pruneInstallTelemetryDedupesInternal: Symbol("pruneInstallTelemetryDedupesInternal"),
}));

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
    telemetry: telemetryRefs,
  },
}));

const {
  __test,
  clearUserTelemetryInternal,
  pruneInstallTelemetryDedupesInternal,
  reportCliInstallInternal,
  reportCliLegacyInstallBatchInternal,
} = await import("./telemetry");

const reportCliInstallHandler = (
  reportCliInstallInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { userId: string; slug: string; ownerHandle?: string; version?: string },
    ) => Promise<void>;
  }
)._handler;

const reportCliLegacyInstallBatchHandler = (
  reportCliLegacyInstallBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        userId: string;
        skills: Array<{ slug: string; version?: string }>;
      },
    ) => Promise<void>;
  }
)._handler;

const clearUserTelemetryHandler = (
  clearUserTelemetryInternal as unknown as {
    _handler: (ctx: unknown, args: { userId: string; clearStartedAt?: number }) => Promise<void>;
  }
)._handler;

const pruneInstallTelemetryDedupesHandler = (
  pruneInstallTelemetryDedupesInternal as unknown as {
    _handler: (ctx: unknown) => Promise<{ deleted: number; hasMore: boolean }>;
  }
)._handler;

function makeIndexBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    lte: vi.fn(() => builder),
  };
  return builder;
}

function makeInstallCtx(params: {
  skills: Array<{ _id: string; slug: string; softDeletedAt?: number } | null>;
  dedupes: Array<Record<string, unknown> | null>;
  installs: Array<Record<string, unknown> | null>;
}) {
  const skills = [...params.skills];
  const dedupes = [...params.dedupes];
  const installs = [...params.installs];
  const insert = vi.fn();
  const patch = vi.fn();
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn(
      (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
        callback(makeIndexBuilder());
        if (table === "skills" && indexName === "by_slug") {
          return {
            unique: async () => skills.shift() ?? null,
            take: async () => {
              const skill = skills.shift() ?? null;
              return skill ? [skill] : [];
            },
          };
        }
        if (table === "installTelemetryDedupes" && indexName === "by_user_skill_day") {
          return { unique: async () => dedupes.shift() ?? null };
        }
        if (table === "userSkillInstalls" && indexName === "by_user_skill") {
          return { unique: async () => installs.shift() ?? null };
        }
        throw new Error(`unexpected query ${table}.${indexName}`);
      },
    ),
  }));

  return { ctx: { db: { insert, patch, query } }, insert, patch, query };
}

describe("telemetry install events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records legacy snapshot batches as rootless user-skill installs", async () => {
    const { ctx, insert } = makeInstallCtx({
      skills: [
        { _id: "skills:weather", slug: "weather" },
        { _id: "skills:calendar", slug: "calendar" },
      ],
      dedupes: [null, null],
      installs: [null, null],
    });

    await reportCliLegacyInstallBatchHandler(ctx, {
      userId: "users:one",
      skills: [{ slug: "weather", version: "1.0.0" }, { slug: "calendar" }],
    });

    expect(insert).toHaveBeenCalledTimes(6);
    expect(insert).toHaveBeenCalledWith(
      "installTelemetryDedupes",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:weather",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "userSkillInstalls",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:weather",
        lastVersion: "1.0.0",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:calendar", kind: "install_new" }),
    );
  });

  it("records the first CLI install without root state", async () => {
    const { ctx, insert } = makeInstallCtx({
      skills: [{ _id: "skills:demo", slug: "demo" }],
      dedupes: [null],
      installs: [null],
    });

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.0",
    });

    expect(insert).toHaveBeenCalledWith(
      "installTelemetryDedupes",
      expect.objectContaining({
        userId: "users:one",
        skillId: "skills:demo",
        dayStart: expect.any(Number),
      }),
    );
    expect(insert).toHaveBeenCalledWith("userSkillInstalls", {
      userId: "users:one",
      skillId: "skills:demo",
      firstSeenAt: expect.any(Number),
      lastSeenAt: expect.any(Number),
      lastVersion: "1.0.0",
    });
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:demo", kind: "install_new" }),
    );
  });

  it("uses owner identity when recording an owner-qualified install", async () => {
    const publisher = {
      _id: "publishers:alice",
      handle: "alice",
      kind: "user",
    };
    const skill = {
      _id: "skills:alice-demo",
      slug: "demo",
      ownerPublisherId: publisher._id,
    };
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "publishers" && indexName === "by_handle") {
                return { unique: async () => publisher };
              }
              if (table === "skills" && indexName === "by_owner_publisher_slug") {
                return { unique: async () => skill };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_day") {
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
      ownerHandle: "alice",
      version: "1.0.0",
    });

    expect(insert).toHaveBeenCalledWith(
      "userSkillInstalls",
      expect.objectContaining({ skillId: "skills:alice-demo" }),
    );
  });

  it("resolves an owner-qualified slug alias before recording an install", async () => {
    const publisher = {
      _id: "publishers:source",
      handle: "source",
      kind: "org",
    };
    const skill = {
      _id: "skills:target-demo",
      slug: "demo",
      ownerPublisherId: "publishers:target",
    };
    const alias = {
      _id: "skillSlugAliases:source-old-demo",
      slug: "old-demo",
      ownerPublisherId: publisher._id,
      skillId: skill._id,
    };
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === skill._id ? skill : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "publishers" && indexName === "by_handle") {
                return { unique: async () => publisher };
              }
              if (table === "skills" && indexName === "by_owner_publisher_slug") {
                return { unique: async () => null };
              }
              if (table === "skillSlugAliases" && indexName === "by_owner_publisher_slug") {
                return { unique: async () => alias };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_day") {
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
      slug: "old-demo",
      ownerHandle: "source",
      version: "1.0.0",
    });

    expect(insert).toHaveBeenCalledWith(
      "userSkillInstalls",
      expect.objectContaining({ skillId: "skills:target-demo" }),
    );
  });

  it("skips ambiguous bare slugs instead of failing or guessing an owner", async () => {
    const insert = vi.fn();
    const duplicateSkills = [
      { _id: "skills:alice-demo", slug: "demo" },
      { _id: "skills:bob-demo", slug: "demo" },
    ];
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return {
                  unique: async () => {
                    throw new Error("unique query matched multiple skills");
                  },
                  take: async () => duplicateSkills,
                };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch: vi.fn(),
      },
    };

    await expect(
      reportCliLegacyInstallBatchHandler(ctx, {
        userId: "users:one",
        skills: [{ slug: "demo", version: "1.0.0" }],
      }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips bare slugs when more matches exist beyond the inspection cap", async () => {
    const insert = vi.fn();
    const candidates = [
      { _id: "skills:first-active", slug: "demo" },
      ...Array.from({ length: 24 }, (_, index) => ({
        _id: `skills:deleted-${index}`,
        slug: "demo",
        softDeletedAt: index + 1,
      })),
      { _id: "skills:second-active", slug: "demo" },
    ];
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return { take: async (limit: number) => candidates.slice(0, limit) };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        insert,
        patch: vi.fn(),
      },
    };

    await reportCliLegacyInstallBatchHandler(ctx, {
      userId: "users:one",
      skills: [{ slug: "demo", version: "1.0.0" }],
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps repeated CLI install events idempotent per user and skill", async () => {
    const { ctx, insert, patch } = makeInstallCtx({
      skills: [{ _id: "skills:demo", slug: "demo" }],
      dedupes: [null],
      installs: [
        {
          _id: "userSkillInstalls:one",
          userId: "users:one",
          skillId: "skills:demo",
          lastVersion: "1.0.0",
        },
      ],
    });

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
    });

    expect(patch).toHaveBeenCalledWith("userSkillInstalls:one", {
      lastSeenAt: expect.any(Number),
      lastVersion: "1.0.1",
    });
    expect(insert).toHaveBeenCalledWith(
      "installTelemetryDedupes",
      expect.objectContaining({ userId: "users:one", skillId: "skills:demo" }),
    );
    expect(insert).not.toHaveBeenCalledWith("skillStatEvents", expect.anything());
  });

  it("dedupes repeated install telemetry for the same user, skill, and day", async () => {
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
                return { unique: async () => skill, take: async () => [skill] };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_skill_day") {
                expect(builder.eq).toHaveBeenCalledWith("userId", "users:one");
                expect(builder.eq).toHaveBeenCalledWith("skillId", "skills:demo");
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
    });

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("clears installs and dedupe rows", async () => {
    const insert = vi.fn();
    const deleteDoc = vi.fn();
    const installs = [
      { _id: "installs:one", skillId: "skills:one" },
      { _id: "installs:two", skillId: "skills:two" },
    ];
    const dedupes = [{ _id: "installTelemetryDedupes:one" }];
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "userSkillInstalls" && indexName === "by_user_lastSeenAt") {
                return { take: async () => installs };
              }
              if (table === "installTelemetryDedupes" && indexName === "by_user_createdAt") {
                return { take: async () => dedupes };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          ),
        })),
        get: vi.fn(async (id: string) => ({ _id: id })),
        insert,
        delete: deleteDoc,
      },
      scheduler: { runAfter: vi.fn() },
    };

    await clearUserTelemetryHandler(ctx, { userId: "users:one", clearStartedAt: 123 });

    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:one",
        kind: "install_clear",
        delta: { allTime: -1, current: -1 },
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:two",
        kind: "install_clear",
        delta: { allTime: -1, current: -1 },
      }),
    );
    expect(deleteDoc).toHaveBeenCalledTimes(3);
    expect(deleteDoc).toHaveBeenCalledWith("installTelemetryDedupes:one");
  });

  it.each([
    {
      table: "userSkillInstalls",
      indexName: "by_user_lastSeenAt",
      batchSize: 5_000,
      laterTables: ["installTelemetryDedupes"],
    },
    {
      table: "installTelemetryDedupes",
      indexName: "by_user_createdAt",
      batchSize: 10_000,
      laterTables: [],
    },
  ])(
    "reschedules user telemetry clearing after a full $table batch before reading later tables",
    async ({ table, indexName, batchSize, laterTables }) => {
      const rows = Array.from({ length: batchSize }, (_, index) => ({
        _id: `${table}:${index}`,
        skillId: "skills:demo",
      }));
      const queriedTables: string[] = [];
      const deleteDoc = vi.fn();
      const runAfter = vi.fn();
      const ctx = {
        db: {
          get: vi.fn(async () => ({ _id: "skills:demo" })),
          query: vi.fn((queriedTable: string) => {
            queriedTables.push(queriedTable);
            return {
              withIndex: vi.fn(
                (
                  actualIndexName: string,
                  callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown,
                ) => {
                  if (queriedTable === table) {
                    expect(actualIndexName).toBe(indexName);
                  }
                  callback(makeIndexBuilder());
                  return {
                    take: async () => (queriedTable === table ? rows : []),
                  };
                },
              ),
            };
          }),
          insert: vi.fn(),
          delete: deleteDoc,
        },
        scheduler: { runAfter },
      };

      await clearUserTelemetryHandler(ctx, { userId: "users:one", clearStartedAt: 123 });

      expect(deleteDoc).toHaveBeenCalledTimes(batchSize);
      expect(runAfter).toHaveBeenCalledWith(0, telemetryRefs.clearUserTelemetryInternal, {
        userId: "users:one",
        clearStartedAt: 123,
      });
      for (const laterTable of laterTables) {
        expect(queriedTables).not.toContain(laterTable);
      }
    },
  );

  it("prunes stale install telemetry dedupe rows by day bucket", async () => {
    vi.setSystemTime(20 * 86_400_000);
    const stale = [{ _id: "installTelemetryDedupes:one" }, { _id: "installTelemetryDedupes:two" }];
    const deleteDoc = vi.fn();
    const take = vi.fn(async () => stale);
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              expect(table).toBe("installTelemetryDedupes");
              expect(indexName).toBe("by_day");
              const builder = makeIndexBuilder();
              callback(builder);
              expect(builder.lt).toHaveBeenCalledWith("dayStart", 6 * 86_400_000);
              return { take };
            },
          ),
        })),
        delete: deleteDoc,
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await pruneInstallTelemetryDedupesHandler(ctx);

    expect(take).toHaveBeenCalledWith(500);
    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(deleteDoc).toHaveBeenCalledWith("installTelemetryDedupes:one");
    expect(deleteDoc).toHaveBeenCalledWith("installTelemetryDedupes:two");
  });

  it("reschedules stale dedupe pruning when one bounded batch fills", async () => {
    vi.setSystemTime(20 * 86_400_000);
    const stale = Array.from({ length: 500 }, (_, index) => ({
      _id: `installTelemetryDedupes:${index}`,
    }));
    const runAfter = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ take: async () => stale })),
        })),
        delete: vi.fn(),
      },
      scheduler: { runAfter },
    };

    const result = await pruneInstallTelemetryDedupesHandler(ctx);

    expect(result).toEqual({ deleted: 500, hasMore: true });
    expect(runAfter).toHaveBeenCalledWith(
      0,
      telemetryRefs.pruneInstallTelemetryDedupesInternal,
      {},
    );
  });

  it("computes UTC day starts", () => {
    expect(__test.getDayStart(86_399_999)).toBe(0);
    expect(__test.getDayStart(86_400_000)).toBe(86_400_000);
  });
});
