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
        vtStatus: "malicious",
        llmStatus: "clean",
        staticScanStatus: "malicious",
      },
    });

    expect(status.key).toBe("visible");
  });

  it("does not block packages from raw static telemetry after resolved scan status is clean", () => {
    const status = packageArtifactStatus({
      scanStatus: "clean",
      latestRelease: {
        vtStatus: "malicious",
        llmStatus: "clean",
        staticScanStatus: "malicious",
      },
    });

    expect(status.label).toBe("Visible");
  });
});
