import type { Route } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  assertPreviewPolicy,
  assertPreviewDeployment,
  assertFreshPreviewCache,
  drainPreviewRoutes,
  assertSamePreviewPolicy,
  authorizedPreviewRequest,
  previewOrigin,
  routePreviewRequest,
} from "./previewAnalyticsProof";

const origin = "https://clawhub-git-feat-native-ga4-openclaw-foundation.vercel.app";
const policy = {
  schema_version: 1,
  policy_version: "2026-10-02.v2",
  region_class: "notice_opt_out",
};
const cache = () =>
  new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
    "cdn-cache-control": "no-store",
  });

describe("read-only hosted preview analytics proof", () => {
  it("binds expected commit to the exact runtime path and bytes, not an unrelated commit label", () => {
    const asset = { path: "/assets/runtimeEnv-12345678.js", sha256: "b".repeat(64) };
    const metadata = { schema_version: 1, git_commit_sha: "a".repeat(40), runtime_asset: asset };
    expect(assertPreviewDeployment(metadata, cache(), "a".repeat(40), asset)).toEqual(metadata);
    expect(() => assertPreviewDeployment(metadata, cache(), "c".repeat(40), asset)).toThrow(
      "DEPLOYMENT_METADATA_SHA",
    );
    for (const changed of [
      { ...asset, path: "/assets/runtimeEnv-87654321.js" },
      { ...asset, sha256: "c".repeat(64) },
    ])
      expect(() => assertPreviewDeployment(metadata, cache(), "a".repeat(40), changed)).toThrow(
        "DEPLOYMENT_METADATA_ASSET",
      );
    expect(() =>
      assertPreviewDeployment({ ...metadata, runtime_asset: null }, cache(), "a".repeat(40), asset),
    ).toThrow("DEPLOYMENT_METADATA_SCHEMA");
  });
  it("accepts deployment-scoped static HIT while keeping regional responses uncached", () => {
    const asset = { path: "/assets/runtimeEnv-12345678.js", sha256: "b".repeat(64) };
    const metadata = { schema_version: 1, git_commit_sha: "a".repeat(40), runtime_asset: asset };
    const headers = cache();
    headers.set("age", "13");
    headers.set("x-vercel-cache", "HIT");
    expect(assertPreviewDeployment(metadata, headers, "a".repeat(40), asset)).toEqual(metadata);
    expect(() => assertPreviewDeployment(metadata, headers, "c".repeat(40), asset)).toThrow(
      "DEPLOYMENT_METADATA_SHA",
    );
    expect(() =>
      assertPreviewDeployment(metadata, headers, "a".repeat(40), {
        ...asset,
        sha256: "c".repeat(64),
      }),
    ).toThrow("DEPLOYMENT_METADATA_ASSET");
    expect(() => assertPreviewPolicy(policy, headers)).toThrow("POLICY_CACHED");
    headers.set("x-vercel-cache", "MISS");
    expect(() => assertPreviewPolicy(policy, headers)).toThrow("POLICY_CACHED");
    headers.set("age", "0");
    expect(assertPreviewPolicy(policy, headers)).toEqual(policy);
  });
  it("rejects stale, malformed or cacheable-client metadata even when commit and asset match", () => {
    const asset = { path: "/assets/runtimeEnv-12345678.js", sha256: "b".repeat(64) };
    const metadata = { schema_version: 1, git_commit_sha: "a".repeat(40), runtime_asset: asset };
    for (const change of [
      { "cache-control": "max-age=0, must-revalidate" },
      { "cdn-cache-control": "max-age=60" },
      { "vercel-cdn-cache-control": "max-age=60" },
      { age: "-1" },
      { age: "invalid" },
      { "x-vercel-cache": "UNKNOWN" },
      { "x-vercel-cache": "STALE" },
    ]) {
      const headers = cache();
      for (const [key, value] of Object.entries(change)) headers.set(key, value);
      expect(() => assertPreviewDeployment(metadata, headers, "a".repeat(40), asset)).toThrow(
        "DEPLOYMENT_METADATA_CACHE",
      );
    }
  });
  it("scopes the existing job credential to a ClawHub preview and GET only", () => {
    expect(previewOrigin(`${origin}/`)).toBe(origin);
    for (const target of [
      "https://clawhub.ai",
      "https://unrelated.vercel.app",
      "http://clawhub-x-openclaw-foundation.vercel.app",
      "https://user:password@clawhub-x-openclaw-foundation.vercel.app",
    ])
      expect(() => previewOrigin(target)).toThrow();
    const request = authorizedPreviewRequest(
      origin,
      "fixture-credential",
      "/api/analytics-consent",
      "DE",
    );
    expect(request.init).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { "x-vercel-ip-country": "DE" },
    });
    expect(request.url).not.toContain("fixture-credential");
    expect(() =>
      authorizedPreviewRequest(origin, "fixture-credential", "https://other.example/api"),
    ).toThrow(/AUTHORIZED_ORIGIN/);
  });
  it("checks exactly three typed fields and the current policy", () => {
    expect(assertPreviewPolicy(policy, cache())).toEqual(policy);
    for (const body of [
      null,
      [],
      { ...policy, country: "US" },
      { ...policy, schema_version: "1" },
      { ...policy, policy_version: "2026-10-02.v1" },
      { ...policy, region_class: "unknown" },
    ])
      expect(() => assertPreviewPolicy(body, cache())).toThrow();
  });
  it("requires private and CDN no-store rather than inferring caching from status", () => {
    for (const headers of [
      new Headers(),
      new Headers({ "cache-control": "no-store", "cdn-cache-control": "no-store" }),
      new Headers({ "cache-control": "private, no-store" }),
      new Headers({
        "cache-control": "private, no-store",
        "cdn-cache-control": "public, max-age=60",
      }),
    ])
      expect(() => assertPreviewPolicy(policy, headers)).toThrow();
    const headers = cache();
    headers.set("vercel-cdn-cache-control", "public, max-age=60");
    expect(() => assertPreviewPolicy(policy, headers)).toThrow();
    headers.set("vercel-cdn-cache-control", "no-store");
    expect(assertPreviewPolicy(policy, headers)).toEqual(policy);
  });
  it("rejects any policy change from the forged country header", () => {
    expect(() => assertSamePreviewPolicy(policy, { ...policy })).not.toThrow();
    expect(() => assertSamePreviewPolicy(policy, { ...policy, region_class: "opt_in" })).toThrow(
      /POLICY_SPOOF_CHANGED/,
    );
  });
});

it.each([
  ["fetch", `${origin}/?secret=PRIVATE`, "home", null],
  ["redirect", `${origin}/assets/app.js?secret=PRIVATE`, "asset", 307],
  ["fulfill", `${origin}/api/private-value?secret=PRIVATE`, "api", 200],
  ["continue", "https://external.invalid/private?secret=PRIVATE", "external", null],
] as const)(
  "retains only bounded %s diagnostics and confines authenticated redirects",
  async (phase, url, pathClass, status) => {
    const raw = new Error("PRIVATE header and redirect value");
    const response = new Response("OK", { status: status ?? 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        phase === "fetch" ? Promise.reject(raw) : Promise.resolve(response),
      );
    const route = {
      request: () => ({
        url: () => url,
        allHeaders: async () => ({}),
        method: () => "GET",
        postDataBuffer: () => null,
      }),
      fulfill: vi.fn().mockRejectedValue(raw),
      continue: vi.fn().mockRejectedValue(raw),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const errors: string[] = [];
    const failures: Parameters<typeof routePreviewRequest>[5] = [];
    await routePreviewRequest(
      route as unknown as Route,
      origin,
      "PRIVATE",
      [],
      errors,
      failures,
      fetchImpl,
    );
    expect(errors).toEqual(["BROWSER_ROUTE_FAILED"]);
    expect(failures).toEqual([
      { path_class: pathClass, phase, status, elapsed_ms: expect.any(Number) },
    ]);
    expect(failures[0].elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(failures[0].elapsed_ms).toBeLessThanOrEqual(60_000);
    expect(JSON.stringify(failures)).not.toMatch(/PRIVATE|secret|https|header/);
    if (phase === "continue") expect(fetchImpl).not.toHaveBeenCalled();
    else
      expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(url, {
        method: "GET",
        body: undefined,
        headers: { "x-vercel-protection-bypass": "PRIVATE" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
    if (phase === "redirect") {
      expect(route.fulfill).not.toHaveBeenCalled();
      expect(route.continue).not.toHaveBeenCalled();
    }
  },
);

it("bounds retained route failures while every failure still fails the proof", async () => {
  const errors: string[] = [];
  const failures: Parameters<typeof routePreviewRequest>[5] = [];
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("not retained"));
  const route = {
    request: () => ({
      url: () => origin,
      allHeaders: async () => ({}),
      method: () => "GET",
      postDataBuffer: () => null,
    }),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  for (let index = 0; index < 33; index++)
    await routePreviewRequest(
      route as unknown as Route,
      origin,
      "PRIVATE",
      [],
      errors,
      failures,
      fetchImpl,
    );
  expect(errors).toHaveLength(33);
  expect(failures).toHaveLength(32);
});

it("fulfills decoded bytes and separate cookies without changing security/cache headers", async () => {
  const response = new Response("decoded document", {
    headers: {
      "content-type": "text/html",
      "content-encoding": "gzip",
      "content-length": "99",
      "transfer-encoding": "chunked",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'self'",
    },
  });
  response.headers.append("set-cookie", "first=1; Path=/; HttpOnly");
  response.headers.append("set-cookie", "second=2; Path=/; HttpOnly");
  const binaryRequest = Buffer.from([9, 9, 0, 255, 128, 1, 9]).subarray(2, 6);
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  const route = {
    request: () => ({
      url: () => origin,
      allHeaders: async () => ({ cookie: "first=1; second=2" }),
      method: () => "POST",
      postDataBuffer: () => binaryRequest,
    }),
    fulfill: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  };
  const errors: string[] = [];
  await routePreviewRequest(
    route as unknown as Route,
    origin,
    "PRIVATE",
    [],
    errors,
    [],
    fetchImpl,
  );
  expect(errors).toEqual([]);
  expect(fetchImpl.mock.calls[0][1]?.method).toBe("POST");
  expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({
    cookie: "first=1; second=2",
    "x-vercel-protection-bypass": "PRIVATE",
  });
  expect(Buffer.from(fetchImpl.mock.calls[0][1]?.body as ArrayBuffer)).toEqual(binaryRequest);
  expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({
    status: 200,
    body: Buffer.from("decoded document"),
    headers: {
      "content-type": "text/html",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'self'",
      "set-cookie": "first=1; Path=/; HttpOnly\nsecond=2; Path=/; HttpOnly",
    },
  });
  expect(route.abort).not.toHaveBeenCalled();
});

it("drains pending route work before context disposal and preserves failures", async () => {
  let complete!: () => void;
  const work = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const pending = new Set([work]);
  let finished = false;
  const cleanup = drainPreviewRoutes(pending).then(() => {
    finished = true;
  });
  expect(finished).toBe(false);
  complete();
  pending.delete(work);
  await cleanup;
  expect(finished).toBe(true);
  await expect(
    drainPreviewRoutes(new Set([Promise.reject(new Error("request failed"))])),
  ).rejects.toThrow("request failed");
  await expect(drainPreviewRoutes(new Set([new Promise<void>(() => {})]), 1)).rejects.toThrow(
    "ROUTE_CLEANUP_TIMEOUT",
  );
});

it("records fresh cache evidence and rejects positive Age, HIT and STALE", () => {
  expect(assertFreshPreviewCache(cache())).toEqual({ age: null, x_vercel_cache: null });
  const fresh = cache();
  fresh.set("age", "0");
  fresh.set("x-vercel-cache", "MISS");
  expect(assertFreshPreviewCache(fresh)).toEqual({ age: 0, x_vercel_cache: "MISS" });
  for (const state of ["HIT", "STALE"]) {
    const h = cache();
    h.set("x-vercel-cache", state);
    expect(() => assertFreshPreviewCache(h)).toThrow("POLICY_CACHED");
  }
  const aged = cache();
  aged.set("age", "1");
  expect(() => assertFreshPreviewCache(aged)).toThrow("POLICY_CACHED");
  aged.set("age", "invalid");
  expect(() => assertFreshPreviewCache(aged)).toThrow("POLICY_CACHE_AGE");
});
