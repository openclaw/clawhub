import { describe, expect, it } from "vitest";
import { packageArtifactStatus, skillArtifactStatus } from "./artifactStatus";

describe("artifactStatus", () => {
  it("does not block skills from raw VT or static telemetry after moderation clears them", () => {
    const status = skillArtifactStatus({
      moderationStatus: "active",
      moderationVerdict: "clean",
      moderationFlags: [],
      moderationReason: "pending.scan",
      latestVersion: {
        llmStatus: "clean",
      },
    });

    expect(status.key).toBe("visible");
  });

  it("uses the resolved package verdict after moderation approves a flagged release", () => {
    const status = packageArtifactStatus({
      scanStatus: "clean",
      latestRelease: {
        llmStatus: "malicious",
      },
    });

    expect(status.label).toBe("Visible");
  });
});
