/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { buildRecommendationTopics } from "./recommendationTopics";

describe("recommendation topics", () => {
  it("blends public search demand with active skill and plugin signals", () => {
    const topics = buildRecommendationTopics({
      searchRows: [
        { query: "github integration", count: 7, lastSearchedAt: 1 },
        { query: "github integration", count: 5, lastSearchedAt: 2 },
      ],
      skillSignals: [
        {
          source: "skill",
          text: "OAuth security scanner",
          downloads: 3,
          installs: 5,
        },
        {
          source: "skill",
          text: "Agent workflow automation",
          downloads: 1,
          installs: 2,
        },
      ],
      pluginSignals: [
        {
          source: "plugin",
          text: "GitHub dashboard plugin with repository metrics",
          downloads: 10,
          installs: 4,
        },
      ],
      limit: 4,
    });

    expect(topics.map((topic) => topic.query)).toEqual([
      "github integration",
      "dashboard builder",
      "security scanner",
      "agent workflow",
    ]);
    expect(topics[0]).toMatchObject({
      kind: "search",
      score: 86,
      reason: "Trending search",
    });
    expect(topics[1]).toMatchObject({ kind: "plugin-topic", reason: "Active plugin demand" });
    expect(topics[2]).toMatchObject({ kind: "skill-topic", reason: "Active skill demand" });
  });

  it("does not publish private-looking or below-threshold search terms", () => {
    const topics = buildRecommendationTopics({
      searchRows: [
        { query: "jason@example.com", count: 99 },
        { query: "single user query", count: 1 },
      ],
      limit: 4,
    });

    expect(topics).toEqual([]);
  });
});
