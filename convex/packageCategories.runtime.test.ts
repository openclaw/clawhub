/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function publish(
  t: ReturnType<typeof convexTest>,
  ownerUserId: Id<"users">,
  ownerPublisherId: Id<"publishers">,
  name: string,
  version: string,
  options: {
    categories?: string[];
    channel?: "community" | "private";
    publicationStatus?: "published" | "pending";
  } = {},
) {
  return await t.mutation(internal.packages.insertReleaseInternal, {
    actorUserId: ownerUserId,
    ownerUserId,
    ownerPublisherId,
    name,
    displayName: name,
    family: "code-plugin",
    version,
    changelog: "Fixture release",
    tags: ["latest"],
    summary: "Fixture plugin",
    categories: options.categories ?? ["other"],
    channel: options.channel ?? "community",
    publicationStatus: options.publicationStatus ?? "published",
    files: [],
    integritySha256: `${name}:${version}`.padEnd(64, "0").slice(0, 64),
    sha256hash: `${version}:${name}`.padEnd(64, "0").slice(0, 64),
    pluginManifestSummary: {
      schemaVersion: 1,
      ...(options.categories ? { categories: options.categories } : {}),
      configFields: [],
      mcpServers: [],
      bundledSkills: [],
    },
  });
}

describe("exact-version plugin categories", () => {
  it("returns stored release categories and null for unavailable or legacy releases", async () => {
    const t = convexTest({ schema, modules });
    const { userId, publisherId } = await t.run(async (ctx) => {
      const createdUserId = await ctx.db.insert("users", { handle: "catalog" });
      const createdPublisherId = await ctx.db.insert("publishers", {
        kind: "user",
        handle: "catalog",
        displayName: "Catalog",
        linkedUserId: createdUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      return { userId: createdUserId, publisherId: createdPublisherId };
    });

    await publish(t, userId, publisherId, "@catalog/versioned", "1.0.0", {
      categories: ["channels"],
    });
    await publish(t, userId, publisherId, "@catalog/versioned", "2.0.0", {
      categories: ["models", "tools"],
    });
    await publish(t, userId, publisherId, "@catalog/legacy", "1.0.0");
    await publish(t, userId, publisherId, "@catalog/private", "1.0.0", {
      categories: ["security"],
      channel: "private",
    });
    await publish(t, userId, publisherId, "@catalog/pending", "1.0.0", {
      categories: ["runtime"],
      publicationStatus: "pending",
    });

    const modelPage = await t.query(api.packages.listPublicPage, {
      family: "code-plugin",
      category: "models",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(modelPage.page.map((pkg) => pkg.name)).toContain("@catalog/versioned");
    const channelPage = await t.query(api.packages.listPublicPage, {
      family: "code-plugin",
      category: "channels",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(channelPage.page.map((pkg) => pkg.name)).not.toContain("@catalog/versioned");

    await expect(
      t.query(internal.packages.resolveVersionCategoriesBatchInternal, {
        packages: [
          { name: "@catalog/versioned", version: "1.0.0" },
          { name: "@catalog/versioned", version: "2.0.0" },
          { name: "@catalog/versioned", version: "1.0.0" },
          { name: "@catalog/legacy", version: "1.0.0" },
          { name: "@catalog/private", version: "1.0.0" },
          { name: "@catalog/pending", version: "1.0.0" },
          { name: "@catalog/missing", version: "9.9.9" },
          { name: "@catalog/versioned", version: "9.9.9" },
        ],
      }),
    ).resolves.toEqual([
      { name: "@catalog/versioned", version: "1.0.0", categories: ["channels"] },
      { name: "@catalog/versioned", version: "2.0.0", categories: ["models", "tools"] },
      { name: "@catalog/versioned", version: "1.0.0", categories: ["channels"] },
      { name: "@catalog/legacy", version: "1.0.0", categories: null },
      { name: "@catalog/private", version: "1.0.0", categories: null },
      { name: "@catalog/pending", version: "1.0.0", categories: null },
      { name: "@catalog/missing", version: "9.9.9", categories: null },
      { name: "@catalog/versioned", version: "9.9.9", categories: null },
    ]);
  });
});
