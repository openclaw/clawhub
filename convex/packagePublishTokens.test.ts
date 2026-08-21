/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createInternal } from "./packagePublishTokens";

type CreateHandler = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

const createHandler = (createInternal as unknown as CreateHandler)._handler;

function createArgs() {
  return {
    packageId: "packages:demo",
    version: "1.0.0",
    prefix: "clh_",
    tokenHash: "hash",
    provider: "github-actions",
    repository: "openclaw/openclaw",
    repositoryId: "1",
    repositoryOwner: "openclaw",
    repositoryOwnerId: "2",
    workflowFilename: "plugin-clawhub-release.yml",
    runId: "100",
    runAttempt: "1",
    sha: "a".repeat(40),
    ref: "refs/heads/release",
    scope: "publish",
    inventoryDigest: "b".repeat(64),
    authorizationVersion: 2,
    authorizationRoute: "automated-awaited",
    authorizationTransactionKey: "exact-parent:child:candidate:package:version:inventory",
    authorizationKey: "exact-parent:child:candidate:package:version:inventory:publish",
    authorizationArtifactId: "101",
    authorizationArtifactDigest: `sha256:${"c".repeat(64)}`,
    trustedToolingIdentityJson: '{"version":2}',
    candidateRepository: "openclaw/openclaw",
    candidateSha: "d".repeat(40),
    parentRepository: "openclaw/openclaw",
    parentWorkflow: ".github/workflows/openclaw-release-publish.yml",
    parentRunId: "99",
    parentRunAttempt: "2",
    expiresAt: Date.now() + 60_000,
  };
}

describe("package publish authorization token minting", () => {
  it("rejects replay of an already minted receipt transaction", async () => {
    const first = vi.fn(async () => ({ _id: "packagePublishTokens:existing" }));
    const ctx = {
      db: {
        get: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            filter: vi.fn(() => ({ first })),
          })),
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        system: { get: vi.fn(), query: vi.fn() },
      },
    };

    await expect(createHandler(ctx, createArgs())).rejects.toThrow(
      "authorization transaction was already minted",
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
