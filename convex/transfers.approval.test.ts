import { afterEach, describe, expect, it, vi } from "vitest";
import { approvePendingApprovalAsModerator as approvePackagePendingApproval } from "./packageTransfers";
import { approvePendingApprovalAsModerator as approveSkillPendingApproval } from "./skillTransfers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("management transfer approvals", () => {
  it("approves queued skill transfers and updates aliases", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");

    const result = (await approveSkillPendingApproval(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: "users:moderator", role: "moderator" };
            if (id === "skillOwnershipTransfers:1") {
              return {
                _id: "skillOwnershipTransfers:1",
                skillId: "skills:1",
                fromUserId: "users:1",
                fromPublisherId: "publishers:owner",
                toUserId: "users:2",
                toPublisherId: "publishers:alice",
                status: "pending_admin_approval",
                requestedAt: Date.now() - 5_000,
                expiresAt: Date.now() + 10_000,
              };
            }
            if (id === "skills:1") {
              return {
                _id: "skills:1",
                slug: "demo",
                ownerUserId: "users:1",
                ownerPublisherId: "publishers:owner",
              };
            }
            if (id === "users:2") {
              return { _id: "users:2", handle: "alice" };
            }
            if (id === "publishers:alice") {
              return {
                _id: "publishers:alice",
                kind: "user",
                handle: "alice",
                linkedUserId: "users:2",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skillSlugAliases") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_skill");
                  return {
                    collect: async () => [
                      { _id: "skillSlugAliases:1", skillId: "skills:1" },
                      { _id: "skillSlugAliases:2", skillId: "skills:1" },
                    ],
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
          patch,
          insert,
        },
      } as never,
      "users:moderator" as never,
      "skillOwnershipTransfers:1" as never,
    )) as { ok: boolean; status: string; skillSlug: string };

    expect(result).toEqual({ ok: true, status: "accepted", skillSlug: "demo" });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:2",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "accepted" }),
    );
  });

  it("approves queued package transfers", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");

    const result = (await approvePackagePendingApproval(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:moderator") return { _id: "users:moderator", role: "moderator" };
            if (id === "packageOwnershipTransfers:1") {
              return {
                _id: "packageOwnershipTransfers:1",
                packageId: "packages:1",
                fromUserId: "users:1",
                fromPublisherId: "publishers:owner",
                toUserId: "users:2",
                toPublisherId: "publishers:alice",
                status: "pending_admin_approval",
                requestedAt: Date.now() - 5_000,
                expiresAt: Date.now() + 10_000,
              };
            }
            if (id === "packages:1") {
              return {
                _id: "packages:1",
                name: "demo-pkg",
                ownerUserId: "users:1",
                ownerPublisherId: "publishers:owner",
              };
            }
            if (id === "users:2") {
              return { _id: "users:2", handle: "alice" };
            }
            if (id === "publishers:alice") {
              return {
                _id: "publishers:alice",
                kind: "user",
                handle: "alice",
                linkedUserId: "users:2",
              };
            }
            return null;
          }),
          patch,
          insert,
        },
      } as never,
      "users:moderator" as never,
      "packageOwnershipTransfers:1" as never,
    )) as { ok: boolean; status: string; packageName: string };

    expect(result).toEqual({ ok: true, status: "accepted", packageName: "demo-pkg" });
    expect(patch).toHaveBeenCalledWith(
      "packages:1",
      expect.objectContaining({
        ownerUserId: "users:2",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packageOwnershipTransfers:1",
      expect.objectContaining({ status: "accepted" }),
    );
  });
});
