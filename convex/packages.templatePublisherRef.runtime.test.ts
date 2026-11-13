/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const insertPackage = async (options: {
    name: string;
    family: "claw" | "code-plugin";
    ownerUserId: Id<"users">;
    ownerPublisherId: Id<"publishers">;
  }) =>
    await t.run(async (ctx) => {
      const packageId = await ctx.db.insert("packages", {
        name: options.name,
        normalizedName: options.name,
        displayName: options.name,
        family: options.family,
        ownerUserId: options.ownerUserId,
        ownerPublisherId: options.ownerPublisherId,
        channel: "community",
        isOfficial: false,
        scanStatus: "clean",
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Initial release",
        distTags: ["latest"],
        files: [],
        integritySha256: "a".repeat(64),
        createdAt: 1,
        createdBy: options.ownerUserId,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "Initial release" },
        tags: { latest: releaseId },
      });
    });
  const owner = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "maker", role: "user" });
    const ownerPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "maker",
      displayName: "Template Maker",
      linkedUserId: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerUserId, ownerPublisherId };
  });
  await insertPackage({ name: "solo-brief", family: "claw", ...owner });
  await insertPackage({ name: "solo-plugin", family: "code-plugin", ...owner });
  return { t, owner, insertPackage };
}

describe("publisher-qualified Template references", () => {
  it("reads an unscoped Template through its publisher's handle", async () => {
    const { t } = await fixture();

    const response = await t.fetch("/api/v1/packages/@maker/solo-brief");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      package: { name: "solo-brief", family: "template", latestVersion: "1.0.0" },
      owner: { handle: "maker" },
    });

    const version = await t.fetch("/api/v1/packages/@maker/solo-brief/versions/1.0.0");
    expect(version.status).toBe(200);
    expect(await version.json()).toMatchObject({
      package: { name: "solo-brief", family: "template" },
      version: { version: "1.0.0" },
    });

    const detail = await t.query(api.packages.getByName, { name: "@Maker/solo-brief" });
    expect(detail?.package.name).toBe("solo-brief");
  });

  it("does not resolve another publisher's handle or a non-Template package", async () => {
    const { t } = await fixture();

    expect((await t.fetch("/api/v1/packages/@reader/solo-brief")).status).toBe(404);
    expect((await t.fetch("/api/v1/packages/@maker/solo-plugin")).status).toBe(404);
    expect((await t.fetch("/api/v1/packages/@maker/missing")).status).toBe(404);
  });

  it("prefers the exact scoped package name", async () => {
    const { t, owner, insertPackage } = await fixture();
    await insertPackage({ name: "@maker/solo-brief", family: "claw", ...owner });

    const response = await t.fetch("/api/v1/packages/@maker/solo-brief");
    expect(await response.json()).toMatchObject({ package: { name: "@maker/solo-brief" } });
  });
});
