/* @vitest-environment node */

import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { mockEvent } from "h3";
import { createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_MANIFEST_AUDIENCE,
  ARCHIVE_MANIFEST_CONTENT_TYPE,
  ARCHIVE_MANIFEST_JWS_TYPE,
  signArchivePayload,
  type SkillArchiveManifest,
} from "../convex/lib/archiveManifest";
import {
  buildConvexProxyTarget,
  isConvexProxyMethodAllowed,
  proxyConvexRequest,
  resolveConvexStorageOrigin,
  resolveConvexProxyEnv,
  verifySignedArchiveManifest,
} from "./convexProxy";

const TEST_ARCHIVE_DEPENDENCIES = {
  getArchiveRequestToken: async () => "verified-vercel-oidc",
  verifyArchiveManifest: async (token: string) => ({
    ...(JSON.parse(token) as Record<string, unknown>),
    issuer: "https://preview-branch-123.convex.site",
    audience: ARCHIVE_MANIFEST_AUDIENCE,
  }),
};

describe("Convex HTTP proxy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("accepts storage only from the Convex deployment paired to the selected site", () => {
    expect(
      resolveConvexStorageOrigin("https://preview-branch-123.convex.site/api/v1/download", {
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
        CONVEX_URL: "https://wry-manatee-359.convex.cloud",
      }),
    ).toBe("https://preview-branch-123.convex.cloud");
    expect(
      resolveConvexStorageOrigin("https://preview-branch-123.convex.site/api/v1/download", {
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
      }),
    ).toBeNull();
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

  it("streams hosted downloads from a Convex manifest with the final attachment filename", async () => {
    const storedBody = new TextEncoder().encode("# streamed skill\n");
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0+build.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0+build",
              publishedAt: 3,
            },
            entries: [
              {
                path: "SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
              },
              {
                path: "stale.txt",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-missing",
              },
            ],
            metricToken: "signed-metric-capability",
          },
          {
            headers: {
              "cache-control": "private, no-store",
              "content-digest": "sha-256=:manifest-digest:",
              "content-encoding": "gzip",
              "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE,
              etag: '"manifest-etag"',
              "x-ratelimit-remaining": "49",
            },
          },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        return new Response(storedBody, { status: 200 });
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-missing") {
        return new Response("missing", { status: 404 });
      }
      if (url === "https://preview-branch-123.convex.site/api/internal/archive-download-metric") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const event = mockEvent("https://preview.example/api/v1/download?slug=demo", {
      headers: { "x-clawhub-vercel-oidc-token": "client-forgery" },
    });

    const response = await proxyConvexRequest(
      event,
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="demo-1.0.0+build.zip"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Digest")).toBeNull();
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("49");
    expect(response.headers.get("X-ClawHub-Preview-Backend")).toBe("preview-branch-123");
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(archive["SKILL.md"]).toEqual(storedBody);
    expect(Object.keys(archive).sort()).toEqual(["SKILL.md", "_meta.json"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://preview-branch-123.convex.site/api/v1/download?slug=demo",
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-clawhub-archive-manifest"),
    ).toBe("v1");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-clawhub-vercel-oidc-token"),
    ).toBe("verified-vercel-oidc");
    const metricCall = fetchMock.mock.calls.find(
      ([input]) =>
        input.toString() ===
        "https://preview-branch-123.convex.site/api/internal/archive-download-metric",
    );
    expect(metricCall?.[1]).toMatchObject({
      method: "POST",
      body: "signed-metric-capability",
      signal: expect.any(AbortSignal),
    });
    const fetchedUrls = fetchMock.mock.calls.map(([input]) => input.toString());
    expect(
      fetchedUrls.indexOf(
        "https://preview-branch-123.convex.site/api/internal/archive-download-metric",
      ),
    ).toBeGreaterThan(
      fetchedUrls.indexOf("https://preview-branch-123.convex.cloud/api/storage/storage-1"),
    );
  });

  it("streams bulk skill exports before a stored entry finishes", async () => {
    const firstStorageChunk = new Uint8Array(64 * 1024).fill(0x61);
    let releaseStorage: (() => void) | undefined;
    const storageReleased = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/skills/export")) {
        return Response.json(
          {
            schema: "clawhub.skill-export-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "skills-export-1-5.zip",
            entries: [
              {
                kind: "storage",
                path: "alice/demo/SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
                size: firstStorageChunk.byteLength + 1,
                sha256: createHash("sha256")
                  .update(firstStorageChunk)
                  .update(Uint8Array.of(0x62))
                  .digest("hex"),
              },
              {
                kind: "inline",
                path: "alice/demo/_export_skill_meta.json",
                text: '{"slug":"demo"}',
              },
              {
                kind: "inline",
                path: "_errors.json",
                text: '[{"slug":"missing","error":"version not found"}]',
              },
            ],
            exportManifest: [
              {
                publisher: "alice",
                slug: "demo",
                sourceRef: "public-clawhub",
                version: "1.0.0",
                displayName: "Demo",
                createdAt: 1,
                updatedAt: 2,
                stats: {},
                fileCount: 1,
              },
            ],
          },
          {
            headers: {
              "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE,
              "x-export-errors": "1",
              "x-total-returned": "1",
            },
          },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        let sentFirstChunk = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (!sentFirstChunk) {
                sentFirstChunk = true;
                controller.enqueue(firstStorageChunk);
                return;
              }
              await storageReleased;
              controller.enqueue(Uint8Array.of(0x62));
              controller.close();
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5", {
        headers: { authorization: "Bearer user-token" },
      }),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="skills-export-1-5.zip"',
    );
    expect(response.headers.get("X-Export-Errors")).toBe("1");
    const reader = response.body!.getReader();
    const firstZipChunk = await reader.read();
    expect(firstZipChunk.done).toBe(false);
    expect(firstZipChunk.value?.byteLength).toBeGreaterThan(0);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-clawhub-archive-manifest"),
    ).toBe("v1");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer user-token",
    );

    releaseStorage?.();
    const chunks = [firstZipChunk.value!];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value);
    }
    const archiveBytes = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      archiveBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const archive = unzipSync(archiveBytes);
    expect(Object.keys(archive).sort()).toEqual([
      "_errors.json",
      "_manifest.json",
      "alice/demo/SKILL.md",
      "alice/demo/_export_skill_meta.json",
    ]);
    expect(JSON.parse(new TextDecoder().decode(archive["_errors.json"]))).toEqual([
      { slug: "missing", error: "version not found" },
    ]);
    expect(JSON.parse(new TextDecoder().decode(archive["_manifest.json"]))).toEqual([
      expect.objectContaining({
        publisher: "alice",
        slug: "demo",
        sourceRef: "public-clawhub",
        fileCount: 1,
      }),
    ]);
  });

  it("fails a bulk export when signed storage disappears", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/skills/export")) {
        return Response.json(
          {
            schema: "clawhub.skill-export-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "skills-export-1-5.zip",
            entries: [
              {
                kind: "storage",
                path: "alice/demo/SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/stale-storage",
                size: 5,
                sha256: createHash("sha256").update("hello").digest("hex"),
              },
              {
                kind: "inline",
                path: "alice/demo/_export_skill_meta.json",
                text: '{"slug":"demo"}',
              },
              {
                kind: "inline",
                path: "_errors.json",
                text: '[{"slug":"missing","error":"version not found"}]',
              },
            ],
            exportManifest: [
              {
                publisher: "alice",
                slug: "demo",
                sourceRef: "public-clawhub",
                version: "1.0.0",
                displayName: "Demo",
                createdAt: 1,
                updatedAt: 2,
                stats: {},
                fileCount: 1,
              },
            ],
          },
          {
            headers: {
              "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE,
              "x-export-errors": "1",
            },
          },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/stale-storage") {
        return new Response("Not found", { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Export-Errors")).toBe("1");
    await expect(response.arrayBuffer()).rejects.toThrow(
      "Signed archive entry disappeared after manifest creation",
    );
  });

  it("rejects bulk export manifests that point outside paired Convex storage", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          schema: "clawhub.skill-export-archive-manifest.v1",
          issuedAt: 1_000,
          expiresAt: 31_000,
          filename: "skills-export-1-5.zip",
          entries: [
            {
              kind: "storage",
              path: "alice/demo/SKILL.md",
              url: "https://attacker.example/private",
              size: 1,
              sha256: "a".repeat(64),
            },
          ],
          exportManifest: [],
        },
        { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Invalid or expired archive manifest");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects bulk export manifests with non-canonical storage paths", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          schema: "clawhub.skill-export-archive-manifest.v1",
          issuedAt: 1_000,
          expiresAt: 31_000,
          filename: "skills-export-1-5.zip",
          entries: [
            {
              kind: "storage",
              path: "alice/demo/SKILL.md",
              url: "https://preview-branch-123.convex.cloud/api/storage/storage-1/extra",
              size: 1,
              sha256: "a".repeat(64),
            },
          ],
          exportManifest: [],
        },
        { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps inline metadata in its bounded manifest budget", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/skills/export")) {
        return Response.json(
          {
            schema: "clawhub.skill-export-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "skills-export-1-5.zip",
            entries: [
              {
                kind: "storage",
                path: "alice/demo/SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
                size: 256 * 1024 * 1024,
                sha256: "a".repeat(64),
              },
              {
                kind: "inline",
                path: "alice/demo/_export_skill_meta.json",
                text: "x",
              },
            ],
            exportManifest: [],
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Keep the signed maximum-size storage entry unconsumed.
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await response.body?.cancel();
  });

  it("fails a bulk export stream when stored bytes miss the signed digest", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/skills/export")) {
        return Response.json(
          {
            schema: "clawhub.skill-export-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "skills-export-1-5.zip",
            entries: [
              {
                kind: "storage",
                path: "alice/demo/SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
                size: 5,
                sha256: createHash("sha256").update("right").digest("hex"),
              },
            ],
            exportManifest: [],
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        return new Response("wrong");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow(
      "Archive entry did not match its signed manifest",
    );
  });

  it("prefetches only a bounded window of bulk export storage responses", async () => {
    const publisher = "p".repeat(200);
    const slug = "s".repeat(200);
    const entries = Array.from({ length: 10 }, (_, index) => ({
      kind: "storage" as const,
      path: `${publisher}/${slug}/${"f".repeat(120)}-${String(index).padStart(2, "0")}.txt`,
      url: `https://preview-branch-123.convex.cloud/api/storage/storage-${index}`,
      size: 1,
      sha256: "a".repeat(64),
    }));
    const cancelledStorage = new Set<number>();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/skills/export")) {
        return Response.json(
          {
            schema: "clawhub.skill-export-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "skills-export-1-5.zip",
            entries,
            exportManifest: [
              {
                publisher,
                slug,
                sourceRef: "public-clawhub",
                version: "1.0.0",
                displayName: "Demo",
                createdAt: 1,
                updatedAt: 2,
                stats: {},
                fileCount: entries.length,
              },
            ],
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url.startsWith("https://preview-branch-123.convex.cloud/api/storage/")) {
        const storageIndex = Number(url.slice(url.lastIndexOf("-") + 1));
        return new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Keep each prefetched response open so the test observes the live window.
            },
            cancel() {
              cancelledStorage.add(storageIndex);
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/skills/export?startDate=1&endDate=5"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    const storageCalls = fetchMock.mock.calls.filter(([input]) =>
      input.toString().startsWith("https://preview-branch-123.convex.cloud/api/storage/"),
    );
    expect(storageCalls).toHaveLength(8);
    await response.body?.cancel();
    expect([...cancelledStorage].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("does not record a download when every source Blob has vanished", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0",
              publishedAt: 3,
            },
            entries: [
              {
                path: "stale.txt",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-missing",
              },
            ],
            metricToken: "signed-metric-capability",
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-missing") {
        return new Response("missing", { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));

    expect(Object.keys(archive)).toEqual(["_meta.json"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsigned archive manifest from the paired Convex origin", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0",
              publishedAt: 3,
            },
            entries: [
              {
                path: "SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
              },
            ],
          },
          { headers: { "content-type": "application/vnd.clawhub.skill-archive-manifest+json" } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        return new Response("should not be fetched");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies the paired Convex signature and rejects a modified manifest", async () => {
    const keyPair = await generateKeyPair("RS256", { extractable: true });
    const privateKey = await exportPKCS8(keyPair.privateKey);
    const publicKey = await exportJWK(keyPair.publicKey);
    const manifest: SkillArchiveManifest = {
      schema: "clawhub.skill-archive-manifest.v1",
      issuer: "https://preview-branch-123.convex.site",
      audience: ARCHIVE_MANIFEST_AUDIENCE,
      issuedAt: 1_000,
      expiresAt: 31_000,
      filename: "demo-1.0.0.zip",
      meta: {
        ownerId: "users:1",
        slug: "demo",
        version: "1.0.0",
        publishedAt: 3,
      },
      entries: [
        {
          path: "SKILL.md",
          url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
        },
      ],
    };
    const token = await signArchivePayload(manifest, ARCHIVE_MANIFEST_JWS_TYPE, privateKey);
    const localJwks = createLocalJWKSet({ keys: [{ use: "sig", ...publicKey }] });

    await expect(
      verifySignedArchiveManifest(
        token,
        "https://preview-branch-123.convex.site/api/v1/download",
        localJwks,
      ),
    ).resolves.toEqual(manifest);
    const [header, payload, signature] = token.split(".");
    const modifiedPayload = `${payload!.slice(0, -1)}${payload!.endsWith("A") ? "B" : "A"}`;
    await expect(
      verifySignedArchiveManifest(
        `${header}.${modifiedPayload}.${signature}`,
        "https://preview-branch-123.convex.site/api/v1/download",
        localJwks,
      ),
    ).rejects.toThrow();
  });

  it("produces identical archive bytes when storage streams use different chunk boundaries", async () => {
    // Cross many normalization boundaries without making full-suite coverage
    // instrumentation dominate the repository's 15-second test timeout.
    const storedBody = new Uint8Array(512 * 1024);
    let randomState = 0x3451cafe;
    for (let index = 0; index < storedBody.length; index += 1) {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      storedBody[index] = randomState;
    }

    let storageRequest = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0",
              publishedAt: 3,
            },
            entries: [
              {
                path: "SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
              },
            ],
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        const chunkSize = storageRequest++ === 0 ? 16_381 : 65_521;
        let offset = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (offset >= storedBody.length) {
                controller.close();
                return;
              }
              const nextOffset = Math.min(offset + chunkSize, storedBody.length);
              controller.enqueue(storedBody.slice(offset, nextOffset));
              offset = nextOffset;
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const env = {
      VERCEL_ENV: "preview",
      VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
      VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
    };

    const firstResponse = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      env,
      TEST_ARCHIVE_DEPENDENCIES,
    );
    const firstArchive = new Uint8Array(await firstResponse.arrayBuffer());
    const secondResponse = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      env,
      TEST_ARCHIVE_DEPENDENCIES,
    );
    const secondArchive = new Uint8Array(await secondResponse.arrayBuffer());

    expect(secondArchive.byteLength).toBe(firstArchive.byteLength);
    expect(secondArchive.every((byte, index) => byte === firstArchive[index])).toBe(true);
    expect(unzipSync(secondArchive)["SKILL.md"]).toEqual(storedBody);
  });

  it("rejects archive manifests that point outside the paired Convex storage origin", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0",
              publishedAt: 3,
            },
            entries: [{ path: "SKILL.md", url: "https://attacker.example/private" }],
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      throw new Error(`Security boundary crossed: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const event = mockEvent("https://preview.example/api/v1/download?slug=demo");

    const response = await proxyConvexRequest(
      event,
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Invalid or expired archive manifest");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired archive manifest before fetching any stored file", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          schema: "clawhub.skill-archive-manifest.v1",
          issuedAt: 1_000,
          expiresAt: 2_000,
          filename: "demo-1.0.0.zip",
          meta: {
            ownerId: "users:1",
            slug: "demo",
            version: "1.0.0",
            publishedAt: 3,
          },
          entries: [
            {
              path: "SKILL.md",
              url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
            },
          ],
        },
        { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_001);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not accept a client-supplied manifest replay", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("Skill not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const event = mockEvent("https://preview.example/api/v1/download?slug=demo&manifest=replayed", {
      headers: { "x-clawhub-archive-manifest": "replayed-v0" },
    });

    const response = await proxyConvexRequest(
      event,
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(404);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://preview-branch-123.convex.site/api/v1/download?slug=demo&manifest=replayed",
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-clawhub-archive-manifest"),
    ).toBe("v1");
  });

  it("rejects an oversized manifest body", async () => {
    const bodyRead = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              bodyRead();
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          {
            headers: {
              "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE,
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(502);
    expect(bodyRead.mock.calls.length).toBeGreaterThanOrEqual(17);
    expect(bodyRead.mock.calls.length).toBeLessThanOrEqual(18);
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

  it("does not wait for download metrics before emitting zip bytes", async () => {
    vi.useFakeTimers();
    const storedBody = new TextEncoder().encode("# streamed skill\n");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://preview-branch-123.convex.site/api/v1/download")) {
        return Response.json(
          {
            schema: "clawhub.skill-archive-manifest.v1",
            issuedAt: 1_000,
            expiresAt: 31_000,
            filename: "demo-1.0.0.zip",
            meta: {
              ownerId: "users:1",
              slug: "demo",
              version: "1.0.0",
              publishedAt: 3,
            },
            entries: [
              {
                path: "SKILL.md",
                url: "https://preview-branch-123.convex.cloud/api/storage/storage-1",
              },
            ],
            metricToken: "signed-metric-capability",
          },
          { headers: { "content-type": ARCHIVE_MANIFEST_CONTENT_TYPE } },
        );
      }
      if (url === "https://preview-branch-123.convex.cloud/api/storage/storage-1") {
        return new Response(storedBody, { status: 200 });
      }
      if (url === "https://preview-branch-123.convex.site/api/internal/archive-download-metric") {
        return new Promise<Response>(() => {});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const response = await proxyConvexRequest(
      mockEvent("https://preview.example/api/v1/download?slug=demo"),
      {
        VERCEL_ENV: "preview",
        VITE_CONVEX_SITE_URL: "https://preview-branch-123.convex.site",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      },
      TEST_ARCHIVE_DEPENDENCIES,
    );

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    const reader = response.body!.getReader();
    const firstChunk = await Promise.race([
      reader.read(),
      vi.advanceTimersByTimeAsync(500).then(() => {
        throw new Error("zip first byte blocked by download metric");
      }),
    ]);

    expect(firstChunk.done).toBe(false);
    expect(firstChunk.value?.byteLength).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          input.toString() ===
          "https://preview-branch-123.convex.site/api/internal/archive-download-metric",
      ),
    ).toBe(true);

    await reader.cancel();
  });
});
