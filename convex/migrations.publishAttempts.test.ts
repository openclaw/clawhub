import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildSuspiciousPublishAttemptRecoveryPatch,
  hasStoredSuspiciousClawscanVerdict,
} from "./migrations";

function suspiciousAttempt(
  overrides: Partial<Doc<"publishAttempts">> = {},
): Doc<"publishAttempts"> {
  return {
    _id: "publishAttempts:test" as Id<"publishAttempts">,
    _creationTime: 1,
    kind: "skill",
    status: "blocked",
    userId: "users:test" as Id<"users">,
    slug: "demo-skill",
    displayName: "Demo Skill",
    version: "1.0.0",
    idempotencyKey: "skill:test",
    artifactFingerprint: "fingerprint",
    files: [],
    checks: {
      trufflehog: { status: "clean", checkedAt: 10 },
      clawscan: {
        status: "blocked",
        checkedAt: 11,
        summary: "Review before installing.",
        redactedFindings: ["status=completed; verdict=suspicious"],
      },
    },
    skillInsertArgs: { slug: "demo-skill", version: "1.0.0" },
    createdAt: 1,
    updatedAt: 11,
    expiresAt: 100,
    blockedAt: 11,
    ...overrides,
  };
}

describe("suspicious publish attempt recovery", () => {
  it("selects only TruffleHog-clean attempts blocked by a stored suspicious verdict", () => {
    expect(hasStoredSuspiciousClawscanVerdict(suspiciousAttempt())).toBe(true);
    expect(
      hasStoredSuspiciousClawscanVerdict(
        suspiciousAttempt({
          checks: {
            trufflehog: { status: "clean" },
            clawscan: {
              status: "blocked",
              redactedFindings: ["status=completed; verdict=malicious"],
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it("requeues replayable attempts with suspicious analysis attached atomically", () => {
    const patch = buildSuspiciousPublishAttemptRecoveryPatch(
      suspiciousAttempt(),
      "replay_missing",
      20,
    );

    expect(patch).toMatchObject({
      status: "ready_to_finalize",
      checks: {
        trufflehog: { status: "clean" },
        clawscan: { status: "clean" },
      },
      skillInsertArgs: {
        slug: "demo-skill",
        version: "1.0.0",
        llmAnalysis: {
          status: "completed",
          verdict: "suspicious",
          summary: "Review before installing.",
          checkedAt: 11,
        },
      },
      blockedAt: undefined,
      failedAt: undefined,
      updatedAt: 20,
    });
  });

  it("terminates occupied-version conflicts instead of feeding them back to the worker", () => {
    expect(
      buildSuspiciousPublishAttemptRecoveryPatch(suspiciousAttempt(), "public_conflict", 20),
    ).toMatchObject({
      status: "failed",
      checkClaimLastError:
        "Recovery skipped: this version is already occupied by a different public artifact.",
      blockedAt: undefined,
      failedAt: 20,
      updatedAt: 20,
    });
  });
});
