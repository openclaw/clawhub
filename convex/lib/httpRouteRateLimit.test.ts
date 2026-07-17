/* @vitest-environment node */
import { httpRouter } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { applyRateLimit, RATE_LIMITS } from "./httpRateLimit";
import { installRateLimitedRoutes, rateLimitedHttpAction } from "./httpRouteRateLimit";

type WrappedHttpAction = {
  _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
};

function makeCtx({
  allowed = true,
}: {
  allowed?: boolean;
} = {}) {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
  });
  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("name" in args && "config" in args) {
      const config = args.config as { period: number };
      return allowed ? { ok: true } : { ok: false, retryAfter: config.period };
    }
    if ("name" in args && "key" in args && "ttlMs" in args) {
      return { action: "retained" };
    }
    throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
  });
  return { ctx: { runQuery, runMutation } as unknown as ActionCtx, runQuery, runMutation };
}

describe("rateLimitedHttpAction", () => {
  it("blocks before the wrapped HTTP handler runs", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const action = httpAction(handler) as unknown as Parameters<typeof rateLimitedHttpAction>[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: () => ({ kind: "read" }),
    }) as unknown as WrappedHttpAction;
    const { ctx, runMutation } = makeCtx({ allowed: false });

    const response = await wrapped._handler(ctx, new Request("https://example.com/api/v1/skills"));

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("Rate limit exceeded");
    expect(handler).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "readIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.read.ip }),
      }),
    );
  });

  it("merges route rate-limit headers into successful responses", async () => {
    const action = httpAction(
      async () => new Response("ok", { headers: { "X-App": "1" } }),
    ) as unknown as Parameters<typeof rateLimitedHttpAction>[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: () => ({ kind: "read" }),
    }) as unknown as WrappedHttpAction;
    const { ctx } = makeCtx();

    const response = await wrapped._handler(ctx, new Request("https://example.com/api/v1/skills"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-App")).toBe("1");
    expect(response.headers.get("RateLimit-Limit")).toBe(String(RATE_LIMITS.read.ip));
  });

  it("preserves multiple Set-Cookie headers on successful responses", async () => {
    const action = httpAction(async () => {
      const headers = new Headers({ "X-App": "1" });
      headers.append("Set-Cookie", "oauth_state=abc; HttpOnly; Path=/");
      headers.append("Set-Cookie", "redirect_to=%2Fdashboard; HttpOnly; Path=/");
      return new Response("ok", { headers });
    }) as unknown as Parameters<typeof rateLimitedHttpAction>[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: () => ({ kind: "read" }),
    }) as unknown as WrappedHttpAction;
    const { ctx } = makeCtx();

    const response = await wrapped._handler(
      ctx,
      new Request("https://example.com/api/auth/signin"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-App")).toBe("1");
    expect(response.headers.get("RateLimit-Limit")).toBe(String(RATE_LIMITS.read.ip));
    expect([...response.headers.entries()].filter(([key]) => key === "set-cookie")).toEqual([
      ["set-cookie", "oauth_state=abc; HttpOnly; Path=/"],
      ["set-cookie", "redirect_to=%2Fdashboard; HttpOnly; Path=/"],
    ]);
  });

  it("supports dynamic route-specific rate limit overrides", async () => {
    const action = httpAction(async () => new Response("ok")) as unknown as Parameters<
      typeof rateLimitedHttpAction
    >[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: (request) =>
        new URL(request.url).pathname.endsWith("/download")
          ? { kind: "download" }
          : { kind: "read" },
    }) as unknown as WrappedHttpAction;
    const { ctx, runMutation } = makeCtx();

    await wrapped._handler(ctx, new Request("https://example.com/api/v1/packages/demo/download"));

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "downloadIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.download.ip }),
      }),
    );
  });

  it("makes wrapper-applied limits authoritative for nested handler checks", async () => {
    const handler = vi.fn(async (ctx: ActionCtx, request: Request) => {
      const nestedRate = await applyRateLimit(ctx, request, "write");
      if (!nestedRate.ok) return nestedRate.response;
      return new Response("ok", { headers: nestedRate.headers });
    });
    const action = httpAction(handler) as unknown as Parameters<typeof rateLimitedHttpAction>[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: () => ({ kind: "read" }),
    }) as unknown as WrappedHttpAction;
    const { ctx, runMutation } = makeCtx();

    const response = await wrapped._handler(ctx, new Request("https://example.com/api/v1/search"));

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "readIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.read.ip }),
      }),
    );
    expect(response.headers.get("RateLimit-Limit")).toBe(String(RATE_LIMITS.read.ip));
    expect(response.headers.get("RateLimit-Limit")).not.toContain(",");
  });

  it("allows explicit route opt-outs", async () => {
    const action = httpAction(async () => new Response("ok")) as unknown as Parameters<
      typeof rateLimitedHttpAction
    >[0];
    const wrapped = rateLimitedHttpAction(action, {
      resolveRateLimit: () => ({ kind: "none" }),
    }) as unknown as WrappedHttpAction;
    const { ctx, runQuery, runMutation } = makeCtx({ allowed: false });

    const response = await wrapped._handler(ctx, new Request("https://example.com/api/v1/health"));

    expect(response.status).toBe(200);
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("installRateLimitedRoutes", () => {
  it.each([
    [
      "read default",
      "/api/v1/example",
      "GET",
      "https://example.com/api/v1/example",
      RATE_LIMITS.read.ip,
    ],
    [
      "write default",
      "/api/v1/example",
      "POST",
      "https://example.com/api/v1/example",
      RATE_LIMITS.write.ip,
    ],
    [
      "download exact",
      "/api/v1/download",
      "GET",
      "https://example.com/api/v1/download?slug=demo",
      RATE_LIMITS.download.ip,
    ],
    [
      "export exact",
      "/api/v1/skills/export",
      "GET",
      "https://example.com/api/v1/skills/export",
      RATE_LIMITS.export.ip,
    ],
    [
      "trusted publish",
      "/api/v1/publish/token/mint",
      "POST",
      "https://example.com/api/v1/publish/token/mint",
      RATE_LIMITS.trustedPublish.ip,
    ],
  ])("applies the central %s bucket", async (_name, path, method, requestUrl, expectedLimit) => {
    const router = installRateLimitedRoutes(httpRouter());
    router.route({
      path,
      method: method as "GET" | "POST",
      handler: httpAction(async () => new Response("ok")),
    });
    const route = router.lookup(path, method as "GET" | "POST");
    if (!route) throw new Error(`Expected route for ${path}`);
    const [action] = route;
    const { ctx, runMutation } = makeCtx();

    await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request(requestUrl, { method }),
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        config: expect.objectContaining({ rate: expectedLimit }),
      }),
    );
  });

  it.each([
    ["package detail", "/api/v1/packages/", "/api/v1/packages/demo", RATE_LIMITS.read.ip],
    [
      "package version download",
      "/api/v1/packages/",
      "/api/v1/packages/demo/versions/1.0.0/download",
      RATE_LIMITS.download.ip,
    ],
    [
      "package artifact",
      "/api/v1/packages/",
      "/api/v1/packages/demo/versions/1.0.0/artifact",
      RATE_LIMITS.download.ip,
    ],
    [
      "scoped package named download",
      "/api/v1/packages/",
      "/api/v1/packages/@scope/download",
      RATE_LIMITS.read.ip,
    ],
    [
      "scoped package named artifact",
      "/api/v1/packages/",
      "/api/v1/packages/@scope/artifact",
      RATE_LIMITS.read.ip,
    ],
    ["npm metadata", "/api/npm/", "/api/npm/demo", RATE_LIMITS.read.ip],
    ["npm tarball", "/api/npm/", "/api/npm/demo/-/demo-1.0.0.tgz", RATE_LIMITS.download.ip],
    [
      "npm tarball with encoded separator",
      "/api/npm/",
      "/api/npm/demo/%2D/demo-1.0.0.tgz",
      RATE_LIMITS.download.ip,
    ],
  ])(
    "classifies central prefix policy for %s",
    async (_name, pathPrefix, requestPath, expectedLimit) => {
      const router = installRateLimitedRoutes(httpRouter());
      router.route({
        pathPrefix,
        method: "GET",
        handler: httpAction(async () => new Response("ok")),
      });
      const route = router.lookup(requestPath, "GET");
      if (!route) throw new Error(`Expected route for ${requestPath}`);
      const [action] = route;
      const { ctx, runMutation } = makeCtx();

      await (action as unknown as WrappedHttpAction)._handler(
        ctx,
        new Request(`https://example.com${requestPath}`),
      );

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          config: expect.objectContaining({ rate: expectedLimit }),
        }),
      );
    },
  );

  it("wraps ordinary route registrations with the default method limit", async () => {
    const router = installRateLimitedRoutes(httpRouter());
    const handler = vi.fn(async () => new Response("ok"));
    router.route({
      path: "/api/v1/example",
      method: "GET",
      handler: httpAction(handler),
    });
    const route = router.lookup("/api/v1/example", "GET");
    if (!route) throw new Error("Expected wrapped route");
    const [action] = route;
    const { ctx, runMutation } = makeCtx({ allowed: false });

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/api/v1/example"),
    );

    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "readIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.read.ip }),
      }),
    );
  });

  it("leaves auth metadata route registrations explicitly unmetered", async () => {
    const router = installRateLimitedRoutes(httpRouter());
    router.route({
      path: "/.well-known/jwks.json",
      method: "GET",
      handler: httpAction(async () => new Response("jwks")),
    });
    const route = router.lookup("/.well-known/jwks.json", "GET");
    if (!route) throw new Error("Expected auth metadata route");
    const [action] = route;
    const { ctx, runQuery, runMutation } = makeCtx({ allowed: false });

    const response = await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/.well-known/jwks.json"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("jwks");
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("supports central route policy overrides", async () => {
    const router = installRateLimitedRoutes(httpRouter(), {
      resolveRateLimit: () => ({ kind: "export" }),
    });
    router.route({
      path: "/custom-export",
      method: "GET",
      handler: httpAction(async () => new Response("ok")),
    });
    const route = router.lookup("/custom-export", "GET");
    if (!route) throw new Error("Expected custom export route");
    const [action] = route;
    const { ctx, runMutation } = makeCtx();

    await (action as unknown as WrappedHttpAction)._handler(
      ctx,
      new Request("https://example.com/custom-export"),
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "exportIp",
        config: expect.objectContaining({ rate: RATE_LIMITS.export.ip }),
      }),
    );
  });
});
