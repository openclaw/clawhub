import { describe, expect, it } from "vitest";
import {
  normalizePublisherFeedQuery,
  PUBLISHER_FEED_SCHEMA_VERSION,
  parsePublisherFeed,
  publisherFeedId,
  type PublisherFeed,
} from "./accountFeed";

function makeFeed(overrides: Partial<PublisherFeed> = {}): PublisherFeed {
  return {
    schemaVersion: PUBLISHER_FEED_SCHEMA_VERSION,
    feedId: publisherFeedId("publishers:demo"),
    publisherId: "publishers:demo",
    handle: "demo",
    displayName: "Demo",
    generatedAt: "2026-07-16T00:00:00.000Z",
    sequence: 1,
    entries: [
      {
        kind: "skill",
        id: "skills:demo",
        name: "demo",
        displayName: "Demo",
        summary: null,
        url: "/demo/skills/demo",
        updatedAt: 10,
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

describe("publisher feed schema", () => {
  it("normalizes publisher queries with the specified ASCII whitespace rules", () => {
    expect(
      normalizePublisherFeedQuery({
        text: "\tCafe\u0301\r\n tools ",
        kinds: ["skill", "plugin", "skill"],
      }),
    ).toEqual({ text: "Café tools", kinds: ["plugin", "skill"] });
    expect(() => normalizePublisherFeedQuery({ text: "   " })).toThrow(
      "between 1 and 256 UTF-8 bytes",
    );
    expect(() => normalizePublisherFeedQuery({ kinds: [] })).toThrow("must not be empty");
  });
  it("binds feed identity to the stable publisher id", () => {
    expect(publisherFeedId("publishers:alice")).toBe("clawhub.publisher.publishers:alice");
    expect(parsePublisherFeed(makeFeed()).entries[0]?.kind).toBe("skill");
  });

  it("rejects unsupported versions and mismatched identity", () => {
    expect(() => parsePublisherFeed(makeFeed({ schemaVersion: 2 }))).toThrow(
      "Unsupported publisher feed schema version",
    );
    expect(() => parsePublisherFeed(makeFeed({ publisherId: "" }))).toThrow(
      "stable publisher identity",
    );
    expect(() => parsePublisherFeed(makeFeed({ feedId: "clawhub.publisher.other" }))).toThrow(
      "stable publisher identity",
    );
  });

  it("rejects invalid ordering and URL fields", () => {
    const entry = makeFeed().entries[0]!;
    expect(() =>
      parsePublisherFeed(makeFeed({ entries: [{ ...entry, updatedAt: Number.NaN }] })),
    ).toThrow("updatedAt");
    for (const url of ["//evil.example/skill", "/\\evil.example/skill", "/bad\npath"]) {
      expect(() => parsePublisherFeed(makeFeed({ entries: [{ ...entry, url }] }))).toThrow(
        "safe origin-relative",
      );
    }
    expect(() =>
      parsePublisherFeed(makeFeed({ entries: [{ ...entry, url: "http://example.com/skill" }] })),
    ).toThrow("absolute HTTPS");
    expect(
      parsePublisherFeed(makeFeed({ entries: [{ ...entry, url: "https://example.com/skill" }] }))
        .entries[0]?.url,
    ).toBe("https://example.com/skill");
  });
});
