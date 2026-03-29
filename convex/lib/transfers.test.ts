import { describe, expect, it, vi } from "vitest";
import {
  TRANSFER_EXPIRY_MS,
  isTransferExpired,
  normalizeTransferHandle,
  validateTransferOwnership,
  validateTransferAcceptPermission,
} from "./transfers";

describe("transfers", () => {
  it("TRANSFER_EXPIRY_MS is 7 days", () => {
    expect(TRANSFER_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe("isTransferExpired", () => {
    it("returns true when expiresAt is in the past", () => {
      expect(isTransferExpired({ expiresAt: 1000 }, 2000)).toBe(true);
    });

    it("returns false when expiresAt is in the future", () => {
      expect(isTransferExpired({ expiresAt: 3000 }, 2000)).toBe(false);
    });

    it("returns false when expiresAt equals now", () => {
      expect(isTransferExpired({ expiresAt: 2000 }, 2000)).toBe(false);
    });
  });

  describe("normalizeTransferHandle", () => {
    it("trims whitespace", () => {
      expect(normalizeTransferHandle("  alice  ")).toBe("alice");
    });

    it("strips leading @ and lowercases", () => {
      expect(normalizeTransferHandle("@Alice")).toBe("alice");
    });

    it("strips multiple leading @ signs", () => {
      expect(normalizeTransferHandle("@@Bob")).toBe("bob");
    });

    it("lowercases without @", () => {
      expect(normalizeTransferHandle("Charlie")).toBe("charlie");
    });
  });

  describe("validateTransferOwnership", () => {
    it("passes for direct owner (personal, no publisher)", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn(),
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:1" as never,
          ownerUserId: "users:1" as never,
          ownerPublisherId: undefined,
        }),
      ).resolves.toBeUndefined();
    });

    it("passes for org admin", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org1",
                    userId: "users:1",
                    role: "admin",
                  }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:1" as never,
          ownerUserId: "users:99" as never,
          ownerPublisherId: "publishers:org1" as never,
        }),
      ).resolves.toBeUndefined();
    });

    it("passes for org owner role", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org1",
                    userId: "users:1",
                    role: "owner",
                  }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:1" as never,
          ownerUserId: "users:99" as never,
          ownerPublisherId: "publishers:org1" as never,
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects non-admin org member (publisher role)", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org1",
                    userId: "users:1",
                    role: "publisher",
                  }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:1" as never,
          ownerUserId: "users:99" as never,
          ownerPublisherId: "publishers:org1" as never,
        }),
      ).rejects.toThrow("Forbidden");
    });

    it("rejects non-owner non-member", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
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
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:1" as never,
          ownerUserId: "users:99" as never,
          ownerPublisherId: "publishers:org1" as never,
        }),
      ).rejects.toThrow("Forbidden");
    });

    it("rejects personal item when actor is not the owner", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn(),
        },
      };

      await expect(
        validateTransferOwnership(ctx as never, {
          actorUserId: "users:2" as never,
          ownerUserId: "users:1" as never,
          ownerPublisherId: undefined,
        }),
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("validateTransferAcceptPermission", () => {
    it("passes for personal target when actor is the target user", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn(),
        },
      };

      await expect(
        validateTransferAcceptPermission(ctx as never, {
          actorUserId: "users:1" as never,
          toUserId: "users:1" as never,
          toPublisherId: undefined,
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects personal target when actor is not the target user", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          query: vi.fn(),
        },
      };

      await expect(
        validateTransferAcceptPermission(ctx as never, {
          actorUserId: "users:2" as never,
          toUserId: "users:1" as never,
          toPublisherId: undefined,
        }),
      ).rejects.toThrow("No pending transfer found");
    });

    it("passes for org target when actor is admin", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async () => ({
            _id: "publishers:org1",
            kind: "org",
            handle: "myorg",
          })),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org1",
                    userId: "users:1",
                    role: "admin",
                  }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      await expect(
        validateTransferAcceptPermission(ctx as never, {
          actorUserId: "users:1" as never,
          toUserId: "users:99" as never,
          toPublisherId: "publishers:org1" as never,
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects org target when actor is not admin/owner", async () => {
      const ctx = {
        db: {
          normalizeId: vi.fn(),
          get: vi.fn(async () => ({
            _id: "publishers:org1",
            kind: "org",
            handle: "myorg",
          })),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: () => ({
                  unique: async () => ({
                    _id: "publisherMembers:1",
                    publisherId: "publishers:org1",
                    userId: "users:1",
                    role: "publisher",
                  }),
                }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      };

      await expect(
        validateTransferAcceptPermission(ctx as never, {
          actorUserId: "users:1" as never,
          toUserId: "users:99" as never,
          toPublisherId: "publishers:org1" as never,
        }),
      ).rejects.toThrow("No pending transfer found");
    });
  });
});
