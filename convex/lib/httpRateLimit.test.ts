/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRateLimit, getClientIp, RATE_LIMITS } from "./httpRateLimit";
import { getVerifiedClientIp } from "./verifiedClientIp";

vi.mock("./verifiedClientIp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./verifiedClientIp")>()),
  getVerifiedClientIp: vi.fn(async () => null),
}));

type MockRateLimitStatus = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
};

type MockRateLimitPlan = {
  ip: MockRateLimitStatus;
  user?: MockRateLimitStatus;
  tokenValid?: boolean;
  userActive?: boolean;
  userRole?: "admin" | "moderator" | "user" | null;
};

function makeRateLimitCtx(plan: MockRateLimitPlan) {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("tokenHash" in args) {
      if (plan.tokenValid === false) return null;
      return {
        apiTokenId: "token_1",
        user:
          plan.userActive === false
            ? null
            : {
                _id: "users_123",
                role: plan.userRole ?? "user",
              },
      };
    }
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
  });

  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("name" in args && "key" in args && !("config" in args)) {
      return { action: "updated", expiresAt: Date.now() + 86_400_000 };
    }
    if (!("name" in args && "config" in args)) {
      throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
    }
    const key = String(args.key);
    const source = key.startsWith("user:") ? plan.user : plan.ip;
    if (!source) throw new Error(`Missing rate limit source for ${key}`);
    if (source.allowed) {
      source.remaining = Math.max(0, source.remaining - 1);
      return { ok: true };
    }
    return { ok: false, retryAfter: Math.max(1, source.resetAt - Date.now()) };
  });

  return {
    runQuery,
    runMutation,
  } as unknown as Parameters<typeof applyRateLimit>[0];
}

function componentRateLimitCalls(runMutation: ReturnType<typeof vi.fn>) {
  return runMutation.mock.calls.filter(([, args]) => {
    return Boolean(args && typeof args === "object" && "config" in args);
  }) as [unknown, Record<string, unknown>][];
}

function suppliedMetadata(runMutation: ReturnType<typeof vi.fn>) {
  return componentRateLimitCalls(runMutation).flatMap(([, args]) => {
    const metadata = args.metadata;
    return metadata && typeof metadata === "object"
      ? [{ name: args.name, key: args.key, ...metadata }]
      : [];
  });
}

describe("getClientIp", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.TRUST_FORWARDED_IPS;
  });
  afterEach(() => {
    if (prev === undefined) {
      delete process.env.TRUST_FORWARDED_IPS;
    } else {
      process.env.TRUST_FORWARDED_IPS = prev;
    }
  });

  it("returns null when cf-connecting-ip is missing (CF-only default)", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
      },
    });
    delete process.env.TRUST_FORWARDED_IPS;
    expect(getClientIp(request)).toBeNull();
  });

  it("keeps forwarded headers disabled when TRUST_FORWARDED_IPS=false", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "false";
    expect(getClientIp(request)).toBeNull();
  });

  it("ignores cf-connecting-ip unless client ip headers are explicitly trusted", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.1, 198.51.100.2",
      },
    });
    delete process.env.TRUST_FORWARDED_IPS;
    expect(getClientIp(request)).toBeNull();
  });

  it("rejects raw cf-connecting-ip even with the legacy flag", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.1, 198.51.100.2",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBeNull();
  });

  it("rejects raw forwarded headers even with the legacy flag", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBeNull();
  });

  it("rejects all unverified forwarded identity headers", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
        "x-real-ip": "198.51.100.77",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBeNull();
  });
});

describe("RATE_LIMITS", () => {
  it("keeps anonymous download bursts installation-friendly", () => {
    expect(RATE_LIMITS.download.ip).toBeGreaterThanOrEqual(1200);
    expect(RATE_LIMITS.download.key).toBeGreaterThanOrEqual(6000);
  });

  it("keeps authenticated write bursts release-friendly", () => {
    expect(RATE_LIMITS.write.ip).toBeGreaterThanOrEqual(300);
    expect(RATE_LIMITS.write.key).toBeGreaterThanOrEqual(3000);
  });

  it("allows trusted publish token mint bursts from shared CI egress", () => {
    expect(RATE_LIMITS.trustedPublish.ip).toBeGreaterThanOrEqual(3000);
    expect(RATE_LIMITS.trustedPublish.key).toBeGreaterThanOrEqual(12000);
  });

  it("gives admin API tokens a larger authenticated bucket", () => {
    expect(RATE_LIMITS.write.adminKey).toBeGreaterThan(RATE_LIMITS.write.key);
    expect(RATE_LIMITS.trustedPublish.adminKey).toBeGreaterThan(RATE_LIMITS.trustedPublish.key);
  });
});

describe("applyRateLimit headers", () => {
  beforeEach(() => {
    vi.mocked(getVerifiedClientIp).mockResolvedValue("203.0.113.1");
    vi.stubEnv("CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE", "on");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns delay-seconds Retry-After on 429 (not epoch)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: false,
        remaining: 0,
        limit: RATE_LIMITS.download.ip,
        resetAt: 1_030_500,
      },
    });
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("31");
    expect(result.response.headers.get("X-RateLimit-Reset")).toBe("1031");
    expect(result.response.headers.get("RateLimit-Reset")).toBe("31");
  });

  it("includes rate-limit headers without Retry-After when allowed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.download.ip,
        resetAt: 2_015_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = new Headers(result.headers);
    expect(headers.get("X-RateLimit-Limit")).toBe(String(RATE_LIMITS.download.ip));
    expect(headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(headers.get("X-RateLimit-Reset")).toBe("2040");
    expect(headers.get("RateLimit-Limit")).toBe(String(RATE_LIMITS.download.ip));
    expect(headers.get("RateLimit-Remaining")).toBeNull();
    expect(headers.get("RateLimit-Reset")).toBe("40");
    expect(headers.get("Retry-After")).toBeNull();
  });

  it("returns retryable unavailable response when component counter writes conflict", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_500_000);
    const ctx = {
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('Document in table "rateLimits" changed while this mutation was being run'),
        ),
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("Retry-After")).toBe("1");
    await expect(result.response.text()).resolves.toBe("Rate limit temporarily unavailable");
  });

  it("keeps successful checks available when metadata key writes conflict", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_550_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Document in table "httpRateLimitKeys" changed while this mutation was being run',
        ),
      )
      .mockResolvedValueOnce({ ok: true });
    const ctx = {
      runMutation,
    } as unknown as Parameters<typeof applyRateLimit>[0];

    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/packages/demo"),
      "read",
    );

    expect(result.ok).toBe(true);
    const attempts = componentRateLimitCalls(runMutation);
    expect(attempts[0][1].metadata).toEqual({ now: 2_550_000, ttlMs: 86_400_000 });
    expect(attempts[1][1].metadata).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("rate_limit_metadata_write_contention", {
      name: "readIp",
    });
  });

  it("keeps counter conflicts fail-closed after metadata-contention fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Document in table "httpRateLimitKeys" changed while this mutation was being run',
        ),
      )
      .mockRejectedValueOnce(
        new Error('Document in table "rateLimits" changed while this mutation was being run'),
      );
    const result = await applyRateLimit(
      { runMutation } as unknown as Parameters<typeof applyRateLimit>[0],
      new Request("https://example.com/api/v1/plugins"),
      "read",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("Retry-After")).toBe("1");
    await expect(result.response.text()).resolves.toBe("Rate limit temporarily unavailable");
  });

  it("configures high-volume component-backed HTTP limits with 32 shards", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_600_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_640_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    const [, args] = componentRateLimitCalls(runMutation)[0];
    expect(args).toMatchObject({
      name: "downloadIp",
      key: "ip:203.0.113.1:download",
      config: expect.objectContaining({
        kind: "fixed window",
        rate: RATE_LIMITS.download.ip,
        period: 60_000,
        start: 0,
        shards: 32,
      }),
    });
  });

  it("supplies retention metadata for an allowed limiter check", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_650_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.download.ip,
        resetAt: 2_700_000,
      },
    });

    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/download?slug=demo"),
      "download",
    );

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(suppliedMetadata(runMutation)).toContainEqual(
      expect.objectContaining({
        name: "downloadIp",
        key: "ip:203.0.113.1:download",
        now: 2_650_000,
        ttlMs: 86_400_000,
      }),
    );
  });

  it("supplies retention metadata for a denied limiter check", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_660_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: false,
        remaining: 0,
        limit: RATE_LIMITS.download.ip,
        resetAt: 2_690_000,
      },
    });

    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/download?slug=demo"),
      "download",
    );

    expect(result.ok).toBe(false);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(suppliedMetadata(runMutation)).toContainEqual(
      expect.objectContaining({
        name: "downloadIp",
        key: "ip:203.0.113.1:download",
        now: 2_660_000,
        ttlMs: 86_400_000,
      }),
    );
  });

  it("does not shard low-rate export ip buckets", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_700_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 9,
        limit: RATE_LIMITS.export.ip,
        resetAt: 2_740_000,
      },
    });

    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/skills/export"),
      "export",
    );

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    const [, args] = componentRateLimitCalls(runMutation)[0];
    expect(args).toMatchObject({
      name: "exportIp",
      key: "ip:203.0.113.1:export",
      config: expect.objectContaining({
        kind: "fixed window",
        rate: RATE_LIMITS.export.ip,
        period: 60_000,
        start: 0,
        shards: 1,
      }),
    });
  });

  it("allows authenticated users when user bucket is healthy and shared ip bucket is exhausted", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 3_040_000,
      },
      user: {
        allowed: true,
        remaining: 42,
        limit: 120,
        resetAt: 3_010_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = new Headers(result.headers);
    expect(headers.get("X-RateLimit-Limit")).toBe(String(RATE_LIMITS.download.key));
    expect(headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(headers.get("Retry-After")).toBeNull();
  });

  it("does not consume ip bucket for authenticated requests", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_100_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 3_140_000,
      },
      user: {
        allowed: true,
        remaining: 41,
        limit: 120,
        resetAt: 3_110_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    const consumedKeys = componentRateLimitCalls(runMutation).map(([, args]) => String(args.key));
    expect(consumedKeys.some((key) => key.startsWith("user:"))).toBe(true);
    expect(consumedKeys.some((key) => key.startsWith("ip:"))).toBe(false);
  });

  it("uses the admin bucket for authenticated admin requests", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_200_000);
    const ctx = makeRateLimitCtx({
      userRole: "admin",
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.write.ip,
        resetAt: 3_240_000,
      },
      user: {
        allowed: true,
        remaining: RATE_LIMITS.write.adminKey,
        limit: RATE_LIMITS.write.adminKey,
        resetAt: 3_230_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_admin",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "write");

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(componentRateLimitCalls(runMutation).map(([, args]) => args)).toContainEqual(
      expect.objectContaining({
        name: "writeAdminKey",
        key: "user:users_123:write",
        config: expect.objectContaining({ rate: RATE_LIMITS.write.adminKey }),
      }),
    );
    if (!result.ok) return;
    expect(new Headers(result.headers).get("X-RateLimit-Limit")).toBe(
      String(RATE_LIMITS.write.adminKey),
    );
  });

  it("denies authenticated users when user bucket is exhausted even if ip bucket is healthy", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_020_000,
      },
      user: {
        allowed: false,
        remaining: 0,
        limit: 120,
        resetAt: 4_030_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("X-RateLimit-Limit")).toBe(String(RATE_LIMITS.download.key));
    expect(result.response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });

  it("shares the verified visitor download bucket across routes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_500_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_530_000,
      },
    });

    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/download?slug=first&version=1.0.0"),
      "download",
    );
    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/packages/second-plugin/download?version=0.2.0"),
      "download",
    );

    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(componentRateLimitCalls(runMutation).map(([, args]) => String(args.key))).toEqual([
      "ip:203.0.113.1:download",
      "ip:203.0.113.1:download",
    ]);
  });

  it("scopes known-ip anonymous buckets by rate limit kind", async () => {
    vi.stubEnv("TRUST_FORWARDED_IPS", "true");
    vi.spyOn(Date, "now").mockReturnValue(4_550_000);
    const readCtx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.read.ip,
        resetAt: 4_580_000,
      },
    });
    const downloadCtx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.download.ip,
        resetAt: 4_580_000,
      },
    });
    const request = new Request("https://example.com/api/v1/packages/demo/download", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    await applyRateLimit(readCtx, request, "read");
    await applyRateLimit(downloadCtx, request, "download");

    const readMutation = (readCtx as unknown as { runMutation: ReturnType<typeof vi.fn> })
      .runMutation;
    const downloadMutation = (downloadCtx as unknown as { runMutation: ReturnType<typeof vi.fn> })
      .runMutation;
    expect(componentRateLimitCalls(readMutation).map(([, args]) => String(args.key))).toContain(
      "ip:203.0.113.1:read",
    );
    expect(componentRateLimitCalls(downloadMutation).map(([, args]) => String(args.key))).toContain(
      "ip:203.0.113.1:download",
    );
  });

  it("scopes authenticated buckets by rate limit kind", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_575_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.read.ip,
        resetAt: 4_600_000,
      },
      user: {
        allowed: true,
        remaining: 42,
        limit: RATE_LIMITS.download.key,
        resetAt: 4_600_000,
      },
    });
    const request = new Request("https://example.com/api/v1/packages/demo/download", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(componentRateLimitCalls(runMutation).map(([, args]) => String(args.key))).toContain(
      "user:users_123:download",
    );
  });

  it("shares the verified visitor read bucket across routes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_600_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_630_000,
      },
    });

    await applyRateLimit(ctx, new Request("https://example.com/api/v1/search?q=demo"), "read");
    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/packages/second-plugin"),
      "read",
    );

    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(componentRateLimitCalls(runMutation).map(([, args]) => String(args.key))).toEqual([
      "ip:203.0.113.1:read",
      "ip:203.0.113.1:read",
    ]);
  });

  it("falls back to ip enforcement when bearer token is invalid", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    const ctx = makeRateLimitCtx({
      tokenValid: false,
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 5_030_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer invalid",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("X-RateLimit-Limit")).toBe(String(RATE_LIMITS.download.ip));
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });
});
describe("anonymous request isolation", () => {
  beforeEach(() => vi.mocked(getVerifiedClientIp).mockResolvedValue(null));
  afterEach(() => vi.unstubAllEnvs());

  it("routes unknown direct visitors through the edge without consuming a shared quota", async () => {
    vi.stubEnv("SITE_URL", "https://clawhub.ai");
    const ctx = makeRateLimitCtx({
      ip: { allowed: true, remaining: 10, limit: 10, resetAt: Date.now() + 60000 },
    });
    const result = await applyRateLimit(
      ctx,
      new Request("https://example.convex.site/api/v1/search?q=test"),
      "read",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(307);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("does not let an opt-in flag turn caller-supplied headers into quota identities", async () => {
    vi.stubEnv("TRUST_FORWARDED_IPS", "true");
    const request = new Request("https://example.convex.site/api/v1/search", {
      headers: { "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "203.0.113.9" },
    });
    expect(getClientIp(request)).toBeNull();
  });
});

describe("RPC rollout guard", () => {
  beforeEach(() => {
    vi.mocked(getVerifiedClientIp).mockResolvedValue("203.0.113.1");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "on"])("keeps metadata capacity errors fatal in mode %s", async (mode) => {
    vi.stubEnv("CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE", mode);
    const capacityError = new Error("CommitterFullError: Too many writes");
    const runMutation = vi.fn().mockRejectedValueOnce(capacityError);
    await expect(
      applyRateLimit(
        { runMutation } as unknown as Parameters<typeof applyRateLimit>[0],
        new Request("https://example.com/api/v1/plugins"),
        "read",
      ),
    ).rejects.toBe(capacityError);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("keeps the default metadata-conflict fallback separate from quota", async () => {
    vi.stubEnv("CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Document in table "httpRateLimitKeys" changed while this mutation was being run',
        ),
      )
      .mockResolvedValueOnce({ ok: true });
    const result = await applyRateLimit(
      { runMutation } as unknown as Parameters<typeof applyRateLimit>[0],
      new Request("https://example.com/api/v1/plugins"),
      "read",
    );
    expect(result.ok).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0][1]).not.toHaveProperty("config");
    expect(componentRateLimitCalls(runMutation)).toHaveLength(1);
    expect(componentRateLimitCalls(runMutation)[0][1]).not.toHaveProperty("metadata");
  });

  it.each([
    ["unset", undefined, "admin", "combined", false],
    ["empty", "", "admin", "combined", false],
    ["off", "off", "admin", "combined", false],
    ["unknown mode", "enabled", "admin", "combined", false],
    ["anonymous probe", "admin-probe", "anonymous", "combined", false],
    ["user probe", "admin-probe", "user", "combined", false],
    ["moderator probe", "admin-probe", "moderator", "combined", false],
    ["invalid token probe", "admin-probe", "invalid-admin", "combined", false],
    ["inactive user probe", "admin-probe", "inactive-admin", "combined", false],
    ["admin control", "admin-probe", "admin", undefined, false],
    ["unknown probe value", "admin-probe", "admin", "COMBINED", false],
    ["admin candidate", "admin-probe", "admin", "combined", true],
    ["enabled anonymous", "on", "anonymous", undefined, true],
    ["enabled user", "on", "user", undefined, true],
    ["enabled admin", "on", "admin", undefined, true],
    ["enabled ignores control header", "on", "admin", "separate", true],
  ] as const)(
    "%s preserves quota and selects only the allowed RPC path",
    async (_name, mode, role, probe, combined) => {
      vi.stubEnv("CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE", mode);
      const userRole = role === "user" || role === "moderator" ? role : "admin";
      const validUser = !["anonymous", "invalid-admin", "inactive-admin"].includes(role);
      const ctx = makeRateLimitCtx({
        userRole,
        tokenValid: role !== "invalid-admin",
        userActive: role !== "inactive-admin",
        ip: { allowed: true, remaining: 10, limit: RATE_LIMITS.read.ip, resetAt: 1_060_000 },
        user: { allowed: true, remaining: 10, limit: RATE_LIMITS.read.key, resetAt: 1_060_000 },
      });
      const headers: Record<string, string> = {};
      if (role !== "anonymous") headers.authorization = "Bearer clh_rollout_fixture";
      if (probe) headers["x-clawhub-rate-limit-rpc"] = probe;
      const result = await applyRateLimit(
        ctx,
        new Request("https://example.com/api/v1/plugins", { headers }),
        "read",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
      expect(runMutation).toHaveBeenCalledTimes(combined ? 1 : 2);
      const calls = componentRateLimitCalls(runMutation);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({
        name: validUser ? (userRole === "admin" ? "readAdminKey" : "readKey") : "readIp",
        key: validUser ? "user:users_123:read" : "ip:203.0.113.1:read",
      });
      expect(calls[0][1].metadata).toEqual(
        combined ? { now: 1_000_000, ttlMs: 86_400_000 } : undefined,
      );
      expect(new Headers(result.headers).get("X-ClawHub-RateLimit-Rpc")).toBe(
        mode === "admin-probe" && validUser && userRole === "admin"
          ? combined
            ? "combined"
            : "separate"
          : null,
      );
    },
  );
});

describe("batched quota accounting", () => {
  function makeBatchedCtx(options: { bucketOpen?: boolean } = {}) {
    const bucketOpen = options.bucketOpen ?? true;
    const consumed: number[] = [];
    const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      if ("tokenHash" in args) return null;
      if ("name" in args && "config" in args) {
        return bucketOpen ? { ok: true } : { ok: false, retryAfter: 5_000 };
      }
      throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
    });
    const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      if ("name" in args && "key" in args && !("config" in args)) {
        return { action: "retained", expiresAt: Date.now() + 86_400_000 };
      }
      if (!("config" in args))
        throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
      consumed.push(typeof args.count === "number" ? args.count : 1);
      return bucketOpen ? { ok: true } : { ok: false, retryAfter: 5_000 };
    });
    const ctx = { runQuery, runMutation } as unknown as Parameters<typeof applyRateLimit>[0];
    return { ctx, runQuery, runMutation, consumed };
  }

  beforeEach(() => {
    delete process.env.CLAWHUB_HTTP_RATE_LIMIT_BATCHING;
    vi.mocked(getVerifiedClientIp).mockResolvedValue("203.0.113.1");
  });
  afterEach(() => {
    process.env.CLAWHUB_HTTP_RATE_LIMIT_BATCHING = "off";
    vi.mocked(getVerifiedClientIp).mockResolvedValue(null);
    vi.restoreAllMocks();
  });

  it("records one batched write per four read requests with unchanged expected consumption", async () => {
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => (call++ % 4) / 4);
    const { ctx, runMutation, runQuery, consumed } = makeBatchedCtx();
    for (let i = 0; i < 800; i++) {
      const result = await applyRateLimit(
        ctx,
        new Request("https://example.com/api/v1/skills"),
        "read",
      );
      expect(result.ok).toBe(true);
    }
    expect(consumed).toHaveLength(200);
    expect(consumed.every((count) => count === 4)).toBe(true);
    expect(consumed.reduce((sum, count) => sum + count, 0)).toBe(800);
    // Metadata is refreshed only alongside committed consumption.
    expect(runMutation.mock.calls.length).toBe(400);
    expect(componentRateLimitCalls(runMutation)[0][1]).toMatchObject({
      name: "readIp",
      key: "ip:203.0.113.1:read",
      count: 4,
    });
    const peeks = runQuery.mock.calls.filter(([, args]) => "config" in (args as object));
    expect(peeks).toHaveLength(600);
    expect(peeks[0][1]).toEqual({
      name: "readIp",
      key: "ip:203.0.113.1:read",
      config: { kind: "fixed window", rate: 3000, period: 60_000, start: 0, shards: 32 },
      count: 4,
    });
  });

  it("denies a request from an exhausted bucket without consuming quota", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { ctx, runMutation, consumed } = makeBatchedCtx({ bucketOpen: false });
    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/skills"),
      "read",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(consumed).toEqual([]);
    // Denied traffic keeps retention metadata fresh (spec invariant).
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      name: "readIp",
      key: "ip:203.0.113.1:read",
      ttlMs: 86_400_000,
    });
  });

  it("denies a sampled request when the batched consumption does not fit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { ctx, consumed } = makeBatchedCtx({ bucketOpen: false });
    const result = await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/download"),
      "download",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(consumed).toEqual([4]);
  });

  it.each(["write", "export", "trustedPublish"] as const)(
    "keeps exact per-request accounting for %s",
    async (kind) => {
      vi.spyOn(Math, "random").mockReturnValue(0.9);
      const { ctx, runQuery, consumed } = makeBatchedCtx();
      const result = await applyRateLimit(ctx, new Request("https://example.com/api/v1/x"), kind);
      expect(result.ok).toBe(true);
      expect(consumed).toEqual([1]);
      expect(
        componentRateLimitCalls(
          (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation,
        )[0][1],
      ).not.toHaveProperty("count");
      expect(runQuery.mock.calls.filter(([, args]) => "config" in (args as object))).toHaveLength(
        0,
      );
    },
  );

  it("restores exact accounting when batching is switched off", async () => {
    process.env.CLAWHUB_HTTP_RATE_LIMIT_BATCHING = "off";
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { ctx, consumed } = makeBatchedCtx();
    for (let i = 0; i < 3; i++) {
      await applyRateLimit(ctx, new Request("https://example.com/api/v1/skills"), "read");
    }
    expect(consumed).toEqual([1, 1, 1]);
  });
});
