import { describe, expect, it } from "vitest";
import {
  hasPostPublishSearch,
  isPostPublishFlag,
  parsePostPublishSearch,
} from "./postPublishSearch";

describe("post-publish search", () => {
  it.each([true, 1, "true", "1", " true ", ' "1" ', '"true"', '"true', 'true"'])(
    "accepts the existing published flag %j",
    (published) => {
      expect(isPostPublishFlag(published)).toBe(true);
      expect(parsePostPublishSearch({ published })).toEqual({ published: true });
    },
  );

  it.each([false, 0, "false", "0", "TRUE", "yes", "", null, undefined, [], {}, '" true "'])(
    "omits the published flag for %j",
    (published) => {
      expect(isPostPublishFlag(published)).toBe(false);
      expect(parsePostPublishSearch({ published })).toEqual({});
    },
  );

  it("drops unrelated search fields", () => {
    const search = { published: true, tab: "files" };
    expect(parsePostPublishSearch(search)).toEqual({ published: true });
    expect(parsePostPublishSearch({})).toEqual({});
  });

  it.each([
    ["?published=1", true],
    ["?published=%22true%22", true],
    ["?published=+true+", true],
    ["?published=false&published=true", false],
    ["?published=true&published=false", true],
    ["?other=published%3Dtrue", false],
    ["?published=TRUE", false],
    ["?published=", false],
    ["", false],
  ])("reads the first decoded published value from %j", (search, expected) => {
    expect(hasPostPublishSearch(search)).toBe(expected);
  });
});
