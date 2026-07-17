/* @vitest-environment node */

import { mockEvent } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConvexProxyTarget,
  isConvexProxyMethodAllowed,
  proxyConvexRequest,
  resolveConvexProxyEnv,
} from "./convexProxy";

describe("Convex HTTP proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps API and hosted feed paths to the paired Convex site", () => {
    const env = {
      VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
    };

    expect(buildConvexProxyTarget("/api/v1/skills/demo?include=latest", env)).toBe(
      "https://preview-branch-123.convex.site/api/v1/skills/demo?include=latest",
    );
    expect(buildConvexProxyTarget("/v1/feeds/plugins", env)).toBe(
      "https://preview-branch-123.convex.site/api/v1/feeds/plugins",
    );
    expect(
      buildConvexProxyTarget(`/v1/feeds/plugins/shards/sha256-${"a".repeat(64)}.json`, env),
    ).toBe(
      `https://preview-branch-123.convex.site/api/v1/feeds/plugins/shards/sha256-${"a".repeat(64)}.json`,
    );
  });

  it("allows only read methods when the frontend is a preview", () => {
    const previewEnv = { VERCEL_ENV: "preview" };
    expect(isConvexProxyMethodAllowed("GET", previewEnv)).toBe(true);
    expect(isConvexProxyMethodAllowed("HEAD", previewEnv)).toBe(true);
    expect(isConvexProxyMethodAllowed("POST", previewEnv)).toBe(false);
    expect(isConvexProxyMethodAllowed("DELETE", previewEnv)).toBe(false);
    expect(isConvexProxyMethodAllowed("POST", { VERCEL_ENV: "production" })).toBe(true);
  });

  it("allows writes in the permanent custom test environment", () => {
    const testEnv = {
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "test",
      VITE_CLAWHUB_DEPLOY_ENV: "test",
    };

    expect(isConvexProxyMethodAllowed("POST", testEnv)).toBe(true);
    expect(isConvexProxyMethodAllowed("DELETE", testEnv)).toBe(true);
  });

  it("prefers the build-paired Convex URL over stale Vercel runtime values", () => {
    expect(
      resolveConvexProxyEnv(
        {
          VERCEL_ENV: "preview",
          VITE_CONVEX_SITE_URL: "https://wry-manatee-359.convex.site",
          VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
        },
        {
          VITE_CLAWHUB_DEPLOY_ENV: "preview",
          VITE_CONVEX_SITE_URL: "https://paired-preview-123.convex.site",
          VITE_CONVEX_URL: "https://paired-preview-123.convex.cloud",
        },
      ),
    ).toEqual({
      VERCEL_ENV: "preview",
      VITE_CLAWHUB_DEPLOY_ENV: "preview",
      VITE_CONVEX_SITE_URL: "https://paired-preview-123.convex.site",
      VITE_CONVEX_URL: "https://paired-preview-123.convex.cloud",
    });
  });

  it("proxies reads and exposes the non-secret preview deployment name for proof", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const event = mockEvent("https://preview.example/api/v1/skills/demo?include=latest");

    const response = await proxyConvexRequest(event, {
      VERCEL_ENV: "preview",
      VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
    });

    expect(response).toBeInstanceOf(Response);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://preview-branch-123.convex.site/api/v1/skills/demo?include=latest",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.headers.get("X-ClawHub-Preview-Backend")).toBe("preview-branch-123");
  });

  it("exposes the permanent Test backend name for deployment proof", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );
    const event = mockEvent("https://test.example/api/v1/skills/demo");

    const response = await proxyConvexRequest(event, {
      VERCEL_TARGET_ENV: "preview",
      VITE_CLAWHUB_DEPLOY_ENV: "test",
      VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
    });

    expect(response.headers.get("X-ClawHub-Test-Backend")).toBe("academic-chihuahua-392");
    expect(response.headers.get("X-ClawHub-Preview-Backend")).toBeNull();
  });

  it("rejects preview writes without contacting Convex", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const event = mockEvent("https://preview.example/api/v1/skills/demo", {
      method: "POST",
    });

    const response = await proxyConvexRequest(event, {
      VERCEL_ENV: "preview",
      VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
    });

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
