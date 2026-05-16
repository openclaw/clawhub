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
                  unique: async () => ({ _id: "users:2", handle: "alice", displayName: "Alice" }),
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

  it("requestTransferInternal resolves recipient via personal publisher handle", async () => {
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
            if (id === "users:2") {
              return {
                _id: "users:2",
                handle: undefined,
                name: "Alice",
                displayName: "Alice",
              };
            }
            if (id === "skills:1") {
              return {
                _id: "skills:1",
                slug: "demo",
                displayName: "Demo",
                ownerUserId: "users:1",
              };
            }
            if (id === "publishers:alice") {
              return {
                _id: "publishers:alice",
                kind: "user",
                handle: "alice",
                displayName: "Alice",
                linkedUserId: "users:2",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: () => ({
                  unique: async () => null,
                }),
              };
            }
            if (table === "publishers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publishers:alice",
                    kind: "user",
                    handle: "alice",
                    displayName: "Alice",
                    linkedUserId: "users:2",
                  }),
                }),
              };
            }
            if (table === "skillOwnershipTransfers") {
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
        skillId: "skills:1",
        toUserHandle: "@alice",
      } as never,
    )) as { ok: boolean; transferId: string };

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        transferId: "skillOwnershipTransfers:new",
        toUserHandle: "alice",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillOwnershipTransfers",
      expect.objectContaining({
        toUserId: "users:2",
      }),
    );
  });

  it("requestTransferInternal allows publisher admins to request user transfers for org-owned skills", async () => {
    const insert = vi.fn(async (table: string) => {
      if (table === "skillOwnershipTransfers") return "skillOwnershipTransfers:new";
      return "auditLogs:1";
    });

    const result = (await requestTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:admin") return { _id: "users:admin", handle: "admin" };
            if (id === "skills:1") {
              return {
                _id: "skills:1",
                slug: "demo",
                displayName: "Demo",
                ownerUserId: "users:creator",
                ownerPublisherId: "publishers:org",
              };
            }
            if (id === "publishers:org") return { _id: "publishers:org", kind: "org" };
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: () => ({
                  unique: async () => ({ _id: "users:alice", handle: "alice" }),
                }),
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org",
                    userId: "users:admin",
                    role: "admin",
                  }),
                }),
              };
            }
            if (table === "skillOwnershipTransfers") {
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
        actorUserId: "users:admin",
        skillId: "skills:1",
        toUserHandle: "@alice",
      } as never,
    )) as { ok: boolean; transferId: string };

    expect(result).toMatchObject({ ok: true, transferId: "skillOwnershipTransfers:new" });
    expect(insert).toHaveBeenCalledWith(
      "skillOwnershipTransfers",
      expect.objectContaining({
        skillId: "skills:1",
        fromUserId: "users:admin",
        toUserId: "users:alice",
      }),
    );
  });

  it("acceptTransferInternal updates skill and alias ownership to the recipient publisher", async () => {
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
    const aliases = [
      {
        _id: "skillSlugAliases:1",
        slug: "demo-old",
        skillId: "skills:1",
        ownerUserId: "users:1",
        ownerPublisherId: "publishers:owner",
      },
      {
        _id: "skillSlugAliases:2",
        slug: "demo-legacy",
        skillId: "skills:1",
        ownerUserId: "users:1",
        ownerPublisherId: "publishers:owner",
      },
    ];

    const result = (await acceptTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:1") {
              return {
                _id: "users:1",
                handle: "owner",
                deletedAt: undefined,
                deactivatedAt: undefined,
              };
            }
            if (id === "users:2") {
              return {
                _id: "users:2",
                handle: "alice",
                personalPublisherId: "publishers:alice",
                trustedPublisher: false,
              };
            }
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
            if (table === "skillSlugAliases") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_skill");
                  return {
                    collect: async () => aliases,
                  };
                },
              };
            }
            if (table === "skillEmbeddings") {
              return {
                withIndex: (indexName: string) => {
                  expect(indexName).toBe("by_skill");
                  return {
                    collect: async () => [
                      {
                        _id: "skillEmbeddings:1",
                        skillId: "skills:1",
                        ownerId: "users:1",
                      },
                    ],
                  };
                },
              };
            }
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
        transferId: "skillOwnershipTransfers:1",
      } as never,
    )) as { ok: boolean; skillSlug: string };

    expect(result).toEqual({ ok: true, skillSlug: "demo" });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:2",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSlugAliases:1",
      expect.objectContaining({
        ownerUserId: "users:2",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSlugAliases:2",
      expect.objectContaining({
        ownerUserId: "users:2",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillEmbeddings:1",
      expect.objectContaining({
        ownerId: "users:2",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "accepted" }),
    );
  });

  it("acceptTransferInternal honors publisher-admin source requests", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const newPublisher = {
      _id: "publishers:alice",
      kind: "user",
      handle: "alice",
      displayName: "Alice",
      linkedUserId: "users:alice",
      trustedPublisher: false,
    };

    const result = (await acceptTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:alice") {
              return {
                _id: "users:alice",
                handle: "alice",
                personalPublisherId: "publishers:alice",
                trustedPublisher: false,
              };
            }
            if (id === "users:admin") return { _id: "users:admin", handle: "admin" };
            if (id === "skillOwnershipTransfers:1") {
              return {
                _id: "skillOwnershipTransfers:1",
                skillId: "skills:1",
                fromUserId: "users:admin",
                toUserId: "users:alice",
                status: "pending",
                requestedAt: Date.now() - 1_000,
                expiresAt: Date.now() + 10_000,
              };
            }
            if (id === "skills:1") {
              return {
                _id: "skills:1",
                slug: "demo",
                ownerUserId: "users:creator",
                ownerPublisherId: "publishers:org",
              };
            }
            if (id === "publishers:org") return { _id: "publishers:org", kind: "org" };
            if (id === "publishers:alice") return newPublisher;
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org",
                    userId: "users:admin",
                    role: "admin",
                  }),
                }),
              };
            }
            if (table === "publishers") {
              return {
                withIndex: () => ({
                  unique: async () => newPublisher,
                }),
              };
            }
            if (table === "skillSlugAliases" || table === "skillEmbeddings") {
              return {
                withIndex: () => ({
                  collect: async () => [],
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
        actorUserId: "users:alice",
        transferId: "skillOwnershipTransfers:1",
      } as never,
    )) as { ok: boolean; skillSlug: string };

    expect(result).toEqual({ ok: true, skillSlug: "demo" });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:alice",
        ownerPublisherId: "publishers:alice",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "accepted" }),
    );
  });

  it("acceptTransferInternal cancels stale transfer when ownership changed", async () => {
    const patch = vi.fn(async () => {});

    const result = await acceptTransferInternalHandler(
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
    );

    expect(result).toEqual({ ok: false, error: "Transfer is no longer valid" });

    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ ownerUserId: "users:2" }),
    );
  });

  it("acceptTransferInternal cancels transfer when requester is inactive", async () => {
    const patch = vi.fn(async () => {});

    const result = await acceptTransferInternalHandler(
      {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn(),
          get: vi.fn(async (id: string) => {
            if (id === "users:2") return { _id: "users:2", handle: "alice" };
            if (id === "users:1") return { _id: "users:1", handle: "owner", deletedAt: 1 };
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
                ownerUserId: "users:1",
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
    );

    expect(result).toEqual({ ok: false, error: "Transfer is no longer valid" });
    expect(patch).toHaveBeenCalledWith(
      "skillOwnershipTransfers:1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({ ownerUserId: "users:2" }),
    );
  });

  it("acceptTransferInternal cancels transfer when skill is under moderation", async () => {
    const patch = vi.fn(async () => {});

    const result = await acceptTransferInternalHandler(
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
                ownerUserId: "users:1",
                moderationVerdict: "malicious",
                moderationStatus: "hidden",
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
    );

    expect(result).toEqual({ ok: false, error: "Skill is under moderation" });
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
