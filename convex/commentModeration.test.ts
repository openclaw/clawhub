/* @vitest-environment node */
import { describe, expect, it } from "vitest";

const { retiredCommentModerationHandler } = await import("./commentModeration");

describe("comment scam moderation drain", () => {
  it("keeps legacy scheduled jobs harmless after comment moderation is retired", async () => {
    await expect(retiredCommentModerationHandler()).resolves.toEqual({
      ok: true,
      retired: true,
    });
  });
});
