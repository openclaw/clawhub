import { afterEach, describe, expect, it, vi } from "vitest";
import { main, resolveVercelBuildPlan } from "./vercel-build";

const previewEnv = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "pe/claw-413-pr-previews",
  CONVEX_DEPLOY_KEY: "preview:openclaw:clawhub|secret",
};
const stagingSha = "a".repeat(40);
const stagingEnv = {
  CLAWHUB_ENV: "staging",
  CLAWHUB_STAGING_EDGE_SECRET: "s".repeat(48),
  SITE_URL: "https://stg.clawhub.ai",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "staging",
  VERCEL_GIT_COMMIT_SHA: stagingSha,
  VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
  VITE_CONVEX_SITE_URL: "https://cheery-civet-733.convex.site",
  VITE_SITE_URL: "https://stg.clawhub.ai",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vercel build plan", () => {
  it("recreates and seeds the branch Convex deployment for previews", () => {
    expect(resolveVercelBuildPlan(previewEnv)).toEqual([
      {
        command: "bunx",
        args: [
          "convex",
          "deploy",
          "--preview-create",
          "pe/claw-413-pr-previews",
          "--cmd",
          "bun scripts/vercel-build-frontend.ts",
          "--cmd-url-env-var-name",
          "VITE_CONVEX_URL",
        ],
      },
      {
        command: "bun",
        args: ["run", "seed", "--", "--preview-name", "pe/claw-413-pr-previews"],
      },
    ]);
  });

  it("fails closed when a preview deploy key is missing or has the wrong type", () => {
    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/demo",
      }),
    ).toThrow("Preview builds require a Convex Preview deploy key");

    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/demo",
        CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|secret",
      }),
    ).toThrow("Preview builds require a Convex Preview deploy key");
  });

  it("runs the ordinary frontend build for production and rejects deploy credentials", () => {
    expect(resolveVercelBuildPlan({ VERCEL_ENV: "production" })).toEqual([
      {
        command: "bun",
        args: ["scripts/vercel-build-frontend.ts"],
      },
    ]);

    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "production",
        CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|secret",
      }),
    ).toThrow("Production Vercel builds must not receive CONVEX_DEPLOY_KEY");
  });

  it("uses the permanent backend for the custom test environment", () => {
    expect(
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
      }),
    ).toEqual([
      {
        command: "bun",
        args: ["scripts/vercel-build-frontend.ts"],
      },
    ]);

    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
        CONVEX_DEPLOY_KEY: "preview:openclaw:clawhub|secret",
      }),
    ).toThrow("Test Vercel builds must not receive CONVEX_DEPLOY_KEY");
  });

  it.each(["preview", "staging"])(
    "uses the permanent backend for the staging branch with Vercel target %s",
    (targetEnvironment) => {
      expect(
        resolveVercelBuildPlan({
          ...stagingEnv,
          VERCEL_TARGET_ENV: targetEnvironment,
        }),
      ).toEqual([{ command: "bun", args: ["scripts/vercel-build-frontend.ts"] }]);
    },
  );

  it.each([
    "https://clawhub-git-staging-openclaw-foundation.vercel.app",
    "https://stg.clawhub.openclaw.org",
  ])("accepts %s as the paired staging site origin", (siteUrl) => {
    expect(
      resolveVercelBuildPlan({
        ...stagingEnv,
        SITE_URL: siteUrl,
        VITE_SITE_URL: siteUrl,
      }),
    ).toEqual([{ command: "bun", args: ["scripts/vercel-build-frontend.ts"] }]);
  });

  it("rejects all deploy keys in the staging build", () => {
    for (const deployKey of ["preview:openclaw:clawhub|secret", "prod:cheery-civet-733|secret"]) {
      expect(() =>
        resolveVercelBuildPlan({
          ...stagingEnv,
          CONVEX_DEPLOY_KEY: deployKey,
        }),
      ).toThrow("Staging Vercel builds must not receive CONVEX_DEPLOY_KEY");
    }
  });

  it.each([
    ["missing marker", { CLAWHUB_ENV: "" }, /CLAWHUB_ENV=staging/],
    ["wrong Vercel environment", { VERCEL_ENV: "production" }, /VERCEL_ENV=preview/],
    ["wrong target environment", { VERCEL_TARGET_ENV: "production" }, /preview or staging/],
    ["missing edge secret", { CLAWHUB_STAGING_EDGE_SECRET: "" }, /CLAWHUB_STAGING_EDGE_SECRET/],
    ["weak edge secret", { CLAWHUB_STAGING_EDGE_SECRET: "short" }, /CLAWHUB_STAGING_EDGE_SECRET/],
    ["wrong branch", { VERCEL_GIT_COMMIT_REF: "feature/demo" }, /COMMIT_REF=staging/],
    ["missing SHA", { VERCEL_GIT_COMMIT_SHA: "" }, /full VERCEL_GIT_COMMIT_SHA/],
    [
      "wrong cloud URL",
      { VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud" },
      /paired cheery-civet-733 Convex URLs/,
    ],
    [
      "wrong site URL",
      { VITE_CONVEX_SITE_URL: "https://wry-manatee-359.convex.site" },
      /paired cheery-civet-733 Convex URLs/,
    ],
    ["missing SITE_URL", { SITE_URL: "" }, /matching SITE_URL and VITE_SITE_URL/],
    ["missing VITE_SITE_URL", { VITE_SITE_URL: "" }, /matching SITE_URL and VITE_SITE_URL/],
    [
      "mismatched site origins",
      { VITE_SITE_URL: "https://clawhub-git-staging-openclaw-foundation.vercel.app" },
      /matching SITE_URL and VITE_SITE_URL/,
    ],
    [
      "production site origin",
      { SITE_URL: "https://clawhub.ai", VITE_SITE_URL: "https://clawhub.ai" },
      /matching SITE_URL and VITE_SITE_URL/,
    ],
    [
      "production frontend site origin",
      { VITE_SITE_URL: "https://clawhub.ai" },
      /matching SITE_URL and VITE_SITE_URL/,
    ],
  ])("fails closed for staging with %s", async (_name, override, error) => {
    const readStagingBackendBuildSha = vi.fn();
    const spawn = vi.fn();

    await expect(
      main({
        env: { ...stagingEnv, ...override },
        readStagingBackendBuildSha,
        spawn,
      }),
    ).rejects.toThrow(error);

    expect(readStagingBackendBuildSha).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("waits for the exact staging backend SHA before building", async () => {
    const readStagingBackendBuildSha = vi
      .fn()
      .mockRejectedValueOnce(new Error("query not deployed"))
      .mockResolvedValueOnce("b".repeat(40))
      .mockResolvedValue(stagingSha);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(main({ env: stagingEnv, readStagingBackendBuildSha, sleep, spawn })).resolves.toBe(
      0,
    );

    expect(readStagingBackendBuildSha).toHaveBeenCalledTimes(3);
    expect(readStagingBackendBuildSha).toHaveBeenCalledWith(stagingEnv.VITE_CONVEX_URL);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 5_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      "bun",
      ["scripts/vercel-build-frontend.ts"],
      expect.anything(),
    );
  });

  it("fails after a bounded wait when the staging backend stays stale", async () => {
    let elapsedMs = 0;
    const readStagingBackendBuildSha = vi.fn().mockResolvedValue("b".repeat(40));
    const sleep = vi.fn(async (delayMs: number) => {
      elapsedMs += delayMs;
    });
    const spawn = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      main({
        env: stagingEnv,
        now: () => elapsedMs,
        readStagingBackendBuildSha,
        sleep,
        spawn,
      }),
    ).rejects.toThrow(/did not reach .+ within 2 minutes/);

    expect(elapsedMs).toBe(120_000);
    expect(readStagingBackendBuildSha).toHaveBeenCalledTimes(25);
    expect(sleep).toHaveBeenCalledTimes(24);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown target environment", () => {
    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "qa",
      }),
    ).toThrow("Unsupported Vercel target environment: qa");
  });

  it("regenerates the full plan with a fresh preview name after a deploy failure", async () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValue({ status: 0 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(main({ env: previewEnv, spawn, sleep })).resolves.toBe(0);

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls.map(([command]) => command)).toEqual(["bunx", "bunx", "bun"]);
    expect(spawn.mock.calls[0]?.[1]).toContain("pe/claw-413-pr-previews-vercel");
    expect(spawn.mock.calls[1]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-2");
    expect(spawn.mock.calls[2]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-2");
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(20_000);
    expect(log).toHaveBeenCalledWith(
      "[vercel-build] convex preview pipeline failed (attempt 1/3); retrying in 20s with preview name pe/claw-413-pr-previews-vercel-retry-2...",
    );
  });

  it("retries the full preview pipeline after a seed failure", async () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValue({ status: 0 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(main({ env: previewEnv, spawn, sleep })).resolves.toBe(0);

    expect(spawn).toHaveBeenCalledTimes(4);
    expect(spawn.mock.calls.map(([command]) => command)).toEqual(["bunx", "bun", "bunx", "bun"]);
    expect(spawn.mock.calls[0]?.[1]).toContain("pe/claw-413-pr-previews-vercel");
    expect(spawn.mock.calls[1]?.[1]).toContain("pe/claw-413-pr-previews-vercel");
    expect(spawn.mock.calls[2]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-2");
    expect(spawn.mock.calls[3]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-2");
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(20_000);
  });

  it("returns a non-zero exit code after exhausting preview pipelines", async () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(main({ env: previewEnv, spawn, sleep })).resolves.toBe(1);

    expect(spawn).toHaveBeenCalledTimes(6);
    expect(spawn.mock.calls[4]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-3");
    expect(spawn.mock.calls[5]?.[1]).toContain("pe/claw-413-pr-previews-vercel-retry-3");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 20_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 40_000);
  });

  it.each([
    ["production", { VERCEL_ENV: "production" }],
    ["test", { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "test" }],
  ])("fails the non-preview %s pipeline immediately", async (_name, env) => {
    const spawn = vi.fn().mockReturnValue({ status: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(main({ env, spawn, sleep })).resolves.toBe(1);

    expect(spawn).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
