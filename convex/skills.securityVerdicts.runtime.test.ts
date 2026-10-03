/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
it("withholds pending and blocked including deleted rows through query and HTTP", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const states = [
    { version: "published", publicationStatus: "published" as const },
    { version: "legacy" },
    { version: "pending", publicationStatus: "pending" as const },
    { version: "blocked", publicationStatus: "blocked" as const },
    { version: "pending-deleted", publicationStatus: "pending" as const, softDeletedAt: 2 },
    { version: "blocked-deleted", publicationStatus: "blocked" as const, softDeletedAt: 2 },
    { version: "published-deleted", publicationStatus: "published" as const, softDeletedAt: 2 },
  ];
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "review-owner" });
    const skillId = await ctx.db.insert("skills", {
      slug: "review-fixture",
      displayName: "Review fixture",
      ownerUserId: userId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: states.length },
      createdAt: 1,
      updatedAt: 1,
    });
    for (const state of states)
      await ctx.db.insert("skillVersions", {
        skillId,
        changelog: "Fixture",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
          summary: "PRIVATE-SCAN-MARKER",
          checkedAt: 2,
        },
        ...state,
      });
  });
  for (const state of [...states, { version: "missing" }]) {
    const result = await t.query(internal.skills.getSecurityVerdictTargetInternal, {
      slug: "review-fixture",
      version: state.version,
    });
    const response = await t.fetch("/api/v1/skills/-/security-verdicts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ slug: "review-fixture", version: state.version }] }),
    });
    const body = await response.json();
    console.log(
      JSON.stringify({
        version: state.version,
        queryVersion: result?.version,
        httpStatus: response.status,
        body,
      }),
    );
    expect(response.status).toBe(200);
    if (
      ["pending", "blocked", "pending-deleted", "blocked-deleted", "missing"].includes(
        state.version,
      )
    ) {
      expect.soft(result?.version).toBeNull();
      expect.soft(body.items[0].error?.code).toBe("version_not_found");
      expect.soft(JSON.stringify(body)).not.toContain("PRIVATE-SCAN-MARKER");
    } else if (state.version === "published-deleted") {
      expect.soft(body.items[0].error?.code).toBe("version_unavailable");
    } else {
      expect.soft(body.items[0].decision).toBe("pass");
      expect.soft(JSON.stringify(body)).toContain("PRIVATE-SCAN-MARKER");
    }
  }
});
