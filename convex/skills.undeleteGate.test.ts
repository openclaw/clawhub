import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { setSkillSoftDeletedInternal } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const setSkillSoftDeletedInternalHandler = (
  setSkillSoftDeletedInternal as unknown as WrappedHandler<{
    userId: string;
    slug: string;
    deleted: boolean;
    reason?: string;
  }>
)._handler;

type UserRole = "user" | "moderator" | "admin";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:1",
    slug: "demo",
    ownerUserId: "users:owner",
    moderationStatus: "hidden",
    softDeletedAt: 1_000,
    hiddenAt: 1_000,
    hiddenBy: "users:mod",
    ...overrides,
  };
}

function makeCtx({
  skill,
  actor,
}: {
  skill: Record<string, unknown> | null;
  actor: { _id: string; role?: UserRole };
}) {
  const patch = vi.fn(async () => {});
  const insert = vi.fn(async () => "auditLogs:1");

  const db = {
    normalizeId: vi.fn(),
    get: vi.fn(async (id: string) => {
      if (id === actor._id) return actor;
      return null;
    }),
    query: vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
            return { unique: async () => skill };
          },
        };
      }
      if (table === "skillEmbeddings") {
        return {
          withIndex: () => ({ collect: async () => [] }),
        };
      }
      if (table === "globalStats") {
        return {
          withIndex: () => ({ unique: async () => null }),
        };
      }
      if (table === "skillSearchDigest") {
        return {
          withIndex: () => ({ unique: async () => null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    patch,
    insert,
  };

  return { ctx: { db } as never, patch, insert };
}

describe("setSkillSoftDeletedInternal B1 undelete gate", () => {
  it("rejects owner undelete when moderationReason is set (moderator-hidden)", async () => {
    const skill = makeSkill({ moderationReason: "manual.quality" });
    const { ctx, patch, insert } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/moderation/i);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects owner undelete for scanner-managed hidden state", async () => {
    const skill = makeSkill({ moderationReason: "scanner.vt.suspicious" });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/moderation/i);

    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects owner undelete for security-redaction hidden state", async () => {
    const skill = makeSkill({ moderationReason: "security.redaction" });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/moderation/i);

    expect(patch).not.toHaveBeenCalled();
  });

  it("allows owner undelete when moderationReason is undefined (self-initiated soft-delete)", async () => {
    const skill = makeSkill({ moderationReason: undefined });
    const { ctx, patch, insert } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        softDeletedAt: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.undelete",
        actorUserId: "users:owner",
      }),
    );
  });

  it("allows moderator to undelete moderator-hidden skill", async () => {
    const skill = makeSkill({ moderationReason: "manual.quality" });
    const { ctx, patch, insert } = makeCtx({
      skill,
      actor: { _id: "users:mod", role: "moderator" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:mod",
        slug: "demo",
        deleted: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        softDeletedAt: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.undelete",
        metadata: expect.objectContaining({ actorRole: "moderator" }),
      }),
    );
  });

  it("allows admin to undelete moderator-hidden skill", async () => {
    const skill = makeSkill({ moderationReason: "scanner.vt.suspicious" });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:admin", role: "admin" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:admin",
        slug: "demo",
        deleted: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ moderationStatus: "active" }),
    );
  });

  it("still allows owner to soft-delete (deleted=true) their own skill regardless of gate", async () => {
    const skill = makeSkill({
      moderationStatus: "active",
      softDeletedAt: undefined,
      hiddenAt: undefined,
      hiddenBy: undefined,
      moderationReason: undefined,
    });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: true,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:owner",
      }),
    );
  });

  it("rejects non-owner non-moderator callers with Forbidden", async () => {
    const skill = makeSkill({ moderationReason: undefined });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:stranger", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:stranger",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow();

    expect(patch).not.toHaveBeenCalled();
  });
});
