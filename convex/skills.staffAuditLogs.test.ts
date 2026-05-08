import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

vi.mock("./lib/badges", async () => {
  const actual = await vi.importActual<typeof import("./lib/badges")>("./lib/badges");
  return {
    ...actual,
    getSkillBadgeMap: vi.fn(async () => ({})),
  };
});

vi.mock("./lib/publishers", async () => {
  const actual = await vi.importActual<typeof import("./lib/publishers")>("./lib/publishers");
  return {
    ...actual,
    ensurePersonalPublisherForUser: vi.fn(),
  };
});

vi.mock("./lib/userSkillStats", async () => {
  const actual =
    await vi.importActual<typeof import("./lib/userSkillStats")>("./lib/userSkillStats");
  return {
    ...actual,
    adjustUserSkillStatsForSkillChange: vi.fn(async () => {}),
  };
});

const { requireUser } = await import("./lib/access");
const { getSkillBadgeMap } = await import("./lib/badges");
const { ensurePersonalPublisherForUser } = await import("./lib/publishers");
const { adjustUserSkillStatsForSkillChange } = await import("./lib/userSkillStats");
const { changeOwner, getBySlugForStaff } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugForStaffHandler = (
  getBySlugForStaff as unknown as WrappedHandler<{
    slug: string;
    auditLogLimit?: number;
  }>
)._handler;

const changeOwnerHandler = (
  changeOwner as unknown as WrappedHandler<{
    skillId: string;
    ownerUserId: string;
  }>
)._handler;

function makeCtx() {
  const skill = {
    _id: "skills:1",
    slug: "padel",
    displayName: "Padel",
    ownerUserId: "users:owner",
    ownerPublisherId: "publishers:local",
    latestVersionId: "skillVersions:1",
    manualOverride: {
      verdict: "clean",
      note: "reviewed locally",
      reviewerUserId: "users:moderator",
      updatedAt: 200,
    },
    tags: {},
  };

  const latestVersion = {
    _id: "skillVersions:1",
    version: "0.1.0",
    createdAt: 100,
    changelog: "seeded",
  };

  const auditLogs = [
    {
      _id: "auditLogs:1",
      actorUserId: "users:moderator",
      action: "skill.manual_override.set",
      targetType: "skill",
      targetId: "skills:1",
      metadata: { verdict: "clean", note: "reviewed locally" },
      createdAt: 200,
    },
    {
      _id: "auditLogs:2",
      actorUserId: "users:admin",
      action: "skill.owner.change",
      targetType: "skill",
      targetId: "skills:1",
      metadata: { from: "users:owner", to: "users:next-owner" },
      createdAt: 150,
    },
  ];

  const auditTake = vi.fn(async (limit: number) => auditLogs.slice(0, limit));
  const skillUnique = vi.fn(async () => skill);
  const query = vi.fn((table: string) => {
    if (table === "skills") {
      return {
        withIndex: vi.fn(() => ({
          unique: skillUnique,
        })),
      };
    }

    if (table === "auditLogs") {
      return {
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({
            take: auditTake,
          })),
        })),
      };
    }

    throw new Error(`Unexpected query table: ${table}`);
  });

  const get = vi.fn(async (id: string) => {
    switch (id) {
      case "skillVersions:1":
        return latestVersion;
      case "publishers:local":
        return {
          _id: "publishers:local",
          _creationTime: 1,
          kind: "user",
          handle: "local-publisher",
          displayName: "Local Dev",
          linkedUserId: "users:owner",
        };
      case "users:owner":
        return {
          _id: "users:owner",
          _creationTime: 1,
          handle: "local",
          name: "Local Dev",
          displayName: "Local Dev",
          role: "user",
        };
      case "users:moderator":
        return {
          _id: "users:moderator",
          _creationTime: 2,
          handle: "moddy",
          name: "Moddy",
          displayName: "Moddy",
          role: "moderator",
        };
      case "users:admin":
        return {
          _id: "users:admin",
          _creationTime: 3,
          handle: "chief",
          name: "Chief",
          displayName: "Chief",
          role: "admin",
        };
      default:
        return null;
    }
  });

  return {
    ctx: {
      db: { query, get },
    } as never,
    auditTake,
    get,
  };
}

describe("getBySlugForStaff audit logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(requireUser).mockReset();
    vi.mocked(ensurePersonalPublisherForUser).mockReset();
    vi.mocked(adjustUserSkillStatsForSkillChange).mockReset();
  });

  it("returns publisher-backed owner info plus recent audit logs with actor handles", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const { ctx, auditTake } = makeCtx();

    const result = (await getBySlugForStaffHandler(ctx, {
      slug: "padel",
      auditLogLimit: 5,
    })) as {
      owner: { handle?: string | null } | null;
      overrideReviewer: { handle?: string | null } | null;
      auditLogs: Array<{
        actor: { handle?: string | null } | null;
        action: string;
      }>;
    };

    expect(getSkillBadgeMap).toHaveBeenCalled();
    expect(auditTake).toHaveBeenCalledWith(5);
    expect(result.owner?.handle).toBe("local-publisher");
    expect(result.overrideReviewer?.handle).toBe("moddy");
    expect(result.auditLogs).toHaveLength(2);
    expect(result.auditLogs[0]?.action).toBe("skill.manual_override.set");
    expect(result.auditLogs[0]?.actor?.handle).toBe("moddy");
    expect(result.auditLogs[1]?.actor?.handle).toBe("chief");
  });

  it("keeps the owner publisher pointer in sync when changing skill owners", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    vi.mocked(ensurePersonalPublisherForUser).mockResolvedValue({
      _id: "publishers:next",
      linkedUserId: "users:next-owner",
      kind: "user",
      handle: "next-owner",
      displayName: "Next Owner",
    } as never);

    const skill = {
      _id: "skills:1",
      slug: "padel",
      displayName: "Padel",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:stale",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "active",
      tags: {},
      stats: {},
    };
    const nextOwner = {
      _id: "users:next-owner",
      handle: "next-owner",
      name: "Next Owner",
      displayName: "Next Owner",
      role: "user",
    };
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const query = vi.fn((table: string) => {
      if (table === "skillEmbeddings") {
        return {
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      throw new Error(`Unexpected query table: ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "skills:1") return skill;
      if (id === "users:next-owner") return nextOwner;
      return null;
    });

    await changeOwnerHandler(
      {
        db: {
          get,
          insert,
          normalizeId: vi.fn(() => null),
          patch,
          query,
          system: {},
        },
      } as never,
      { skillId: "skills:1", ownerUserId: "users:next-owner" },
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:next-owner",
        ownerPublisherId: "publishers:next",
      }),
    );
    expect(adjustUserSkillStatsForSkillChange).toHaveBeenCalledWith(
      expect.anything(),
      skill,
      expect.objectContaining({
        ownerUserId: "users:next-owner",
        ownerPublisherId: "publishers:next",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.owner.change",
        metadata: expect.objectContaining({
          fromPublisherId: "publishers:stale",
          toPublisherId: "publishers:next",
        }),
      }),
    );
  });
});
