/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachIntermediaries } from "../scripts/security/infer-intermediaries";
import { api, internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.42" }));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("DEV_AUTH_ENABLED", "1");
  vi.stubEnv("CONVEX_DEPLOYMENT", "anonymous:intermediary-test");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3271");
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
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
        `/api/v1/packages/local-intermediary-${suffix}/detail`,
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
        if (path.endsWith("/detail")) {
          expect(body.version.requiresIntermediary).toBe(expected);
          expect(body.package.intermediaryDetails).toBe(body.version.intermediaryDetails);
        }
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

describe("legacy disclosure data and worker completion", () => {
  it.each([false, true])(
    "loads legacy records with llmAnalysis present=%s without a backfill",
    async (hasAnalysis) => {
      const t = await fixture();
      await t.run(async (ctx) => {
        const skill = await ctx.db
          .query("skills")
          .withIndex("by_slug", (q) => q.eq("slug", "intermediary-required"))
          .first();
        const pkg = await ctx.db
          .query("packages")
          .withIndex("by_name", (q) => q.eq("normalizedName", "local-intermediary-required"))
          .first();
        const llmAnalysis = hasAnalysis
          ? { status: "clean", verdict: "benign", checkedAt: 1 }
          : undefined;
        await ctx.db.patch(skill!.latestVersionId!, { llmAnalysis });
        await ctx.db.patch(pkg!.latestReleaseId!, { llmAnalysis });
      });
      for (const path of [
        "/api/v1/skills/intermediary-required",
        "/api/v1/skills/intermediary-required/versions/1.0.0",
        "/api/v1/packages/local-intermediary-required",
        "/api/v1/packages/local-intermediary-required/detail",
        "/api/v1/packages/local-intermediary-required/versions/1.0.0",
      ]) {
        const response = await t.fetch(path);
        expect(response.status, path).toBe(200);
        const body = await response.json();
        const projection = path.includes("/versions/")
          ? body.version
          : path.includes("/packages/")
            ? body.package
            : body;
        expect(projection.requiresIntermediary, path).toBeNull();
        expect(projection.intermediaryDetails, path).toBeNull();
      }
      const page = await t.action(api.publicPluginDetail.getPage, {
        name: "local-intermediary-required",
      });
      expect(page!.package.requiresIntermediary).toBeNull();
      expect(page!.version!.requiresIntermediary).toBeNull();
    },
  );

  it.each([
    { targetKind: "skillVersion" as const, failed: false },
    { targetKind: "skillVersion" as const, failed: true },
    { targetKind: "packageRelease" as const, failed: false },
    { targetKind: "packageRelease" as const, failed: true },
  ])(
    "persists extraction through the production completion action: $targetKind, providerFailure=$failed",
    async ({ targetKind, failed }) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-fixture");
      vi.stubEnv("CLAWHUB_INTERMEDIARY_DISCLOSURE_ENABLED", "1");
      const t = await fixture();
      await mkdir(join(process.cwd(), ".artifacts"), { recursive: true });
      const dir = await mkdtemp(join(process.cwd(), ".artifacts/pr4045-extraction-"));
      try {
        await writeFile(join(dir, "SKILL.md"), "Gmail access requires a Bridge account.");
        const provider = vi.fn<typeof fetch>().mockImplementation(async () => {
          if (failed) throw new Error("fixture extraction failure");
          return new Response(
            JSON.stringify({
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        requiresIntermediary: true,
                        intermediaryDetails: "Requires a Bridge account for Gmail.",
                        evidence: ["e0"],
                      }),
                    },
                  ],
                },
              ],
            }),
          );
        });
        const security = {
          status: "clean",
          verdict: "benign",
          findings: "No security findings",
          checkedAt: Date.now(),
        };
        const analysis = await attachIntermediaries(security, () => dir, {
          apiKey: "fixture-not-a-credential",
          fetch: provider,
        });
        expect(analysis.intermediaryAnalysis.requiresIntermediary).toBe(failed ? null : true);
        expect(analysis).toMatchObject(security);
        const { jobId: completedJobId, versionId: completedVersionId } = await t.run(
          async (ctx) => {
            const skill = await ctx.db
              .query("skills")
              .withIndex("by_slug", (q) => q.eq("slug", "intermediary-required"))
              .first();
            const pkg = await ctx.db
              .query("packages")
              .withIndex("by_name", (q) => q.eq("normalizedName", "local-intermediary-required"))
              .first();
            const versionId =
              targetKind === "skillVersion" ? skill!.latestVersionId! : pkg!.latestReleaseId!;
            const jobId = await ctx.db.insert("securityScanJobs", {
              targetKind,
              ...(targetKind === "skillVersion"
                ? { skillVersionId: skill!.latestVersionId! }
                : { packageReleaseId: pkg!.latestReleaseId! }),
              status: "running",
              source: "manual",
              priority: 1,
              hasMaliciousSignal: false,
              nextRunAt: 0,
              attempts: 1,
              leaseToken: "lease-fixture",
              workerId: "disclosure-fixture",
              leaseExpiresAt: Date.now() + 60000,
              createdAt: 1,
              updatedAt: 1,
            });
            return { jobId, versionId };
          },
        );
        await t.action(api.securityScan.completeCodexScanJob, {
          token: "worker-fixture",
          jobId: completedJobId,
          leaseToken: "lease-fixture",
          llmAnalysis: analysis,
          ...(targetKind === "skillVersion"
            ? {
                aigAnalysis: {
                  status: "clean",
                  issueCount: 0,
                  findings: [],
                  checkedAt: security.checkedAt,
                },
              }
            : {}),
        });
        const stored = await t.run(
          async (ctx) => (await ctx.db.get(completedVersionId))!.llmAnalysis,
        );
        expect(stored).toEqual(analysis);
        const path =
          targetKind === "skillVersion"
            ? "/api/v1/skills/intermediary-required"
            : "/api/v1/packages/local-intermediary-required";
        for (const suffix of targetKind === "skillVersion"
          ? ["", "/versions/1.0.0"]
          : ["", "/detail", "/versions/1.0.0"]) {
          const response = await t.fetch(path + suffix);
          expect(response.status, path + suffix).toBe(200);
          const body = await response.json();
          const projection = suffix.startsWith("/versions/")
            ? body.version
            : targetKind === "packageRelease"
              ? body.package
              : body;
          expect(projection.requiresIntermediary).toBe(failed ? null : true);
          if (suffix === "/detail")
            expect(body.version.requiresIntermediary).toBe(projection.requiresIntermediary);
        }
        expect(provider).toHaveBeenCalledOnce();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
