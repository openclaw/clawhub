import { describe, expect, it } from "vitest";
import {
  getPublicSkillFileAccessBlock,
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
});
