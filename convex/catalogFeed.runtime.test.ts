/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { CATALOG_FEED_ID } from "clawhub-schema";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

// Route behavior assumes verified ingress; trust validation is covered by httpRateLimit.edge.test.ts.
vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const digest = `sha256:${"a".repeat(64)}`;

describe("experimental Claw feed runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores and serves the exact publication only while the gate is enabled", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const stored = await t.mutation(internal.catalogFeed.storeClawPublication, {
      generatedAt: "2026-07-24T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
      entries: [
        {
          type: "claw",
          id: "@openclaw/runtime-proof",
          title: "Runtime proof",
          version: "1.0.0",
          state: "available",
          publisher: { id: "openclaw", trust: "official" },
          clawManifestSummary: {
            schemaVersion: 1,
            agent: { id: "runtime-proof", name: "Runtime proof" },
            workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
            packages: { skillCount: 0, pluginCount: 0 },
            mcpServerCount: 0,
            cronJobCount: 0,
          },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/runtime-proof",
                version: "1.0.0",
                integrity: digest,
              },
            ],
          },
        },
      ],
    });
    expect(stored).toMatchObject({
      feedId: "clawhub-official-claws",
      sequence: 1,
      entryCount: 1,
    });

    const publication = await t.query(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official-claws",
    });
    expect(publication?.payload).toContain('"id":"@openclaw/runtime-proof"');

    const enabled = await t.fetch("/api/v1/feeds/claws");
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("cache-control")).toBe("no-store");
    expect(enabled.headers.get("surrogate-control")).toBeNull();
    expect(await enabled.text()).toBe(publication?.payload);

    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "0");
    const disabled = await t.fetch("/api/v1/feeds/claws");
    expect(disabled.status).toBe(404);
    expect(disabled.headers.get("cache-control")).toBe("no-store");
  });
});

describe("catalog feed pagination runtime", () => {
  it("publishes every official plugin when the catalog spans multiple pages", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const packageNames: string[] = [];
    await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "feed-publisher" });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "feed-publisher",
        displayName: "Feed Publisher",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("officialPublishers", { publisherId, createdAt: 1, updatedAt: 1 });

      for (let index = 0; index < 101; index += 1) {
        const name = `@feed-publisher/plugin-${index.toString().padStart(3, "0")}`;
        packageNames.push(name);
        const packageId = await ctx.db.insert("packages", {
          name,
          normalizedName: name,
          displayName: `Plugin ${index}`,
          ownerUserId,
          ownerPublisherId: publisherId,
          family: "code-plugin",
          channel: "official",
          isOfficial: true,
          tags: {},
          stats: { downloads: index, installs: 0, stars: 0, versions: 1 },
          createdAt: index + 1,
          updatedAt: index + 1,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          publicationStatus: "published",
          changelog: "Fixture",
          distTags: ["latest"],
          files: [],
          integritySha256: "a".repeat(64),
          sha256hash: "a".repeat(64),
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
          createdBy: ownerUserId,
          createdAt: index + 1,
        });
        await ctx.db.patch(packageId, {
          latestReleaseId: releaseId,
          tags: { latest: releaseId },
        });
      }
    });

    const results = await t.action(internal.catalogFeed.publish, {
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(results[0]).toMatchObject({ feedId: CATALOG_FEED_ID, entryCount: 101 });

    const publication = await t.query(internal.catalogFeed.getLatestPublication, {
      feedId: CATALOG_FEED_ID,
    });
    const payload = JSON.parse(publication?.payload ?? "{}");
    expect(payload.entries.map((entry: { id: string }) => entry.id)).toEqual(packageNames);
  });
});
