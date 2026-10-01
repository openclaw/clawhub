/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");

async function fixture(role: "user" | "admin") {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { handle: "managed-author", role });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "local test",
      prefix: "test",
      tokenHash: await hashToken("managed-test"),
      createdAt: 1,
    });
    return id;
  });
  return { t, userId, ui: t.withIdentity({ subject: `${userId}|test-session` }) };
}

describe("managed MCP authorization", () => {
  it("rejects both UI and CLI writes from a normal user before generating artifacts", async () => {
    const { t, ui } = await fixture("user");
    await expect(ui.action(api.managedMcp.publish, { definition: {} })).rejects.toThrow(
      "Forbidden",
    );
    const response = await t.fetch("/api/v1/packages/-/managed-mcp", {
      method: "POST",
      headers: { Authorization: "Bearer managed-test", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual([]);
  });

  it("does not let an internal actor id bypass the admin boundary", async () => {
    const { t, userId } = await fixture("user");
    await expect(
      t.action(internal.managedMcp.publishForAdminInternal, {
        actorUserId: userId,
        definition: {},
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      t.action(internal.managedMcp.unpublishForAdminInternal, { actorUserId: userId, id: "demo" }),
    ).rejects.toThrow("Forbidden");
  });

  it("validates UI and CLI definitions through the same backend and never reflects secret input", async () => {
    const { t, ui } = await fixture("admin");
    const definition = { clientSecret: "do-not-reflect-this" };
    await expect(ui.action(api.managedMcp.publish, { definition })).rejects.toThrow(
      "Invalid managed MCP definition fields",
    );
    const response = await t.fetch("/api/v1/packages/-/managed-mcp", {
      method: "POST",
      headers: { Authorization: "Bearer managed-test", "Content-Type": "application/json" },
      body: JSON.stringify(definition),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("do-not-reflect-this");
  });

  it("refuses to overwrite an unrelated package with the same identity", async () => {
    const { t, userId } = await fixture("admin");
    await t.run((ctx) =>
      ctx.db.insert("packages", {
        name: "@openclaw/demo",
        normalizedName: "@openclaw/demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      t.query(internal.managedMcp.getReleaseInternal, { actorUserId: userId, id: "demo" }),
    ).rejects.toThrow("Package identity is already in use");
  });
});
