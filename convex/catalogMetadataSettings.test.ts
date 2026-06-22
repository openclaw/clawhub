/* @vitest-environment node */

import { getAuthUserId } from "@convex-dev/auth/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertPackageSearchDigestMock, upsertSkillSearchDigestMock } = vi.hoisted(() => ({
  upsertPackageSearchDigestMock: vi.fn(),
  upsertSkillSearchDigestMock: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/packageSearchDigest", async () => {
  const actual = await vi.importActual<typeof import("./lib/packageSearchDigest")>(
    "./lib/packageSearchDigest",
  );
  return { ...actual, upsertPackageSearchDigest: upsertPackageSearchDigestMock };
});

vi.mock("./lib/skillSearchDigest", async () => {
  const actual =
    await vi.importActual<typeof import("./lib/skillSearchDigest")>("./lib/skillSearchDigest");
  return { ...actual, upsertSkillSearchDigest: upsertSkillSearchDigestMock };
});

const { setPackageCatalogMetadata } = await import("./packages");
const { setCatalogMetadata } = await import("./skills");

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<void>;
};

const setPackageCatalogMetadataHandler = (
  setPackageCatalogMetadata as unknown as WrappedHandler<{
    packageId: string;
    categories?: string[];
    topics: string[];
  }>
)._handler;
const setSkillCatalogMetadataHandler = (
  setCatalogMetadata as unknown as WrappedHandler<{
    skillId: string;
    categories?: string[];
    topics: string[];
  }>
)._handler;

const user = {
  _id: "users:owner",
  role: "user",
  handle: "owner",
  personalPublisherId: "publishers:owner",
};
const publisher = {
  _id: "publishers:owner",
  kind: "user",
  handle: "owner",
  displayName: "Owner",
  linkedUserId: "users:owner",
};

function makeCtx(
  resourceId: string,
  resource: Record<string, unknown>,
  relatedResources: Record<string, Record<string, unknown>> = {},
) {
  const patch = vi.fn(async () => {});
  const insert = vi.fn(async (table: string) => `${table}:inserted`);
  const replace = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  return {
    patch,
    insert,
    ctx: {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === user._id) return user;
          if (id === publisher._id) return publisher;
          if (id === resourceId) return resource;
          return relatedResources[id] ?? null;
        }),
        patch,
        insert,
        replace,
        delete: remove,
        normalizeId: vi.fn(),
        system: {},
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => null),
            collect: vi.fn(async () => []),
          })),
        })),
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getAuthUserId).mockResolvedValue(user._id as never);
  upsertPackageSearchDigestMock.mockReset();
  upsertSkillSearchDigestMock.mockReset();
});

describe("catalog metadata settings", () => {
  it("persists exact skill category slugs and author topics", async () => {
    const skill = {
      _id: "skills:demo",
      slug: "demo",
      displayName: "Demo",
      ownerUserId: user._id,
      inferredCategories: ["automation"],
      inferredTopics: ["Old inference"],
      inferredFromVersionId: "skillVersions:demo",
      inferredCategoryConfidence: "medium",
      inferredTopicConfidence: "high",
      inferredClassifierVersion: "taxonomy-prototype-v9",
      inferredTopicClassifierVersion: "topic-prototype-v1",
      inferredInputHash: "category-hash",
      inferredTopicInputHash: "old-hash",
      inferredAt: 123,
      tags: {},
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch, insert } = makeCtx(skill._id, skill);

    await setSkillCatalogMetadataHandler(ctx, {
      skillId: skill._id,
      categories: ["development"],
      topics: ["GPU development"],
    });

    expect(patch).toHaveBeenCalledWith(
      skill._id,
      expect.objectContaining({
        categories: ["development"],
        topics: ["GPU development"],
        inferredCategories: undefined,
        inferredTopics: undefined,
        inferredFromVersionId: undefined,
        inferredCategoryConfidence: undefined,
        inferredTopicConfidence: undefined,
        inferredClassifierVersion: undefined,
        inferredTopicClassifierVersion: undefined,
        inferredInputHash: undefined,
        inferredTopicInputHash: undefined,
        inferredAt: undefined,
      }),
    );
    expect(upsertSkillSearchDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["development"],
        topics: ["GPU development"],
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "skill.catalog_metadata.set" }),
    );
  });

  it("persists exact plugin category slugs and author topics", async () => {
    const pkg = {
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: user._id,
      inferredCategories: ["tools"],
      inferredTopics: ["Old inference"],
      inferredFromReleaseId: "packageReleases:demo",
      inferredCategoryConfidence: "medium",
      inferredTopicConfidence: "high",
      inferredClassifierVersion: "taxonomy-prototype-v9",
      inferredTopicClassifierVersion: "topic-prototype-v1",
      inferredInputHash: "category-hash",
      inferredTopicInputHash: "old-hash",
      inferredAt: 123,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      scanStatus: "clean",
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch, insert } = makeCtx(pkg._id, pkg);

    await setPackageCatalogMetadataHandler(ctx, {
      packageId: pkg._id,
      categories: ["models"],
      topics: ["Local models"],
    });

    expect(patch).toHaveBeenCalledWith(
      pkg._id,
      expect.objectContaining({
        categories: ["models"],
        topics: ["Local models"],
        inferredCategories: undefined,
        inferredTopics: undefined,
        inferredFromReleaseId: undefined,
        inferredCategoryConfidence: undefined,
        inferredTopicConfidence: undefined,
        inferredClassifierVersion: undefined,
        inferredTopicClassifierVersion: undefined,
        inferredInputHash: undefined,
        inferredTopicInputHash: undefined,
        inferredAt: undefined,
      }),
    );
    expect(upsertPackageSearchDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["models"],
        topics: ["Local models"],
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "package.catalog_metadata.set" }),
    );
  });

  it("uses Other when stored skill categories are cleared", async () => {
    const skill = {
      _id: "skills:demo",
      slug: "demo",
      displayName: "Demo",
      categories: ["development"],
      inferredTopics: ["Old inference"],
      inferredTopicConfidence: "medium",
      ownerUserId: user._id,
      tags: {},
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch } = makeCtx(skill._id, skill);

    await setSkillCatalogMetadataHandler(ctx, {
      skillId: skill._id,
      topics: ["GPU development"],
    });

    expect(patch).toHaveBeenCalledWith(
      skill._id,
      expect.objectContaining({
        categories: ["other"],
        topics: ["GPU development"],
      }),
    );
  });

  it("persists Other when skill categories are explicitly cleared", async () => {
    const skill = {
      _id: "skills:demo",
      slug: "demo",
      displayName: "Demo",
      categories: ["development"],
      ownerUserId: user._id,
      tags: {},
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch } = makeCtx(skill._id, skill);

    await setSkillCatalogMetadataHandler(ctx, {
      skillId: skill._id,
      categories: [],
      topics: [],
    });

    expect(patch).toHaveBeenCalledWith(
      skill._id,
      expect.objectContaining({
        categories: ["other"],
        topics: undefined,
        inferredTopics: undefined,
        inferredTopicConfidence: undefined,
      }),
    );
    expect(upsertSkillSearchDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
      }),
    );
  });

  it("uses Other when stored plugin categories are cleared", async () => {
    const release = {
      _id: "packageReleases:demo",
      extractedPluginManifest: { contracts: { tools: ["demo"] } },
    };
    const pkg = {
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      categories: ["models"],
      latestReleaseId: release._id,
      ownerUserId: user._id,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      scanStatus: "clean",
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch } = makeCtx(pkg._id, pkg, { [release._id]: release });

    await setPackageCatalogMetadataHandler(ctx, {
      packageId: pkg._id,
      topics: ["Local models"],
    });

    expect(patch).toHaveBeenCalledWith(
      pkg._id,
      expect.objectContaining({
        categories: ["other"],
        topics: ["Local models"],
      }),
    );
    expect(upsertPackageSearchDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
        pluginCategoryTags: ["other"],
      }),
    );
  });

  it("persists Other when plugin categories are explicitly cleared", async () => {
    const pkg = {
      _id: "packages:legacy-bundle",
      name: "legacy-bundle",
      normalizedName: "legacy-bundle",
      displayName: "Legacy Bundle",
      family: "bundle-plugin",
      channel: "community",
      isOfficial: false,
      categories: ["tools"],
      inferredTopics: ["Old inference"],
      inferredTopicConfidence: "medium",
      ownerUserId: user._id,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      scanStatus: "clean",
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch } = makeCtx(pkg._id, pkg);

    await setPackageCatalogMetadataHandler(ctx, {
      packageId: pkg._id,
      categories: [],
      topics: [],
    });

    expect(patch).toHaveBeenCalledWith(
      pkg._id,
      expect.objectContaining({
        categories: ["other"],
        topics: undefined,
        inferredTopics: undefined,
        inferredTopicConfidence: undefined,
      }),
    );
    expect(upsertPackageSearchDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
        pluginCategoryTags: ["other"],
      }),
    );
  });

  it("uses Other when legacy plugin categories are cleared", async () => {
    const pkg = {
      _id: "packages:legacy-bundle",
      name: "legacy-bundle",
      normalizedName: "legacy-bundle",
      displayName: "Legacy Bundle",
      family: "bundle-plugin",
      channel: "community",
      isOfficial: false,
      categories: ["tools"],
      ownerUserId: user._id,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      scanStatus: "clean",
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, patch } = makeCtx(pkg._id, pkg);

    await setPackageCatalogMetadataHandler(ctx, {
      packageId: pkg._id,
      topics: [],
    });

    expect(patch).toHaveBeenCalledWith(
      pkg._id,
      expect.objectContaining({
        categories: ["other"],
      }),
    );
  });
});
