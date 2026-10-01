import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { derivePersonalPublisherHandle } from "./publishers";

function makeUser(overrides: Partial<Doc<"users">>): Doc<"users"> {
  return {
    _id: "users:docs",
    _creationTime: 1,
    name: "demo",
    createdAt: 1,
    ...overrides,
  } as Doc<"users">;
}

describe("derivePersonalPublisherHandle", () => {
  it("does not derive a reserved public owner handle", () => {
    expect(derivePersonalPublisherHandle(makeUser({ name: "docs" }))).toBe("docs-2");
  });
});
