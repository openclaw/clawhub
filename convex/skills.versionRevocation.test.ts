import { afterEach, describe, expect, it, vi } from "vitest";
import { setSkillVersionRevocationForUserInternal } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const setSkillVersionRevocationHandler = (
  setSkillVersionRevocationForUserInternal as unknown as WrappedHandler<{
    actorUserId: string;
    slug: string;
    version: string;
    state: "active" | "revoked";
    reason: string;
  }>
)._handler;

function makeCtx(params?: { manualRevocation?: Record<string, unknown> }) {
  const actor = { _id: "users:moderator", role: "moderator" };
  const skill = { _id: "skills:1", slug: "demo" };
  const version = {
    _id: "skillVersions:1",
    skillId: skill._id,
    version: "1.0.0",
    ...params,
  };
  const patch = vi.fn(async () => {});
  const replace = vi.fn(async () => {});
  const deleteDoc = vi.fn(async () => {});
  const insert = vi.fn(async () => "auditLogs:1");
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn(() => ({
      unique: vi.fn(async () => (table === "skills" ? skill : version)),
    })),
  }));
  const get = vi.fn(async (id: string) => (id === actor._id ? actor : null));
  return {
    ctx: {
      db: {
        get,
        query,
        patch,
        replace,
        delete: deleteDoc,
        insert,
        normalizeId: vi.fn(),
        system: {},
      },
    } as never,
    patch,
    insert,
  };
}

describe("skill version revocation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revokes an exact version and writes an audit record", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { ctx, patch, insert } = makeCtx();

    await expect(
      setSkillVersionRevocationHandler(ctx, {
        actorUserId: "users:moderator",
        slug: "Demo",
        version: "1.0.0",
        state: "revoked",
        reason: "confirmed compromise",
      }),
    ).resolves.toEqual({
      ok: true,
      skillId: "skills:1",
      versionId: "skillVersions:1",
      state: "revoked",
      revokedAt: now,
    });

    expect(patch).toHaveBeenCalledWith("skillVersions:1", {
      manualRevocation: {
        reason: "confirmed compromise",
        reviewerUserId: "users:moderator",
        revokedAt: now,
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.version.revoked",
        targetType: "skillVersion",
        targetId: "skillVersions:1",
      }),
    );
  });

  it("clears an exact version revocation without deleting the version", async () => {
    const { ctx, patch, insert } = makeCtx({
      manualRevocation: {
        reason: "confirmed compromise",
        reviewerUserId: "users:moderator",
        revokedAt: 1,
      },
    });

    await setSkillVersionRevocationHandler(ctx, {
      actorUserId: "users:moderator",
      slug: "demo",
      version: "1.0.0",
      state: "active",
      reason: "false positive cleared",
    });

    expect(patch).toHaveBeenCalledWith("skillVersions:1", {
      manualRevocation: undefined,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.version.revocation_cleared",
      }),
    );
  });
});
