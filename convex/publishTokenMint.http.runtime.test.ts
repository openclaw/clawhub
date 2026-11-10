/// <reference types="vite/client" />
/* @vitest-environment node */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { mintPublishTokenV1Handler } from "./httpApiV1/packagesV1";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const rejection = "Publish token request could not be verified.";

async function postMint(
  t: ReturnType<typeof convexTest>,
  packageName: string,
  token = "not-a-jwt",
) {
  return await t.action(async (ctx) => {
    const response = await mintPublishTokenV1Handler(
      ctx as unknown as ActionCtx,
      new Request("https://example.com/api/v1/publish/token/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName,
          version: "1.0.0",
          githubOidcToken: token,
        }),
      }),
    );
    return { status: response.status, body: await response.text() };
  });
}

describe("publish token mint through the real Convex handler", () => {
  it("uses one rejection for a missing name, a hidden package, and a bad OIDC token", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiterV2");
    const ownerUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { handle: "secret-owner" });
    });
    const hiddenId = await insertPackage(t, ownerUserId, {
      name: "secret-plugin",
      channel: "private",
      scanStatus: "malicious",
    });
    await insertPackage(t, ownerUserId, {
      name: "configured-plugin",
      channel: "private",
      scanStatus: "clean",
    });
    const configuredId = await t.run(async (ctx) => {
      const pkg = await ctx.db
        .query("packages")
        .filter((q) => q.eq(q.field("name"), "configured-plugin"))
        .unique();
      if (!pkg) throw new Error("missing configured package");
      await ctx.db.insert("packageTrustedPublishers", {
        packageId: pkg._id,
        provider: "github-actions",
        repository: "private/secret",
        repositoryId: "91",
        repositoryOwner: "private",
        repositoryOwnerId: "92",
        workflowFilename: "release.yml",
        createdByUserId: ownerUserId,
        updatedByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      return pkg._id;
    });

    const missing = await postMint(t, "missing-plugin");
    const hidden = await postMint(t, "secret-plugin");
    const badToken = await postMint(t, "configured-plugin", "not-a-jwt");

    expect(missing).toEqual({ status: 400, body: rejection });
    expect(hidden).toEqual(missing);
    expect(badToken).toEqual(missing);
    expect(badToken.body).not.toContain("private/secret");
    expect(badToken.body).not.toContain("not-a-jwt");

    const audit = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .filter((q) => q.eq(q.field("targetId"), String(configuredId)))
        .collect();
    });
    expect(audit.some((entry) => entry.action === "package.publish_token.mint_rejected")).toBe(
      true,
    );
    expect(hiddenId).toBeTruthy();
    expect(configuredId).not.toBe(hiddenId);
  });
});

async function insertPackage(
  t: ReturnType<typeof convexTest>,
  ownerUserId: Id<"users">,
  options: { name: string; channel: "private"; scanStatus: "clean" | "malicious" },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("packages", {
      name: options.name,
      normalizedName: options.name,
      displayName: options.name,
      ownerUserId,
      family: "code-plugin",
      channel: options.channel,
      isOfficial: false,
      scanStatus: options.scanStatus,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
  });
}
