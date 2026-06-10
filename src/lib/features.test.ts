/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { featureFlags, getFeatureFlagFallback, resolveBooleanFeatureFlag } from "./features";

describe("feature flags", () => {
  it("keeps Souls disabled by default", () => {
    expect(featureFlags.souls.launchDarklyKey).toBe("clawhub-souls");
    expect(getFeatureFlagFallback("souls")).toBe(false);
  });

  it("lets a loaded LaunchDarkly value override the fallback", () => {
    expect(resolveBooleanFeatureFlag("souls", true)).toBe(true);
  });
});
