/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { gzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { sha256Hex } from "./lib/clawpack";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

function oldArchive(name: string, version: string) {
  const files = {
    "package/package.json": JSON.stringify({ name, version, openclaw: { claw: "CLAW.md" } }),
    "package/CLAW.md": `---\nschemaVersion: 1\nagent: { id: ${name.split("/")[1]} }\n---\nSynthetic historical fixture.\n`,
  };
  const parts: Uint8Array[] = [];
  for (const [path, value] of Object.entries(files)) {
    const content = new TextEncoder().encode(value);
    const header = new Uint8Array(512);
    const text = (offset: number, width: number, textValue: string) =>
      header.set(new TextEncoder().encode(textValue).subarray(0, width), offset);
    const octal = (offset: number, width: number, number: number) =>
      text(offset, width, number.toString(8).padStart(width - 1, "0") + "\0");
    text(0, 100, path);
    octal(100, 8, 0o644);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, content.length);
    octal(136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = 48;
    text(257, 6, "ustar");
    text(263, 2, "00");
    octal(
      148,
      8,
      header.reduce((n, byte) => n + byte, 0),
    );
    const body = new Uint8Array(Math.ceil(content.length / 512) * 512);
    body.set(content);
    parts.push(header, body);
  }
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.length;
  }
  return gzipSync(tar);
}

async function historicalFixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "historical-owner", role: "admin" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    const badgeId = await ctx.db.insert("officialPublishers", {
      publisherId,
      createdAt: 1,
      updatedAt: 1,
    });
    const entries = [];
    const names = [];
    let firstPackageId;
    let firstReleaseId;
    let firstBytes = new Uint8Array();
    for (let i = 0; i < 150; i++) {
      const slug = `historical-fixture-${i.toString().padStart(3, "0")}`;
      const name = `@openclaw/${slug}`;
      const version = i % 2 === 0 ? "0.1.1" : "0.1.2";
      const bytes = oldArchive(name, version);
      const sha256 = await sha256Hex(bytes);
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(bytes)], { type: "application/gzip" }),
      );
      const summary = {
        schemaVersion: 1 as const,
        agent: { id: slug, name: `Historical ${i}` },
        workspace: { bootstrapFiles: [], fileCount: 0 },
        packages: { skillCount: 0, pluginCount: 0 },
        profiles: { count: 0, hasOpenClaw: false },
        extensions: { count: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      };
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: `Historical ${i}`,
        family: "claw",
        clawProfilePolicyVersion: 1,
        ownerUserId,
        ownerPublisherId: publisherId,
        channel: "official",
        isOfficial: true,
        scanStatus: "clean",
        tags: {},
        categories: ["research"],
        topics: [],
        stats: { downloads: 1, installs: 0, stars: 0, versions: 1 },
        createdAt: i + 1,
        updatedAt: i + 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version,
        publicationStatus: "published",
        changelog: "Historical",
        distTags: ["latest"],
        files: [],
        integritySha256: sha256,
        artifactKind: "npm-pack",
        clawpackStorageId: storageId,
        clawpackSha256: sha256,
        clawpackSize: bytes.length,
        clawpackFormat: "tgz",
        clawManifestSummary: summary,
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
        createdAt: 1,
        createdBy: ownerUserId,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId: releaseId,
        latestVersionSummary: { version, createdAt: 1, changelog: "Historical" },
        tags: { latest: releaseId },
      });
      const pkg = (await ctx.db.get(packageId))!;
      await upsertPackageSearchDigest(ctx, {
        ...extractPackageDigestFields(pkg),
        ownerHandle: "openclaw",
        ownerKind: "org",
      });
      entries.push({
        type: "claw",
        id: name,
        title: `Historical ${i}`,
        version,
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        clawManifestSummary: summary,
        install: {
          candidates: [
            { sourceRef: "public-clawhub", package: name, version, integrity: `sha256:${sha256}` },
          ],
        },
      });
      names.push(name);
      if (i === 0) {
        firstPackageId = packageId;
        firstReleaseId = releaseId;
        firstBytes = bytes;
      }
    }
    const payload = JSON.stringify({
      schemaVersion: 1,
      id: "clawhub-official-claws",
      sequence: 59,
      generatedAt: "2026-10-28T00:46:01.333Z",
      expiresAt: "2026-10-29T00:46:01.333Z",
      entries,
    });
    const feedId = await ctx.db.insert("catalogFeedPublications", {
      feedId: "clawhub-official-claws",
      sequence: 59,
      generatedAt: "2026-10-28T00:46:01.333Z",
      expiresAt: "2026-10-29T00:46:01.333Z",
      payload,
      payloadSha256: await sha256Hex(new TextEncoder().encode(payload)),
      publishedAt: 1,
      clawPolicyVersion: 1,
      clawEntryCount: 150,
      clawPublisherId: publisherId,
    });
    return {
      publisherId,
      badgeId,
      names,
      firstPackageId: firstPackageId!,
      firstReleaseId: firstReleaseId!,
      firstBytes: Array.from(firstBytes),
      feedId,
      payload,
    };
  });
  return { t, ...ids };
}

describe("existing published storage survives the public Template cutover", () => {
  it("cannot seed historical fixtures into a cloud backend even when dev auth is enabled", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "");
    vi.stubEnv("DEV_AUTH_CONVEX_DEPLOYMENT", "");
    vi.stubEnv("DEV_AUTH_ENABLED", "1");
    vi.stubEnv("CONVEX_SITE_URL", "https://production.example.convex.site");
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.templateStorageDevSeed.seedHistoricalArchiveInternal, {
        archive: new ArrayBuffer(0),
      }),
    ).rejects.toThrow("isolated localhost backend");
    expect(await t.run(async (ctx) => (await ctx.db.query("packages").take(1)).length)).toBe(0);
  });

  it("serves every old-shaped record through strict new family filters without rewriting a row or archive", async () => {
    const { t, names, firstPackageId, firstReleaseId, firstBytes, feedId, payload } =
      await historicalFixture();
    const before = await t.run(async (ctx) => ({
      pkg: await ctx.db.get(firstPackageId),
      release: await ctx.db.get(firstReleaseId),
      feed: await ctx.db.get(feedId),
    }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result: {
        page: Array<{ name: string; family: string }>;
        isDone: boolean;
        continueCursor: string;
      } = await t.query(api.packages.listPublicPage, {
        family: "template" as const,
        paginationOpts: { cursor, numItems: 37 },
      });
      expect(result.page.every((entry) => entry.family === "template")).toBe(true);
      seen.push(...result.page.map((entry) => entry.name));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen.sort()).toEqual([...names].sort());
    const searched = await t.query(api.packages.searchPublic, {
      family: "template",
      query: "historical-fixture",
      limit: 100,
    });
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.every((entry) => entry.package.family === "template")).toBe(true);
    const path = `/api/v1/packages/${encodeURIComponent(names[0])}`;
    const detail = await t.fetch(path);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.package).toMatchObject({
      family: "template",
      templateProfilePolicyVersion: 1,
      templateManifestSummary: before.release!.clawManifestSummary,
    });
    expect(detailBody.package).not.toHaveProperty("clawProfilePolicyVersion");
    expect(detailBody.package).not.toHaveProperty("clawManifestSummary");
    const exact = await t.fetch(`${path}/versions/0.1.1`);
    expect(exact.status).toBe(200);
    expect((await exact.json()).version.templateManifestSummary).toEqual(
      before.release!.clawManifestSummary,
    );
    const download = await t.fetch(`${path}/versions/0.1.1/artifact/download`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(firstBytes));
    const feed = await t.fetch("/api/v1/feeds/templates");
    expect(feed.status).toBe(200);
    const wire = await feed.text();
    const body = JSON.parse(wire);
    expect(body).toMatchObject({ id: "clawhub-official-templates", sequence: 59 });
    expect(body.entries).toHaveLength(150);
    expect(
      body.entries.every(
        (entry: { type: string; templateManifestSummary?: unknown }) =>
          entry.type === "template" && entry.templateManifestSummary,
      ),
    ).toBe(true);
    expect(feed.headers.get("etag")).toBe(
      `"sha256:${await sha256Hex(new TextEncoder().encode(wire))}"`,
    );
    expect(feed.headers.get("cache-control")).toBe("no-store");
    const cached = await t.fetch("/api/v1/feeds/templates", {
      headers: { "if-none-match": feed.headers.get("etag")! },
    });
    expect(cached.status).toBe(304);
    expect((await t.fetch("/api/v1/packages?family=claw")).status).toBe(400);
    expect((await t.fetch("/api/v1/packages/search?family=claw&q=historical")).status).toBe(400);
    await expect(
      t.query(api.packages.listPublicPage, {
        family: "claw" as never,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
    const after = await t.run(async (ctx) => ({
      pkg: await ctx.db.get(firstPackageId),
      release: await ctx.db.get(firstReleaseId),
      feed: await ctx.db.get(feedId),
    }));
    expect(after).toEqual(before);
    expect(after.feed!.payload).toBe(payload);
    expect(after.pkg!.family).toBe("claw");
  });

  it("keeps current-publisher and stored-integrity guards fail closed for historical snapshots", async () => {
    const { t, badgeId, feedId } = await historicalFixture();
    await t.run((ctx) => ctx.db.delete(badgeId));
    expect((await t.fetch("/api/v1/feeds/templates")).status).toBe(503);
    await t.run(async (ctx) => {
      const feed = (await ctx.db.get(feedId))!;
      await ctx.db.patch(feedId, { payloadSha256: "a".repeat(64) });
      await ctx.db.insert("officialPublishers", {
        publisherId: feed.clawPublisherId!,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect((await t.fetch("/api/v1/feeds/templates")).status).toBe(503);
  });
});
