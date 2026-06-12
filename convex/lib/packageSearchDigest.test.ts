import { describe, expect, it, vi } from "vitest";
import { deletePackageSearchDigests } from "./packageSearchDigest";

describe("packageSearchDigest", () => {
  it("decrements the public plugin count when deleting a public plugin digest", async () => {
    const patch = vi.fn();
    const deleteDoc = vi.fn();
    const packageDigest = {
      _id: "packageSearchDigest:demo",
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      softDeletedAt: undefined,
    };

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return { unique: vi.fn().mockResolvedValue(packageDigest) };
              }),
            };
          }
          if (table === "globalStats") {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return {
                  unique: vi.fn().mockResolvedValue({
                    _id: "globalStats:default",
                    activePluginsCount: 5,
                  }),
                };
              }),
            };
          }
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch,
        delete: deleteDoc,
      },
    };

    await deletePackageSearchDigests(ctx as never, "packages:demo" as never);

    expect(patch).toHaveBeenCalledWith("globalStats:default", {
      activePluginsCount: 4,
      updatedAt: expect.any(Number),
    });
    expect(deleteDoc).toHaveBeenCalledWith("packageSearchDigest:demo");
  });

  it("does not initialize plugin counts from deltas before reconciliation", async () => {
    const patch = vi.fn();
    const deleteDoc = vi.fn();
    const packageDigest = {
      _id: "packageSearchDigest:demo",
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      softDeletedAt: undefined,
    };

    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return { unique: vi.fn().mockResolvedValue(packageDigest) };
              }),
            };
          }
          if (table === "globalStats") {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return {
                  unique: vi.fn().mockResolvedValue({
                    _id: "globalStats:default",
                    activeSkillsCount: 26,
                  }),
                };
              }),
            };
          }
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
            return {
              withIndex: vi.fn((_indexName, callback) => {
                callback({ eq: vi.fn(() => ({})) });
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch,
        delete: deleteDoc,
      },
    };

    await deletePackageSearchDigests(ctx as never, "packages:demo" as never);

    expect(patch).not.toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledWith("packageSearchDigest:demo");
  });
});
