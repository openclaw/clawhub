import { describe, expect, it } from "vitest";
import { newestReusableAllowedAttempt } from "./skillsShAttemptHistory";

describe("newestReusableAllowedAttempt", () => {
  it("does not skip a newer malicious verdict to reuse an older clean verdict", () => {
    expect(
      newestReusableAllowedAttempt([
        { status: "succeeded", verdict: "malicious" },
        { status: "succeeded", verdict: "clean" },
      ]),
    ).toBeNull();
  });

  it("reuses the newest exact allowed verdict", () => {
    const newest = { status: "succeeded" as const, verdict: "suspicious" as const };

    expect(
      newestReusableAllowedAttempt([newest, { status: "succeeded", verdict: "malicious" }]),
    ).toBe(newest);
  });

  it("does not reuse a rolled-back verdict", () => {
    expect(
      newestReusableAllowedAttempt([
        {
          status: "succeeded",
          verdict: "clean",
          publicationRolledBackAt: 1,
        },
      ]),
    ).toBeNull();
  });
});
