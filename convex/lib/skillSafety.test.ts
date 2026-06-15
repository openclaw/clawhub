import { describe, expect, it } from "vitest";
import {
  isSoftDeletedSkillEligibleForAdminTransfer,
  isSkillReviewFlagged,
  isSkillSuspicious,
  isSkillTransferBlockedByModeration,
} from "./skillSafety";

describe("isSkillSuspicious", () => {
  it("returns true when suspicious flag is present", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: ["flagged.suspicious"],
        moderationReason: undefined,
      }),
    ).toBe(true);
  });

  it("returns true for scanner suspicious reason", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.suspicious",
      }),
    ).toBe(true);
  });

  it("returns false for clean moderation states", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.clean",
      }),
    ).toBe(false);
  });

  it("keeps review flags out of the hidden suspicious bucket", () => {
    const skill = {
      moderationFlags: ["flagged.review"],
      moderationReason: "scanner.llm.review",
    };

    expect(isSkillSuspicious(skill)).toBe(false);
    expect(isSkillReviewFlagged(skill)).toBe(true);
  });
});

describe("isSkillTransferBlockedByModeration", () => {
  it("blocks scanner malicious reasons even when verdict fields are missing", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: undefined,
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: "scanner.vt.malicious",
        moderationReasonCodes: undefined,
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("blocks legacy hidden skills that only have softDeletedAt", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: undefined,
        moderationVerdict: undefined,
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: undefined,
        moderationReasonCodes: undefined,
        softDeletedAt: 123,
      }),
    ).toBe(true);
  });

  it("allows admins to relocate clean soft-deleted skills without allowing unsafe moderation", () => {
    expect(
      isSoftDeletedSkillEligibleForAdminTransfer({
        moderationStatus: "hidden",
        moderationVerdict: "clean",
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: undefined,
        moderationReasonCodes: undefined,
        softDeletedAt: 123,
      }),
    ).toBe(true);
    expect(
      isSoftDeletedSkillEligibleForAdminTransfer({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: undefined,
        moderationReasonCodes: undefined,
        softDeletedAt: 123,
      }),
    ).toBe(false);
  });

  it("blocks known administrative delete reasons even when the owner performed the action", () => {
    for (const moderationReason of ["owner.merged", "user.banned", "security.redaction"]) {
      expect(
        isSoftDeletedSkillEligibleForAdminTransfer({
          moderationStatus: "hidden",
          moderationVerdict: "clean",
          isSuspicious: false,
          moderationFlags: undefined,
          moderationReason,
          moderationReasonCodes: undefined,
          softDeletedAt: 123,
        }),
      ).toBe(false);
    }
  });

  it("does not treat an ordinary duplicate relationship as merge provenance", () => {
    expect(
      isSoftDeletedSkillEligibleForAdminTransfer({
        moderationStatus: "hidden",
        moderationVerdict: "clean",
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: undefined,
        moderationReasonCodes: undefined,
        softDeletedAt: 123,
        forkOf: {
          skillId: "skills:canonical" as never,
          kind: "duplicate",
          at: 100,
        },
      }),
    ).toBe(true);
  });
});
