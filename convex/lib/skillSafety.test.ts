import { describe, expect, it } from "vitest";
import { isSkillReviewFlagged, isSkillSuspicious } from "./skillSafety";

describe("isSkillSuspicious", () => {
  it("ignores legacy suspicious flags", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: ["flagged.suspicious"],
        moderationReason: undefined,
      }),
    ).toBe(false);
  });

  it("ignores legacy scanner suspicious reasons", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.suspicious",
      }),
    ).toBe(false);
  });

  it("returns false for clean moderation states", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.clean",
      }),
    ).toBe(false);
  });

  it("ignores legacy review flags", () => {
    const skill = {
      moderationFlags: ["flagged.review"],
      moderationReason: "scanner.llm.review",
    };

    expect(isSkillSuspicious(skill)).toBe(false);
    expect(isSkillReviewFlagged(skill)).toBe(false);
  });
});
