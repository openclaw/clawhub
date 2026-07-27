import { describe, expect, it } from "vitest";
import { normalizeSkillTags } from "./skillTags";

describe("normalizeSkillTags", () => {
  it("keeps unique Convex-safe tags and drops invalid object keys", () => {
    expect(
      normalizeSkillTags([
        " latest ",
        "tax",
        "tax",
        "个体工商户",
        "_private",
        "$system",
        "line\nbreak",
        "",
      ]),
    ).toEqual(["latest", "tax"]);
  });

  it("preserves an omitted tag list", () => {
    expect(normalizeSkillTags(undefined)).toBeUndefined();
  });
});
