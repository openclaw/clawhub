import { describe, expect, it } from "vitest";
import {
  parseBrowseTopicFromSearchInput,
  parseBrowseTopicFromSearchString,
  sanitizeBrowseTopicSearch,
} from "./browseTopicSearch";

describe("browseTopicSearch", () => {
  it("parses a normal topic query param", () => {
    expect(parseBrowseTopicFromSearchString("?topic=github")).toBe("github");
    expect(parseBrowseTopicFromSearchInput({ topic: "github" })).toBe("github");
  });

  it("parses malformed topic%3Dgithub query strings", () => {
    expect(parseBrowseTopicFromSearchString("?topic%3Dgithub")).toBe("github");
    expect(parseBrowseTopicFromSearchInput({ "topic=github": "" })).toBe("github");
  });

  it("normalizes topic labels", () => {
    expect(parseBrowseTopicFromSearchString("?topic=GitHub")).toBe("github");
  });

  it("removes malformed topic keys when sanitizing search state", () => {
    expect(sanitizeBrowseTopicSearch({ "topic=github": "", category: "development" }, "github")).toEqual({
      category: "development",
      topic: "github",
    });
    expect(sanitizeBrowseTopicSearch({ "topic=github": "", topic: "github" }, null)).toEqual({});
  });
});
