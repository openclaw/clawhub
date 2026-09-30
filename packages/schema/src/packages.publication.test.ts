import { describe, expect, it } from "vitest";
import { parseArk } from "./ark.js";
import { ApiV1PackageVersionPublicationResponseSchema } from "./packages.js";
import { ApiRoutes } from "./routes.js";

const identity = { name: "@openclaw/discord", version: "2026.9.2" };
const shapes = [
  { state: "absent" },
  { state: "published" },
  { state: "pending", stage: "staging" },
  { state: "pending", stage: "checks", attemptId: "attempt" },
  { state: "pending", stage: "finalization", attemptId: "attempt" },
  { state: "failed", recoverable: false },
  { state: "failed", recoverable: true, attemptId: "attempt" },
];
const parse = (value: unknown) =>
  parseArk(ApiV1PackageVersionPublicationResponseSchema, value, "publication");

describe("package version publication contract", () => {
  it("exports the exact route", () => {
    expect(ApiRoutes.packageVersionPublication).toBe(
      "/api/v1/packages/{name}/versions/{version}/publication",
    );
  });
  it.each(shapes)("accepts the closed shape $state $stage", (shape) => {
    expect(parse({ ...identity, ...shape })).toEqual({ ...identity, ...shape });
    expect(() => parse({ ...identity, ...shape, error: "private detail" })).toThrow();
  });
  it.each([
    { state: "unknown" },
    { state: "pending" },
    { state: "pending", stage: "checks" },
    { state: "pending", stage: "finalization" },
    { state: "pending", stage: "staging", attemptId: "attempt" },
    { state: "pending", stage: "other", attemptId: "attempt" },
    { state: "failed" },
    { state: "failed", recoverable: "true" },
    { state: "published", attemptId: "attempt" },
    { state: "absent", recoverable: false },
  ])("rejects malformed recognized or unknown states %#", (shape) => {
    expect(() => parse({ ...identity, ...shape })).toThrow();
  });
});
