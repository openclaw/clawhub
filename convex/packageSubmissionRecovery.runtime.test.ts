/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { npmPackFixture } from "../packages/clawhub/test/npmPack";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseClawPack, sha256Hex } from "./lib/clawpack";
import { buildPackageInventoryDigest } from "./lib/skills/skillMarkdown";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.7" }));
const modules = import.meta.glob("./**/*.ts");
declare const Convex: { jsSyscall(op: string, args: Record<string, unknown>): Promise<unknown> };
const bearer = "local-submission-recovery-fixture";
let restoreBlobAdapter = () => {};
afterEach(() => {
  restoreBlobAdapter();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function fixture() {
  vi.useFakeTimers();
  vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  // convex-test's Blob adapter opens a transaction per store without serializing
  // concurrent calls. Serialize that adapter only; archive prep and publication
  // remain the real registered functions, with actual bytes and database writes.
  const descriptor = Object.getOwnPropertyDescriptor(Convex, "jsSyscall")!;
  let stores: Promise<unknown> = Promise.resolve();
  Object.defineProperty(Convex, "jsSyscall", {
    ...descriptor,
    get() {
      const store: typeof Convex.jsSyscall = descriptor.get!.call(Convex);
      return (op: string, args: Record<string, unknown>) => {
        if (op !== "storage/storeBlob") return store(op, args);
        const next = stores.then(() => store(op, args));
        stores = next.catch(() => undefined);
        return next;
      };
    },
  });
  restoreBlobAdapter = () => Object.defineProperty(Convex, "jsSyscall", descriptor);
  const name = "@openclaw/submission-fixture",
    version = "2026.11.5";
  const bytes = npmPackFixture({
    "package/package.json": JSON.stringify({
      name,
      version,
      description: "Fixture plugin",
      repository: { type: "git", url: "https://github.com/openclaw/openclaw.git" },
      openclaw: {
        compat: { pluginApi: "^1.0.0" },
        build: { openclawVersion: "2026.11.5" },
        extensions: ["./index.js"],
      },
    }),
    "package/openclaw.plugin.json": JSON.stringify({
      id: "submission-fixture",
      name: "Fixture",
      description: "Fixture plugin",
      configSchema: { type: "object", properties: {} },
    }),
    "package/index.js": "export default {};\n",
    "package/README.md": "# Fixture plugin\nA synthetic recovery fixture.\n",
  });
  const parsed = await parseClawPack(bytes);
  const inventoryDigest = await buildPackageInventoryDigest(
    await Promise.all(
      parsed.entries.map(async (e) => ({
        path: e.path,
        size: e.bytes.length,
        sha256: await sha256Hex(e.bytes),
      })),
    ),
  );
  const request = {
    name,
    version,
    sourcePath: "extensions/submission-fixture",
    inventoryDigest,
    artifactSha256: parsed.artifactSha256,
    artifactSize: bytes.length,
    originalRunId: "100",
    originalRunAttempt: "1",
    originalToolingSha: "b".repeat(40),
    manualOverrideReason: "Recover original retained bytes following interrupted publication",
  };
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { handle: "original-owner" });
    const actor = await ctx.db.insert("users", { handle: "manual-publisher", githubCreatedAt: 1 });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("officialPublishers", {
      publisherId: publisher,
      reason: "fixture",
      createdAt: now,
      updatedAt: now,
    });
    const membership = await ctx.db.insert("publisherMembers", {
      publisherId: publisher,
      userId: actor,
      role: "publisher",
      createdAt: now,
      updatedAt: now,
    });
    const apiToken = await ctx.db.insert("apiTokens", {
      userId: actor,
      label: "local",
      prefix: "local",
      tokenHash: await hashToken(bearer),
      createdAt: now,
    });
    const packageId = await ctx.db.insert("packages", {
      name,
      normalizedName: name,
      displayName: "Fixture",
      ownerUserId: owner,
      ownerPublisherId: publisher,
      family: "code-plugin",
      channel: "official",
      isOfficial: true,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const archiveId = await ctx.storage.store(new Blob([Uint8Array.from(bytes)]));
    const common = {
      packageId,
      provider: "github-actions" as const,
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
      version,
      runId: "100",
      runAttempt: "1",
      sha: request.originalToolingSha,
      ref: "refs/heads/release/2026.11.5",
      inventoryDigest,
      authorizationVersion: 2 as const,
      authorizationRoute: "automated-sealed" as const,
      authorizationTransactionKey: "original-transaction",
      candidateRepository: "openclaw/openclaw",
      candidateSha: "a".repeat(40),
      expiresAt: now - 1,
      createdAt: now - 2000,
    };
    const originalToken = await ctx.db.insert("packagePublishTokens", {
      ...common,
      scope: "publish",
      prefix: "publish",
      tokenHash: "old-publish",
    });
    const uploadToken = await ctx.db.insert("packagePublishTokens", {
      ...common,
      scope: "upload",
      prefix: "upload",
      tokenHash: "old-upload",
      consumedAt: now - 1000,
    });
    await ctx.db.insert("packagePublishUploadTickets", {
      kind: "github-actions",
      publishTokenId: uploadToken,
      authorizationTransactionKey: common.authorizationTransactionKey,
      storageId: archiveId,
      usedAt: now - 1000,
      createdAt: now - 2000,
      expiresAt: now - 1,
    });
    return { owner, actor, publisher, membership, apiToken, packageId, archiveId, originalToken };
  });
  const recover = (override: Record<string, unknown> = {}) =>
    t.fetch("/api/v1/publish/submissions/recover", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, ...override }),
    });
  return { t, ids, request, recover };
}

it("recovers retained exact bytes with fresh publisher authority and atomically records its receipt", async () => {
  const { t, ids, request, recover } = await fixture();
  const original = await t.run((ctx) => ctx.db.get(ids.originalToken));
  const response = await recover();
  const body = await response.text();
  expect(response.status, body).toBe(202);
  const receipt = JSON.parse(body);
  const release = await t.run((ctx) => ctx.db.get(receipt.releaseId as Id<"packageReleases">));
  const attempt = await t.run((ctx) => ctx.db.get(receipt.attemptId as Id<"publishAttempts">));
  expect(receipt).toMatchObject({
    recoveredFromSubmissionId: ids.originalToken,
    status: "pending_checks",
    publicationStatus: "pending",
    reused: false,
  });
  expect(release).toMatchObject({
    publicationStatus: "pending",
    publishAttemptId: receipt.attemptId,
    clawpackStorageId: ids.archiveId,
    clawpackSha256: request.artifactSha256,
    source: { path: request.sourcePath, commit: "a".repeat(40) },
  });
  expect(attempt).toMatchObject({
    packageReleaseId: receipt.releaseId,
    ownerUserId: ids.owner,
    ownerPublisherId: ids.publisher,
  });
  expect(attempt?.artifactFingerprint).not.toBe(request.artifactSha256);
  expect(attempt?.scanContext).not.toMatchObject({ trustedOpenClawPlugin: true });
  expect(release?.verification?.trustedOpenClawPlugin).not.toBe(true);
  expect(attempt?.checks).toMatchObject({
    trufflehog: { status: "pending" },
    clawscan: { status: "pending" },
  });
  expect(await t.run((ctx) => ctx.db.get(ids.originalToken))).toEqual(original);
  expect(await (await recover()).json()).toMatchObject({ ...receipt, reused: true });
});

it.each([
  "consumed",
  "live",
  "revoked",
  "orphan",
  "release",
  "archive",
  "inventory",
  "publisher",
] as const)("rejects unsafe original outcome or authority: %s", async (change) => {
  const { t, ids, recover } = await fixture();
  await t.run(async (ctx) => {
    if (change === "consumed") await ctx.db.patch(ids.originalToken, { consumedAt: Date.now() });
    if (change === "live") await ctx.db.patch(ids.originalToken, { expiresAt: Date.now() + 60000 });
    if (change === "revoked") await ctx.db.patch(ids.originalToken, { revokedAt: Date.now() });
    if (change === "publisher") await ctx.db.delete(ids.membership);
    if (change === "archive") await ctx.storage.delete(ids.archiveId);
    if (change === "release")
      await ctx.db.insert("packageReleases", {
        packageId: ids.packageId,
        version: "2026.11.5",
        publicationStatus: "pending",
        changelog: "old",
        integritySha256: "c".repeat(64),
        files: [],
        distTags: [],
        createdAt: 1,
        createdBy: ids.owner,
      });
    if (change === "orphan")
      await ctx.db.insert("publishAttempts", {
        kind: "package",
        status: "expired",
        userId: ids.owner,
        slug: "@openclaw/submission-fixture",
        displayName: "orphan audit",
        version: "2026.11.5",
        idempotencyKey: "original-orphan",
        artifactFingerprint: "d".repeat(64),
        files: [],
        checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
        createdAt: 1,
        updatedAt: 2,
        expiresAt: 2,
      });
    if (change === "inventory")
      await ctx.db.patch(ids.originalToken, { inventoryDigest: "e".repeat(64) });
  });
  const response = await recover();
  expect([404, 409]).toContain(response.status);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("publishAttempts")
        .withIndex("by_idempotency_key", (q) =>
          q.eq("idempotencyKey", `manual-submission-recovery:${ids.originalToken}`),
        )
        .unique(),
    ),
  ).toBeNull();
});

it.each([
  "none",
  "original-grant",
  "owner",
  "token",
  "membership",
  "archive",
  "extracted",
  "moderation",
] as const)("uses normal claimed scan/finalization and live authority: %s", async (change) => {
  const { t, ids, recover } = await fixture();
  const receipt = await (await recover()).json();
  const attemptId = receipt.attemptId as Id<"publishAttempts">,
    releaseId = receipt.releaseId as Id<"packageReleases">;
  const attempt = await t.run((ctx) => ctx.db.get(attemptId));
  await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
  });
  await t.mutation(internal.publishAttempts.completePendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
    artifactFingerprint: attempt!.artifactFingerprint,
    clawscanAnalysis: { status: "clean", verdict: "benign", checkedAt: Date.now() },
    aigAnalysis: { status: "clean", issueCount: 0, findings: [], checkedAt: Date.now() },
    trufflehog: { status: "clean", summary: "fresh secrets scan" },
    clawscan: { status: "clean", summary: "fresh policy scan" },
  });
  await t.run(async (ctx) => {
    if (change === "original-grant")
      await ctx.db.patch(ids.originalToken, { revokedAt: Date.now() });
    if (change === "owner") await ctx.db.patch(ids.packageId, { ownerUserId: ids.actor });
    if (change === "moderation")
      await ctx.db.patch(releaseId, {
        manualModeration: {
          state: "quarantined",
          reason: "fixture hold",
          updatedAt: Date.now(),
          reviewerUserId: ids.actor,
        },
      });
    if (change === "token") await ctx.db.patch(ids.apiToken, { revokedAt: Date.now() });
    if (change === "membership") await ctx.db.delete(ids.membership);
    if (change === "archive") await ctx.storage.delete(ids.archiveId);
    if (change === "extracted") await ctx.storage.delete(attempt!.files[0].storageId);
  });
  const commit = t.action(internal.packages.finalizePackagePublishAttemptInternal, { attemptId });
  if (change === "none") {
    await expect(commit).resolves.toMatchObject({ ok: true, releaseId });
    expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
      publicationStatus: "published",
      publishActor: { kind: "user", userId: ids.actor },
    });
    expect(await (await recover()).json()).toMatchObject({
      status: "finalized",
      publicationStatus: "published",
      reused: true,
    });
  } else {
    await expect(commit).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "failed" });
    if (change === "original-grant" || change === "owner") {
      expect(await (await recover()).json()).toMatchObject({
        status: "failed",
        publicationStatus: "failed",
        reused: true,
      });
    }
  }
  expect(await t.run((ctx) => ctx.db.get(ids.originalToken))).not.toHaveProperty("consumedAt");
});

it("returns a terminal receipt after block cleanup instead of staging again", async () => {
  const { t, ids, recover } = await fixture();
  const receipt = await (await recover()).json();
  await t.run(async (ctx) => {
    await ctx.db.patch(receipt.attemptId as Id<"publishAttempts">, { status: "blocked" });
    await ctx.db.delete(receipt.releaseId as Id<"packageReleases">);
    await ctx.storage.delete(ids.archiveId);
  });
  expect(await (await recover()).json()).toMatchObject({
    ...receipt,
    status: "blocked",
    publicationStatus: "blocked",
    reused: true,
  });
  expect(await t.run((ctx) => ctx.db.query("packageReleases").collect())).toHaveLength(0);
});

it("fails closed on a mismatched sealed tarball identity or extra request field", async () => {
  const { recover } = await fixture();
  expect((await recover({ artifactSha256: "e".repeat(64) })).status).toBe(409);
  expect((await recover({ unexpected: true })).status).toBe(400);
  expect((await recover({ sourcePath: "../other" })).status).toBe(400);
});

it.each([
  "pending_checks",
  "ready_to_finalize",
  "finalizing",
  "finalized",
  "blocked",
  "failed",
  "expired",
] as const)("rejects retained orphan audit in every attempt state: %s", async (status) => {
  const { t, ids, recover } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("publishAttempts", {
      kind: "package",
      status,
      userId: ids.owner,
      slug: "@openclaw/submission-fixture",
      displayName: "original orphan",
      version: "2026.11.5",
      idempotencyKey: "orphan",
      artifactFingerprint: "d".repeat(64),
      files: [],
      checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
      createdAt: 1,
      updatedAt: 2,
      expiresAt: 2,
    }),
  );
  expect((await recover()).status).toBe(409);
});
it.each(["run", "attempt", "tooling", "inventory"] as const)(
  "does not adopt an unrelated original grant: %s",
  async (change) => {
    const { recover } = await fixture();
    const override =
      change === "run"
        ? { originalRunId: "101" }
        : change === "attempt"
          ? { originalRunAttempt: "2" }
          : change === "tooling"
            ? { originalToolingSha: "c".repeat(40) }
            : { inventoryDigest: "c".repeat(64) };
    expect((await recover(override)).status).toBe(404);
  },
);
