import { describe, expect, it } from "vitest";
import {
  isOwnerRouteHandleOrIdSegment,
  isOwnerRouteHandleSegment,
  isOwnerRouteScopeSegment,
} from "./ownerRoute";

describe("owner route segments", () => {
  it("accepts npm-compatible publisher handle characters", () => {
    expect(isOwnerRouteHandleSegment("bitrouter.ai")).toBe(true);
    expect(isOwnerRouteHandleSegment("glin_1")).toBe(true);
    expect(isOwnerRouteHandleSegment("pluglab_thinkly")).toBe(true);
    expect(isOwnerRouteHandleSegment("souls_market")).toBe(true);
  });

  it("keeps route segments bounded by alphanumeric characters", () => {
    expect(isOwnerRouteHandleSegment(".bitrouter")).toBe(false);
    expect(isOwnerRouteHandleSegment("bitrouter.")).toBe(false);
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
    expect(isOwnerRouteScopeSegment("@bitrouter.ai")).toBe(true);
    expect(isOwnerRouteScopeSegment("@glin_1")).toBe(true);
  });
});
