import { describe, expect, it } from "vitest";
import {
  getPublicSkillFileAccessBlock,
  getPublicSkillVersionDownloadBlock,
  getSkillFileModerationInfoFromSkill,
} from "./skillFileAccess";

describe("skill file moderation access", () => {
  it("blocks skills whose current moderation verdict is malicious", () => {
    const moderationInfo = getSkillFileModerationInfoFromSkill({
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.malicious",
      moderationFlags: [],
      moderationVerdict: "malicious",
    });

    expect(moderationInfo.isMalwareBlocked).toBe(true);
    expect(getPublicSkillFileAccessBlock(moderationInfo)).toMatchObject({
      status: 403,
      message: expect.stringContaining("malicious"),
    });
  });

  it.each([
    ["suspicious", false],
    ["malicious", true],
    ["failed", true],
  ])("applies shared scan download policy for %s skill versions", (status, blocked) => {
    const block = getPublicSkillVersionDownloadBlock(null, {
      _id: "skillVersions:1",
      llmAnalysis: { status },
    });

    if (blocked) {
      expect(block).toMatchObject({
        status: 403,
        message: expect.stringContaining("flagged"),
      });
    } else {
      expect(block).toBeNull();
    }
  });
});
