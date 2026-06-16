/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

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
  },
}));

const {
  clearUserTelemetryInternal,
  reportCliInstallInternal,
  reportCliLegacyInstallBatchInternal,
} = await import("./telemetry");

const reportCliInstallHandler = (
  reportCliInstallInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { userId: string; slug: string; version?: string },
    ) => Promise<void>;
  }
)._handler;

const reportCliLegacyInstallBatchHandler = (
  reportCliLegacyInstallBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { userId: string; skills: Array<{ slug: string; version?: string }> },
    ) => Promise<void>;
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
  };
  return builder;
}

function makeInstallCtx(params: {
  skills: Array<{ _id: string; slug: string } | null>;
  installs: Array<Record<string, unknown> | null>;
}) {
  const skills = [...params.skills];
  const installs = [...params.installs];
  const insert = vi.fn();
  const patch = vi.fn();
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn(
      (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
        callback(makeIndexBuilder());
        if (table === "skills" && indexName === "by_slug") {
          return { unique: async () => skills.shift() ?? null };
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
  it("records legacy snapshot batches as rootless user-skill installs", async () => {
    const { ctx, insert, query } = makeInstallCtx({
      skills: [
        { _id: "skills:weather", slug: "weather" },
        { _id: "skills:calendar", slug: "calendar" },
      ],
      installs: [null, null],
    });

    await reportCliLegacyInstallBatchHandler(ctx, {
      userId: "users:one",
      skills: [{ slug: "weather", version: "1.0.0" }, { slug: "calendar" }],
    });

    expect(query).not.toHaveBeenCalledWith("userSyncRoots");
    expect(query).not.toHaveBeenCalledWith("userSkillRootInstalls");
    expect(insert).toHaveBeenCalledTimes(4);
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
      installs: [null],
    });

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.0",
    });

    expect(insert).toHaveBeenCalledWith("userSkillInstalls", {
      userId: "users:one",
      skillId: "skills:demo",
      firstSeenAt: expect.any(Number),
      lastSeenAt: expect.any(Number),
      lastVersion: "1.0.0",
    });
    expect(insert).not.toHaveBeenCalledWith("userSyncRoots", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("userSkillRootInstalls", expect.anything());
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:demo", kind: "install_new" }),
    );
  });

  it("keeps repeated CLI install events idempotent per user and skill", async () => {
    const { ctx, insert, patch } = makeInstallCtx({
      skills: [{ _id: "skills:demo", slug: "demo" }],
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
      activeRoots: undefined,
      lastSeenAt: expect.any(Number),
      lastVersion: "1.0.1",
    });
    expect(insert).not.toHaveBeenCalledWith("skillStatEvents", expect.anything());
  });

  it("reactivates a legacy inactive install while removing its root count", async () => {
    const { ctx, insert, patch } = makeInstallCtx({
      skills: [{ _id: "skills:demo", slug: "demo" }],
      installs: [
        {
          _id: "userSkillInstalls:one",
          userId: "users:one",
          skillId: "skills:demo",
          activeRoots: 0,
          lastVersion: "1.0.0",
        },
      ],
    });

    await reportCliInstallHandler(ctx, {
      userId: "users:one",
      slug: "demo",
      version: "1.0.1",
    });

    expect(patch).toHaveBeenCalledWith(
      "userSkillInstalls:one",
      expect.objectContaining({ activeRoots: undefined, lastVersion: "1.0.1" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:demo", kind: "install_reactivate" }),
    );
  });

  it("clears rootless installs while preserving legacy inactive count semantics", async () => {
    const insert = vi.fn();
    const deleteDoc = vi.fn();
    const installs = [
      { _id: "installs:rootless", skillId: "skills:rootless" },
      { _id: "installs:inactive", skillId: "skills:inactive", activeRoots: 0 },
    ];
    const roots = [{ _id: "roots:one" }];
    const rootInstalls = [{ _id: "rootInstalls:one" }];
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_name, callback) => {
            callback(makeIndexBuilder());
            return {
              take: async () =>
                table === "userSkillInstalls"
                  ? installs
                  : table === "userSyncRoots"
                    ? roots
                    : rootInstalls,
            };
          }),
        })),
        get: vi.fn(async (id: string) => ({ _id: id })),
        insert,
        delete: deleteDoc,
      },
    };

    await clearUserTelemetryHandler(ctx, { userId: "users:one" });

    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:rootless",
        kind: "install_clear",
        delta: { allTime: -1, current: -1 },
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:inactive",
        kind: "install_clear",
        delta: { allTime: -1, current: 0 },
      }),
    );
    expect(deleteDoc).toHaveBeenCalledTimes(4);
    expect(deleteDoc).toHaveBeenCalledWith("roots:one");
    expect(deleteDoc).toHaveBeenCalledWith("rootInstalls:one");
  });
});
