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

  it("allows owner undelete when owner-initiated soft-delete (hiddenBy === owner, no moderationReason)", async () => {
    const skill = makeSkill({ moderationReason: undefined, hiddenBy: "users:owner" });
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

  // BLOCKER regression: healthy skills almost always carry a benign scanner /
  // pipeline `moderationReason` (e.g. `pending.scan` right after publish, or
  // `scanner.aggregate.clean` after scans land). The owner soft-delete path
  // does NOT clear `moderationReason`, so requiring `moderationReason ===
  // undefined` here would trap owners who delete a normal freshly-published
  // skill and then try to undelete it. The gate must only deny on reasons
  // that describe a system/admin-originated hide.
  it("allows owner undelete when skill carries benign pending.scan reason (freshly-published owner delete)", async () => {
    const skill = makeSkill({
      moderationReason: "pending.scan",
      hiddenBy: "users:owner",
    });
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
      expect.objectContaining({ action: "skill.undelete", actorUserId: "users:owner" }),
    );
  });

  it("allows owner undelete when skill carries benign scanner.aggregate.clean reason", async () => {
    const skill = makeSkill({
      moderationReason: "scanner.aggregate.clean",
      hiddenBy: "users:owner",
    });
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
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        softDeletedAt: undefined,
      }),
    );
  });

  // Defense-in-depth: even when `hiddenBy` equals the owner (e.g. stale from
  // a prior owner delete), an explicit system-origin `moderationReason` must
  // still block owner self-restore.
  it("rejects owner undelete when moderationReason is on the system-origin deny list (auto.reports)", async () => {
    const skill = makeSkill({
      moderationReason: "auto.reports",
      hiddenBy: "users:owner",
    });
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
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  // BLOCKER regression: the moderator UI path (setSoftDeleted) hides a skill
  // without writing moderationReason, only hiddenBy. A gate that trusts
  // moderationReason alone would let the owner reverse the moderator's
  // decision. Authorization must be based on hiddenBy === owner.
  it("rejects owner undelete when hidden by a moderator without moderationReason", async () => {
    const skill = makeSkill({
      moderationReason: undefined,
      hiddenBy: "users:mod",
    });
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

  // Regression: the HTTP boundary (softDeleteErrorToResponse) relies on the
  // "Forbidden:" prefix to map this denial to a deterministic 403 response
  // instead of 500. If a refactor ever drops the prefix, this test fails
  // loudly rather than silently regressing the HTTP contract.
  it("owner undelete denial error message starts with 'Forbidden:' for HTTP mapping", async () => {
    const skill = makeSkill({
      moderationReason: undefined,
      hiddenBy: "users:mod",
    });
    const { ctx } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/^Forbidden:/i);
  });

  // Legacy / manual-override rows can have hiddenBy === undefined while still
  // being in a hidden state. Fail closed: owners cannot self-restore without
  // a positive signal that they hid the record themselves.
  it("rejects owner undelete when hiddenBy is missing (legacy / override-cleared)", async () => {
    const skill = makeSkill({
      moderationReason: undefined,
      hiddenBy: undefined,
    });
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

  // Merging a skill into another (owner-initiated) sets hiddenBy === owner
  // AND moderationReason === "owner.merged". The owner must NOT be able to
  // reverse a merge through the generic undelete path.
  it("rejects owner undelete when skill was soft-deleted by owner-initiated merge", async () => {
    const skill = makeSkill({
      moderationReason: "owner.merged",
      hiddenBy: "users:owner",
    });
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

  // BLOCKER regression: VT-only escalation (escalateByVtInternal) hides a
  // skill by stamping `blocked.malware` into moderationFlags and flipping
  // moderationStatus to "hidden", but intentionally does NOT overwrite
  // moderationReason (to preserve the aggregate LLM verdict). If the owner
  // had previously owner-initiated-soft-deleted the skill, the stale
  // provenance (`hiddenBy === owner`, `moderationReason === undefined`)
  // would have matched the ownerInitiatedHide check. The gate must
  // fail-closed on any malicious flag/verdict regardless of provenance.
  it("rejects owner undelete when moderationFlags carries blocked.malware (scanner escalation over stale owner hide)", async () => {
    const skill = makeSkill({
      moderationReason: undefined,
      hiddenBy: "users:owner",
      moderationFlags: ["blocked.malware"],
    });
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
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects owner undelete when moderationVerdict is malicious (scanner escalation over stale owner hide)", async () => {
    const skill = makeSkill({
      moderationReason: undefined,
      hiddenBy: "users:owner",
      moderationVerdict: "malicious",
    });
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
    ).rejects.toThrow(/malware/i);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
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
    const skill = makeSkill({ moderationReason: undefined, hiddenBy: "users:owner" });
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
