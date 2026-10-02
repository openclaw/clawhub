import { describe, expect, it } from "vitest";
import {
  assertPreviewPolicy,
  assertFreshPreviewCache,
  drainPreviewRoutes,
  assertSamePreviewPolicy,
  authorizedPreviewRequest,
  previewOrigin,
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
