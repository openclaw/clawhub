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
      icon: "https://cdn.example.test/icons/mcp.svg",
      categories: ["models"],
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
      recommendedScore: 7,
      recommendedScoreVersion: 1,
      tags: {},
      createdAt: 1,
      updatedAt: 2,
    } as never);

    expect(digest.categories).toEqual(["models"]);
    expect(digest.icon).toBe("https://cdn.example.test/icons/mcp.svg");
    expect(digest.pluginCategoryTags).toEqual(["models"]);
    expect(digest.topics).toEqual(["local-models", "inference"]);
    expect(digest.recommendedScore).toBe(7);
  });

  it("tolerates retired stored categories during plugin digest rebuilds", () => {
    const digest = extractPackageDigestFields({
      _id: "packages:legacy",
      family: "code-plugin",
      name: "@openclaw/legacy",
      normalizedName: "@openclaw/legacy",
      displayName: "Legacy",
      categories: ["retired-category"],
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      capabilityTags: [],
      compatibility: {},
      capabilities: {},
      verification: {},
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      tags: {},
      createdAt: 1,
      updatedAt: 2,
    } as never);

    expect(digest.pluginCategoryTags).toEqual(["other"]);
  });

  it("projects current inferred plugin metadata when author metadata is omitted", () => {
    const digest = extractPackageDigestFields({
      _id: "packages:inferred",
      latestReleaseId: "packageReleases:v1",
      inferredFromReleaseId: "packageReleases:v1",
      inferredCategories: ["models", "voice"],
      inferredTopics: ["OpenAI", "Speech-to-Text"],
      family: "code-plugin",
      name: "@openclaw/inferred",
      normalizedName: "@openclaw/inferred",
      displayName: "Inferred",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      compatibility: {},
      verification: {},
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      tags: {},
      createdAt: 1,
      updatedAt: 2,
    } as never);

    expect(digest.categories).toEqual(["models", "voice"]);
    expect(digest.pluginCategoryTags).toEqual(["models", "voice"]);
    expect(digest.topics).toEqual(["OpenAI", "Speech-to-Text"]);
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

  it("syncs one topic digest row per valid stored topic", async () => {
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(null),
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
        topics: ["calendar", "Official", "scheduling"],
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
        expect.objectContaining({
          topic: "calendar",
          pluginCategoryTags: ["data"],
          recommendedScore: undefined,
        }),
      ],
      [
        "packageTopicSearchDigest",
        expect.objectContaining({ topic: "scheduling", pluginCategoryTags: ["data"] }),
      ],
    ]);
  });

  it("does not infer plugin categories during shared digest resyncs", async () => {
    const insert = vi.fn();
    const pkg = {
      _id: "packages:demo",
      latestReleaseId: "packageReleases:demo",
    };
    const release = {
      _id: "packageReleases:demo",
      extractedPluginManifest: { contracts: { tools: ["demo"] } },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === pkg._id) return pkg;
          if (id === release._id) return release;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })),
            };
          }
          if (
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
        packageId: pkg._id,
        name: "demo",
        normalizedName: "demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:owner",
        pluginCategoryTags: ["other"],
        scanStatus: "clean",
        createdAt: 1,
        updatedAt: 2,
      } as never,
    );

    expect(insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({ pluginCategoryTags: ["other"] }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packagePluginCategorySearchDigest",
      expect.objectContaining({ pluginCategory: "other", pluginCategoryTags: ["other"] }),
    );
  });
});
