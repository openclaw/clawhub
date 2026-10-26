/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.42" }));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("DEV_AUTH_ENABLED", "1");
  vi.stubEnv("CONVEX_DEPLOYMENT", "anonymous:intermediary-test");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3271");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.action(internal.devSeed.seedIntermediaryFixtures, {});
  return t;
}

describe("version-bound intermediary HTTP metadata", () => {
  it("serves required, direct and unknown from real stored skill/plugin results", async () => {
    const t = await fixture();
    for (const [suffix, expected] of [
      ["required", true],
      ["direct", false],
      ["unknown", null],
    ] as const) {
      for (const path of [
        `/api/v1/skills/intermediary-${suffix}`,
        `/api/v1/skills/intermediary-${suffix}/versions/1.0.0`,
        `/api/v1/packages/intermediary-${suffix}`,
        `/api/v1/packages/intermediary-${suffix}/versions/1.0.0`,
        `/api/v1/packages/local-intermediary-${suffix}`,
        `/api/v1/packages/local-intermediary-${suffix}/versions/1.0.0`,
      ]) {
        const response = await t.fetch(path);
        expect(response.status, path).toBe(200);
        const body = await response.json();
        const disclosure = path.includes("/versions/")
          ? body.version
          : path.includes("/packages/")
            ? body.package
            : body;
        expect(disclosure.requiresIntermediary, path).toBe(expected);
        if (expected === null) expect(disclosure.intermediaryDetails).toBeNull();
        else expect(disclosure.intermediaryDetails).toMatch(/Gmail/);
      }
    }
  });

  it("does not substitute latest-version conclusions for an older exact version", async () => {
    const t = await fixture();
    await t.run(async (ctx) => {
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", "intermediary-required"))
        .first();
      const current = await ctx.db.get(skill!.latestVersionId!);
      const { _id, _creationTime, ...version } = current!;
      await ctx.db.insert("skillVersions", {
        ...version,
        version: "0.9.0",
        createdAt: 1,
        llmAnalysis: {
          status: "clean",
          checkedAt: 1,
          intermediaryAnalysis: {
            requiresIntermediary: false,
            intermediaryDetails: "Earlier version connects directly to Gmail.",
            checkedAt: 1,
            model: "fixture",
            recipe: "fixture",
            evidence: [],
          },
        },
      });
    });
    const older = await (
      await t.fetch("/api/v1/skills/intermediary-required/versions/0.9.0")
    ).json();
    const latest = await (await t.fetch("/api/v1/skills/intermediary-required")).json();
    expect(older.version.requiresIntermediary).toBe(false);
    expect(latest.requiresIntermediary).toBe(true);
  });

  it("replacing inspection with a legacy result clears the previous inference", async () => {
    const t = await fixture();
    const versionId = await t.run(async (ctx) => {
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", "intermediary-required"))
        .first();
      return skill!.latestVersionId!;
    });
    await t.mutation(internal.skills.updateVersionLlmAnalysisInternal, {
      versionId,
      llmAnalysis: { status: "clean", checkedAt: 2 },
    });
    const body = await (await t.fetch("/api/v1/skills/intermediary-required")).json();
    expect(body.requiresIntermediary).toBeNull();
    expect(body.intermediaryDetails).toBeNull();
  });
});
