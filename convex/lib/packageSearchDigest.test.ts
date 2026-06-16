import { describe, expect, it, vi } from "vitest";
import {
  deletePackageSearchDigests,
  extractPackageDigestFields,
  upsertPackageSearchDigest,
} from "./packageSearchDigest";

describe("packageSearchDigest", () => {
  it("projects stored catalog metadata and prefers a stored plugin category", () => {
    const digest = extractPackageDigestFields({
      _id: "packages:demo",
      family: "code-plugin",
      name: "@openclaw/mcp-provider",
      normalizedName: "@openclaw/mcp-provider",
      displayName: "MCP Provider",
      summary: "An MCP adapter",
      primaryCategory: "model-providers",
      topics: ["local-models", "inference"],
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      capabilityTags: ["mcp"],
      compatibility: {},
      capabilities: {},
      verification: {},
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      tags: {},
      createdAt: 1,
      updatedAt: 2,
    } as never);

    expect(digest.primaryCategory).toBe("model-providers");
    expect(digest.pluginCategoryTags).toEqual(["model-providers"]);
    expect(digest.topics).toEqual(["local-models", "inference"]);
  });

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
            table === "packageTopicSearchDigest" ||
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
            table === "packageTopicSearchDigest" ||
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

  it("syncs one topic digest row per stored topic", async () => {
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })),
            };
          }
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packageTopicSearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
            return {
              withIndex: vi.fn(() => ({ collect: vi.fn().mockResolvedValue([]) })),
            };
          }
          if (table === "globalStats") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        insert,
      },
    };

    await upsertPackageSearchDigest(
      ctx as never,
      {
        packageId: "packages:demo",
        name: "demo",
        normalizedName: "demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:owner",
        topics: ["calendar", "scheduling"],
        capabilityTags: [],
        pluginCategoryTags: ["data"],
        scanStatus: "clean",
        createdAt: 1,
        updatedAt: 2,
      } as never,
    );

    expect(insert.mock.calls.filter(([table]) => table === "packageTopicSearchDigest")).toEqual([
      [
        "packageTopicSearchDigest",
        expect.objectContaining({ topic: "calendar", pluginCategoryTags: ["data"] }),
      ],
      [
        "packageTopicSearchDigest",
        expect.objectContaining({ topic: "scheduling", pluginCategoryTags: ["data"] }),
      ],
    ]);
  });
});
