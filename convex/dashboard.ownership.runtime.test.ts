/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("dashboard metrics ownership", () => {
  it.each(["claw", "code-plugin"] as const)(
    "reports complete family presence beyond 100 newer %s packages",
    async (newerFamily) => {
      const t = convexTest(schema, modules);
      const ids = await t.run(async (ctx) => {
        const owner = await ctx.db.insert("users", { handle: "mixed-owner" });
        const publisherId = await ctx.db.insert("publishers", {
          kind: "user",
          handle: "mixed-owner",
          displayName: "Mixed owner",
          linkedUserId: owner,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.patch(owner, { personalPublisherId: publisherId });
        for (let index = 0; index <= 100; index++) {
          const family =
            index === 0 ? (newerFamily === "claw" ? "code-plugin" : "claw") : newerFamily;
          await ctx.db.insert("packages", {
            name: `mixed-${index}`,
            normalizedName: `mixed-${index}`,
            displayName: `Mixed ${index}`,
            ownerUserId: owner,
            ownerPublisherId: publisherId,
            family,
            channel: "community",
            isOfficial: false,
            tags: {},
            stats: { downloads: 1, installs: 0, stars: 0, versions: 0 },
            createdAt: index + 1,
            updatedAt: index + 1,
          });
        }
        return { owner, publisherId };
      });
      const metrics = await t
        .withIdentity({ subject: ids.owner })
        .query(api.dashboard.getDownloadMetrics, {
          publisherId: ids.publisherId,
          endDay: Date.now(),
        });
      expect(metrics.plugins).toMatchObject({
        allTimeDownloads: 101,
        hasTemplates: true,
        hasPlugins: true,
      });
    },
  );

  for (const kind of ["legacy", "linked", "org"] as const) {
    it(`authorizes the stored ${kind} owner and denies unrelated callers`, async () => {
      const t = convexTest(schema, modules);
      const ids = await t.run(async (ctx) => {
        const owner = await ctx.db.insert("users", { handle: "owner" });
        const outsider = await ctx.db.insert("users", { handle: "outsider" });
        const publisherId = await ctx.db.insert("publishers", {
          kind: kind === "org" ? "org" : "user",
          handle: "metrics",
          displayName: "Metrics",
          createdAt: 1,
          updatedAt: 1,
          ...(kind === "linked" ? { linkedUserId: owner } : {}),
        });
        if (kind !== "org") await ctx.db.patch(owner, { personalPublisherId: publisherId });
        const membership = await ctx.db.insert("publisherMembers", {
          publisherId,
          userId: owner,
          role: "owner",
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("skills", {
          slug: "metrics",
          displayName: "Metrics",
          ownerUserId: owner,
          ownerPublisherId: publisherId,
          tags: {},
          stats: { comments: 0, downloads: 37, stars: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        });
        return { owner, outsider, publisherId, membership };
      });
      const args = {
        publisherId: ids.publisherId,
        endDay: Date.now(),
        selection: { kind: "skill" as const, slug: "metrics" },
      };
      const owner = t.withIdentity({ subject: ids.owner });
      const outsider = t.withIdentity({ subject: ids.outsider });
      await expect(owner.query(api.dashboard.getDownloadMetrics, args)).resolves.toMatchObject({
        allTimeDownloads: 37,
      });
      await expect(outsider.query(api.dashboard.getDownloadMetrics, args)).rejects.toThrow(
        /Forbidden/,
      );
      if (kind === "org") {
        await t.run((ctx) => ctx.db.delete(ids.membership));
      } else if (kind === "legacy") {
        await t.run((ctx) => ctx.db.patch(ids.owner, { personalPublisherId: undefined }));
      } else {
        // A stale personalPublisherId must not override a publisher's current linked user.
        await t.run((ctx) => ctx.db.patch(ids.publisherId, { linkedUserId: ids.outsider }));
      }
      await expect(owner.query(api.dashboard.getDownloadMetrics, args)).rejects.toThrow(
        /Forbidden/,
      );
    });
  }
});
