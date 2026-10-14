/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { classifyAnalyticsRegion } from "./handlers/analyticsConsent";

describe("first-party country classification", () => {
  const approved = { VERCEL: "1" };
  it("requires the trusted deployed platform for the approved source policy", () => {
    expect(classifyAnalyticsRegion("US", {})).toBe("unknown");
    expect(classifyAnalyticsRegion("US", { ...approved, VERCEL: undefined })).toBe("unknown");
  });
  it("maps the exact 39 EEA/UK/Swiss and EU territory codes to opt-in", () => {
    const optIn =
      "AT AX BE BG CH CY CZ DE DK EE ES FI FR GB GF GP GR HR HU IE IS IT LI LT LU LV MF MQ MT NL NO PL PT RE RO SE SI SK YT".split(
        " ",
      );
    expect(new Set(optIn).size).toBe(39);
    for (const country of optIn) expect(classifyAnalyticsRegion(country, approved)).toBe("opt_in");
    for (const country of ["US", "CA", "JP", "BR", "AU"])
      expect(classifyAnalyticsRegion(country, approved)).toBe("notice_opt_out");
  });
  it("fails closed on absent, malformed, reserved and unrecognized values", () => {
    for (const country of [null, "", "XX", "ZZ", "EU", "T1", "U1", "us", "USA", "US,GB"])
      expect(classifyAnalyticsRegion(country, approved)).toBe("unknown");
  });
});
