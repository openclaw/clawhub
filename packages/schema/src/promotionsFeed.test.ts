import { describe, expect, it } from "vitest";
import {
  PROMOTIONS_FEED_ID,
  PROMOTIONS_FEED_SCHEMA_VERSION,
  parsePromotionsFeed,
  serializePromotionsFeed,
  type PromotionsFeed,
} from "./promotionsFeed.js";

function makeFeed(overrides: Partial<PromotionsFeed> = {}): PromotionsFeed {
  return {
    schemaVersion: PROMOTIONS_FEED_SCHEMA_VERSION,
    id: PROMOTIONS_FEED_ID,
    generatedAt: "2026-07-01T00:00:00.000Z",
    sequence: 1,
    expiresAt: "2026-07-02T00:00:00.000Z",
    entries: [
      {
        type: "promotion",
        slug: "zeta-launch",
        title: "Zeta launch",
        blurb: "Free models from Zeta.",
        startsAt: 100,
        endsAt: 200,
        models: [
          { modelRef: "example-provider/zeta/model-beta" },
          { modelRef: "example-provider/zeta/model-alpha", alias: "Alpha", suggestedDefault: true },
        ],
        signupUrl: "https://signup.example.com",
      },
      {
        type: "promotion",
        slug: "alpha-launch",
        title: "Alpha launch",
        blurb: "Free models from Alpha.",
        sponsor: "Alpha",
        startsAt: 100,
        endsAt: 300,
        models: [{ modelRef: "example-provider/alpha/model-one" }],
      },
    ],
    ...overrides,
  };
}

describe("promotions feed schema", () => {
  it("round-trips a valid feed", () => {
    const parsed = parsePromotionsFeed(JSON.parse(serializePromotionsFeed(makeFeed())));
    expect(parsed.id).toBe(PROMOTIONS_FEED_ID);
    expect(parsed.entries).toHaveLength(2);
  });

  it("serializes deterministically: entries by slug, models by modelRef", () => {
    const payload = JSON.parse(serializePromotionsFeed(makeFeed())) as PromotionsFeed;
    expect(payload.entries.map((entry) => entry.slug)).toEqual(["alpha-launch", "zeta-launch"]);
    expect(payload.entries[1]?.models.map((model) => model.modelRef)).toEqual([
      "example-provider/zeta/model-alpha",
      "example-provider/zeta/model-beta",
    ]);
  });

  it("rejects unsupported schema versions", () => {
    expect(() => parsePromotionsFeed(makeFeed({ schemaVersion: 2 }))).toThrow(/schema version/);
  });

  it("rejects a payload for a different feed id", () => {
    expect(() => parsePromotionsFeed(makeFeed({ id: "wrong-feed" }))).toThrow(/feed id/);
  });

  it("rejects inverted feed and entry windows", () => {
    expect(() => parsePromotionsFeed(makeFeed({ expiresAt: "2026-06-30T00:00:00.000Z" }))).toThrow(
      /expiresAt/,
    );
    const feed = makeFeed();
    const entry = feed.entries[0];
    if (!entry) throw new Error("fixture missing entry");
    entry.endsAt = entry.startsAt;
    expect(() => parsePromotionsFeed(feed)).toThrow(/inverted window/);
  });

  it("rejects unknown fields", () => {
    const feed = makeFeed() as PromotionsFeed & { extra?: string };
    feed.extra = "nope";
    expect(() => parsePromotionsFeed(feed)).toThrow();
  });
});
