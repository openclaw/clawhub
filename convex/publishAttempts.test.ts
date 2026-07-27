import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import {
  claimPendingPublishAttemptChecksInternal,
  claimPrePublicationChecks,
  claimReadyPublishAttemptFinalizationRetryInternal,
  completePendingPublishAttemptChecksInternal,
  recordSkillPublishAttemptFinalizedInternal,
  releasePackagePublishAttemptFinalizationClaimInternal,
  releaseSkillPublishAttemptFinalizationClaimInternal,
} from "./publishAttempts";

const claimPendingChecksHandler = (
  claimPendingPublishAttemptChecksInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const completePendingChecksHandler = (
  completePendingPublishAttemptChecksInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const claimReadyFinalizationHandler = (
  claimReadyPublishAttemptFinalizationRetryInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const claimPrePublicationChecksHandler = (
  claimPrePublicationChecks as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const releaseSkillFinalizationHandler = (
  releaseSkillPublishAttemptFinalizationClaimInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const releasePackageFinalizationHandler = (
  releasePackagePublishAttemptFinalizationClaimInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const recordSkillFinalizedHandler = (
  recordSkillPublishAttemptFinalizedInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;

describe("publishAttempts", () => {
  it("leases staged publish check claims long enough for scanner timeouts", async () => {
    const attempt = {
      _id: "publishAttempts:demo",
      kind: "skill",
      status: "pending_checks",
      userId: "users:publisher",
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      artifactFingerprint: "fingerprint",
      files: [{ path: "SKILL.md", storageId: "_storage:skill", size: 10, sha256: "sha" }],
      skillInsertArgs: {
        staticScan: { status: "clean" },
      },
      createdAt: Date.now(),
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [attempt]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimPendingChecksHandler(ctx, { claimId: "checks:claim" }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:demo",
      claimId: "checks:claim",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        checkClaimId: "checks:claim",
        checkClaimedAt: expect.any(Number),
        checkClaimExpiresAt: expect.any(Number),
      }),
    );
    const patch = ctx.db.patch.mock.calls[0]?.[1] as {
      checkClaimedAt: number;
      checkClaimExpiresAt: number;
    };
    expect(patch.checkClaimExpiresAt - patch.checkClaimedAt).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it("claims fresh staged publishes before older scanner retries", async () => {
    const now = Date.now();
    const freshAttempt = {
      _id: "publishAttempts:fresh",
      kind: "skill",
      status: "pending_checks",
      userId: "users:publisher",
      slug: "fresh-skill",
      displayName: "Fresh Skill",
      version: "1.0.0",
      artifactFingerprint: "fresh-fingerprint",
      files: [{ path: "SKILL.md", storageId: "_storage:fresh", size: 10, sha256: "fresh-sha" }],
      skillInsertArgs: {
        staticScan: { status: "clean" },
      },
      createdAt: now,
    };
    const retryAttempt = {
      ...freshAttempt,
      _id: "publishAttempts:retry",
      slug: "retry-skill",
      artifactFingerprint: "retry-fingerprint",
      checkClaimExpiresAt: now - 1,
      checkClaimLastError: "ClawScan judge status was failed",
      createdAt: now - 60_000,
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn((indexName: string) => ({
            order: vi.fn(() => ({
              take: vi.fn(async () =>
                indexName === "by_status_check_claim_expires_at_created"
                  ? [freshAttempt, retryAttempt]
                  : [retryAttempt, freshAttempt],
              ),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimPendingChecksHandler(ctx, { claimId: "checks:claim" }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:fresh",
      slug: "fresh-skill",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:fresh",
      expect.objectContaining({ checkClaimId: "checks:claim" }),
    );
  });

  it("terminalizes orphaned pending attempts and claims healthy work behind them", async () => {
    const orphan = {
      _id: "publishAttempts:orphan",
      kind: "skill",
      status: "pending_checks",
      userId: "users:publisher",
      skillVersionId: "skillVersions:deleted",
      slug: "deleted-skill",
      displayName: "Deleted Skill",
      version: "1.0.0",
      artifactFingerprint: "fingerprint",
      files: [{ path: "SKILL.md", storageId: "_storage:skill", size: 10, sha256: "sha" }],
      createdAt: Date.now(),
    };
    const healthy = {
      ...orphan,
      _id: "publishAttempts:healthy",
      skillVersionId: "skillVersions:healthy",
      slug: "healthy-skill",
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async (id: string) =>
          id === "skillVersions:healthy"
            ? { _id: id, fingerprint: healthy.artifactFingerprint }
            : null,
        ),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [orphan, healthy]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimPendingChecksHandler(ctx, { claimId: "checks:claim" }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:healthy",
      slug: "healthy-skill",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:orphan",
      expect.objectContaining({
        status: "failed",
        checkClaimId: undefined,
        checkClaimLastError: "Pending skill version not found.",
        failedAt: expect.any(Number),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:healthy",
      expect.objectContaining({ checkClaimId: "checks:claim" }),
    );
  });

  it("reuses a completed ClawScan verdict only for the exact staged artifact", async () => {
    const attempt = {
      _id: "publishAttempts:reusable",
      kind: "skill",
      status: "pending_checks",
      userId: "users:publisher",
      skillVersionId: "skillVersions:reusable",
      slug: "reusable-skill",
      displayName: "Reusable Skill",
      version: "1.0.0",
      artifactFingerprint: "exact-fingerprint",
      files: [{ path: "SKILL.md", storageId: "_storage:skill", size: 10, sha256: "sha" }],
      skillInsertArgs: {
        staticScan: { status: "clean" },
      },
      createdAt: Date.now(),
    };
    const analysis = {
      checkedAt: Date.now(),
      confidence: "high",
      status: "suspicious",
      summary: "Completed exact-artifact review.",
      verdict: "suspicious",
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async (id: string) =>
          id === "skillVersions:reusable"
            ? { fingerprint: "exact-fingerprint", llmAnalysis: analysis }
            : null,
        ),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [attempt]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimPendingChecksHandler(ctx, { claimId: "checks:claim" }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:reusable",
      existingClawscanAnalysis: analysis,
    });
  });

  it("hydrates staged package attempts with ClawPack URL and review context", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "worker-token";
    const ctx = {
      runMutation: vi.fn(async () => ({
        attemptId: "publishAttempts:demo-package",
        claimId: "claim-1",
        kind: "package",
        userId: "users:publisher",
        ownerUserId: "users:publisher",
        slug: "@demo/plugin",
        displayName: "Demo Plugin",
        version: "1.0.0",
        artifactFingerprint: "fingerprint",
        files: [
          {
            path: "package.json",
            size: 10,
            storageId: "_storage:manifest",
            sha256: "manifest-sha",
          },
        ],
        clawpackStorageId: "_storage:clawpack",
        scanContext: {
          trustedOpenClawPlugin: true,
          release: {
            artifactKind: "npm-pack",
            pluginManifestSummary: { bundledSkills: [{ rootPath: "skills/demo" }] },
            staticScan: { status: "clean" },
          },
        },
        checkClaimExpiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      })),
      storage: {
        getUrl: vi.fn(async (storageId: string) => `https://signed.example.invalid/${storageId}`),
      },
    };

    try {
      await expect(
        claimPrePublicationChecksHandler(ctx, { token: "worker-token" }),
      ).resolves.toMatchObject({
        attemptId: "publishAttempts:demo-package",
        files: [
          expect.objectContaining({
            path: "package.json",
            url: "https://signed.example.invalid/_storage:manifest",
          }),
        ],
        clawpackUrl: "https://signed.example.invalid/_storage:clawpack",
        scanContext: {
          trustedOpenClawPlugin: true,
          release: {
            artifactKind: "npm-pack",
            pluginManifestSummary: { bundledSkills: [{ rootPath: "skills/demo" }] },
          },
        },
      });
    } finally {
      if (previousToken === undefined) delete process.env.SECURITY_SCAN_WORKER_TOKEN;
      else process.env.SECURITY_SCAN_WORKER_TOKEN = previousToken;
    }

    expect(ctx.storage.getUrl).toHaveBeenCalledWith("_storage:manifest");
    expect(ctx.storage.getUrl).toHaveBeenCalledWith("_storage:clawpack");
  });

  it("prioritizes ready-to-finalize attempts over pending scanner work", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "worker-token";
    const ctx = {
      runMutation: vi.fn().mockResolvedValueOnce({
        attemptId: "publishAttempts:ready",
        status: "ready_to_finalize",
        claimId: "claim-1",
        kind: "skill",
        userId: "users:publisher",
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.0.0",
        artifactFingerprint: "fingerprint",
        files: [],
        checkClaimExpiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
      storage: {
        getUrl: vi.fn(),
      },
    };

    try {
      await expect(
        claimPrePublicationChecksHandler(ctx, { token: "worker-token" }),
      ).resolves.toMatchObject({
        attemptId: "publishAttempts:ready",
        status: "ready_to_finalize",
        files: [],
      });
    } finally {
      if (previousToken === undefined) delete process.env.SECURITY_SCAN_WORKER_TOKEN;
      else process.env.SECURITY_SCAN_WORKER_TOKEN = previousToken;
    }

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(
      getFunctionName(ctx.runMutation.mock.calls[0]?.[0] as Parameters<typeof getFunctionName>[0]),
    ).toBe("publishAttempts:claimReadyPublishAttemptFinalizationRetryInternal");
    expect(ctx.storage.getUrl).not.toHaveBeenCalled();
  });

  it("lets targeted pending attempts fall through the ready-finalization lookup", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:pending",
          status: "pending_checks",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimReadyFinalizationHandler(ctx, {
        attemptId: "publishAttempts:pending",
        claimId: "claim-1",
      }),
    ).resolves.toBeNull();
  });

  it("skips ready-to-finalize attempts with an active retry lease", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [
                {
                  _id: "publishAttempts:ready",
                  status: "ready_to_finalize",
                  checkClaimId: "existing-claim",
                  checkClaimExpiresAt: Date.now() + 60_000,
                },
              ]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimReadyFinalizationHandler(ctx, {
        claimId: "new-claim",
      }),
    ).resolves.toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("terminalizes orphaned ready attempts and claims healthy work behind them", async () => {
    const orphan = {
      _id: "publishAttempts:orphan-package",
      kind: "package",
      status: "ready_to_finalize",
      packageReleaseId: "packageReleases:deleted",
      slug: "@demo/deleted",
      version: "1.0.0",
      createdAt: Date.now(),
    };
    const healthy = {
      ...orphan,
      _id: "publishAttempts:healthy-package",
      packageReleaseId: "packageReleases:healthy",
      slug: "@demo/healthy",
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async (id: string) =>
          id === "packageReleases:deleted" ? { _id: id, softDeletedAt: Date.now() } : { _id: id },
        ),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [orphan, healthy]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimReadyFinalizationHandler(ctx, { claimId: "finalize:claim" }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:healthy-package",
      slug: "@demo/healthy",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:orphan-package",
      expect.objectContaining({
        status: "failed",
        finalizationClaimId: undefined,
        finalizationLastError: "Pending package release not found",
        failedAt: expect.any(Number),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:healthy-package",
      expect.objectContaining({ checkClaimId: "finalize:claim" }),
    );
  });

  it("treats targeted attempts terminalized by the ready queue as drained", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:orphan-package",
          kind: "package",
          status: "failed",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimPendingChecksHandler(ctx, {
        attemptId: "publishAttempts:orphan-package",
        claimId: "finalize:claim",
      }),
    ).resolves.toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects targeted ready-finalization claims with mismatched filters", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:ready",
          status: "ready_to_finalize",
          kind: "skill",
          slug: "expected-skill",
          version: "1.0.0",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      claimReadyFinalizationHandler(ctx, {
        attemptId: "publishAttempts:ready",
        claimId: "claim-1",
        slug: "different-skill",
      }),
    ).rejects.toThrow("Publish attempt slug does not match worker claim.");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("lets worker completion retries reclaim expired finalization leases", async () => {
    const now = Date.now();
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "skill",
          status: "finalizing",
          artifactFingerprint: "fingerprint",
          finalizationClaimExpiresAt: now - 1,
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "clean" },
        clawscan: { status: "clean" },
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:demo",
      kind: "skill",
      status: "ready_to_finalize",
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("keeps scanner execution failures fail-closed and retryable", async () => {
    const now = Date.now();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "skill",
          status: "pending_checks",
          artifactFingerprint: "fingerprint",
          checkClaimId: "checks:claim",
          checkClaimExpiresAt: now + 60_000,
          checks: {
            trufflehog: { status: "pending" },
            clawscan: { status: "pending" },
          },
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "failed", summary: "scanner unavailable" },
        clawscan: { status: "failed", summary: "scanner unavailable" },
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:demo",
      kind: "skill",
      status: "pending_checks",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "pending_checks",
        checkClaimId: undefined,
        checkClaimedAt: undefined,
        checkClaimExpiresAt: expect.any(Number),
        checkClaimLastError: "scanner unavailable",
        failedAt: undefined,
      }),
    );
    const patch = ctx.db.patch.mock.calls[0]?.[1] as { checkClaimExpiresAt: number };
    expect(patch.checkClaimExpiresAt).toBeGreaterThan(now);
  });

  it("terminalizes an attempt when its staged target disappears during scanning", async () => {
    const now = Date.now();
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishAttempts:orphan"
            ? {
                _id: "publishAttempts:orphan",
                kind: "skill",
                status: "pending_checks",
                skillVersionId: "skillVersions:deleted",
                artifactFingerprint: "fingerprint",
                checkClaimId: "checks:claim",
                checkClaimExpiresAt: now + 60_000,
                checks: {
                  trufflehog: { status: "pending" },
                  clawscan: { status: "pending" },
                },
              }
            : null,
        ),
        patch: vi.fn(async (id: string) => {
          if (id === "skillVersions:deleted") {
            throw new Error("Update on nonexistent document ID skillVersions:deleted");
          }
        }),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:orphan",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "clean" },
        clawscan: { status: "clean" },
        clawscanAnalysis: {
          status: "clean",
          verdict: "benign",
          checkedAt: now,
        },
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:orphan",
      kind: "skill",
      status: "failed",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:orphan",
      expect.objectContaining({
        status: "failed",
        checkClaimLastError: "Pending skill version not found.",
        failedAt: expect.any(Number),
      }),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith("skillVersions:deleted", expect.anything());
  });

  it("terminalizes duplicate skill versions instead of retrying finalization", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "skill",
          status: "finalizing",
          skillInsertArgs: { slug: "demo-skill", version: "1.0.0" },
          followup: {},
          finalizationClaimId: "finalize:claim",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };
    const error =
      "Uncaught ConvexError: Version 1.0.0 already exists. Increment the version number and try again.";

    await expect(
      releaseSkillFinalizationHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "finalize:claim",
        error,
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:demo", status: "failed" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "failed",
        checkClaimId: undefined,
        finalizationClaimId: undefined,
        finalizationLastError: error,
        failedAt: expect.any(Number),
      }),
    );
  });

  it("terminalizes ambiguous legacy fork slugs instead of retrying finalization", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:ambiguous-fork",
          kind: "skill",
          status: "finalizing",
          skillInsertArgs: {
            slug: "demo-skill",
            version: "1.0.0",
            forkOf: { slug: "shared-upstream" },
          },
          followup: {},
          finalizationClaimId: "finalize:claim",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };
    const error =
      "Uncaught ConvexError: Slug is used by multiple publishers. Use an owner-qualified skill URL.";

    await expect(
      releaseSkillFinalizationHandler(ctx, {
        attemptId: "publishAttempts:ambiguous-fork",
        claimId: "finalize:claim",
        error,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:ambiguous-fork",
      status: "failed",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:ambiguous-fork",
      expect.objectContaining({
        status: "failed",
        checkClaimId: undefined,
        finalizationClaimId: undefined,
        finalizationLastError: error,
        failedAt: expect.any(Number),
      }),
    );
  });

  it.each([
    [
      "redirected legacy slugs",
      "Uncaught ConvexError: Slug redirects to an existing skill. Choose a different slug. Existing skill: /orchune/personal-finance",
    ],
    ["deleted fork sources", "Uncaught ConvexError: Upstream skill not found"],
    ["deleted staged versions", "Uncaught ConvexError: Pending skill version not found."],
  ])("terminalizes %s instead of retrying finalization", async (_caseName, error) => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:legacy-fork",
          kind: "skill",
          status: "finalizing",
          skillInsertArgs: {
            slug: "demo-skill",
            version: "1.0.0",
            forkOf: { slug: "legacy-upstream" },
          },
          followup: {},
          finalizationClaimId: "finalize:claim",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      releaseSkillFinalizationHandler(ctx, {
        attemptId: "publishAttempts:legacy-fork",
        claimId: "finalize:claim",
        error,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:legacy-fork",
      status: "failed",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:legacy-fork",
      expect.objectContaining({
        status: "failed",
        checkClaimId: undefined,
        finalizationClaimId: undefined,
        finalizationLastError: error,
        failedAt: expect.any(Number),
      }),
    );
  });

  it("terminalizes duplicate package versions while preserving transient retries", async () => {
    const duplicateCtx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo-package",
          kind: "package",
          status: "finalizing",
          packageInsertArgs: { name: "@demo/plugin", version: "1.0.0" },
          finalizationClaimId: "finalize:claim",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };
    const duplicateError =
      "Version 1.0.0 already exists. Increment the version number and try again.";

    await expect(
      releasePackageFinalizationHandler(duplicateCtx, {
        attemptId: "publishAttempts:demo-package",
        claimId: "finalize:claim",
        error: duplicateError,
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:demo-package", status: "failed" });

    const transientCtx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:retry",
          kind: "skill",
          status: "finalizing",
          skillInsertArgs: { slug: "demo-skill", version: "1.0.1" },
          followup: {},
          finalizationClaimId: "finalize:retry",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    await expect(
      releaseSkillFinalizationHandler(transientCtx, {
        attemptId: "publishAttempts:retry",
        claimId: "finalize:retry",
        error: "Rate limit exceeded",
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:retry", status: "ready_to_finalize" });
    expect(transientCtx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:retry",
      expect.objectContaining({
        status: "ready_to_finalize",
        finalizationLastError: "Rate limit exceeded",
      }),
    );
    expect(transientCtx.db.patch.mock.calls[0]?.[1]).not.toHaveProperty("failedAt");
  });

  it("terminalizes deleted package releases instead of retrying finalization", async () => {
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: "publishAttempts:orphan-package",
          kind: "package",
          status: "finalizing",
          packageReleaseId: "packageReleases:deleted",
          finalizationClaimId: "finalize:claim",
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };
    const error = "Uncaught ConvexError: Pending package release not found";

    await expect(
      releasePackageFinalizationHandler(ctx, {
        attemptId: "publishAttempts:orphan-package",
        claimId: "finalize:claim",
        error,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:orphan-package",
      status: "failed",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:orphan-package",
      expect.objectContaining({
        status: "failed",
        finalizationLastError: error,
        failedAt: expect.any(Number),
      }),
    );
  });

  it("clears private pending skill metadata when finalization is recorded", async () => {
    const now = Date.now();
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async (id: string) =>
          id === "publishAttempts:demo"
            ? {
                _id: "publishAttempts:demo",
                kind: "skill",
                status: "finalizing",
                skillVersionId: "skillVersions:pending",
                followup: {},
                finalizationClaimId: "finalize:claim",
                finalizationClaimExpiresAt: now + 60_000,
              }
            : null,
        ),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };
    const result = {
      skillId: "skills:demo",
      versionId: "skillVersions:pending",
      embeddingId: "skillEmbeddings:demo",
      publicationStatus: "published",
    };

    await expect(
      recordSkillFinalizedHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "finalize:claim",
        result,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:demo",
      status: "finalized",
      result,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "finalized",
        result,
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("skillVersions:pending", {
      pendingPublication: undefined,
    });
  });

  it("stores suspicious analysis with the staged insert before finalization", async () => {
    const now = Date.now();
    const llmAnalysis = {
      status: "completed",
      verdict: "suspicious",
      summary: "Review before installing.",
      checkedAt: now,
    };
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "skill",
          status: "pending_checks",
          artifactFingerprint: "fingerprint",
          checkClaimId: "checks:claim",
          checkClaimExpiresAt: now + 60_000,
          skillInsertArgs: {
            slug: "demo-skill",
            version: "1.0.0",
          },
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "clean" },
        clawscan: {
          status: "clean",
          redactedFindings: ["status=completed; verdict=suspicious"],
        },
        clawscanAnalysis: llmAnalysis,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:demo",
      kind: "skill",
      status: "ready_to_finalize",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "ready_to_finalize",
        skillInsertArgs: {
          slug: "demo-skill",
          version: "1.0.0",
          llmAnalysis,
        },
      }),
    );
  });

  it("retains malicious analysis while keeping the staged artifact blocked", async () => {
    const now = Date.now();
    const llmAnalysis = {
      status: "completed",
      verdict: "malicious",
      summary: "Credential theft behavior detected.",
      checkedAt: now,
    };
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "package",
          status: "pending_checks",
          artifactFingerprint: "fingerprint",
          checkClaimId: "checks:claim",
          checkClaimExpiresAt: now + 60_000,
          packageInsertArgs: {
            name: "demo-plugin",
            version: "1.0.0",
          },
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "clean" },
        clawscan: {
          status: "blocked",
          redactedFindings: ["status=completed; verdict=malicious"],
        },
        clawscanAnalysis: llmAnalysis,
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:demo",
      kind: "package",
      status: "blocked",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "blocked",
        packageInsertArgs: {
          name: "demo-plugin",
          version: "1.0.0",
          llmAnalysis,
        },
      }),
    );
    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it("emails the publisher when TruffleHog blocks a staged publish", async () => {
    const ctx = {
      db: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "publishAttempts:demo",
            kind: "skill",
            status: "pending_checks",
            userId: "users:publisher",
            skillId: "skills:secret",
            skillVersionId: "skillVersions:secret",
            createdNewParent: true,
            slug: "secret-skill",
            version: "1.0.0",
            artifactFingerprint: "fingerprint",
            checkClaimId: "checks:claim",
            checkClaimExpiresAt: Date.now() + 60_000,
            files: [{ storageId: "_storage:secret-skill" }],
          })
          .mockResolvedValueOnce({
            _id: "skills:secret",
            latestVersionId: undefined,
          })
          .mockResolvedValueOnce({
            _id: "users:publisher",
            handle: "publisher",
            email: "publisher@example.com",
          }),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "skillVersionFingerprints") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => [{ _id: "skillVersionFingerprints:secret" }]),
              })),
            };
          }
          if (table === "skillVersions") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => []),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        normalizeId: vi.fn(),
        system: {},
      },
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: {
          status: "blocked",
          summary: "redacted TruffleHog finding",
          redactedFindings: ["redacted-secret"],
        },
        clawscan: { status: "clean" },
      }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:demo",
      kind: "skill",
      status: "blocked",
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith("_storage:secret-skill");
    expect(ctx.db.delete).toHaveBeenCalledWith("skillVersionFingerprints:secret");
    expect(ctx.db.delete).toHaveBeenCalledWith("skillVersions:secret");
    expect(ctx.db.delete).toHaveBeenCalledWith("skills:secret");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo",
      expect.objectContaining({
        status: "blocked",
        files: [],
        skillInsertArgs: undefined,
        packageInsertArgs: undefined,
        followup: undefined,
        packageFollowup: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      attemptId: "publishAttempts:demo",
      userId: "users:publisher",
      to: "publisher@example.com",
      handle: "publisher",
      artifact: { kind: "skill", name: "secret-skill" },
      version: "1.0.0",
    });
  });

  it("keeps existing skill parents when TruffleHog blocks a pending new version", async () => {
    const ctx = {
      db: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "publishAttempts:demo",
            kind: "skill",
            status: "pending_checks",
            userId: "users:publisher",
            skillId: "skills:existing",
            skillVersionId: "skillVersions:pending",
            createdNewParent: false,
            slug: "existing-skill",
            version: "2.0.0",
            artifactFingerprint: "fingerprint",
            checkClaimId: "checks:claim",
            checkClaimExpiresAt: Date.now() + 60_000,
            files: [{ storageId: "_storage:secret-skill" }],
          })
          .mockResolvedValueOnce({
            _id: "users:publisher",
            handle: "publisher",
            email: "publisher@example.com",
          }),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "skillVersionFingerprints") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => [{ _id: "skillVersionFingerprints:pending" }]),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        normalizeId: vi.fn(),
        system: {},
      },
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: {
          status: "blocked",
          summary: "redacted TruffleHog finding",
          redactedFindings: ["redacted-secret"],
        },
        clawscan: { status: "clean" },
      }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:demo",
      kind: "skill",
      status: "blocked",
    });

    expect(ctx.db.delete).toHaveBeenCalledWith("skillVersionFingerprints:pending");
    expect(ctx.db.delete).toHaveBeenCalledWith("skillVersions:pending");
    expect(ctx.db.delete).not.toHaveBeenCalledWith("skills:existing");
  });

  it("keeps TruffleHog-positive attempts pending when secret storage deletion fails", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishAttempts:demo",
          kind: "skill",
          status: "pending_checks",
          userId: "users:publisher",
          slug: "secret-skill",
          version: "1.0.0",
          artifactFingerprint: "fingerprint",
          checkClaimId: "checks:claim",
          checkClaimExpiresAt: Date.now() + 60_000,
          files: [{ storageId: "_storage:secret-skill" }],
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        delete: vi.fn(async () => {
          throw new Error("storage unavailable");
        }),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: {
          status: "blocked",
          summary: "redacted TruffleHog finding",
          redactedFindings: ["redacted-secret"],
        },
        clawscan: { status: "clean" },
      }),
    ).rejects.toThrow("storage unavailable");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("deletes package artifacts when TruffleHog blocks a staged package publish", async () => {
    const ctx = {
      db: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "publishAttempts:demo-package",
            kind: "package",
            status: "pending_checks",
            userId: "users:publisher",
            slug: "@demo/plugin",
            version: "1.0.0",
            artifactFingerprint: "fingerprint",
            checkClaimId: "checks:claim",
            checkClaimExpiresAt: Date.now() + 60_000,
            files: [{ storageId: "_storage:manifest" }, { storageId: "_storage:artifact" }],
            packageInsertArgs: { clawpackStorageId: "_storage:artifact" },
          })
          .mockResolvedValueOnce({
            _id: "users:publisher",
            handle: "publisher",
            email: "publisher@example.com",
          }),
        patch: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        normalizeId: vi.fn(),
        system: {},
      },
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        delete: vi.fn(),
      },
    };

    await expect(
      completePendingChecksHandler(ctx, {
        attemptId: "publishAttempts:demo-package",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: {
          status: "blocked",
          summary: "redacted TruffleHog finding",
          redactedFindings: ["redacted-secret"],
        },
        clawscan: { status: "clean" },
      }),
    ).resolves.toMatchObject({
      attemptId: "publishAttempts:demo-package",
      kind: "package",
      status: "blocked",
    });

    expect(ctx.storage.delete).toHaveBeenCalledTimes(2);
    expect(ctx.storage.delete).toHaveBeenCalledWith("_storage:manifest");
    expect(ctx.storage.delete).toHaveBeenCalledWith("_storage:artifact");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:demo-package",
      expect.objectContaining({
        status: "blocked",
        files: [],
        skillInsertArgs: undefined,
        packageInsertArgs: undefined,
        followup: undefined,
        packageFollowup: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      attemptId: "publishAttempts:demo-package",
      userId: "users:publisher",
      to: "publisher@example.com",
      handle: "publisher",
      artifact: { kind: "plugin", name: "@demo/plugin" },
      version: "1.0.0",
    });
  });
});
