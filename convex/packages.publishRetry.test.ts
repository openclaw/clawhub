/* @vitest-environment node */

import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./lib/clawpack";
import { buildPackageInventoryDigest } from "./lib/skills";
import { publishPackageForTrustedPublisherInternal } from "./packages";

vi.mock("./lib/openClawPublishAuthorization", () => ({
  verifyOpenClawPublishAuthorization: vi.fn(async () => {
    throw new Error("a settled retry must not reach publish authorization");
  }),
}));

const publish = (
  publishPackageForTrustedPublisherInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { publishTokenId: string; payload: unknown },
    ) => Promise<unknown>;
  }
)._handler;

const candidateSha = "b".repeat(40);
const manifest = JSON.stringify({ id: "demo.plugin" });
const trustedPublisher = {
  _id: "packageTrustedPublishers:1",
  packageId: "packages:demo",
  provider: "github-actions",
  repository: "openclaw/openclaw",
  repositoryId: "1",
  repositoryOwner: "openclaw",
  repositoryOwnerId: "2",
  workflowFilename: "plugin-clawhub-release.yml",
  environment: "clawhub-release",
};
const existingPackage = {
  _id: "packages:demo",
  name: "demo-plugin",
  normalizedName: "demo-plugin",
  displayName: "Demo Plugin",
  family: "code-plugin",
  channel: "community",
  ownerUserId: "users:owner",
  latestReleaseId: "packageReleases:previous",
  createdAt: 1,
  updatedAt: 1,
};
const pendingRelease = {
  _id: "packageReleases:staged",
  packageId: "packages:demo",
  version: "1.0.0",
  publicationStatus: "pending",
};

async function publishToken(runAttempt = "1") {
  const bytes = new TextEncoder().encode(manifest);
  return {
    ...trustedPublisher,
    _id: "packagePublishTokens:retry",
    version: "1.0.0",
    sha: "c".repeat(40),
    ref: "refs/tags/release-publish/tooling",
    runId: "100",
    runAttempt,
    scope: "publish",
    inventoryDigest: await buildPackageInventoryDigest([
      { path: "openclaw.plugin.json", size: bytes.byteLength, sha256: await sha256Hex(bytes) },
    ]),
    authorizationVersion: 2,
    candidateRepository: "openclaw/openclaw",
    candidateSha,
    expiresAt: Date.now() + 60_000,
  };
}

async function retry(existingAttempt: Record<string, unknown>, runAttempt?: string) {
  const token = await publishToken(runAttempt);
  const queries: Record<string, unknown> = {
    "packagePublishTokens:getByIdInternal": token,
    "packages:getTrustedPublisherByPackageIdInternal": trustedPublisher,
    "packages:getPackageByNameInternal": existingPackage,
    "packages:getReleaseByPackageAndVersionInternal": pendingRelease,
    "publishAttempts:findExistingPublishAttemptForArtifactInternal": existingAttempt,
  };
  const ctx = {
    runQuery: vi.fn(
      async (ref: FunctionReference<"query">) => queries[getFunctionName(ref)] ?? null,
    ),
    runMutation: vi.fn(async () => {
      throw new Error("a settled retry must not write");
    }),
    runAction: vi.fn(async () => {
      throw new Error("a settled retry must not rerun scans or Plugin Inspector");
    }),
    scheduler: { runAfter: vi.fn() },
    storage: {
      get: vi.fn(async () => new Blob([manifest])),
      store: vi.fn(),
      delete: vi.fn(),
    },
  };
  const result = publish(ctx, {
    publishTokenId: "packagePublishTokens:retry",
    payload: {
      name: "demo-plugin",
      family: "code-plugin",
      version: "1.0.0",
      changelog: "retry",
      source: {
        kind: "github",
        url: "https://github.com/openclaw/openclaw",
        repo: "openclaw/openclaw",
        ref: candidateSha,
        commit: candidateSha,
        path: "extensions/demo-plugin",
        importedAt: 1,
      },
      files: [
        {
          path: "openclaw.plugin.json",
          size: manifest.length,
          storageId: "storage:manifest",
          sha256: "client-hash",
          contentType: "application/json",
        },
      ],
    },
  });
  return { result, ctx };
}

const stagedAttempt = {
  attemptId: "publishAttempts:staged",
  packageId: "packages:demo",
  releaseId: "packageReleases:staged",
  githubActionsRun: { repository: "openclaw/openclaw", runId: "100", runAttempt: "1" },
};

describe("staged package publish retries", () => {
  it("returns the pending staged release for an exact retry from the same run", async () => {
    const { result, ctx } = await retry({
      ...stagedAttempt,
      status: "ready_to_finalize",
      reusable: true,
    });
    await expect(result).resolves.toMatchObject({
      ok: true,
      status: "pending",
      publicationStatus: "pending",
      attemptId: "publishAttempts:staged",
      releaseId: "packageReleases:staged",
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("does not adopt another workflow run's pending publication", async () => {
    const { result, ctx } = await retry(
      { ...stagedAttempt, status: "pending_checks", reusable: true },
      "2",
    );
    await expect(result).rejects.toThrow(
      "already staged by publish attempt publishAttempts:staged from another workflow run",
    );
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("names the failed attempt and its recovery command before rerunning checks", async () => {
    const { result, ctx } = await retry({
      ...stagedAttempt,
      status: "failed",
      reusable: false,
      error: "OpenClaw release parent terminal state completed/failure is not authorized",
    });
    await expect(result).rejects.toThrow(
      "Version 1.0.0 is staged by failed publish attempt publishAttempts:staged (OpenClaw release parent terminal state completed/failure is not authorized). Recover it with: clawhub package recover publishAttempts:staged",
    );
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
