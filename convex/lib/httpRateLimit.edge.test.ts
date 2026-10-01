/* @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyClawHubVercelOidcToken } from "./clawhubVercelOidc";
import { applyRateLimit, getClientIp } from "./httpRateLimit";

vi.mock("./clawhubVercelOidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clawhubVercelOidc")>()),
  verifyClawHubVercelOidcToken: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "production");
  vi.stubEnv("SITE_URL", "https://clawhub.ai");
  vi.mocked(verifyClawHubVercelOidcToken).mockImplementation(async (token) => {
    if (token !== "local-verified-edge-fixture") throw new Error("Invalid edge token");
    return {};
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function request(ip: string, token = "local-verified-edge-fixture") {
  return new Request("https://deployment.convex.site/api/v1/search", {
    headers: {
      "x-clawhub-client-ip": ip,
      "x-clawhub-vercel-oidc-token": token,
      "cf-connecting-ip": "198.51.100.99",
      "x-forwarded-for": "198.51.100.98",
    },
  });
}

it("isolates verified visitor allowances and ignores other forwarded identity headers", async () => {
  const consumed = new Set<string>();
  const runMutation = vi.fn(async (_fn: unknown, args: { key: string; config?: unknown }) => {
    if (!args.config) return { action: "updated" };
    if (consumed.has(args.key)) return { ok: false, retryAfter: 60000 };
    consumed.add(args.key);
    return { ok: true };
  });
  const ctx = { runMutation } as unknown as Parameters<typeof applyRateLimit>[0];
  const first = request("203.0.113.1");
  expect((await applyRateLimit(ctx, first, "read")).ok).toBe(true);
  const limited = await applyRateLimit(ctx, request("203.0.113.1"), "read");
  expect(limited.ok).toBe(false);
  if (!limited.ok) expect(limited.response.status).toBe(429);
  expect((await applyRateLimit(ctx, request("203.0.113.2"), "read")).ok).toBe(true);
  expect(getClientIp(first)).toBe("203.0.113.1");
  expect([...consumed]).toEqual(["ip:203.0.113.1:read", "ip:203.0.113.2:read"]);
  expect(verifyClawHubVercelOidcToken).toHaveBeenCalledWith(
    "local-verified-edge-fixture",
    "production",
  );
});

it.each(["", "forged"])(
  "rejects unverified identities (%s) before consuming any quota",
  async (token) => {
    vi.stubEnv("TRUST_FORWARDED_IPS", "true");
    const runMutation = vi.fn();
    const ctx = { runMutation } as unknown as Parameters<typeof applyRateLimit>[0];
    const visitor = request("203.0.113.1", token);
    const result = await applyRateLimit(ctx, visitor, "read");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("Location")).toBeNull();
    }
    expect(getClientIp(visitor)).toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  },
);

it.each(["203.0.113.1, 203.0.113.2", "not-an-ip", "256.1.1.1", "001.2.3.4"])(
  "rejects malformed edge addresses: %s",
  async (ip) => {
    const runMutation = vi.fn();
    const result = await applyRateLimit(
      { runMutation } as unknown as Parameters<typeof applyRateLimit>[0],
      request(ip),
      "read",
    );
    expect(result.ok).toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  },
);

it("keeps redirect destinations on the configured origin for network-path inputs", async () => {
  const result = await applyRateLimit(
    { runMutation: vi.fn() } as unknown as Parameters<typeof applyRateLimit>[0],
    new Request("https://deployment.convex.site//attacker.example/api/v1/search?q=test"),
    "read",
  );
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.response.headers.get("Location")).toBe(
      "https://clawhub.ai//attacker.example/api/v1/search?q=test",
    );
});

it("allows local development only when the server deployment URL is loopback", async () => {
  vi.stubEnv("CLAWHUB_ENV", "");
  vi.stubEnv("CLAWHUB_PREVIEW", "");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  const runMutation = vi.fn(async () => ({ ok: true }));
  const ctx = { runMutation } as unknown as Parameters<typeof applyRateLimit>[0];
  const local = new Request("http://127.0.0.1:3211/api/v1/search");
  expect((await applyRateLimit(ctx, local, "read")).ok).toBe(true);
  expect(getClientIp(local)).toBe("127.0.0.1");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://deployment.convex.cloud");
  runMutation.mockClear();
  expect((await applyRateLimit(ctx, new Request(local), "read")).ok).toBe(false);
  expect(runMutation).not.toHaveBeenCalled();
});

it("rejects unverified requests when no distinct public edge is configured", async () => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("SITE_URL", "https://deployment.convex.site");
  const runMutation = vi.fn();
  const result = await applyRateLimit(
    { runMutation } as unknown as Parameters<typeof applyRateLimit>[0],
    request("203.0.113.1", ""),
    "read",
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(401);
  expect(runMutation).not.toHaveBeenCalled();
});
