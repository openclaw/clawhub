import { LegacyApiRoutes } from "clawhub-schema";
/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import http from "./http";
import { RATE_LIMITS } from "./lib/httpRateLimit";

type WrappedHttpAction = {
  _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
};

function makeDeniedRateLimitCtx() {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
  });
  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("name" in args && "config" in args) {
      const config = args.config as { period: number };
      return { ok: false, retryAfter: config.period };
    }
    throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
  });
  return {
    ctx: {
      runQuery,
      runMutation,
    } as unknown as ActionCtx,
    runQuery,
    runMutation,
  };
}

function makeAllowedRateLimitCtx() {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
  });
  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("name" in args && "config" in args) {
      return { ok: true };
    }
    throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
  });
  return {
    ctx: {
      runQuery,
      runMutation,
      runAction: vi.fn(async () => []),
    } as unknown as ActionCtx,
    runMutation,
  };
}

describe("HTTP route rate limit defaults", () => {
  it("registers package version downloads behind the download limit", async () => {
    const route = http.lookup("/api/v1/packages/demo/versions/1.0.0/download", "GET");
    if (!route) throw new Error("Expected package version download route");
    const [action] = route;
    const { ctx, runMutation } = makeDeniedRateLimitCtx();

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/api/v1/packages/demo/versions/1.0.0/download"),
    );

    expect(response.status).toBe(429);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "downloadIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.download.ip }),
      }),
    );
  });

  it("registers auth sign-in routes behind the router-level default limit", async () => {
    const route = http.lookup("/api/auth/signin/github", "GET");
    if (!route) throw new Error("Expected auth sign-in route");
    const [action] = route;
    const { ctx, runMutation } = makeDeniedRateLimitCtx();

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/api/auth/signin/github"),
    );

    expect(response.status).toBe(429);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "readIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.read.ip }),
      }),
    );
  });

  it.each([
    ["search", LegacyApiRoutes.search, "GET"],
    ["skill detail", LegacyApiRoutes.skill, "GET"],
    ["skill resolve", LegacyApiRoutes.skillResolve, "GET"],
    ["whoami", LegacyApiRoutes.cliWhoami, "GET"],
    ["upload URL", LegacyApiRoutes.cliUploadUrl, "POST"],
    ["publish", LegacyApiRoutes.cliPublish, "POST"],
    ["install telemetry", LegacyApiRoutes.cliTelemetryInstall, "POST"],
    ["skill delete", LegacyApiRoutes.cliSkillDelete, "POST"],
    ["skill undelete", LegacyApiRoutes.cliSkillUndelete, "POST"],
  ])("registers legacy %s behind the router-level default limit", async (_name, path, method) => {
    const route = http.lookup(path, method as "GET" | "POST");
    if (!route) throw new Error(`Expected legacy route for ${path}`);
    const [action] = route;
    const { ctx, runMutation } = makeDeniedRateLimitCtx();

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request(`https://example.com${path}`, { method }),
    );

    expect(response.status).toBe(429);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: method === "GET" ? "readIp" : "writeIp",
        config: expect.objectContaining({
          rate: method === "GET" ? RATE_LIMITS.read.ip : RATE_LIMITS.write.ip,
        }),
      }),
    );
  });

  it("does not double-consume routes that already rate limit inside their handler", async () => {
    const route = http.lookup("/api/v1/search", "GET");
    if (!route) throw new Error("Expected v1 search route");
    const [action] = route;
    const { ctx, runMutation } = makeAllowedRateLimitCtx();

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/api/v1/search?q="),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "readIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.read.ip }),
      }),
    );
  });
});
