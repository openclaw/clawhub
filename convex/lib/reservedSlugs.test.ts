import { describe, expect, it, vi } from "vitest";
import {
  enforceReservedSlugCooldownForNewSkill,
  formatReservedSlugCooldownMessage,
  getLatestActiveReservedSlugForPublisher,
  releaseActiveReservedSlugsForPublisher,
} from "./reservedSlugs";

describe("reservedSlugs", () => {
  it("throws a user-facing error when slug is actively reserved by another user", async () => {
    const now = Date.now();
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedSlugs:1",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:owner",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
      patch: vi.fn(async () => {}),
    };

    await expect(
      enforceReservedSlugCooldownForNewSkill({ db } as never, {
        slug: "taken-skill",
        userId: "users:caller" as never,
        ownerPublisher: {
          _id: "publishers:owner",
          kind: "user",
          linkedUserId: "users:owner",
        } as never,
        now,
      }),
    ).rejects.toThrow(formatReservedSlugCooldownMessage("taken-skill", now + 60_000));
  });

  it("does not block another publisher namespace for the same slug", async () => {
    const now = Date.now();
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedSlugs:1",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:owner",
                    originalOwnerPublisherId: "publishers:owner",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
      patch: vi.fn(async () => {}),
    };

    await expect(
      enforceReservedSlugCooldownForNewSkill({ db } as never, {
        slug: "taken-skill",
        userId: "users:caller" as never,
        ownerPublisher: {
          _id: "publishers:other",
          kind: "org",
          linkedUserId: undefined,
        } as never,
        now,
      }),
    ).resolves.toBeUndefined();
    expect(db.patch).not.toHaveBeenCalled();
  });

  it("lets the reserved org publisher namespace release its own reservation", async () => {
    const now = Date.now();
    const patch = vi.fn(async () => {});
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedSlugs:1",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:previous-admin",
                    originalOwnerPublisherId: "publishers:owner",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
      patch,
    };

    await expect(
      enforceReservedSlugCooldownForNewSkill({ db } as never, {
        slug: "taken-skill",
        userId: "users:current-admin" as never,
        ownerPublisher: {
          _id: "publishers:owner",
          kind: "org",
          linkedUserId: undefined,
        } as never,
        now,
      }),
    ).resolves.toBeUndefined();
    expect(patch).toHaveBeenCalledWith("reservedSlugs:1", { releasedAt: now });
  });

  it("only releases reservations for the requested publisher namespace", async () => {
    const now = Date.now();
    const patch = vi.fn(async () => {});
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedSlugs:owner",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:owner",
                    originalOwnerPublisherId: "publishers:owner",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                  {
                    _id: "reservedSlugs:other",
                    slug: "taken-skill",
                    originalOwnerUserId: "users:other",
                    originalOwnerPublisherId: "publishers:other",
                    deletedAt: now - 1000,
                    expiresAt: now + 60_000,
                    releasedAt: undefined,
                  },
                ],
              }),
            };
          },
        };
      }),
      patch,
    };

    await releaseActiveReservedSlugsForPublisher(
      { db } as never,
      "taken-skill",
      {
        _id: "publishers:owner",
        kind: "org",
        linkedUserId: undefined,
      } as never,
      now,
    );

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("reservedSlugs:owner", { releasedAt: now });
  });

  it("finds a publisher reservation beyond the first global page", async () => {
    const now = Date.now();
    const reservations = [
      ...Array.from({ length: 30 }, (_, index) => ({
        _id: `reservedSlugs:other-${index}`,
        slug: "taken-skill",
        originalOwnerUserId: `users:other-${index}`,
        originalOwnerPublisherId: `publishers:other-${index}`,
        deletedAt: now - index,
        expiresAt: now + 60_000,
        releasedAt: undefined,
      })),
      {
        _id: "reservedSlugs:owner",
        slug: "taken-skill",
        originalOwnerUserId: "users:owner",
        originalOwnerPublisherId: "publishers:owner",
        deletedAt: now - 31,
        expiresAt: now + 60_000,
        releasedAt: undefined,
      },
    ];
    const take = vi.fn(async () => {
      throw new Error("publisher-scoped lookup must not stop at the first global page");
    });
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedSlugs") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_slug_active_deletedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take,
                async *[Symbol.asyncIterator]() {
                  for (const reservation of reservations) yield reservation;
                },
              }),
            };
          },
        };
      }),
    };

    const result = await getLatestActiveReservedSlugForPublisher({ db } as never, "taken-skill", {
      _id: "publishers:owner",
      kind: "org",
      linkedUserId: undefined,
    } as never);

    expect(result?._id).toBe("reservedSlugs:owner");
    expect(take).not.toHaveBeenCalled();
  });
});
