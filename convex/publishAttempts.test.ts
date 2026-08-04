import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import {
  claimPendingPublishAttemptChecksInternal,
  claimPrePublicationChecks,
  claimReadyPublishAttemptFinalizationRetryInternal,
  closeOrphanedSkillPublishAttemptInternal,
  completePendingPublishAttemptChecksInternal,
  createPackagePublishAttemptInternal,
  createSkillPublishAttemptInternal,
  findActiveSkillPublishAttemptByIdInternal,
  findActiveSkillPublishAttemptInternal,
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
const createSkillPublishAttemptHandler = (
  createSkillPublishAttemptInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const createPackagePublishAttemptHandler = (
  createPackagePublishAttemptInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const findActiveSkillPublishAttemptHandler = (
  findActiveSkillPublishAttemptInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const findActiveSkillPublishAttemptByIdHandler = (
  findActiveSkillPublishAttemptByIdInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const closeOrphanedSkillPublishAttemptHandler = (
  closeOrphanedSkillPublishAttemptInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;

describe("publishAttempts", () => {
  it("schedules exact dispatch for fresh skill attempts", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
    const runAfter = vi.fn();
    const insert = vi.fn(async () => "publishAttempts:fresh");
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(),
        insert,
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => []),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
      scheduler: { runAfter },
    };

    try {
      await expect(
        createSkillPublishAttemptHandler(ctx, {
          userId: "users:publisher",
          skillId: "skills:demo",
          skillVersionId: "skillVersions:demo",
          slug: "demo",
          displayName: "Demo",
          version: "1.0.0",
          idempotencyKey: "skill:demo",
          artifactFingerprint: "fingerprint",
          files: [],
          followup: {},
        }),
      ).resolves.toMatchObject({
        attemptId: "publishAttempts:fresh",
        status: "pending_checks",
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      attemptId: "publishAttempts:fresh",
      retryCount: 0,
    });
  });

  it("redispatches pending idempotent package attempts", async () => {
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
    const runAfter = vi.fn();
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
                  _id: "publishAttempts:existing",
                  status: "pending_checks",
                  result: undefined,
                },
              ]),
            })),
          })),
        })),
        replace: vi.fn(),
        system: {},
      },
      scheduler: { runAfter },
    };

    try {
      await expect(
        createPackagePublishAttemptHandler(ctx, {
          userId: "users:publisher",
          ownerUserId: "users:publisher",
          packageId: "packages:demo",
          packageReleaseId: "packageReleases:demo",
          name: "@openclaw/demo",
          displayName: "Demo",
          version: "1.0.0",
          idempotencyKey: "package:demo",
          artifactFingerprint: "fingerprint",
          files: [],
          packageFollowup: {},
        }),
      ).resolves.toEqual({
        attemptId: "publishAttempts:existing",
        status: "pending_checks",
        result: undefined,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      attemptId: "publishAttempts:existing",
      retryCount: 0,
    });
  });

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

  it("uses reserved claims for expired pending-check retries before finalization work", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "worker-token";
    const retry = {
      attemptId: "publishAttempts:retry",
      status: "pending_checks",
      claimId: "claim-1",
      kind: "skill",
      userId: "users:publisher",
      slug: "retry-skill",
      displayName: "Retry Skill",
      version: "1.0.0",
      artifactFingerprint: "fingerprint",
      files: [],
      checkClaimExpiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    };
    const ctx = {
      runMutation: vi.fn(async (ref: Parameters<typeof getFunctionName>[0], _args?: unknown) => {
        const name = getFunctionName(ref);
        return name === "publishAttempts:claimPendingPublishAttemptChecksInternal"
          ? retry
          : { ...retry, attemptId: "publishAttempts:ready", status: "ready_to_finalize" };
      }),
      storage: {
        getUrl: vi.fn(),
      },
    };

    try {
      await expect(
        claimPrePublicationChecksHandler(ctx, {
          token: "worker-token",
          preferRetry: true,
        }),
      ).resolves.toMatchObject({
        attemptId: "publishAttempts:retry",
        status: "pending_checks",
      });
    } finally {
      if (previousToken === undefined) delete process.env.SECURITY_SCAN_WORKER_TOKEN;
      else process.env.SECURITY_SCAN_WORKER_TOKEN = previousToken;
    }

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(
      getFunctionName(ctx.runMutation.mock.calls[0]?.[0] as Parameters<typeof getFunctionName>[0]),
    ).toBe("publishAttempts:claimPendingPublishAttemptChecksInternal");
    expect(ctx.runMutation.mock.calls[0]?.[1]).toMatchObject({ retryOnly: true });
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
        checkFailureCount: 1,
        failedAt: undefined,
      }),
    );
    const patch = ctx.db.patch.mock.calls[0]?.[1] as { checkClaimExpiresAt: number };
    expect(patch.checkClaimExpiresAt).toBeGreaterThan(now);
  });

  it("terminalizes an attempt after three consecutive scanner execution failures", async () => {
    const now = Date.now();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishAttempts:poison",
          kind: "skill",
          status: "pending_checks",
          artifactFingerprint: "fingerprint",
          checkClaimId: "checks:claim",
          checkClaimExpiresAt: now + 60_000,
          checkFailureCount: 2,
          checks: {
            trufflehog: { status: "clean", checkedAt: now - 300_000 },
            clawscan: {
              status: "failed",
              checkedAt: now - 300_000,
              summary: "ClawScan scanner did not complete: skillspector=failed",
            },
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
        attemptId: "publishAttempts:poison",
        claimId: "checks:claim",
        artifactFingerprint: "fingerprint",
        trufflehog: { status: "clean" },
        clawscan: {
          status: "failed",
          summary: "ClawScan scanner did not complete: skillspector=failed",
        },
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:poison",
      kind: "skill",
      status: "failed",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "publishAttempts:poison",
      expect.objectContaining({
        status: "failed",
        checkFailureCount: 3,
        checkClaimExpiresAt: undefined,
        checkClaimLastError: "ClawScan scanner did not complete: skillspector=failed",
        failedAt: expect.any(Number),
      }),
    );
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

  it("caps consecutive transient finalization failures instead of retrying forever (#3349)", async () => {
    const attemptId = "publishAttempts:looping";
    const makeCtx = (finalizationFailureCount: number | undefined) => ({
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: attemptId,
          kind: "skill",
          status: "finalizing",
          skillInsertArgs: { slug: "looping-skill", version: "1.0.0" },
          followup: {},
          finalizationClaimId: "finalize:claim",
          finalizationFailureCount,
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    });

    // Four consecutive transient failures stay below the cap and keep the
    // attempt retriable.
    for (let previousCount = 0; previousCount < 4; previousCount += 1) {
      const ctx = makeCtx(previousCount === 0 ? undefined : previousCount);
      await expect(
        releaseSkillFinalizationHandler(ctx, {
          attemptId,
          claimId: "finalize:claim",
          error: "Rate limit exceeded",
        }),
      ).resolves.toEqual({ attemptId, status: "ready_to_finalize" });
      expect(ctx.db.patch).toHaveBeenCalledWith(
        attemptId,
        expect.objectContaining({
          status: "ready_to_finalize",
          finalizationFailureCount: previousCount + 1,
        }),
      );
    }

    // The 5th consecutive transient failure hits
    // MAX_CONSECUTIVE_FINALIZATION_FAILURES and terminalizes the attempt so it
    // stops looping forever and surfaces as failed instead of leaving the
    // skillVersion silently pending (#3349).
    const cappedCtx = makeCtx(4);
    await expect(
      releaseSkillFinalizationHandler(cappedCtx, {
        attemptId,
        claimId: "finalize:claim",
        error: "Rate limit exceeded",
      }),
    ).resolves.toEqual({ attemptId, status: "failed" });
    expect(cappedCtx.db.patch).toHaveBeenCalledWith(
      attemptId,
      expect.objectContaining({
        status: "failed",
        finalizationClaimId: undefined,
        finalizationLastError: "Rate limit exceeded",
        finalizationFailureCount: 5,
        failedAt: expect.any(Number),
      }),
    );
  });

  it("keeps retrying package finalization past the skill cap since there is no package repair path yet (#3401)", async () => {
    // Finding 1: releaseFinalizationClaimPatch used to terminalize at
    // MAX_CONSECUTIVE_FINALIZATION_FAILURES for both kinds, but a
    // terminalized package attempt has no repair sweep (unlike
    // repairOrphanedPendingSkillVersion for skills), so it would permanently
    // orphan the pending package release. Package finalization must stay
    // retriable past the skill cap until a package repair path exists.
    const attemptId = "publishAttempts:package-looping";
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn(async () => ({
          _id: attemptId,
          kind: "package",
          status: "finalizing",
          packageInsertArgs: { name: "@demo/plugin", version: "1.0.0" },
          packageReleaseId: "packageReleases:demo",
          finalizationClaimId: "finalize:claim",
          finalizationFailureCount: 4,
        })),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        system: {},
      },
    };

    // The 5th consecutive transient failure would terminalize a skill
    // attempt (see the cap test above), but a package attempt must stay
    // "ready_to_finalize" instead of "failed".
    await expect(
      releasePackageFinalizationHandler(ctx, {
        attemptId,
        claimId: "finalize:claim",
        error: "Rate limit exceeded",
      }),
    ).resolves.toEqual({ attemptId, status: "ready_to_finalize" });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      attemptId,
      expect.objectContaining({
        status: "ready_to_finalize",
        finalizationClaimId: undefined,
        finalizationLastError: "Rate limit exceeded",
        finalizationFailureCount: 5,
      }),
    );
    expect(ctx.db.patch.mock.calls[0]?.[1]).not.toHaveProperty("failedAt");
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

  it("finds a live in-flight attempt so #3349 repair does not race a legitimate publish", async () => {
    const now = Date.now();
    const live = {
      _id: "publishAttempts:live",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: now + 60_000,
      checkClaimExpiresAt: 0,
      createdAt: now - 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [live]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:live", status: "ready_to_finalize" });
  });

  it("ignores attempts for a different skillId sharing the same slug+version", async () => {
    const now = Date.now();
    const otherSkillAttempt = {
      _id: "publishAttempts:other-owner",
      skillId: "skills:other",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: now + 60_000,
      checkClaimExpiresAt: 0,
      createdAt: now - 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [otherSkillAttempt]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toBeNull();
  });

  it("treats an old unclaimed attempt as abandoned and does not block repair", async () => {
    const now = Date.now();
    const abandoned = {
      _id: "publishAttempts:abandoned",
      skillId: "skills:demo",
      status: "pending_checks",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 60 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [abandoned]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toBeNull();
  });

  it("treats a below-cap finalization failure with recent activity as still active for dispatcher retry (#3401)", async () => {
    const now = Date.now();
    // Created 5 minutes ago with finalizationFailureCount 2 (below
    // MAX_CONSECUTIVE_FINALIZATION_FAILURES) and updatedAt only 1 minute
    // ago: releaseFinalizationClaimPatch intentionally handed this back to
    // "ready_to_finalize" for the dispatcher to retry. A manual repair must
    // not treat a nonzero failure count alone as abandonment while the
    // attempt is still fresh relative to its last activity (#3401 finding
    // 2) — the old behavior abandoned this immediately, racing the
    // dispatcher's own retry.
    const retryingFinalizer = {
      _id: "publishAttempts:retrying-finalizer",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      finalizationFailureCount: 2,
      createdAt: now - 5 * 60_000,
      updatedAt: now - 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [retryingFinalizer]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:retrying-finalizer",
      status: "ready_to_finalize",
    });
  });

  it("treats a finalization failure as abandoned once it goes stale past the retry window (#3401)", async () => {
    const now = Date.now();
    // Same nonzero finalizationFailureCount as the still-active case above,
    // but updatedAt is well past ACTIVE_ATTEMPT_RETRYABLE_STALE_MS
    // (2x FINALIZATION_CLAIM_LEASE_MS = 20 minutes): nothing has touched
    // this attempt in 25 minutes despite it already failing once, so it is
    // genuinely stuck and must not block manual repair.
    const staleFinalizer = {
      _id: "publishAttempts:stale-finalizer",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      finalizationFailureCount: 2,
      createdAt: now - 30 * 60_000,
      updatedAt: now - 25 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [staleFinalizer]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toBeNull();
  });

  it("still protects pending_checks between scanner retries with nonzero checkFailureCount (#3349)", async () => {
    const now = Date.now();
    // Scanner released the claim and scheduled a retry; checkFailureCount is
    // nonzero but the attempt is still actively pending_checks within grace.
    const betweenScannerRetries = {
      _id: "publishAttempts:scanner-retry",
      skillId: "skills:demo",
      status: "pending_checks",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      checkFailureCount: 2,
      createdAt: now - 5 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [betweenScannerRetries]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:scanner-retry",
      status: "pending_checks",
    });
  });

  it("still protects a genuinely fresh unclaimed attempt with zero failures", async () => {
    const now = Date.now();
    const fresh = {
      _id: "publishAttempts:fresh",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 5 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [fresh]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:fresh", status: "ready_to_finalize" });
  });

  it("treats a zero-failure attempt as active when it recently transitioned status, even if created long ago (#3401)", async () => {
    const now = Date.now();
    // Created an hour ago (well past ACTIVE_ATTEMPT_UNCLAIMED_GRACE_MS from
    // createdAt alone) but updatedAt is only 2 minutes ago: a long-running
    // pending_checks phase just moved cleanly to ready_to_finalize with zero
    // failures. Using createdAt alone here would wrongly call this abandoned
    // while the dispatcher still actively owns it, racing manual repair
    // against a live finalize attempt.
    const recentlyTransitioned = {
      _id: "publishAttempts:recently-transitioned",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 60 * 60_000,
      updatedAt: now - 2 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [recentlyTransitioned]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:recently-transitioned",
      status: "ready_to_finalize",
    });
  });

  it("treats a zero-failure attempt as abandoned once both createdAt and updatedAt go stale", async () => {
    const now = Date.now();
    // Created an hour ago and last updated 45 minutes ago (past
    // ACTIVE_ATTEMPT_UNCLAIMED_GRACE_MS from updatedAt too): genuinely
    // abandoned, not merely old, so manual repair must still proceed.
    const staleTransitioned = {
      _id: "publishAttempts:stale-transitioned",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 60 * 60_000,
      updatedAt: now - 45 * 60_000,
    };
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(async () => [staleTransitioned]),
            })),
          })),
        })),
      },
    };

    await expect(
      findActiveSkillPublishAttemptHandler(ctx, {
        skillId: "skills:demo",
        slug: "demo-skill",
        version: "1.0.0",
      }),
    ).resolves.toBeNull();
  });
});

describe("findActiveSkillPublishAttemptByIdInternal (#3401)", () => {
  it("returns the attempt when it is live and owned by the given skill", async () => {
    const now = Date.now();
    const attempt = {
      _id: "publishAttempts:by-id",
      kind: "skill",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: now + 60_000,
      checkClaimExpiresAt: 0,
      createdAt: now - 60_000,
    };
    const ctx = { db: { get: vi.fn(async () => attempt) } };

    await expect(
      findActiveSkillPublishAttemptByIdHandler(ctx, {
        attemptId: "publishAttempts:by-id",
        skillId: "skills:demo",
      }),
    ).resolves.toEqual({ attemptId: "publishAttempts:by-id", status: "ready_to_finalize" });
  });

  it("returns null when the attempt belongs to a different skill", async () => {
    const now = Date.now();
    const attempt = {
      _id: "publishAttempts:mismatched",
      kind: "skill",
      skillId: "skills:other",
      status: "ready_to_finalize",
      finalizationClaimExpiresAt: now + 60_000,
      checkClaimExpiresAt: 0,
      createdAt: now - 60_000,
    };
    const ctx = { db: { get: vi.fn(async () => attempt) } };

    await expect(
      findActiveSkillPublishAttemptByIdHandler(ctx, {
        attemptId: "publishAttempts:mismatched",
        skillId: "skills:demo",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the attempt is already terminal", async () => {
    const attempt = {
      _id: "publishAttempts:terminal",
      kind: "skill",
      skillId: "skills:demo",
      status: "failed",
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: Date.now() - 60_000,
    };
    const ctx = { db: { get: vi.fn(async () => attempt) } };

    await expect(
      findActiveSkillPublishAttemptByIdHandler(ctx, {
        attemptId: "publishAttempts:terminal",
        skillId: "skills:demo",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the attempt is non-terminal but stale (no live claim, past retry window)", async () => {
    const now = Date.now();
    const attempt = {
      _id: "publishAttempts:stale",
      kind: "skill",
      skillId: "skills:demo",
      status: "ready_to_finalize",
      finalizationFailureCount: 3,
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 60 * 60_000,
      updatedAt: now - 60 * 60_000,
    };
    const ctx = { db: { get: vi.fn(async () => attempt) } };

    await expect(
      findActiveSkillPublishAttemptByIdHandler(ctx, {
        attemptId: "publishAttempts:stale",
        skillId: "skills:demo",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the attempt does not exist", async () => {
    const ctx = { db: { get: vi.fn(async () => null) } };

    await expect(
      findActiveSkillPublishAttemptByIdHandler(ctx, {
        attemptId: "publishAttempts:missing",
        skillId: "skills:demo",
      }),
    ).resolves.toBeNull();
  });
});

describe("closeOrphanedSkillPublishAttemptInternal (#3349)", () => {
  const result = {
    skillId: "skills:1",
    versionId: "skillVersions:1",
    embeddingId: "skillEmbeddings:1",
    publicationStatus: "published" as const,
  };

  it("force-finalizes a dead non-terminal attempt so the dispatcher can't reclaim it", async () => {
    const now = Date.now();
    const attempt = {
      _id: "publishAttempts:orphaned",
      kind: "skill",
      skillVersionId: "skillVersions:1",
      status: "ready_to_finalize",
      finalizationFailureCount: 5,
      finalizationClaimExpiresAt: 0,
      checkClaimExpiresAt: 0,
      createdAt: now - 60 * 60_000,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => attempt),
        normalizeId: vi.fn(),
        query: vi.fn(),
        patch,
      },
    };

    await expect(
      closeOrphanedSkillPublishAttemptHandler(ctx, {
        attemptId: "publishAttempts:orphaned",
        result,
      }),
    ).resolves.toEqual({ closed: true });

    expect(patch).toHaveBeenCalledWith(
      "publishAttempts:orphaned",
      expect.objectContaining({ status: "finalized", result }),
    );
    expect(patch).toHaveBeenCalledWith("skillVersions:1", { pendingPublication: undefined });
  });

  it("does not touch an attempt a live worker still claims", async () => {
    const now = Date.now();
    const attempt = {
      _id: "publishAttempts:live",
      kind: "skill",
      skillVersionId: "skillVersions:1",
      status: "finalizing",
      finalizationClaimExpiresAt: now + 60_000,
      checkClaimExpiresAt: 0,
      createdAt: now - 60_000,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => attempt),
        normalizeId: vi.fn(),
        query: vi.fn(),
        patch,
      },
    };

    await expect(
      closeOrphanedSkillPublishAttemptHandler(ctx, {
        attemptId: "publishAttempts:live",
        result,
      }),
    ).resolves.toEqual({ closed: false, reason: "claim-active" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("no-ops on an attempt that already reached a terminal status", async () => {
    const attempt = {
      _id: "publishAttempts:done",
      kind: "skill",
      status: "finalized",
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => attempt),
        normalizeId: vi.fn(),
        query: vi.fn(),
        patch,
      },
    };

    await expect(
      closeOrphanedSkillPublishAttemptHandler(ctx, {
        attemptId: "publishAttempts:done",
        result,
      }),
    ).resolves.toEqual({ closed: false, reason: "already-terminal", status: "finalized" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("no-ops when the attempt no longer exists", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => null),
        normalizeId: vi.fn(),
        query: vi.fn(),
        patch,
      },
    };

    await expect(
      closeOrphanedSkillPublishAttemptHandler(ctx, {
        attemptId: "publishAttempts:missing",
        result,
      }),
    ).resolves.toEqual({ closed: false, reason: "not-found" });
    expect(patch).not.toHaveBeenCalled();
  });
});
