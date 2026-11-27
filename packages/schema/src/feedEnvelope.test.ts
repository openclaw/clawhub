import { describe, expect, it } from "vitest";
import { parseCatalogFeed, serializeCatalogFeed } from "./catalogFeed.js";
import {
  parseExperimentalTemplateFeed,
  serializeExperimentalTemplateFeed,
} from "./experimentalTemplateFeed.js";
import { parsePromotionsFeed, serializePromotionsFeed } from "./promotionsFeed.js";

const feeds = [
  {
    id: "clawhub-official",
    label: "Catalog",
    parse: parseCatalogFeed,
    serialize: serializeCatalogFeed,
    identityError: "Unsupported catalog feed schema version: 2",
  },
  {
    id: "clawhub-promotions",
    label: "Promotions",
    parse: parsePromotionsFeed,
    serialize: serializePromotionsFeed,
    identityError: "Unsupported promotions feed id: other",
  },
  {
    id: "clawhub-official-templates",
    label: "Experimental Template",
    parse: parseExperimentalTemplateFeed,
    serialize: serializeExperimentalTemplateFeed,
    identityError: "Unsupported experimental Template feed schema version: 2",
  },
];

function makeFeed(id: string) {
  return {
    schemaVersion: 1,
    id,
    generatedAt: "2026-07-01T00:00:00.000Z",
    sequence: 1,
    expiresAt: "2026-07-02T00:00:00.000Z",
    entries: [],
  };
}

describe.each(feeds)("$label feed envelope", ({ id, label, parse, serialize, identityError }) => {
  it("preserves identity, sequence, date and interval error precedence", () => {
    const invalidTimes = { generatedAt: "invalid", expiresAt: "invalid" };
    expect(() =>
      parse({ ...makeFeed("other"), schemaVersion: 2, sequence: -1, ...invalidTimes }),
    ).toThrow(identityError);
    for (const sequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parse({ ...makeFeed(id), sequence, ...invalidTimes })).toThrow(
        `${label} feed sequence must be a non-negative integer`,
      );
    }
    expect(() => parse({ ...makeFeed(id), ...invalidTimes })).toThrow(
      `${label} feed timestamps must be valid ISO dates`,
    );
    expect(() => parse({ ...makeFeed(id), expiresAt: makeFeed(id).generatedAt })).toThrow(
      `${label} feed expiresAt must be after generatedAt`,
    );
  });

  it("retains accepted date strings and canonical bytes regardless of input key order", () => {
    const feed = makeFeed(id);
    const reordered = {
      entries: feed.entries,
      expiresAt: "2026-07-02",
      sequence: 0,
      generatedAt: "2026-07-01",
      id,
      schemaVersion: 1,
    };
    const expected = `{"schemaVersion":1,"id":"${id}","generatedAt":"2026-07-01","sequence":0,"expiresAt":"2026-07-02","entries":[]}`;
    expect(serialize(reordered)).toBe(expected);
    expect(serialize({ ...reordered, description: "" })).toBe(
      expected.replace('"entries":[]', '"description":"","entries":[]'),
    );
  });
});
