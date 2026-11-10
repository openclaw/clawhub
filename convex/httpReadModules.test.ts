/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { skillsGetRouterV1Handler } from "./httpApiV1/skillsV1";
import { getRegisteredHttpHandler } from "./lib/httpRouteRateLimit";
import { get as skillRead } from "./skillReadHttp";

describe("leaf HTTP read registrations", () => {
  it("keeps the canonical skill handler, including exact-version and moderation checks", () => {
    expect(getRegisteredHttpHandler(skillRead)).toBe(skillsGetRouterV1Handler);
  });
});
