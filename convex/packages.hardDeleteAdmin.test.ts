/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { hardDeleteForAdminInternal } from "./packages";

type Args = {
  actorUserId: string;
  name: string;
  ownerHandle: string;
  reason: string;
  dryRun?: boolean;
  confirmationToken?: string;
};

type Handler = { _handler: (ctx: unknown, args: Args) => Promise<Record<string, unknown>> };
const handler = (hardDeleteForAdminInternal as unknown as Handler)._handler;

function makeCtx(options: { softDeleted?: boolean; ownerHandle?: string } = {}) {
  const pkg = {
    _id: "packages:tencent",
    name: "openclaw-tencent-provider",
    normalizedName: "openclaw-tencent-provider",
    displayName: "Tencent Cloud",
    runtimeId: "tencent",
    ownerUserId: "users:owner",
    ownerPublisherId: "publishers:hxy91819",
    softDeletedAt: options.softDeleted === false ? undefined : 1_000,
  };
  const publisher = {
    _id: "publishers:hxy91819",
    kind: "user",
    handle: options.ownerHandle ?? "hxy91819",
    linkedUserId: "users:owner",
  };
  const insert = vi.fn(async () => "auditLogs:1");
  const remove = vi.fn();
  const query = vi.fn((table: string) => ({
    withIndex: () => ({
      unique: async () => (table === "packages" ? pkg : null),
      collect: async () => [],
    }),
  }));
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "users:admin") return { _id: id, role: "admin" };
        if (id === "publishers:hxy91819") return publisher;
        return null;
      }),
      query,
      insert,
      delete: remove,
      patch: vi.fn(),
      replace: vi.fn(),
      normalizeId: vi.fn(),
    },
  } as never;
  return { ctx, insert, remove };
}

const baseArgs = {
  actorUserId: "users:admin",
  name: "openclaw-tencent-provider",
  ownerHandle: "hxy91819",
  reason: "Free the stale package name for Tencent externalization",
};

describe("hardDeleteForAdminInternal", () => {
  it("returns an exact token without mutating during dry-run", async () => {
    const { ctx, insert, remove } = makeCtx();
    await expect(handler(ctx, baseArgs)).resolves.toEqual({
      ok: true,
      packageId: "packages:tencent",
      name: "openclaw-tencent-provider",
      ownerHandle: "hxy91819",
      displayName: "Tencent Cloud",
      runtimeId: "tencent",
      dryRun: true,
      deleted: false,
      confirmationToken: "hard-delete-package:@hxy91819/openclaw-tencent-provider:packages:tencent",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("requires the package to be soft-deleted and owner-qualified", async () => {
    await expect(handler(makeCtx({ softDeleted: false }).ctx, baseArgs)).rejects.toThrow(
      /must be soft-deleted/i,
    );
    await expect(handler(makeCtx().ctx, { ...baseArgs, ownerHandle: "tencent" })).rejects.toThrow(
      /owner does not match/i,
    );
  });

  it("requires the exact token before deleting and auditing", async () => {
    const { ctx, insert, remove } = makeCtx();
    await expect(
      handler(ctx, { ...baseArgs, dryRun: false, confirmationToken: "wrong" }),
    ).rejects.toThrow(/confirmation token must be/i);
    expect(remove).not.toHaveBeenCalled();

    const token = "hard-delete-package:@hxy91819/openclaw-tencent-provider:packages:tencent";
    const result = await handler(ctx, {
      ...baseArgs,
      dryRun: false,
      confirmationToken: token,
    });
    expect(result).toMatchObject({ dryRun: false, deleted: true });
    expect(remove).toHaveBeenCalledWith("packages:tencent");
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "package.hard_delete.requested",
        targetId: "packages:tencent",
        metadata: expect.objectContaining({
          ownerHandle: "hxy91819",
          reason: baseArgs.reason,
          source: "clawhub-admin",
        }),
      }),
    );
  });
});
