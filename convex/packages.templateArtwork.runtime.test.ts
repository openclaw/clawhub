/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { npmPackFixture } from "../packages/clawhub/test/npmPack";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/hash";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

function serializeFixtureBlobStores() {
  // convex-test 0.0.62 shares transaction depth between concurrent blob
  // stores. Serialize only its storage syscall, retaining real hashes/bytes.
  const runtime = globalThis as typeof globalThis & {
    Convex: { jsSyscall: (op: string, args: unknown) => Promise<unknown> };
  };
  const jsSyscall = runtime.Convex.jsSyscall;
  const accessors: { jsSyscall: unknown } = runtime.Convex;
  let pending = Promise.resolve();
  vi.spyOn(accessors, "jsSyscall", "get").mockReturnValue((op: string, args: unknown) => {
    if (op !== "storage/storeBlob") return jsSyscall(op, args);
    const result = pending.then(() => jsSyscall(op, args));
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function assertTemplateArtwork(source: "explicit" | "avatar") {
  vi.useFakeTimers();
  // The mock supplies the original method's Blob receiver with call(this).
  // oxlint-disable-next-line typescript/unbound-method
  const arrayBuffer = Blob.prototype.arrayBuffer;
  // A slow PNG read deterministically exposes the harness transaction race.
  vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(async function (this: Blob) {
    if (this.size === png.length) await new Promise((resolve) => realSetTimeout(resolve, 25));
    return arrayBuffer.call(this);
  });
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  await t.run(async (ctx) => {
    serializeFixtureBlobStores();
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
      openclaw: { template: "CLAW.md" },
    }),
    "package/CLAW.md":
      "---\nschemaVersion: 1\ncategories: [engineering]\nagent:\n  id: artwork-claw\n  name: Artwork Template\n  identity:\n    avatar: avatars/agent.svg\nworkspace:\n  files:\n    - path: avatars/agent.svg\n      source: art/source.svg\n---\nHelp with research.\n",
    "package/art/source.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff3366"/></svg>',
    ...(source === "explicit" ? { "package/assets/icon.png": png } : {}),
  });
  const form = new FormData();
  form.set(
    "payload",
    JSON.stringify({
      name: "@openclaw/artwork-claw",
      family: "template",
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
  const catalog = await (await t.fetch("/api/v1/packages?family=template")).json();
  const icon = catalog.items[0]?.icon;
  expect(catalog.items[0]?.name).toBe("@openclaw/artwork-claw");
  expect(icon).toMatch(/^\/api\/v1\/skill-icons\/[a-f0-9]{64}$/);
  const explicitPath = `/api/v1/skill-icons/${await sha256Hex(png)}`;
  if (source === "explicit") expect(icon).toBe(explicitPath);
  else expect(icon).not.toBe(explicitPath);
  const versionResponse = await t.fetch(
    "/api/v1/packages/%40openclaw%2Fartwork-claw/versions/1.0.0",
  );
  expect(versionResponse.status).toBe(200);
  expect((await versionResponse.json()).version).toMatchObject({
    version: "1.0.0",
    icon,
  });
  await t.action(internal.catalogFeed.publish, {
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const feed = await (await t.fetch("/api/v1/feeds/templates")).json();
  expect(feed.entries[0].icon).toBe(`https://clawhub.ai${icon}`);
  const image = await t.fetch(icon);
  expect(image.status).toBe(200);
  expect(image.headers.get("Content-Type")).toBe("image/png");
  const bytes = new Uint8Array(await image.arrayBuffer());
  expect(bytes.slice(0, 8)).toEqual(png.slice(0, 8));
  expect(icon).toBe(`/api/v1/skill-icons/${await sha256Hex(bytes)}`);
  if (source === "explicit") expect(bytes).toEqual(png);
}

it.each(["explicit", "avatar"] as const)(
  "publishes %s Template artwork through the first-party PNG route",
  assertTemplateArtwork,
);

it.each(["legacy-only", "mixed", "json"])(
  "rejects %s Template selectors at the public publish boundary",
  async (mode) => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiterV2");
    await t.run(async (ctx) => {
      serializeFixtureBlobStores();
      const userId = await ctx.db.insert("users", { handle: "strict-author", role: "admin" });
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
        label: "strict-format-test",
        prefix: "strict",
        tokenHash: await hashToken("strict-format-test"),
        createdAt: 1,
      });
    });
    const openclaw =
      mode === "mixed"
        ? { template: "CLAW.md", claw: "CLAW.md" }
        : mode === "json"
          ? { template: "openclaw.template.json" }
          : { claw: "CLAW.md" };
    const archive = npmPackFixture({
      "package/package.json": JSON.stringify({
        name: "@openclaw/strict-format-test",
        version: "1.0.0",
        openclaw,
      }),
      "package/CLAW.md":
        "---\nschemaVersion: 1\nagent: { id: strict-format-test }\n---\nSynthetic local contract fixture.\n",
    });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        name: "@openclaw/strict-format-test",
        family: "template",
        version: "1.0.0",
        changelog: "Local format contract",
        expectedArtifactSha256: await sha256Hex(archive),
      }),
    );
    form.set(
      "clawpack",
      new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
      "strict-format-test.tgz",
    );
    const response = await t.fetch("/api/v1/packages", {
      method: "POST",
      headers: { Authorization: "Bearer strict-format-test" },
      body: form,
    });
    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("package.json.openclaw.template");
    expect(await t.run((ctx) => ctx.db.query("packages").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("packageReleases").take(1))).toEqual([]);
  },
);
