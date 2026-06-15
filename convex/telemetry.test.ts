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

const { reportCliInstallInternal, reportCliLegacyInstallBatchInternal } =
  await import("./telemetry");

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

const reportCliLegacyInstallBatchHandler = (
  reportCliLegacyInstallBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        userId: string;
        rootId: string;
        rootLabel: string;
        skills: Array<{ slug: string; version?: string }>;
      },
    ) => Promise<void>;
  }
)._handler;

function makeIndexBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
  };
  return builder;
}

describe("telemetry install events", () => {
  it("records legacy snapshot batches additively", async () => {
    const skills = [
      { _id: "skills:weather", slug: "weather" },
      { _id: "skills:calendar", slug: "calendar" },
    ];
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (indexName: string, callback: (q: ReturnType<typeof makeIndexBuilder>) => unknown) => {
              callback(makeIndexBuilder());
              if (table === "skills" && indexName === "by_slug") {
                return { unique: async () => skills.shift() ?? null };
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

    await reportCliLegacyInstallBatchHandler(ctx, {
      userId: "users:one",
      rootId: "root",
      rootLabel: "~/skills",
      skills: [{ slug: "weather", version: "1.0.0" }, { slug: "calendar" }],
    });

    expect(insert).toHaveBeenCalledTimes(7);
    expect(insert).toHaveBeenCalledWith(
      "userSyncRoots",
      expect.objectContaining({ userId: "users:one", rootId: "root", label: "~/skills" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:weather", kind: "install_new" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:calendar", kind: "install_new" }),
    );
  });

  it("records the first CLI install as an install stat event", async () => {
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
});
