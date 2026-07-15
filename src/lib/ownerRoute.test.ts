import { describe, expect, it } from "vitest";
import {
  buildPublisherApiFeedHref,
  buildPublisherProfileHref,
  isOwnerRouteHandleOrIdSegment,
  isOwnerRouteHandleSegment,
  isOwnerRouteScopeSegment,
} from "./ownerRoute";

describe("owner route segments", () => {
  it("uses the legacy profile route for official alias collisions", () => {
    expect(buildPublisherProfileHref("tencent")).toBe("/user/tencent");
    expect(buildPublisherProfileHref("steipete")).toBe("/steipete");
  });

  it("builds a stable publisher API feed URL", () => {
    expect(buildPublisherApiFeedHref("publishers:alice/example")).toBe(
      "/api/v1/publishers/publishers%3Aalice%2Fexample/feed",
    );
  });

  it("accepts npm-compatible publisher handle characters", () => {
    expect(isOwnerRouteHandleSegment("example.tools")).toBe(true);
    expect(isOwnerRouteHandleSegment("lab_1")).toBe(true);
    expect(isOwnerRouteHandleSegment("studio_tools")).toBe(true);
    expect(isOwnerRouteHandleSegment("market_square")).toBe(true);
  });

  it("keeps route segments bounded by alphanumeric characters", () => {
    expect(isOwnerRouteHandleSegment(".example")).toBe(false);
    expect(isOwnerRouteHandleSegment("example.")).toBe(false);
    expect(isOwnerRouteHandleSegment("_glin")).toBe(false);
    expect(isOwnerRouteHandleSegment("glin_")).toBe(false);
  });

  it("keeps route handles within the publisher handle length limit", () => {
    expect(isOwnerRouteHandleSegment("a".repeat(40))).toBe(true);
    expect(isOwnerRouteHandleSegment("a".repeat(41))).toBe(false);
    expect(isOwnerRouteScopeSegment(`@${"a".repeat(40)}`)).toBe(true);
    expect(isOwnerRouteScopeSegment(`@${"a".repeat(41)}`)).toBe(false);
  });

  it("accepts raw owner id route segments", () => {
    expect(isOwnerRouteHandleOrIdSegment("users:abc123")).toBe(true);
    expect(isOwnerRouteHandleOrIdSegment("publishers:abc123")).toBe(true);
  });

  it("accepts npm scope route aliases for the main skill route", () => {
    expect(isOwnerRouteScopeSegment("@openclaw")).toBe(true);
    expect(isOwnerRouteScopeSegment("@example.tools")).toBe(true);
    expect(isOwnerRouteScopeSegment("@lab_1")).toBe(true);
  });
});
