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
});
