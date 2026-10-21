/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { gzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/clawpack";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

const TAR_BLOCK_SIZE = 512;

function tarOctal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeTarString(target: Uint8Array, offset: number, width: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, width), offset);
}

function tarFile(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  writeTarString(header, 0, 100, path);
  writeTarString(header, 100, 8, tarOctal(0o644, 8));
  writeTarString(header, 108, 8, tarOctal(0, 8));
  writeTarString(header, 116, 8, tarOctal(0, 8));
  writeTarString(header, 124, 12, tarOctal(bytes.byteLength, 12));
  writeTarString(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 8, tarOctal(checksum, 8));

  const paddedSize = Math.ceil(bytes.byteLength / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  const body = new Uint8Array(paddedSize);
  body.set(bytes);
  return [header, body];
}

function npmPackFixture(files: Record<string, string | Uint8Array>) {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    parts.push(...tarFile(path, content));
  }
  parts.push(new Uint8Array(TAR_BLOCK_SIZE), new Uint8Array(TAR_BLOCK_SIZE));
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("publishes a Claw's packaged PNG through the validated content-addressed image route", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "maker", role: "admin" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("officialPublishers", { publisherId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "publisher",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("apiTokens", {
      userId,
      label: "test",
      prefix: "test",
      tokenHash: await hashToken("claw-artwork-test"),
      createdAt: 1,
    });
  });
  const archive = npmPackFixture({
    "package/package.json": JSON.stringify({
      name: "@openclaw/artwork-claw",
      version: "1.0.0",
      openclaw: { claw: "CLAW.md" },
    }),
    "package/CLAW.md":
      "---\nschemaVersion: 1\nagent:\n  id: artwork-claw\n  name: Artwork Claw\n---\nHelp with research.\n",
    "package/assets/icon.png": png,
  });
  const form = new FormData();
  form.set(
    "payload",
    JSON.stringify({
      name: "@openclaw/artwork-claw",
      family: "claw",
      version: "1.0.0",
      changelog: "Artwork",
      expectedArtifactSha256: await sha256Hex(archive),
    }),
  );
  form.set(
    "clawpack",
    new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
    "artwork-claw.tgz",
  );
  const response = await t.fetch("/api/v1/packages", {
    method: "POST",
    headers: { Authorization: "Bearer claw-artwork-test" },
    body: form,
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  expect(JSON.parse(body)).toMatchObject({ publicationStatus: "pending" });
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "artwork-worker");
  const claim = (await t.action(api.publishAttempts.claimPrePublicationChecks, {
    token: "artwork-worker",
    attemptId: JSON.parse(body).attemptId,
  })) as { attemptId: Id<"publishAttempts">; claimId: string; artifactFingerprint: string };
  await t.action(api.publishAttempts.completePrePublicationChecks, {
    token: "artwork-worker",
    attemptId: claim.attemptId,
    claimId: claim.claimId,
    artifactFingerprint: claim.artifactFingerprint,
    trufflehog: { status: "clean" },
    clawscan: { status: "clean" },
  });
  const catalog = await (await t.fetch("/api/v1/packages?family=claw")).json();
  expect(catalog.items[0]).toMatchObject({
    name: "@openclaw/artwork-claw",
    icon: `/api/v1/skill-icons/${await sha256Hex(png)}`,
  });
  const versionResponse = await t.fetch(
    "/api/v1/packages/%40openclaw%2Fartwork-claw/versions/1.0.0",
  );
  expect(versionResponse.status).toBe(200);
  expect((await versionResponse.json()).version).toMatchObject({
    version: "1.0.0",
    icon: `/api/v1/skill-icons/${await sha256Hex(png)}`,
  });
  await t.action(internal.catalogFeed.publish, {
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const feed = await (await t.fetch("/api/v1/feeds/claws")).json();
  expect(feed.entries[0].icon).toBe(
    `https://clawhub.ai/api/v1/skill-icons/${await sha256Hex(png)}`,
  );
  const image = await t.fetch(`/api/v1/skill-icons/${await sha256Hex(png)}`);
  expect(image.status).toBe(200);
  expect(image.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
});
