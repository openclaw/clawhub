/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { createAnonymousLaunchDarklyContext } from "./featureFlagContext";

describe("feature flag context", () => {
  it("lets LaunchDarkly generate distinct anonymous context keys", () => {
    const context = createAnonymousLaunchDarklyContext();

    expect(context).toEqual({ kind: "user", anonymous: true });
    expect(Object.hasOwn(context, "key")).toBe(false);
  });
});
