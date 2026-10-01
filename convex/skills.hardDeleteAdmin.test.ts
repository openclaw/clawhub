/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { hardDeleteForAdminInternal } from "./skills";

type HardDeleteForAdminArgs = {
  actorUserId: string;
  slug: string;
  ownerHandle: string;
  reason: string;
  dryRun?: boolean;
  confirmationToken?: string;
};

type HardDeleteForAdminResult = {
  ok: true;
  skillId: string;
  slug: string;
  ownerHandle: string;
  displayName: string;
  dryRun: boolean;
  scheduled: boolean;
  confirmationToken: string;
};

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const hardDeleteForAdminHandler = (
  hardDeleteForAdminInternal as unknown as WrappedHandler<
    HardDeleteForAdminArgs,
    HardDeleteForAdminResult
  >
)._handler;

function makeCtx() {
  const skill = {
    _id: "skills:demo",
    slug: "demo",
    displayName: "Demo",
    ownerUserId: "users:owner",
    ownerPublisherId: "publishers:openclaw",
    softDeletedAt: 1_000,
    hiddenAt: 1_000,
    hiddenBy: "users:moderator",
    moderationStatus: "removed",
  };
  const insert = vi.fn();
  const scheduler = { runAfter: vi.fn() };
  const query = vi.fn((table: string) => {
    if (table === "publishers") {
      return {
        withIndex: () => ({
          unique: async () => ({
            _id: "publishers:openclaw",
            kind: "user",
            handle: "openclaw",
            linkedUserId: "users:owner",
          }),
        }),
      };
    }
    if (table === "skills") {
      return {
        withIndex: () => ({
          unique: async () => skill,
        }),
      };
    }
    if (table === "skillVersions") {
      return {
        withIndex: () => ({
          take: async () => [],
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const ctx = {
    db: {
      get: vi.fn(async (id: string) =>
        id === "users:admin"
          ? {
              _id: "users:admin",
              role: "admin",
              deletedAt: undefined,
              deactivatedAt: undefined,
            }
          : null,
      ),
      insert,
      patch: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      query,
      normalizeId: vi.fn(),
    },
    scheduler,
  } as never;
  return { ctx, insert, scheduler };
}

const baseArgs = {
  actorUserId: "users:admin",
  slug: "demo",
  ownerHandle: "openclaw",
  reason: "Owner-requested cleanup",
};

describe("hardDeleteForAdminInternal", () => {
  it("resolves a banned legacy owner whose stored handle uses mixed case", async () => {
    const legacySkill = {
      _id: "skills:legacy",
      slug: "legacy-demo",
      displayName: "Legacy Demo",
      ownerUserId: "users:legacy-owner",
      softDeletedAt: 1_000,
      moderationStatus: "hidden",
      moderationReason: "user.banned",
    };
    const legacyOwner = {
      _id: "users:legacy-owner",
      handle: "Cybercentry",
      deletedAt: 1_000,
    };
    const insert = vi.fn();
    const scheduler = { runAfter: vi.fn() };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") {
            return {
              _id: "users:admin",
              role: "admin",
              deletedAt: undefined,
              deactivatedAt: undefined,
            };
          }
          if (id === legacyOwner._id) return legacyOwner;
          if (id === legacySkill._id) return legacySkill;
          return null;
        }),
        insert,
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: (indexName: string) => {
            if (table === "publishers" && indexName === "by_handle") {
              return { unique: async () => null };
            }
            if (table === "users" && indexName === "handle") {
              return { unique: async () => null };
            }
            if (table === "skills" && indexName === "by_slug") {
              return { take: async () => [legacySkill] };
            }
            if (table === "skillSlugAliases" && indexName === "by_slug") {
              return { take: async () => [] };
            }
            throw new Error(`Unexpected query ${table}.${indexName}`);
          },
        })),
        normalizeId: vi.fn(),
      },
      scheduler,
    } as never;

    const result = await hardDeleteForAdminHandler(ctx, {
      ...baseArgs,
      slug: legacySkill.slug,
      ownerHandle: "cybercentry",
    });

    expect(result).toMatchObject({
      skillId: legacySkill._id,
      slug: legacySkill.slug,
      ownerHandle: "cybercentry",
      dryRun: true,
      scheduled: false,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("returns an exact confirmation token without mutating during dry-run", async () => {
    const generated_token_reference = "hard-delete-skill:@openclaw/demo:skills:demo";
    const { ctx, insert, scheduler } = makeCtx();

    const result = await hardDeleteForAdminHandler(ctx, baseArgs);

    expect(result).toEqual({
      ok: true,
      skillId: "skills:demo",
      slug: "demo",
      ownerHandle: "openclaw",
      displayName: "Demo",
      dryRun: true,
      scheduled: false,
      confirmationToken: generated_token_reference,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("rejects apply without the exact dry-run confirmation token", async () => {
    const { ctx, insert, scheduler } = makeCtx();

    await expect(
      hardDeleteForAdminHandler(ctx, {
        ...baseArgs,
        dryRun: false,
        confirmationToken: "wrong",
      }),
    ).rejects.toThrow('Confirmation token must be "hard-delete-skill:@openclaw/demo:skills:demo"');
    expect(insert).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("audits the reason and schedules the existing batched cleanup", async () => {
    const { ctx, insert, scheduler } = makeCtx();
    const generated_token_reference = "hard-delete-skill:@openclaw/demo:skills:demo";

    const result = await hardDeleteForAdminHandler(ctx, {
      ...baseArgs,
      dryRun: false,
      confirmationToken: generated_token_reference,
    });

    expect(result).toMatchObject({
      dryRun: false,
      scheduled: true,
      confirmationToken: generated_token_reference,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:admin",
        action: "skill.hard_delete.requested",
        targetType: "skill",
        targetId: "skills:demo",
        metadata: {
          slug: "demo",
          ownerHandle: "openclaw",
          reason: "Owner-requested cleanup",
          source: "clawhub-admin",
        },
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        skillId: "skills:demo",
        actorUserId: "users:admin",
        phase: "fingerprints",
        source: "admin",
        reason: "Owner-requested cleanup",
      }),
    );
  });
});
