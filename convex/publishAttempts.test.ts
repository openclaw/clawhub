import { describe, expect, it, vi } from "vitest";
import {
  claimPendingPublishAttemptChecksInternal,
  claimPrePublicationChecks,
  completePendingPublishAttemptChecksInternal,
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
const claimPrePublicationChecksHandler = (
  claimPrePublicationChecks as unknown as {
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

  it("claims ready-to-finalize attempts for idempotent finalization retry", async () => {
    const previousToken = process.env.SECURITY_SCAN_WORKER_TOKEN;
    process.env.SECURITY_SCAN_WORKER_TOKEN = "worker-token";
    const ctx = {
      runMutation: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
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

    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
    expect(ctx.storage.getUrl).not.toHaveBeenCalled();
  });

  it("lets worker completion retries reclaim expired finalization leases", async () => {
    const now = Date.now();
    const ctx = {
      db: {
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
            slug: "secret-skill",
            version: "1.0.0",
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
