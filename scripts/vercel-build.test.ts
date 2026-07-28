import { afterEach, describe, expect, it, vi } from "vitest";
import { main, resolveVercelBuildPlan } from "./vercel-build";

const previewEnv = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "pe/claw-413-pr-previews",
  CONVEX_DEPLOY_KEY: "preview:openclaw:clawhub|secret",
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
