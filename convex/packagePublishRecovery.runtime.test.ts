/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildPackageInventoryDigest } from "./lib/skills";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.2",
}));

const modules = import.meta.glob("./**/*.ts");
const bearer = "local-recovery-fixture";
const reason = "Recover the exact staged artifact after failed release publication";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sealedIdentity = {
  version: 2,
  repository: "openclaw/openclaw",
  workflow: ".github/workflows/plugin-clawhub-release.yml",
  runId: "100",
  runAttempt: "1",
  ref: "release/2026.9.2",
  fullRef: "refs/heads/release/2026.9.2",
  sha: "a".repeat(40),
  candidateRepository: "openclaw/openclaw",
  candidateSha: "a".repeat(40),
  toolingRef: `release-publish/${"b".repeat(12)}-99`,
  toolingFullRef: `refs/tags/release-publish/${"b".repeat(12)}-99`,
  toolingSha: "b".repeat(40),
  parentRepository: "openclaw/openclaw",
  parentWorkflow: ".github/workflows/openclaw-release-publish.yml",
  parentRunId: "99",
  parentRunAttempt: "2",
};

function sealedParentReceipt(inventoryDigest: string) {
  return {
    version: 2,
    kind: "openclaw-clawhub-parent-authorization",
    repository: sealedIdentity.parentRepository,
    workflow: sealedIdentity.parentWorkflow,
    runId: sealedIdentity.parentRunId,
    runAttempt: sealedIdentity.parentRunAttempt,
    ref: sealedIdentity.toolingRef,
    fullRef: sealedIdentity.toolingFullRef,
    headSha: sealedIdentity.toolingSha,
    childRepository: sealedIdentity.repository,
    childWorkflow: sealedIdentity.workflow,
    childRunId: sealedIdentity.runId,
    childRunAttempt: sealedIdentity.runAttempt,
    childRef: sealedIdentity.ref,
    childFullRef: sealedIdentity.fullRef,
    childHeadSha: sealedIdentity.sha,
    candidateRepository: sealedIdentity.candidateRepository,
    candidateSha: sealedIdentity.candidateSha,
    toolingRef: sealedIdentity.toolingRef,
    toolingFullRef: sealedIdentity.toolingFullRef,
    toolingSha: sealedIdentity.toolingSha,
    authorizationRoute: "automated-sealed",
    packages: [{ name: publicationName, version: publicationVersion, inventoryDigest }],
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

async function sealedGitHubFetch(options: {
  inventoryDigest: string;
  parentConclusion?: "failure" | "cancelled";
  childActor?: { login: string; type: string };
  receiptInventoryDigest?: string;
}) {
  const receipt = sealedParentReceipt(options.receiptInventoryDigest ?? options.inventoryDigest);
  const archive = zipSync(
    { "authorization.json": strToU8(JSON.stringify(receipt)) },
    { mtime: new Date("2000-01-01T00:00:00.000Z") },
  );
  const artifactDigest = `sha256:${await sha256Hex(archive)}`;
  const artifactName = [
    "openclaw-clawhub-parent-authorization-v2",
    sealedIdentity.parentRunId,
    sealedIdentity.parentRunAttempt,
    sealedIdentity.runId,
    sealedIdentity.runAttempt,
  ].join("-");
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = requestUrl(input);
    if (url.includes(`/actions/runs/${sealedIdentity.runId}/attempts/1`)) {
      return Response.json({
        id: Number(sealedIdentity.runId),
        run_attempt: 1,
        path: sealedIdentity.workflow,
        head_branch: sealedIdentity.ref,
        head_sha: sealedIdentity.sha,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "failure",
        actor: options.childActor ?? { login: "github-actions[bot]", type: "Bot" },
        repository: { full_name: sealedIdentity.repository },
      });
    }
    if (url.includes(`/actions/runs/${sealedIdentity.parentRunId}/attempts/2`)) {
      return Response.json({
        id: Number(sealedIdentity.parentRunId),
        run_attempt: 2,
        path: sealedIdentity.parentWorkflow,
        head_branch: sealedIdentity.toolingRef,
        head_sha: sealedIdentity.toolingSha,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: options.parentConclusion ?? "failure",
        repository: { full_name: sealedIdentity.parentRepository },
      });
    }
    if (url.includes(`/actions/runs/${sealedIdentity.parentRunId}/artifacts?`)) {
      if (new URL(url).searchParams.get("name") !== artifactName) {
        return Response.json({ total_count: 0, artifacts: [] });
      }
      return Response.json({
        total_count: 1,
        artifacts: [
          {
            id: 101,
            name: artifactName,
            expired: false,
            digest: artifactDigest,
            archive_download_url: "https://api.github.com/artifacts/101/zip",
            workflow_run: {
              id: Number(sealedIdentity.parentRunId),
              head_sha: sealedIdentity.toolingSha,
            },
          },
        ],
      });
    }
    if (url.includes(`/actions/runs/${sealedIdentity.runId}/artifacts?`)) {
      return Response.json({ total_count: 0, artifacts: [] });
    }
    if (url.endsWith("/artifacts/101/zip")) return new Response(archive);
    if (url.includes("/git/ref/tags/")) {
      return Response.json({
        ref: sealedIdentity.toolingFullRef,
        object: { type: "commit", sha: sealedIdentity.toolingSha },
      });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { artifactDigest, fetchImpl };
}

async function fixture() {
  vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { handle: "original-owner" });
    const actor = await ctx.db.insert("users", {
      handle: "recovery-publisher",
      githubCreatedAt: 1,
    });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
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
      label: "local fixture",
      prefix: "local",
      tokenHash: await hashToken(bearer),
      createdAt: now,
    });
    const packageId = await ctx.db.insert("packages", {
      name: "@openclaw/recovery-fixture",
      normalizedName: "@openclaw/recovery-fixture",
      displayName: "Recovery fixture",
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
    const storageId = await ctx.storage.store(new Blob(["fixture artifact"]));
    const files = [
      { path: "index.js", size: 16, storageId, sha256: await hashToken("fixture artifact") },
    ];
    const archive = new Blob(["exact tarball fixture"]);
    const archiveId = await ctx.storage.store(archive);
    const archiveFields = {
      clawpackStorageId: archiveId,
      clawpackSha256: await hashToken("exact tarball fixture"),
      clawpackSize: archive.size,
      artifactKind: "npm-pack" as const,
    };
    const inventoryDigest = await buildPackageInventoryDigest(files);
    const trusted = {
      packageId,
      provider: "github-actions" as const,
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
    };
    await ctx.db.insert("packageTrustedPublishers", {
      ...trusted,
      createdByUserId: owner,
      updatedByUserId: owner,
      createdAt: now,
      updatedAt: now,
    });
    const originalToken = await ctx.db.insert("packagePublishTokens", {
      ...trusted,
      version: "2026.9.2",
      prefix: "original",
      tokenHash: "original-consumed-fixture",
      runId: "100",
      runAttempt: "1",
      sha: "a".repeat(40),
      ref: "refs/tags/v2026.9.2",
      scope: "publish",
      inventoryDigest,
      authorizationVersion: 2,
      authorizationRoute: "automated-awaited",
      authorizationArtifactId: "123",
      authorizationArtifactDigest: `sha256:${"b".repeat(64)}`,
      candidateRepository: "openclaw/openclaw",
      candidateSha: "a".repeat(40),
      parentRepository: "openclaw/openclaw",
      parentWorkflow: ".github/workflows/openclaw-release-publish.yml",
      parentRunId: "99",
      parentRunAttempt: "2",
      consumedAt: now - 1000,
      expiresAt: now - 1,
      createdAt: now - 2000,
    });
    const authorization = {
      trustedPublishTokenId: originalToken,
      trustedPublishInventoryDigest: inventoryDigest,
      trustedPublishAuthorizationVersion: 2,
    };
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "2026.9.2",
      publicationStatus: "pending",
      pendingPublication: {
        ...authorization,
        ownerUserId: owner,
        ownerPublisherId: publisher,
        family: "code-plugin",
        tags: ["latest"],
      },
      ...archiveFields,
      changelog: "Original immutable notes",
      distTags: ["latest"],
      files,
      integritySha256: "c".repeat(64),
      createdBy: owner,
      createdAt: now - 1000,
      publishActor: {
        kind: "github-actions",
        repository: "openclaw/openclaw",
        workflow: "plugin-clawhub-release.yml",
        runId: "100",
        runAttempt: "1",
        sha: "a".repeat(40),
      },
    });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "package",
      status: "failed",
      userId: owner,
      ownerUserId: owner,
      ownerPublisherId: publisher,
      packageId,
      packageReleaseId: releaseId,
      slug: "@openclaw/recovery-fixture",
      displayName: "Recovery fixture",
      version: "2026.9.2",
      idempotencyKey: "original",
      artifactFingerprint: "c".repeat(64),
      clawpackStorageId: archiveId,
      files,
      checks: {
        trufflehog: { status: "clean", summary: "Original clean check" },
        clawscan: { status: "clean", summary: "Original clean scan" },
      },
      packageFollowup: {
        ...authorization,
        packageName: "@openclaw/recovery-fixture",
        version: "2026.9.2",
        githubActionsAudit: { repository: "openclaw/openclaw" },
      },
      finalizationLastError:
        "OpenClaw release parent terminal state completed/failure is not authorized by automated-awaited",
      failedAt: now - 10,
      createdAt: now - 1000,
      updatedAt: now - 10,
      expiresAt: now + 100000,
    });
    await ctx.db.patch(releaseId, { publishAttemptId: attemptId });
    return {
      owner,
      actor,
      publisher,
      membership,
      apiToken,
      packageId,
      releaseId,
      attemptId,
      originalToken,
      storageId,
      archiveId,
    };
  });
  const recover = (body: unknown = { manualOverrideReason: reason }, token = bearer) =>
    t.fetch(`/api/v1/publish/attempts/${ids.attemptId}/recover`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { t, ids, recover };
}

async function sealedPublicationFixture() {
  const fixtureResult = await fixture();
  const { t, ids } = fixtureResult;
  const token = await t.run((ctx) => ctx.db.get(ids.originalToken));
  if (!token?.inventoryDigest) throw new Error("Missing fixture inventory digest");
  const { artifactDigest, fetchImpl } = await sealedGitHubFetch({
    inventoryDigest: token.inventoryDigest,
  });
  const transactionKey = [
    sealedIdentity.parentRepository,
    sealedIdentity.parentRunId,
    sealedIdentity.parentRunAttempt,
    sealedIdentity.runId,
    sealedIdentity.runAttempt,
    sealedIdentity.candidateSha,
    publicationName,
    publicationVersion,
    token.inventoryDigest,
  ].join(":");
  await t.run(async (ctx) => {
    const attempt = await ctx.db.get(ids.attemptId);
    if (!attempt) throw new Error("Missing fixture attempt");
    const packageFollowup = attempt.packageFollowup as Record<string, unknown>;
    await ctx.db.patch(ids.originalToken, {
      authorizationRoute: "automated-sealed",
      authorizationTransactionKey: transactionKey,
      authorizationKey: `${transactionKey}:publish`,
      authorizationArtifactId: "101",
      authorizationArtifactDigest: artifactDigest,
      trustedToolingIdentityJson: JSON.stringify(sealedIdentity),
      candidateRepository: sealedIdentity.candidateRepository,
      candidateSha: sealedIdentity.candidateSha,
      parentRepository: sealedIdentity.parentRepository,
      parentWorkflow: sealedIdentity.parentWorkflow,
      parentRunId: sealedIdentity.parentRunId,
      parentRunAttempt: sealedIdentity.parentRunAttempt,
      sha: sealedIdentity.sha,
      ref: sealedIdentity.fullRef,
    });
    await ctx.db.patch(ids.attemptId, {
      status: "ready_to_finalize",
      finalizationLastError: undefined,
      failedAt: undefined,
      checks: {
        trufflehog: { status: "clean", checkedAt: Date.now() },
        clawscan: { status: "clean", checkedAt: Date.now() },
      },
      packageFollowup: {
        ...packageFollowup,
        githubActionsAudit: {
          actorUserId: ids.owner,
          version: publicationVersion,
          repository: sealedIdentity.repository,
          workflowFilename: "plugin-clawhub-release.yml",
          runId: sealedIdentity.runId,
          runAttempt: sealedIdentity.runAttempt,
          sha: sealedIdentity.sha,
        },
      },
      updatedAt: Date.now(),
    });
  });
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubGlobal("fetch", fetchImpl);
  return fixtureResult;
}

type SealedPublicationFixture = Awaited<ReturnType<typeof sealedPublicationFixture>>;

async function sealedInventoryDigest({ t, ids }: SealedPublicationFixture) {
  const token = await t.run((ctx) => ctx.db.get(ids.originalToken));
  if (!token?.inventoryDigest) throw new Error("Missing fixture inventory digest");
  return token.inventoryDigest;
}

it("publishes the exact sealed transaction after its parent fails", async () => {
  const { t, ids } = await sealedPublicationFixture();
  await expect(
    t.action(internal.packages.finalizePackagePublishAttemptInternal, {
      attemptId: ids.attemptId,
    }),
  ).resolves.toMatchObject({ ok: true, releaseId: ids.releaseId });
  expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
    publicationStatus: "published",
  });
  expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
    status: "finalized",
  });
});

it.each([
  {
    name: "cancelled parent",
    expected: "is not authorized by automated-sealed",
    prepare: async (fixtureResult: SealedPublicationFixture) => {
      const replacement = await sealedGitHubFetch({
        inventoryDigest: await sealedInventoryDigest(fixtureResult),
        parentConclusion: "cancelled",
      });
      vi.stubGlobal("fetch", replacement.fetchImpl);
    },
  },
  {
    name: "substituted non-bot child authority",
    expected: "recovery-approval-100-1 is missing or ambiguous",
    prepare: async (fixtureResult: SealedPublicationFixture) => {
      const replacement = await sealedGitHubFetch({
        inventoryDigest: await sealedInventoryDigest(fixtureResult),
        childActor: { login: "substituted-publisher", type: "User" },
      });
      vi.stubGlobal("fetch", replacement.fetchImpl);
    },
  },
  {
    name: "revoked consumed token",
    expected: "Staged OpenClaw publish authorization no longer matches the release",
    prepare: async ({ t, ids }: SealedPublicationFixture) => {
      await t.run((ctx) => ctx.db.patch(ids.originalToken, { revokedAt: Date.now() }));
    },
  },
  {
    name: "reassigned trusted publisher",
    expected: "Trusted publish authorization no longer matches the current trusted publisher",
    prepare: async ({ t, ids }: SealedPublicationFixture) => {
      await t.run(async (ctx) => {
        const trusted = await ctx.db
          .query("packageTrustedPublishers")
          .withIndex("by_package", (q) => q.eq("packageId", ids.packageId))
          .unique();
        if (!trusted) throw new Error("Missing trusted publisher fixture");
        await ctx.db.patch(trusted._id, { repository: "openclaw/reassigned" });
      });
    },
  },
  {
    name: "mismatched sealed transaction",
    expected: "does not contain one exact package transaction",
    prepare: async (fixtureResult: SealedPublicationFixture) => {
      const inventoryDigest = await sealedInventoryDigest(fixtureResult);
      const replacement = await sealedGitHubFetch({
        inventoryDigest,
        receiptInventoryDigest: "f".repeat(64),
      });
      await fixtureResult.t.run((ctx) =>
        ctx.db.patch(fixtureResult.ids.originalToken, {
          authorizationArtifactDigest: replacement.artifactDigest,
        }),
      );
      vi.stubGlobal("fetch", replacement.fetchImpl);
    },
  },
])("keeps publication pending for $name", async ({ prepare, expected }) => {
  const fixtureResult = await sealedPublicationFixture();
  await prepare(fixtureResult);
  await expect(
    fixtureResult.t.action(internal.packages.finalizePackagePublishAttemptInternal, {
      attemptId: fixtureResult.ids.attemptId,
    }),
  ).rejects.toThrow(expected);
  expect(await fixtureResult.t.run((ctx) => ctx.db.get(fixtureResult.ids.releaseId))).toMatchObject(
    {
      publicationStatus: "pending",
    },
  );
});

it("recovers a failed staged plugin through fresh publisher authority without replacing its bytes or history", async () => {
  const { t, ids, recover } = await fixture();
  const before = await t.run(async (ctx) => ({
    attempt: await ctx.db.get(ids.attemptId),
    release: await ctx.db.get(ids.releaseId),
    token: await ctx.db.get(ids.originalToken),
  }));
  const response = await recover();
  expect(response.status, await response.clone().text()).toBe(202);
  const result = await response.json();
  expect(result).toMatchObject({
    recoveredFromAttemptId: ids.attemptId,
    releaseId: ids.releaseId,
    status: "pending_checks",
    publicationStatus: "pending",
    reused: false,
  });
  expect(result.attemptId).not.toBe(ids.attemptId);
  const after = await t.run(async (ctx) => ({
    attempt: await ctx.db.get(ids.attemptId),
    release: await ctx.db.get(ids.releaseId),
    token: await ctx.db.get(ids.originalToken),
    successor: await ctx.db.get(result.attemptId as Id<"publishAttempts">),
  }));
  expect(after.attempt).toEqual(before.attempt);
  expect(after.token).toEqual(before.token);
  expect(after.release?.files).toEqual(before.release?.files);
  expect(after.release?.integritySha256).toBe(before.release?.integritySha256);
  expect(after.successor).toMatchObject({
    userId: ids.actor,
    status: "pending_checks",
    checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
  });
});

it("replays exactly once and preserves the original attempt's private status", async () => {
  const { t, ids, recover } = await fixture();
  const first = await (await recover()).json();
  const replay = await recover();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ attemptId: first.attemptId, reused: true });
  expect((await recover({ manualOverrideReason: "different reason" })).status).toBe(409);
  const oldStatus = await t.fetch(`/api/v1/publish/attempts/${ids.attemptId}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  expect(oldStatus.status).toBe(404);
  const newStatus = await t.fetch(`/api/v1/publish/attempts/${first.attemptId}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  expect(newStatus.status).toBe(200);
});

it("recovers a retained failed attempt whose legacy release has no backlink", async () => {
  const { t, ids, recover } = await fixture();
  await t.run((ctx) => ctx.db.patch(ids.releaseId, { publishAttemptId: undefined }));
  expect((await recover()).status).toBe(202);
});

it("does not recover a legacy missing backlink over another active attempt", async () => {
  const { t, ids, recover } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.releaseId, { publishAttemptId: undefined });
    const original = await ctx.db.get(ids.attemptId);
    if (!original) throw new Error("Missing fixture attempt");
    const { _id, _creationTime, ...copy } = original;
    await ctx.db.insert("publishAttempts", {
      ...copy,
      status: "pending_checks",
      idempotencyKey: "active-other",
    });
  });
  expect((await recover()).status).toBe(409);
});

it("binds a newly created package attempt before scanner execution", async () => {
  const { t, ids } = await fixture();
  const original = await t.run(async (ctx) => {
    const attempt = await ctx.db.get(ids.attemptId);
    if (!attempt) throw new Error("Missing fixture attempt");
    await ctx.db.delete(ids.attemptId);
    await ctx.db.patch(ids.releaseId, { publishAttemptId: undefined });
    return attempt;
  });
  const created = await t.mutation(internal.publishAttempts.createPackagePublishAttemptInternal, {
    userId: ids.owner,
    ownerUserId: ids.owner,
    ownerPublisherId: ids.publisher,
    packageId: ids.packageId,
    packageReleaseId: ids.releaseId,
    name: original.slug,
    displayName: original.displayName,
    version: original.version,
    idempotencyKey: "new-producer",
    artifactFingerprint: original.artifactFingerprint,
    files: original.files,
    clawpackStorageId: original.clawpackStorageId,
    packageFollowup: original.packageFollowup,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
    publishAttemptId: created.attemptId,
  });
});

it("terminalizes full-action finalization after publisher membership is lost", async () => {
  const { t, ids, recover } = await fixture();
  const recovered = await (await recover()).json();
  const attemptId = recovered.attemptId as Id<"publishAttempts">;
  await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
  });
  await t.mutation(internal.publishAttempts.completePendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
    artifactFingerprint: "c".repeat(64),
    trufflehog: { status: "clean" },
    clawscan: { status: "clean" },
  });
  await t.run((ctx) => ctx.db.delete(ids.membership));
  await expect(
    t.action(internal.packages.finalizePackagePublishAttemptInternal, { attemptId }),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "failed" });
  expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
    publicationStatus: "pending",
  });
});

it.each(["trufflehog", "clawscan"] as const)(
  "replays the terminal result after %s blocks the successor",
  async (scanner) => {
    const { t, recover } = await fixture();
    const first = await (await recover()).json();
    const attemptId = first.attemptId as Id<"publishAttempts">;
    await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
      attemptId,
      claimId: "scanner",
    });
    await t.mutation(internal.publishAttempts.completePendingPublishAttemptChecksInternal, {
      attemptId,
      claimId: "scanner",
      artifactFingerprint: "c".repeat(64),
      trufflehog: { status: scanner === "trufflehog" ? "blocked" : "clean" },
      clawscan: { status: scanner === "clawscan" ? "blocked" : "clean" },
    });
    const replay = await recover();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      attemptId,
      reused: true,
      publicationStatus: "blocked",
    });
  },
);

it("finalizes a second successor through the complete action and replays its result", async () => {
  const { t, ids, recover } = await fixture();
  const first = await (await recover()).json();
  const firstId = first.attemptId as Id<"publishAttempts">;
  await t.run((ctx) => ctx.db.patch(firstId, { status: "failed", failedAt: Date.now() }));
  const request = () =>
    t.fetch(`/api/v1/publish/attempts/${firstId}/recover`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ manualOverrideReason: reason }),
    });
  const second = await (await request()).json();
  const attemptId = second.attemptId as Id<"publishAttempts">;
  expect(attemptId).not.toBe(firstId);
  await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
  });
  await t.mutation(internal.publishAttempts.completePendingPublishAttemptChecksInternal, {
    attemptId,
    claimId: "scanner",
    artifactFingerprint: "c".repeat(64),
    trufflehog: { status: "clean" },
    clawscan: { status: "clean" },
  });
  await expect(
    t.action(internal.packages.finalizePackagePublishAttemptInternal, { attemptId }),
  ).resolves.toMatchObject({ ok: true, releaseId: ids.releaseId });
  expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "finalized" });
  const replay = await request();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({
    attemptId,
    reused: true,
    publicationStatus: "published",
  });
  expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({ status: "failed" });
  expect(await t.run((ctx) => ctx.db.get(firstId))).toMatchObject({ status: "failed" });
});

it.each([
  "ready_to_finalize",
  "pending_checks",
  "finalizing",
  "finalized",
  "blocked",
  "expired",
] as const)("does not reset an attempt in %s", async (status) => {
  const { t, ids, recover } = await fixture();
  await t.run((ctx) => ctx.db.patch(ids.attemptId, { status }));
  const response = await recover();
  expect(response.status).toBe(409);
  expect(response.headers.get("Retry-After")).toBe(
    ["pending_checks", "ready_to_finalize", "finalizing"].includes(status) ? "10" : null,
  );
  expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({ status });
});

it.each([
  { manualOverrideReason: " " },
  { manualOverrideReason: "x".repeat(501) },
  { manualOverrideReason: reason, actorUserId: "other" },
  { manualOverrideReason: reason, trustedToolingIdentity: {} },
  { manualOverrideReason: reason, files: [] },
])("rejects malformed or extra authority inputs %#", async (body) => {
  const { recover } = await fixture();
  expect((await recover(body)).status).toBe(400);
});

it("does not let a platform administrator bypass publisher membership", async () => {
  const { t, ids, recover } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.actor, { role: "admin" });
    await ctx.db.delete(ids.membership);
  });
  expect((await recover()).status).toBe(404);
});

it.each(["token", "owner", "actor", "publisher"] as const)(
  "rejects revoked/deactivated %s without a successor",
  async (subject) => {
    const { t, ids, recover } = await fixture();
    await t.run(async (ctx) => {
      if (subject === "token") await ctx.db.patch(ids.apiToken, { revokedAt: Date.now() });
      else await ctx.db.patch(ids[subject], { deactivatedAt: Date.now() });
    });
    expect([401, 404]).toContain((await recover()).status);
    expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
      publishAttemptId: ids.attemptId,
    });
  },
);

it.each([
  "original-scope",
  "inventory",
  "fingerprint",
  "files",
  "storage",
  "archive",
  "archive-digest",
  "moderation",
  "scan-block",
  "active-claim",
] as const)("rejects changed %s", async (change) => {
  const { t, ids, recover } = await fixture();
  await t.run(async (ctx) => {
    if (change === "original-scope") await ctx.db.patch(ids.originalToken, { scope: "upload" });
    if (change === "inventory")
      await ctx.db.patch(ids.originalToken, { inventoryDigest: "f".repeat(64) });
    if (change === "fingerprint")
      await ctx.db.patch(ids.releaseId, { integritySha256: "f".repeat(64) });
    if (change === "files") await ctx.db.patch(ids.releaseId, { files: [] });
    if (change === "storage") await ctx.storage.delete(ids.storageId);
    if (change === "archive") await ctx.storage.delete(ids.archiveId);
    if (change === "archive-digest")
      await ctx.db.patch(ids.releaseId, { clawpackSha256: "f".repeat(64) });
    if (change === "moderation")
      await ctx.db.patch(ids.releaseId, {
        manualModeration: {
          state: "quarantined",
          reason: "hold",
          reviewerUserId: ids.actor,
          updatedAt: Date.now(),
        },
      });
    if (change === "scan-block")
      await ctx.db.patch(ids.attemptId, {
        checks: { trufflehog: { status: "clean" }, clawscan: { status: "blocked" } },
      });
    if (change === "active-claim")
      await ctx.db.patch(ids.attemptId, {
        finalizationClaimId: "active",
        finalizationClaimExpiresAt: Date.now() + 60000,
      });
  });
  expect((await recover()).status).toBe(409);
  expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
    publishAttemptId: ids.attemptId,
  });
});

it("fences expired predecessor claims by using a distinct attempt", async () => {
  const { t, ids, recover } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch(ids.attemptId, {
      finalizationClaimId: "expired",
      finalizationClaimExpiresAt: Date.now() - 1,
    }),
  );
  const response = await recover();
  expect(response.status).toBe(202);
  expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
    status: "failed",
    finalizationClaimId: "expired",
  });
});

it("requires fresh scanner checks and rejects stale finalization claims", async () => {
  const { t, ids, recover } = await fixture();
  const result = await (await recover()).json();
  const successorId = result.attemptId as Id<"publishAttempts">;
  await expect(
    t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: ids.releaseId,
      manualRecoveryAttemptId: successorId,
      manualRecoveryClaimId: "unclaimed",
    }),
  ).rejects.toThrow(/claim or checks changed/);
  await t.run((ctx) =>
    ctx.db.patch(successorId, {
      status: "ready_to_finalize",
      checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
    }),
  );
  await t.mutation(internal.publishAttempts.claimPackagePublishAttemptForFinalizationInternal, {
    attemptId: successorId,
    claimId: "current",
  });
  await expect(
    t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: ids.releaseId,
      manualRecoveryAttemptId: successorId,
      manualRecoveryClaimId: "stale",
    }),
  ).rejects.toThrow(/claim or checks changed/);
  await t.run((ctx) => ctx.db.patch(ids.apiToken, { revokedAt: Date.now() }));
  await expect(
    t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: ids.releaseId,
      manualRecoveryAttemptId: successorId,
      manualRecoveryClaimId: "current",
    }),
  ).rejects.toThrow(/revoked/);
  expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
    publicationStatus: "pending",
  });
});

it("uses fresh manual authority independently of an expired and revoked original grant", async () => {
  const { t, ids, recover } = await fixture();
  await t.run((ctx) => ctx.db.patch(ids.originalToken, { revokedAt: Date.now() }));
  const original = await t.run((ctx) => ctx.db.get(ids.originalToken));
  expect(
    (await recover({ manualOverrideReason: reason }, "original-consumed-fixture")).status,
  ).toBe(401);
  expect((await recover()).status).toBe(202);
  expect(await t.run((ctx) => ctx.db.get(ids.originalToken))).toEqual(original);
});

it.each(["none", "membership", "token", "archive-digest"] as const)(
  "commits only a currently authorized recovery after fresh claimed scans: %s",
  async (revocation) => {
    const { t, ids, recover } = await fixture();
    const recovered = await (await recover()).json();
    const attemptId = recovered.attemptId as Id<"publishAttempts">;
    await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
      attemptId,
      claimId: "fresh-scanner",
    });
    await t.mutation(internal.publishAttempts.completePendingPublishAttemptChecksInternal, {
      attemptId,
      claimId: "fresh-scanner",
      artifactFingerprint: "c".repeat(64),
      trufflehog: { status: "clean", summary: "Fresh secret scan" },
      clawscan: { status: "clean", summary: "Fresh policy scan" },
    });
    await t.mutation(internal.publishAttempts.claimPackagePublishAttemptForFinalizationInternal, {
      attemptId,
      claimId: "fresh-finalizer",
    });
    if (revocation === "membership") await t.run((ctx) => ctx.db.delete(ids.membership));
    if (revocation === "token")
      await t.run((ctx) => ctx.db.patch(ids.apiToken, { revokedAt: Date.now() }));
    if (revocation === "archive-digest")
      await t.run((ctx) => ctx.db.patch(ids.releaseId, { clawpackSha256: "f".repeat(64) }));
    const commit = t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: ids.releaseId,
      manualRecoveryAttemptId: attemptId,
      manualRecoveryClaimId: "fresh-finalizer",
    });
    if (revocation !== "none") {
      await expect(commit).rejects.toThrow();
      expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
        publicationStatus: "pending",
      });
    } else {
      await expect(commit).resolves.toMatchObject({ ok: true, releaseId: ids.releaseId });
      expect(await t.run((ctx) => ctx.db.get(ids.releaseId))).toMatchObject({
        publicationStatus: "published",
        publishActor: { kind: "user", userId: ids.actor },
      });
    }
    expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({ status: "failed" });
  },
);

const publicationName = "@openclaw/recovery-fixture";
const publicationVersion = "2026.9.2";
const publicationIdentity = { name: publicationName, version: publicationVersion };
const publicationPath = `/api/v1/packages/${encodeURIComponent(publicationName)}/versions/${publicationVersion}/publication`;

async function publicationFixture() {
  const fixtureResult = await fixture();
  const { t, ids } = fixtureResult;
  // A staged first release is not yet a visible package. Give this fixture a public baseline.
  await t.run(async (ctx) => {
    const latestReleaseId = await ctx.db.insert("packageReleases", {
      packageId: ids.packageId,
      version: "2026.9.1",
      publicationStatus: "published",
      changelog: "Published baseline",
      integritySha256: "d".repeat(64),
      files: [],
      distTags: ["latest"],
      createdAt: 1,
      createdBy: ids.owner,
    });
    await ctx.db.patch(ids.packageId, {
      latestReleaseId,
      tags: { latest: latestReleaseId },
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    });
  });
  const publication = async (expected: Record<string, unknown>, path = publicationPath) => {
    const response = await t.fetch(path);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ...publicationIdentity, ...expected });
    expect(Object.keys(body).sort()).toEqual(
      Object.keys({ ...publicationIdentity, ...expected }).sort(),
    );
    return response;
  };
  return { ...fixtureResult, publication };
}

it("reports unknown and hard-deleted releases as absent despite retained attempt audit rows", async () => {
  const { t, ids, publication } = await publicationFixture();
  const response = await publication(
    { version: "unknown", state: "absent" },
    publicationPath.replace(publicationVersion, "unknown"),
  );
  expect(response.headers.get("X-RateLimit-Limit")).toBe("3000");
  await t.run((ctx) => ctx.db.delete(ids.releaseId));
  await publication({ state: "absent" });
  expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).not.toBeNull();
});

it.each([undefined, "published"] as const)(
  "reports %s published releases",
  async (publicationStatus) => {
    const { t, ids, publication } = await publicationFixture();
    await t.run((ctx) => ctx.db.patch(ids.releaseId, { publicationStatus }));
    await publication({ state: "published" });
    expect((await t.fetch(publicationPath.replace("/publication", ""))).status).toBe(200);
  },
);

it.each(["unbound", "missing-row"] as const)(
  "reports staging for an attempt that is %s",
  async (binding) => {
    const { t, ids, publication } = await publicationFixture();
    await t.run((ctx) =>
      binding === "unbound"
        ? ctx.db.patch(ids.releaseId, { publishAttemptId: undefined })
        : ctx.db.delete(ids.attemptId),
    );
    await publication({ state: "pending", stage: "staging" });
  },
);

it.each([
  ["pending_checks", "checks"],
  ["ready_to_finalize", "finalization"],
  ["finalizing", "finalization"],
  ["finalized", "finalization"],
] as const)("reports pending %s as %s without private attempt fields", async (status, stage) => {
  const { t, ids, publication } = await publicationFixture();
  await t.run((ctx) => ctx.db.patch(ids.attemptId, { status }));
  await publication({ state: "pending", stage, attemptId: ids.attemptId });
  await publication(
    { state: "pending", stage, attemptId: ids.attemptId },
    `/api/v1/packages/@openclaw/recovery-fixture/versions/${publicationVersion}/publication`,
  );
});

it("reports recoverable publicly, proves recovery parity, and follows the successor binding", async () => {
  const { ids, recover, publication } = await publicationFixture();
  await publication({ state: "failed", attemptId: ids.attemptId, recoverable: true });
  const recovery = await recover();
  expect(recovery.status).toBe(202);
  const { attemptId } = await recovery.json();
  await publication({ state: "pending", stage: "checks", attemptId });
});

it("uses the same original-token policy for a failed manual successor", async () => {
  const { t, ids, recover, publication } = await publicationFixture();
  await recover();
  const release = await t.run((ctx) => ctx.db.get(ids.releaseId));
  const attemptId = release?.publishAttemptId;
  if (!attemptId) throw new Error("Missing recovery successor");
  await t.run((ctx) => ctx.db.patch(attemptId, { status: "failed" }));
  await publication({ state: "failed", attemptId, recoverable: true });
  await t.run((ctx) => ctx.db.patch(ids.releaseId, { pendingPublication: {} }));
  await publication({ state: "failed", attemptId, recoverable: false });
  await expect(
    t.mutation(internal.packagePublishRecovery.commitInternal, {
      attemptId,
      actorUserId: ids.actor,
      apiTokenId: ids.apiToken,
      manualOverrideReason: reason,
    }),
  ).rejects.toThrow("Original manual recovery binding changed");
});

it("preserves storage-before-binding recovery rejection precedence", async () => {
  const { t, ids } = await publicationFixture();
  await t.run(async (ctx) => {
    await ctx.storage.delete(ids.storageId);
    await ctx.db.patch(ids.releaseId, { pendingPublication: {} });
  });
  await expect(
    t.mutation(internal.packagePublishRecovery.commitInternal, {
      attemptId: ids.attemptId,
      actorUserId: ids.actor,
      apiTokenId: ids.apiToken,
      manualOverrideReason: reason,
    }),
  ).rejects.toThrow("Recovered package publication authorization artifact storage changed");
});

it.each(["blocked", "expired"] as const)(
  "folds %s attempts into unrecoverable failures",
  async (status) => {
    const { t, ids, publication } = await publicationFixture();
    await t.run((ctx) => ctx.db.patch(ids.attemptId, { status }));
    await publication({ state: "failed", attemptId: ids.attemptId, recoverable: false });
  },
);

it.each([true, false])("reports blocked releases, bound=%s", async (bound) => {
  const { t, ids, publication } = await publicationFixture();
  await t.run((ctx) =>
    ctx.db.patch(ids.releaseId, {
      publicationStatus: "blocked",
      publishAttemptId: bound ? ids.attemptId : undefined,
    }),
  );
  await publication({
    state: "failed",
    ...(bound ? { attemptId: ids.attemptId } : {}),
    recoverable: false,
  });
});

it.each([
  "scan-block",
  "non-openclaw",
  "token-scope",
  "token-missing",
  "artifact",
  "authorization-binding",
  "release-binding",
  "family",
  "moderation",
] as const)("shares static recovery rejection for %s", async (change) => {
  const { t, ids, publication, recover } = await publicationFixture();
  await t.run(async (ctx) => {
    if (change === "scan-block")
      await ctx.db.patch(ids.attemptId, {
        checks: { trufflehog: { status: "blocked" }, clawscan: { status: "clean" } },
      });
    if (change === "non-openclaw")
      await ctx.db.patch(ids.originalToken, { repository: "example/plugin" });
    if (change === "token-scope") await ctx.db.patch(ids.originalToken, { scope: "upload" });
    if (change === "token-missing") await ctx.db.delete(ids.originalToken);
    if (change === "artifact") await ctx.db.patch(ids.releaseId, { integritySha256: "different" });
    if (change === "authorization-binding")
      await ctx.db.patch(ids.releaseId, { pendingPublication: {} });
    if (change === "release-binding")
      await ctx.db.patch(ids.attemptId, { packageReleaseId: undefined });
    if (change === "family") await ctx.db.patch(ids.packageId, { family: "claw" });
    if (change === "moderation")
      await ctx.db.patch(ids.releaseId, {
        manualModeration: {
          state: "quarantined",
          reason: "private reason",
          reviewerUserId: ids.actor,
          updatedAt: 1,
        },
      });
  });
  if (change === "family") vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
  await publication({ state: "failed", attemptId: ids.attemptId, recoverable: false });
  expect([404, 409]).toContain((await recover()).status);
});

it.each(["membership", "storage", "active-claim"] as const)(
  "keeps advisory eligibility independent of %s",
  async (change) => {
    const { t, ids, publication, recover } = await publicationFixture();
    await t.run(async (ctx) => {
      if (change === "membership") await ctx.db.delete(ids.membership);
      if (change === "storage") await ctx.storage.delete(ids.storageId);
      if (change === "active-claim")
        await ctx.db.patch(ids.attemptId, { checkClaimExpiresAt: Date.now() + 60000 });
    });
    await publication({ state: "failed", attemptId: ids.attemptId, recoverable: true });
    expect([404, 409]).toContain((await recover()).status);
  },
);

it.each(["softDeletedAt", "ownerDeletedAt"] as const)(
  "preserves hidden published version 404 for %s",
  async (field) => {
    const { t, ids } = await publicationFixture();
    await t.run((ctx) =>
      ctx.db.patch(ids.releaseId, { publicationStatus: "published", [field]: 0 }),
    );
    for (const path of [publicationPath, publicationPath.replace("/publication", "")]) {
      const response = await t.fetch(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Version not found");
    }
  },
);

it.each(["quarantined", "revoked"] as const)(
  "preserves published metadata visibility for %s releases",
  async (state) => {
    const { t, ids, publication } = await publicationFixture();
    await t.run((ctx) =>
      ctx.db.patch(ids.releaseId, {
        publicationStatus: "published",
        manualModeration: {
          state,
          reason: "private reason",
          reviewerUserId: ids.actor,
          updatedAt: 1,
        },
      }),
    );
    expect((await t.fetch(publicationPath.replace("/publication", ""))).status).toBe(200);
    await publication({ state: "published" });
  },
);

it.each(["private", "deleted", "staged-first-release", "missing", "skill"] as const)(
  "returns Package not found for %s packages",
  async (visibility) => {
    const { t, ids } = await publicationFixture();
    await t.run(async (ctx) => {
      if (visibility === "private") await ctx.db.patch(ids.packageId, { channel: "private" });
      if (visibility === "deleted") await ctx.db.patch(ids.packageId, { softDeletedAt: 0 });
      if (visibility === "staged-first-release")
        await ctx.db.patch(ids.packageId, {
          latestReleaseId: undefined,
          stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        });
      if (visibility === "missing" || visibility === "skill") await ctx.db.delete(ids.packageId);
      if (visibility === "skill")
        await ctx.db.insert("skills", {
          slug: "publication-skill",
          displayName: "Publication skill",
          ownerUserId: ids.owner,
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
          createdAt: 1,
          updatedAt: 1,
        });
    });
    const path =
      visibility === "skill"
        ? "/api/v1/packages/publication-skill/versions/1.0.0/publication"
        : publicationPath;
    const response = await t.fetch(path);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Package not found");
    if (visibility === "private") {
      const headers = { Authorization: `Bearer ${bearer}` };
      const authenticated = await t.fetch(path, { headers });
      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toEqual({
        ...publicationIdentity,
        state: "failed",
        attemptId: ids.attemptId,
        recoverable: true,
      });
      await t.run((ctx) => ctx.db.patch(ids.releaseId, { publicationStatus: "published" }));
      for (const versionPath of [path, path.replace("/publication", "")])
        expect((await t.fetch(versionPath, { headers })).status).toBe(200);
    }
  },
);
