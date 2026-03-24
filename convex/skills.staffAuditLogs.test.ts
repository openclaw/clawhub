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

const { requireUser } = await import("./lib/access");
const { getSkillBadgeMap } = await import("./lib/badges");
const { getBySlugForStaff } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugForStaffHandler = (
  getBySlugForStaff as unknown as WrappedHandler<{
    slug: string;
    auditLogLimit?: number;
  }>
)._handler;

function makeCtx() {
  const skill = {
    _id: "skills:1",
    slug: "padel",
    displayName: "Padel",
    ownerUserId: "users:owner",
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
  });

  it("returns reviewer info and recent audit logs with actor handles", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const { ctx, auditTake } = makeCtx();

    const result = (await getBySlugForStaffHandler(ctx, {
      slug: "padel",
      auditLogLimit: 5,
    })) as {
      overrideReviewer: { handle?: string | null } | null;
      auditLogs: Array<{
        actor: { handle?: string | null } | null;
        action: string;
      }>;
    };

    expect(getSkillBadgeMap).toHaveBeenCalled();
    expect(auditTake).toHaveBeenCalledWith(5);
    expect(result.overrideReviewer?.handle).toBe("moddy");
    expect(result.auditLogs).toHaveLength(2);
    expect(result.auditLogs[0]?.action).toBe("skill.manual_override.set");
    expect(result.auditLogs[0]?.actor?.handle).toBe("moddy");
    expect(result.auditLogs[1]?.actor?.handle).toBe("chief");
  });
});
