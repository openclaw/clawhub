import { describe, expect, it } from "vitest";
import { getPublicSlugCollision } from "./slugCollision";

describe("getPublicSlugCollision", () => {
  it("returns null when availability result is missing", () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: "demo",
        result: undefined,
      }),
    ).toBeNull();
  });

  it("returns null when slug is available", () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: "demo",
        result: {
          available: true,
          reason: "available",
          message: null,
          url: null,
        },
      }),
    ).toBeNull();
  });

  it("returns collision with link when query reports unavailable with URL", () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: "demo",
        result: {
          available: false,
          reason: "taken",
          message: "Slug is already taken. Choose a different slug.",
          url: "/alice/demo",
        },
      }),
    ).toEqual({
      message: "Slug is already taken. Choose a different slug.",
      url: "/alice/demo",
    });
  });

  it("returns generic collision message when backend message is empty", () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: "demo",
        result: {
          available: false,
          reason: "reserved",
          message: "   ",
          url: null,
        },
      }),
    ).toEqual({
      message: "Slug is already taken. Choose a different slug.",
      url: null,
    });
  });
});
