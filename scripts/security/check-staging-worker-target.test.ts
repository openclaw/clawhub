/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { checkStagingWorkerTarget } from "./check-staging-worker-target";

const staging = {
  GITHUB_REPOSITORY: "openclaw/clawhub",
  GITHUB_REF: "refs/heads/staging",
  CONVEX_URL: "https://cheery-civet-733.convex.cloud",
  GITHUB_SHA: "a".repeat(40),
};

describe("staging worker target", () => {
  it("accepts only the deployed staging revision", async () => {
    await expect(
      checkStagingWorkerTarget(staging, async () => staging.GITHUB_SHA),
    ).resolves.toBeUndefined();
    await expect(checkStagingWorkerTarget(staging, async () => "b".repeat(40))).rejects.toThrow(
      "Deploy this staging commit",
    );
    await expect(checkStagingWorkerTarget(staging, async () => null)).rejects.toThrow(
      "Deploy this staging commit",
    );
  });

  it.each([
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REPOSITORY: "fork/clawhub" },
    { CONVEX_URL: "https://wry-manatee-359.convex.cloud" },
    { CONVEX_URL: "https://academic-chihuahua-392.convex.cloud" },
    { GITHUB_SHA: "" },
  ])("rejects an unsafe target before connecting: %j", async (override) => {
    const readBuildSha = vi.fn();
    await expect(
      checkStagingWorkerTarget({ ...staging, ...override }, readBuildSha),
    ).rejects.toThrow("Staging workers require");
    expect(readBuildSha).not.toHaveBeenCalled();
  });
});
