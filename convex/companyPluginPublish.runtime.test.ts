/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
// Keep the in-process publication test independent of npm downloads. The local
// browser acceptance test also runs the real inspector against the release runtime.
vi.mock("@openclaw/plugin-inspector", () => ({
  openClawTargets: { resolveVersion: async () => ({}), prepare: async () => ({}) },
  pluginRoot: { runCheck: async () => ({ report: { status: "pass", issues: [] } }) },
}));
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])(
  "keeps a curated bundle private with global staging off (trusted provenance: %s)",
  async (curated) => {
    vi.stubEnv("CLAWHUB_STAGED_PREPUBLICATION_PUBLISHES", "0");
    vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const fixture = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", {
        handle: "staff",
        githubCreatedAt: 1,
        role: "admin",
      });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "cursor",
        displayName: "Cursor",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("publisherMembers", {
        publisherId,
        userId: actorUserId,
        role: "owner",
        createdAt: 1,
        updatedAt: 1,
      });
      const content = {
        "openclaw.plugin.json": JSON.stringify({
          id: "support",
          name: "Support",
          configSchema: { type: "object", properties: {} },
        }),
        ".cursor-plugin/plugin.json": JSON.stringify({ name: "support", mcpServers: "./mcp.json" }),
        "mcp.json": JSON.stringify({ mcpServers: { support: { url: "https://example.com/mcp" } } }),
      };
      const files = await Promise.all(
        Object.entries(content).map(async ([path, text]) => ({
          path,
          size: new TextEncoder().encode(text).length,
          sha256: await hashToken(text),
          storageId: await ctx.storage.store(new Blob([text])),
        })),
      );
      return { actorUserId, publisherId, files };
    });
    const result = await t.action(internal.packages.publishPackageForUserInternal, {
      actorUserId: fixture.actorUserId,
      payload: {
        name: "@cursor/support",
        displayName: "Support",
        family: "bundle-plugin",
        version: "1.0.0",
        changelog: "Curated import",
        requirePrepublicationChecks: !curated,
        ...(curated
          ? {
              source: {
                kind: "github" as const,
                url: "https://github.com/cursor/plugins",
                repo: "cursor/plugins",
                ref: "main",
                commit: "a".repeat(40),
                path: "support",
                importedAt: 1,
              },
              curation: {
                supersedes: [],
                integration: "support",
                job: "customer-support",
                authorship: "registry" as const,
                repositoryId: 1,
                ownerId: 10,
                sourceContentHash: "b".repeat(64),
                author: "Cursor",
                omittedCapabilities: ["rules"],
                format: "cursor",
              },
            }
          : {}),
        bundle: { format: "cursor" },
        files: fixture.files,
      },
    });
    expect(result).toMatchObject({ status: "pending", publicationStatus: "pending" });
    expect(
      await t.run(async (ctx) => ({
        attempts: await ctx.db.query("publishAttempts").collect(),
        releases: await ctx.db.query("packageReleases").collect(),
      })),
    ).toMatchObject({
      attempts: [{ status: "pending_checks" }],
      releases: [{ publicationStatus: "pending" }],
    });
    const release = await t.run((ctx) => ctx.db.query("packageReleases").first());
    if (curated)
      expect(release?.curation).toMatchObject({
        authorship: "registry",
        author: "Cursor",
        sourceContentHash: "b".repeat(64),
        syncedAt: expect.any(Number),
      });
    else expect(release?.curation).toBeUndefined();
    const dashboard = await t
      .withIdentity({ subject: fixture.actorUserId })
      .query(makeFunctionReference<"query">("packages:list"), {
        ownerPublisherId: fixture.publisherId,
      });
    expect(dashboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "@cursor/support", pendingReview: true }),
      ]),
    );
    const response = await t.fetch("/api/v1/plugins?limit=10");
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("@cursor/support");
  },
);
