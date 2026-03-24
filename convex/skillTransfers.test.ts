import { describe, expect, it, vi } from "vitest";
import { acceptTransferInternal, requestTransferInternal } from "./skillTransfers";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const requestTransferInternalHandler = (
  requestTransferInternal as unknown as WrappedHandler<{
    actorUserId: string;
    skillId: string;
    toUserHandle: string;
    message?: string;
  }>
)._handler;

const acceptTransferInternalHandler = (
  acceptTransferInternal as unknown as WrappedHandler<{
    actorUserId: string;
    transferId: string;
  }>
)._handler;

describe("skillTransfers", () => {
  it("requestTransferInternal expires stale pending transfer before creating new request", async () => {
    const now = Date.now();
    const stalePending = {
      _id: "skillOwnershipTransfers:stale",
      skillId: "skills:1",
      fromUserId: "users:1",
      toUserId: "users:2",
      status: "pending",
      message: undefined,
      requestedAt: now - 10_000,
      expiresAt: now - 1_000,
    };

    const patch = vi.fn(async () => {});
    const insert = vi.fn(async (table: string) => {
      if (table === "skillOwnershipTransfers") return "skillOwnershipTransfers:new";
      return "auditLogs:1";
    });

    const result = (await requestTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:1") return { _id: "users:1", handle: "owner" };
            if (id === "skills:1") {
              return {
                _id: "skills:1",
                slug: "demo",
                displayName: "Demo",
                ownerUserId: "users:1",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: () => ({
                  first: async () => ({ _id: "users:2", handle: "alice", displayName: "Alice" }),
                }),
              };
            }
            if (table === "skillOwnershipTransfers") {
              return {
                withIndex: () => ({
                  collect: async () => [stalePending],
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
          patch,
          insert,
        },
      } as never,
      {
        actorUserId: "users:1",
        skillId: "skills:1",
        toUserHandle: "@Alice",
      } as never,
    )) as { ok: boolean; transferId: string };

    expect(result.ok).toBe(true);
    expect(result.transferId).toBe("skillOwnershipTransfers:new");
    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:stale",
      expect.objectContaining({ status: "expired" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillOwnershipTransfers",
      expect.objectContaining({
        skillId: "skills:1",
        fromUserId: "users:1",
        toUserId: "users:2",
        status: "pending",
      }),
    );
  });

  it("acceptTransferInternal cancels stale transfer when ownership changed", async () => {
    const patch = vi.fn(async () => {});

    await expect(
      acceptTransferInternalHandler(
        {
          db: {
            normalizeId: vi.fn(),
            query: vi.fn(),
            get: vi.fn(async (id: string) => {
              if (id === "users:2") return { _id: "users:2", handle: "alice" };
              if (id === "skillOwnershipTransfers:1") {
                return {
                  _id: "skillOwnershipTransfers:1",
                  skillId: "skills:1",
                  fromUserId: "users:1",
                  toUserId: "users:2",
                  status: "pending",
                  requestedAt: Date.now() - 1_000,
                  expiresAt: Date.now() + 10_000,
                };
              }
              if (id === "skills:1") {
                return {
                  _id: "skills:1",
                  slug: "demo",
                  ownerUserId: "users:someone-else",
                };
              }
              return null;
            }),
            patch,
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          actorUserId: "users:2",
          transferId: "skillOwnershipTransfers:1",
        } as never,
      ),
    ).rejects.toThrow(/no longer valid/i);

    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ ownerUserId: "users:2" }),
    );
  });
});
