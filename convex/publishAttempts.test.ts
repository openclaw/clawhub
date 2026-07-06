import { describe, expect, it, vi } from "vitest";
import { completePendingPublishAttemptChecksInternal } from "./publishAttempts";

const completePendingChecksHandler = (
  completePendingPublishAttemptChecksInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;

describe("publishAttempts", () => {
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
