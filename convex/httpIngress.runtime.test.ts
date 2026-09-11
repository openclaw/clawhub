/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { strFromU8, unzipSync } from "fflate";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_METRIC_AUDIENCE,
  ARCHIVE_METRIC_JWS_TYPE,
  signArchivePayload,
} from "./lib/archiveManifest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const workerToken = "local-ingress-worker-fixture";
const workerHeaders = { Authorization: `Bearer ${workerToken}` };

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "production");
  vi.stubEnv("CLAWHUB_PREVIEW", "");
  vi.stubEnv("SITE_URL", "https://clawhub.ai");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://some.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("AUTH_GITHUB_ID", "local-oauth-client-fixture");
  vi.stubEnv("AUTH_GITHUB_SECRET", "local-oauth-secret-fixture");
  vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", workerToken);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("hosted HTTP ingress with endpoint-owned credentials", () => {
  it("lets the worker claim, download, and acknowledge a real stored artifact directly", async () => {
    const t = convexTest(schema, modules);
    const releaseId = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "inspector-fixture" });
      const storageId = await ctx.storage.store(new Blob(["fixture plugin"]));
      const packageId = await ctx.db.insert("packages", {
        name: "inspector-fixture",
        normalizedName: "inspector-fixture",
        displayName: "Inspector fixture",
        ownerUserId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        scanStatus: "clean",
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const id = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Initial release",
        distTags: ["latest"],
        files: [{ path: "index.js", size: 14, storageId, sha256: "a".repeat(64) }],
        integritySha256: "b".repeat(64),
        createdAt: 1,
        createdBy: ownerUserId,
        verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
      });
      await ctx.db.patch(packageId, { latestReleaseId: id, tags: { latest: id } });
      return id;
    });

    const claim = await t.fetch("/api/v1/package-inspector/claim?runId=ingress-fixture", {
      method: "POST",
      headers: workerHeaders,
    });
    expect(claim.status).toBe(200);
    const batch = await claim.json();
    expect(batch).toMatchObject({ leased: false, items: [{ releaseId }] });
    const downloadUrl = new URL(batch.items[0].downloadUrl);
    expect(downloadUrl.origin).toBe("https://some.convex.site");
    const artifact = await t.fetch(downloadUrl.pathname + downloadUrl.search, {
      headers: workerHeaders,
    });
    expect(artifact.status).toBe(200);
    const files = unzipSync(new Uint8Array(await artifact.arrayBuffer()));
    expect(Object.values(files).map((bytes) => strFromU8(bytes))).toContain("fixture plugin");
    const acknowledge = await t.fetch(
      "/api/v1/package-inspector/acknowledge?runId=ingress-fixture",
      {
        method: "POST",
        headers: workerHeaders,
      },
    );
    expect(acknowledge.status).toBe(200);
    expect(await acknowledge.json()).toMatchObject({ ok: true, completed: true });
  });

  it.each(["claim", "acknowledge", "artifact", "results", "notify"])(
    "still rejects missing and incorrect worker credentials on %s",
    async (route) => {
      const t = convexTest(schema, modules);
      for (const authorization of [undefined, "Bearer incorrect-worker-fixture"]) {
        const response = await t.fetch(`/api/v1/package-inspector/${route}`, {
          method: route === "artifact" ? "GET" : "POST",
          headers: authorization ? { Authorization: authorization } : {},
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("Location")).toBeNull();
      }
    },
  );

  it("starts OAuth with its verifier and cookies at the Convex origin", async () => {
    const t = convexTest(schema, modules);
    const verifier = await t.run((ctx) => ctx.db.insert("authVerifiers", {}));
    const response = await t.fetch(`/api/auth/signin/github?code=${verifier}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://some.convex.site/api/auth/callback/github",
    );
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");

    // A denied provider callback must reach Auth's error handling at this origin.
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const method of ["GET", "POST"]) {
        const callback = await t.fetch("/api/auth/callback/github?error=access_denied", { method });
        expect(callback.status).toBe(302);
        expect(callback.headers.get("Location")).toBe("https://clawhub.ai/");
      }
    } finally {
      logError.mockRestore();
    }
  });

  it("accepts a signed metric receipt and rejects a forged one without an edge assertion", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const skillId = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "metric-fixture" });
      return await ctx.db.insert("skills", {
        slug: "metric-fixture",
        displayName: "Metric fixture",
        ownerUserId,
        tags: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    vi.stubEnv("JWKS", JSON.stringify({ keys: [await exportJWK(publicKey)] }));
    const now = Date.now();
    const metric = {
      target: { kind: "skill" as const, id: skillId },
      identityKind: "ip" as const,
      identityHash: "metric-fixture",
      dayStart: Math.floor(now / 86_400_000) * 86_400_000,
      occurredAt: now,
    };
    const token = await signArchivePayload(
      {
        schema: "clawhub.archive-download-metric.v1",
        issuer: "https://some.convex.site",
        audience: ARCHIVE_METRIC_AUDIENCE,
        issuedAt: now,
        expiresAt: now + 30_000,
        metric,
      },
      ARCHIVE_METRIC_JWS_TYPE,
      await exportPKCS8(privateKey),
    );
    const send = (body: string) =>
      t.fetch("/api/internal/archive-download-metric", {
        method: "POST",
        headers: { "Content-Type": "application/jose" },
        body,
      });
    expect((await send("forged-metric-fixture")).status).toBe(401);
    expect((await send(token)).status).toBe(204);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual([metric]);
  });

  it("keeps ordinary anonymous API calls behind verified ingress, including worker bearer tokens", async () => {
    const t = convexTest(schema, modules);
    for (const headers of [{}, workerHeaders]) {
      const response = await t.fetch("/api/v1/search?q=fixture", { headers });
      expect(response.status).toBe(307);
      expect(response.headers.get("Location")).toBe("https://clawhub.ai/api/v1/search?q=fixture");
      expect(response.headers.get("RateLimit-Limit")).toBeNull();
    }
    const forged = await t.fetch("/api/v1/search?q=fixture", {
      headers: {
        "x-clawhub-vercel-oidc-token": "forged-edge-fixture",
        "x-clawhub-client-ip": "203.0.113.42",
      },
    });
    expect(forged.status).toBe(401);
    expect(forged.headers.get("Location")).toBeNull();
  });
});
