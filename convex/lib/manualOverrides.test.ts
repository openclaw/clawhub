import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { applyManualOverrideToSkillPatch, isManualOverrideReason } from "./manualOverrides";

function userId(value: string) {
  return value as Id<"users">;
}

describe("manualOverrides", () => {
  it("detects manual override reasons", () => {
    expect(isManualOverrideReason("manual.override.clean")).toBe(true);
    expect(isManualOverrideReason("scanner.vt.suspicious")).toBe(false);
    expect(isManualOverrideReason(undefined)).toBe(false);
  });

  it("applies a clean override as non-suspicious active skill state", () => {
    const now = 1_700_000_000_000;
    const patch = applyManualOverrideToSkillPatch({
      basePatch: {
        moderationReasonCodes: ["suspicious.dynamic_code_execution"],
      },
      override: {
        verdict: "clean",
        note: "security tool false positive",
        reviewerUserId: userId("users:reviewer"),
        updatedAt: now,
      },
      now,
    });

    expect(patch).toMatchObject({
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationFlags: undefined,
      moderationSummary: "Manual override (clean): security tool false positive",
      moderationEvaluatedAt: now,
      isSuspicious: false,
      updatedAt: now,
    });
    expect(patch.moderationReasonCodes).toEqual(["suspicious.dynamic_code_execution"]);
  });

  it("preserves malicious scanner state over a clean override", () => {
    const now = 1_700_000_100_000;
    const patch = applyManualOverrideToSkillPatch({
      basePatch: {
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
        moderationSummary: "Detected: malicious.known_blocked_signature",
        hiddenAt: now,
        hiddenBy: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      },
      override: {
        verdict: "clean",
        note: "earlier false positive review",
        reviewerUserId: userId("users:reviewer"),
        updatedAt: now,
      },
      now,
    });

    expect(patch).toMatchObject({
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.malicious",
      moderationVerdict: "malicious",
      moderationFlags: ["blocked.malware"],
      hiddenAt: now,
      lastReviewedAt: now,
      updatedAt: now,
    });
  });

  it("preserves non-scanner hidden locks over a clean override", () => {
    const now = 1_700_000_200_000;
    const patch = applyManualOverrideToSkillPatch({
      basePatch: {
        moderationStatus: "hidden",
        moderationReason: "quality.low",
        moderationVerdict: "clean",
        moderationFlags: undefined,
        moderationSummary: "Auto-quarantined by quality gate.",
        updatedAt: now,
      },
      override: {
        verdict: "clean",
        note: "older suspicious finding was reviewed",
        reviewerUserId: userId("users:reviewer"),
        updatedAt: now,
      },
      now,
    });

    expect(patch).toMatchObject({
      moderationStatus: "hidden",
      moderationReason: "quality.low",
      moderationVerdict: "clean",
      moderationSummary: "Auto-quarantined by quality gate.",
      updatedAt: now,
    });
  });
});
