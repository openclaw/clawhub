import { describe, expect, it, vi } from "vitest";
import {
  acceptTransferInternal,
  cancelTransferInternal,
  listIncomingInternal,
  requestTransferInternal,
} from "./packageTransfers";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const requestTransferInternalHandler = (
  requestTransferInternal as unknown as WrappedHandler<{
    actorUserId: string;
    packageId: string;
    toUserHandle: string;
    toPublisherId?: string;
    message?: string;
  }>
)._handler;

const acceptTransferInternalHandler = (
  acceptTransferInternal as unknown as WrappedHandler<{
    actorUserId: string;
    transferId: string;
    publisherId?: string;
  }>
)._handler;

const cancelTransferInternalHandler = (
  cancelTransferInternal as unknown as WrappedHandler<{
    actorUserId: string;
    transferId: string;
  }>
)._handler;

const listIncomingInternalHandler = (
  listIncomingInternal as unknown as WrappedHandler<{
    userId: string;
  }>
)._handler;

describe("packageTransfers", () => {
  it("requestTransferInternal creates pending transfer for user→user", async () => {
    const insert = vi.fn(async (table: string) => {
      if (table === "packageOwnershipTransfers") return "packageOwnershipTransfers:new";
      return "auditLogs:1";
    });

    const result = (await requestTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:1") return { _id: "users:1", handle: "owner" };
            if (id === "packages:1") {
              return {
                _id: "packages:1",
                name: "my-pkg",
                displayName: "My Package",
                ownerUserId: "users:1",
                ownerPublisherId: undefined,
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "users:2",
                    handle: "alice",
                    displayName: "Alice",
                  }),
                }),
              };
            }
            if (table === "packageOwnershipTransfers") {
              return {
                withIndex: () => ({
                  collect: async () => [],
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
          patch: vi.fn(async () => {}),
          insert,
        },
      } as never,
      {
        actorUserId: "users:1",
        packageId: "packages:1",
        toUserHandle: "@Alice",
      } as never,
    )) as { ok: boolean; transferId: string; toUserHandle: string };

    expect(result.ok).toBe(true);
    expect(result.transferId).toBe("packageOwnershipTransfers:new");
    expect(result.toUserHandle).toBe("alice");
    expect(insert).toHaveBeenCalledWith(
      "packageOwnershipTransfers",
      expect.objectContaining({
        packageId: "packages:1",
        fromUserId: "users:1",
        toUserId: "users:2",
        status: "pending",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "package.transfer.request",
        targetType: "package",
        targetId: "packages:1",
      }),
    );
  });

  it("requestTransferInternal rejects if actor is not owner (Forbidden)", async () => {
    await expect(
      requestTransferInternalHandler(
        {
          db: {
            normalizeId: vi.fn(),
            get: vi.fn(async (id: string) => {
              if (id === "users:1") return { _id: "users:1", handle: "owner" };
              if (id === "packages:1") {
                return {
                  _id: "packages:1",
                  name: "my-pkg",
                  displayName: "My Package",
                  ownerUserId: "users:someone-else",
                  ownerPublisherId: undefined,
                };
              }
              return null;
            }),
            query: vi.fn(),
            patch: vi.fn(async () => {}),
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          actorUserId: "users:1",
          packageId: "packages:1",
          toUserHandle: "@alice",
        } as never,
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  it("requestTransferInternal rejects transfer to self", async () => {
    await expect(
      requestTransferInternalHandler(
        {
          db: {
            normalizeId: vi.fn(),
            get: vi.fn(async (id: string) => {
              if (id === "users:1") return { _id: "users:1", handle: "owner" };
              if (id === "packages:1") {
                return {
                  _id: "packages:1",
                  name: "my-pkg",
                  displayName: "My Package",
                  ownerUserId: "users:1",
                  ownerPublisherId: undefined,
                };
              }
              return null;
            }),
            query: vi.fn((table: string) => {
              if (table === "users") {
                return {
                  withIndex: () => ({
                    unique: async () => ({
                      _id: "users:1",
                      handle: "owner",
                      displayName: "Owner",
                    }),
                  }),
                };
              }
              if (table === "packageOwnershipTransfers") {
                return {
                  withIndex: () => ({
                    collect: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected table ${table}`);
            }),
            patch: vi.fn(async () => {}),
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          actorUserId: "users:1",
          packageId: "packages:1",
          toUserHandle: "@owner",
        } as never,
      ),
    ).rejects.toThrow(/yourself/i);
  });

  it("acceptTransferInternal queues package transfer for management approval", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const newPublisher = {
      _id: "publishers:alice",
      handle: "alice",
      displayName: "Alice",
      linkedUserId: "users:2",
      trustedPublisher: false,
    };
    const existingMember = {
      _id: "publisherMembers:1",
      publisherId: "publishers:alice",
      userId: "users:2",
      role: "owner",
    };

    const result = (await acceptTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:2") {
              return {
                _id: "users:2",
                handle: "alice",
                personalPublisherId: "publishers:alice",
                trustedPublisher: false,
              };
            }
            if (id === "packageOwnershipTransfers:1") {
              return {
                _id: "packageOwnershipTransfers:1",
                packageId: "packages:1",
                fromUserId: "users:1",
                toUserId: "users:2",
                status: "pending",
                requestedAt: Date.now() - 1_000,
                expiresAt: Date.now() + 10_000,
              };
            }
            if (id === "packages:1") {
              return {
                _id: "packages:1",
                name: "my-pkg",
                displayName: "My Package",
                ownerUserId: "users:1",
                ownerPublisherId: "publishers:owner",
              };
            }
            if (id === "publishers:alice") {
              return newPublisher;
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "publishers") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_handle");
                  return {
                    unique: async () => newPublisher,
                  };
                },
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_publisher_user");
                  return {
                    unique: async () => existingMember,
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
      {
        actorUserId: "users:2",
        transferId: "packageOwnershipTransfers:1",
      } as never,
    )) as { ok: boolean; packageName: string; status: string };

    expect(result).toEqual({
      ok: true,
      packageName: "my-pkg",
      status: "pending_admin_approval",
    });
    expect(patch).not.toHaveBeenCalledWith(
      "packages:1",
      expect.objectContaining({
        ownerUserId: "users:2",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packageOwnershipTransfers:1",
      expect.objectContaining({
        status: "pending_admin_approval",
        toUserId: "users:2",
        toPublisherId: "publishers:alice",
      }),
    );
  });

  it("acceptTransferInternal cancels stale transfer when ownership changed since request", async () => {
    const patch = vi.fn(async () => {});

    await expect(
      acceptTransferInternalHandler(
        {
          db: {
            normalizeId: vi.fn(),
            query: vi.fn(),
            get: vi.fn(async (id: string) => {
              if (id === "users:2") return { _id: "users:2", handle: "alice" };
              if (id === "packageOwnershipTransfers:1") {
                return {
                  _id: "packageOwnershipTransfers:1",
                  packageId: "packages:1",
                  fromUserId: "users:1",
                  toUserId: "users:2",
                  status: "pending",
                  requestedAt: Date.now() - 1_000,
                  expiresAt: Date.now() + 10_000,
                };
              }
              if (id === "packages:1") {
                return {
                  _id: "packages:1",
                  name: "my-pkg",
                  displayName: "My Package",
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
          transferId: "packageOwnershipTransfers:1",
        } as never,
      ),
    ).rejects.toThrow(/no longer valid/i);

    expect(patch).toHaveBeenCalledWith(
      "packageOwnershipTransfers:1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "packages:1",
      expect.objectContaining({ ownerUserId: "users:2" }),
    );
  });

  it("cancelTransferInternal hides personal-publisher transfer existence from other users", async () => {
    await expect(
      cancelTransferInternalHandler(
        {
          db: {
            normalizeId: vi.fn(),
            get: vi.fn(async (id: string) => {
              if (id === "users:2") return { _id: "users:2", handle: "other-user" };
              if (id === "packageOwnershipTransfers:1") {
                return {
                  _id: "packageOwnershipTransfers:1",
                  packageId: "packages:1",
                  fromUserId: "users:1",
                  fromPublisherId: "publishers:owner",
                  status: "pending",
                  requestedAt: Date.now() - 1_000,
                  expiresAt: Date.now() + 10_000,
                };
              }
              if (id === "publishers:owner") {
                return {
                  _id: "publishers:owner",
                  kind: "user",
                  linkedUserId: "users:1",
                  handle: "owner",
                };
              }
              return null;
            }),
            query: vi.fn((table: string) => {
              if (table === "publisherMembers") {
                return {
                  withIndex: () => ({
                    unique: async () => null,
                  }),
                };
              }
              throw new Error(`unexpected table ${table}`);
            }),
            patch: vi.fn(async () => {}),
            insert: vi.fn(async () => "auditLogs:1"),
          },
        } as never,
        {
          actorUserId: "users:2",
          transferId: "packageOwnershipTransfers:1",
        } as never,
      ),
    ).rejects.toThrow(/No pending transfer found/);
  });

  it("listIncomingInternal includes org-targeted package transfers for org admins", async () => {
    const result = (await listIncomingInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:2") return { _id: "users:2", handle: "alice" };
            if (id === "packages:1") {
              return {
                _id: "packages:1",
                name: "my-pkg",
                displayName: "My Package",
              };
            }
            if (id === "users:1") {
              return {
                _id: "users:1",
                handle: "owner",
                displayName: "Owner",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "packageOwnershipTransfers") {
              return {
                withIndex: (indexName: string) => {
                  if (indexName === "by_to_user_status") {
                    return { collect: async () => [] };
                  }
                  if (indexName === "by_to_publisher_status") {
                    return {
                      collect: async () => [
                        {
                          _id: "packageOwnershipTransfers:1",
                          packageId: "packages:1",
                          fromUserId: "users:1",
                          toUserId: "users:9",
                          toPublisherId: "publishers:org1",
                          status: "pending",
                          requestedAt: Date.now() - 1_000,
                          expiresAt: Date.now() + 10_000,
                        },
                      ],
                    };
                  }
                  throw new Error(`unexpected package transfer index ${indexName}`);
                },
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_user");
                  return {
                    collect: async () => [
                      {
                        _id: "publisherMembers:1",
                        publisherId: "publishers:org1",
                        userId: "users:2",
                        role: "admin",
                      },
                    ],
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      } as never,
      { userId: "users:2" } as never,
    )) as Array<{ _id: string; type: string; package: { name: string }; toPublisherId?: string }>;

    expect(result).toEqual([
      expect.objectContaining({
        _id: "packageOwnershipTransfers:1",
        type: "package",
        package: expect.objectContaining({ name: "my-pkg" }),
        toPublisherId: "publishers:org1",
      }),
    ]);
  });
});
