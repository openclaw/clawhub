import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
});

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
    stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0 },
    ...overrides,
  };
}

function makeCtx({
  skill,
  actor,
  hiddenBy,
  membership,
}: {
  skill: Record<string, unknown> | null;
  actor: { _id: string; role?: UserRole };
  hiddenBy?: { _id: string; role?: UserRole } | null;
  membership?: Record<string, unknown> | null;
}) {
  const patch = vi.fn(async () => {});
  const insert = vi.fn(async () => "auditLogs:1");

  const db = {
    normalizeId: vi.fn(),
    get: vi.fn(async (id: string) => {
      if (id === actor._id) return actor;
      if (hiddenBy && id === hiddenBy._id) return hiddenBy;
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
      if (table === "publisherMembers") {
        return {
          withIndex: () => ({ unique: async () => membership ?? null }),
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
  it("allows org publisher admins to restore org-admin hidden skills", async () => {
    const skill = makeSkill({
      ownerUserId: "users:creator",
      ownerPublisherId: "publishers:org",
      hiddenBy: "users:hidden-admin",
      moderationReason: undefined,
    });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:actor", role: "user" },
      hiddenBy: { _id: "users:hidden-admin", role: "user" },
      membership: { _id: "publisherMembers:1", role: "admin" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:actor",
        slug: "demo",
        deleted: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        hiddenBy: undefined,
      }),
    );
  });

  it("rejects org publisher admins restoring moderator-hidden skills", async () => {
    const skill = makeSkill({
      ownerUserId: "users:creator",
      ownerPublisherId: "publishers:org",
      hiddenBy: "users:mod",
      moderationReason: undefined,
    });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:actor", role: "user" },
      hiddenBy: { _id: "users:mod", role: "moderator" },
      membership: { _id: "publisherMembers:1", role: "admin" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:actor",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
  });

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
        unpublishedSlugReservedUntil: undefined,
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

  // BLOCKER regression: a moderator restore (`setSoftDeleted` with
  // deleted=false) clears `hiddenBy` but does NOT clear `moderationReason`,
  // so a row can carry a stale "auto.reports" reason while being
  // moderationStatus="active". If the owner later self-deletes, the current
  // hide is owner-initiated (hiddenBy === owner) and a later self-undelete
  // must be allowed — the stale historical reason must not create a sticky
  // 403 that requires moderator intervention.
  it("allows owner undelete when hiddenBy === owner even though stale moderationReason is auto.reports", async () => {
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

  it("allows owner undelete when hiddenBy === owner even though stale moderationReason is manual.report", async () => {
    const skill = makeSkill({
      moderationReason: "manual.report",
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

  // Data hygiene: when the owner self-deletes a skill that carried a stale
  // moderation reason (e.g. left over from a previous moderator restore),
  // the delete must clear `moderationReason` so future rows reflect the
  // current hide's provenance rather than historical metadata.
  it("owner self-delete clears stale moderationReason so subsequent undelete is clean", async () => {
    const skill = makeSkill({
      moderationStatus: "active",
      softDeletedAt: undefined,
      hiddenAt: undefined,
      hiddenBy: undefined,
      moderationReason: "auto.reports",
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
    ).resolves.toMatchObject({ ok: true, slugReservedUntil: expect.any(Number) });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:owner",
        moderationReason: undefined,
      }),
    );
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

  it("lets moderators unhide scanner-blocked skills as a manual clean override", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const skill = makeSkill({
      moderationReason: "scanner.vt.malicious",
      moderationFlags: ["blocked.malware"],
      moderationVerdict: "malicious",
      moderationReasonCodes: ["malicious.vt_malicious"],
      moderationEvidence: [{ scanner: "vt", detail: "malicious" }],
      moderationSummary: "Blocked by scanner.",
      moderationEngineVersion: "old",
      moderationEvaluatedAt: now - 1_000,
      moderationSourceVersionId: "skillVersions:old",
    });
    const { ctx, patch, insert } = makeCtx({
      skill,
      actor: { _id: "users:mod", role: "moderator" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:mod",
        slug: "demo",
        deleted: false,
        reason: "VT false positive; reanalysis clean",
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "manual.override.clean",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        moderationEvidence: undefined,
        moderationEngineVersion: undefined,
        moderationSourceVersionId: undefined,
        moderationNotes: "VT false positive; reanalysis clean",
        hiddenAt: undefined,
        hiddenBy: undefined,
        manualOverride: expect.objectContaining({
          verdict: "clean",
          note: "VT false positive; reanalysis clean",
          reviewerUserId: "users:mod",
          updatedAt: now,
        }),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.undelete",
        metadata: expect.objectContaining({
          reason: "VT false positive; reanalysis clean",
          actorRole: "moderator",
        }),
      }),
    );
  });

  it("still allows owner to soft-delete (deleted=true) their own skill regardless of gate", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
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
    ).resolves.toEqual({ ok: true, slugReservedUntil: now + 30 * 24 * 60 * 60 * 1000 });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:owner",
        unpublishedSlugReservedUntil: now + 30 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it("returns a slug reservation when an elevated owner soft-deletes their own skill", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const skill = makeSkill({
      moderationStatus: "active",
      softDeletedAt: undefined,
      hiddenAt: undefined,
      hiddenBy: undefined,
      moderationReason: undefined,
    });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "admin" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: true,
      }),
    ).resolves.toEqual({ ok: true, slugReservedUntil: now + 30 * 24 * 60 * 60 * 1000 });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:owner",
        unpublishedSlugReservedUntil: now + 30 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  // BLOCKER regression: the owner MUST NOT be able to "re-delete" a skill
  // that is currently hidden by a moderator/system. Without this guard,
  // the delete patch would rewrite `hiddenBy` to the owner (and clear
  // `moderationReason`), so a subsequent owner-undelete would pass the
  // provenance-based gate and reverse the moderator's hide — a
  // privilege-escalation chain in two API calls.
  it("rejects owner delete (deleted=true) when skill is currently moderator-hidden", async () => {
    const skill = makeSkill({
      moderationStatus: "hidden",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:mod",
      moderationReason: "manual.quality",
    });
    const { ctx, patch, insert } = makeCtx({
      skill,
      actor: { _id: "users:owner", role: "user" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: true,
      }),
    ).rejects.toThrow(/^Forbidden:/i);

    // Critically: no patch must land — otherwise hiddenBy/moderationReason
    // would be corrupted and the follow-up undelete could succeed.
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  // Chain verification: even if the guard were bypassed, the full two-call
  // exploit (owner delete → owner undelete) must fail at the boundary.
  // This test drives the chain end-to-end using the actual handler: the
  // first call (delete) is expected to reject, so the stored provenance
  // remains intact and the subsequent undelete still hits the moderator
  // hide.
  it("owner delete on moderator-hidden skill does NOT enable a subsequent owner undelete", async () => {
    // Shared mutable skill state so patch() modifications (if any) persist
    // across the two handler invocations.
    const skillState: Record<string, unknown> = {
      _id: "skills:1",
      slug: "demo",
      ownerUserId: "users:owner",
      moderationStatus: "hidden",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:mod",
      moderationReason: "manual.quality",
    };

    const patch = vi.fn(async (_id: string, p: Record<string, unknown>) => {
      Object.assign(skillState, p);
    });
    const insert = vi.fn(async () => "auditLogs:1");
    const actor = { _id: "users:owner", role: "user" as const };

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
              return { unique: async () => skillState };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return { withIndex: () => ({ collect: async () => [] }) };
        }
        if (table === "globalStats") {
          return { withIndex: () => ({ unique: async () => null }) };
        }
        if (table === "skillSearchDigest") {
          return { withIndex: () => ({ unique: async () => null }) };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    };
    const ctx = { db } as never;

    // Step 1: owner delete must be rejected by the provenance guard.
    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: true,
      }),
    ).rejects.toThrow(/^Forbidden:/i);

    // Provenance must be untouched.
    expect(skillState.hiddenBy).toBe("users:mod");
    expect(skillState.moderationReason).toBe("manual.quality");

    // Step 2: owner undelete must also be rejected, because the current
    // hide is still moderator-provenance.
    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:owner",
        slug: "demo",
        deleted: false,
      }),
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects owner delete (deleted=true) when skill is hidden with no hiddenBy (auto.reports)", async () => {
    const skill = makeSkill({
      moderationStatus: "hidden",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: undefined,
      moderationReason: "auto.reports",
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
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects owner delete (deleted=true) when skill is security-redaction hidden", async () => {
    const skill = makeSkill({
      moderationStatus: "hidden",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:security-admin",
      moderationReason: "security.redaction",
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
    ).rejects.toThrow(/^Forbidden:/i);

    expect(patch).not.toHaveBeenCalled();
  });

  // Idempotency: if the current hide is already owner-initiated, re-delete
  // must remain a safe no-op-ish operation (provenance does not change
  // meaningfully because hiddenBy is still the owner).
  it("allows owner delete (deleted=true) when skill is already owner-hidden (idempotent)", async () => {
    const skill = makeSkill({
      moderationStatus: "hidden",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:owner",
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
    ).resolves.toMatchObject({ ok: true, slugReservedUntil: expect.any(Number) });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:owner",
      }),
    );
  });

  // Moderators and admins must retain full access via this internal entry
  // point — the provenance guard applies only to non-privileged owners.
  it("allows moderator to delete (deleted=true) a skill regardless of provenance guard", async () => {
    const skill = makeSkill({
      moderationStatus: "active",
      softDeletedAt: undefined,
      hiddenAt: undefined,
      hiddenBy: undefined,
      moderationReason: undefined,
    });
    const { ctx, patch } = makeCtx({
      skill,
      actor: { _id: "users:mod", role: "moderator" },
    });

    await expect(
      setSkillSoftDeletedInternalHandler(ctx, {
        userId: "users:mod",
        slug: "demo",
        deleted: true,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        hiddenBy: "users:mod",
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
