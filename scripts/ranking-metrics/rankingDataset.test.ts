import { describe, expect, it } from "vitest";
import {
  buildRankingDataset,
  parseRankingDataset,
  rankingDatasetChecksum,
  type RankingMetricTarget,
} from "./rankingDataset";

const targets: RankingMetricTarget[] = [
  {
    kind: "skill",
    ownerHandle: "test-snapshot-user-0123456789ab",
    slug: "calendar",
    createdAt: 1_700_000_000_000,
    days: [
      { day: 20_655, downloads: 4, installs: 2, bookmarks: 1 },
      { day: 20_656, downloads: 6, installs: 3, bookmarks: 0 },
    ],
  },
  {
    kind: "package",
    normalizedName: "@openclaw/calendar",
    family: "code-plugin",
    channel: "stable",
    createdAt: 1_700_000_000_000,
    days: [{ day: 20_656, downloads: 8, installs: 5, bookmarks: 0 }],
  },
];

describe("ranking metric dataset", () => {
  it("builds a versioned allowlisted aggregate dataset", () => {
    const dataset = buildRankingDataset({
      datasetVersion: "ranking-metrics-2026-07-23-v1",
      generatedAt: "2026-07-23T22:00:00.000Z",
      startDay: 20_597,
      endDay: 20_656,
      targets,
    });

    expect(parseRankingDataset(JSON.stringify(dataset))).toEqual(dataset);
    expect(dataset.counts).toEqual({
      targets: 2,
      skillTargets: 1,
      packageTargets: 1,
      dailyRows: 3,
      downloads: 18,
      installs: 10,
      bookmarks: 1,
    });
    expect(dataset.checksum).toBe(rankingDatasetChecksum(dataset));
  });

  it.each([
    ["user identity", { userId: "kn7secret" }],
    ["device identity", { deviceId: "device-1" }],
    ["session", { sessionToken: "secret" }],
    ["IP address", { note: "198.51.100.42" }],
    ["raw document id", { skillId: "kd7rawproductionid" }],
  ])("rejects prohibited %s fields fail-closed", (_label, prohibited) => {
    const dataset = buildRankingDataset({
      datasetVersion: "ranking-metrics-2026-07-23-v1",
      generatedAt: "2026-07-23T22:00:00.000Z",
      startDay: 20_597,
      endDay: 20_656,
      targets,
    });

    const unsafe = { ...dataset, ...prohibited };
    expect(() => parseRankingDataset(JSON.stringify(unsafe))).toThrow();
  });

  it("rejects duplicate target-day rows and rows outside the declared window", () => {
    expect(() =>
      buildRankingDataset({
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        generatedAt: "2026-07-23T22:00:00.000Z",
        startDay: 20_597,
        endDay: 20_656,
        targets: [
          {
            ...targets[0],
            days: [
              { day: 20_655, downloads: 1, installs: 1, bookmarks: 1 },
              { day: 20_655, downloads: 2, installs: 2, bookmarks: 2 },
            ],
          },
        ],
      }),
    ).toThrow("duplicate");

    expect(() =>
      buildRankingDataset({
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        generatedAt: "2026-07-23T22:00:00.000Z",
        startDay: 20_597,
        endDay: 20_656,
        targets: [
          { ...targets[0], days: [{ day: 20_596, downloads: 1, installs: 1, bookmarks: 1 }] },
        ],
      }),
    ).toThrow("outside");
  });

  it("treats package family and channel as part of the target identity", () => {
    const packageTarget = targets[1];
    if (packageTarget.kind !== "package") throw new Error("expected package fixture");
    expect(() =>
      buildRankingDataset({
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        generatedAt: "2026-07-23T22:00:00.000Z",
        startDay: 20_597,
        endDay: 20_656,
        targets: [
          packageTarget,
          { ...packageTarget, family: "bundle-plugin" },
          { ...packageTarget, channel: "beta" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects negative aggregate counts", () => {
    expect(() =>
      buildRankingDataset({
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        generatedAt: "2026-07-23T22:00:00.000Z",
        startDay: 20_597,
        endDay: 20_656,
        targets: [
          {
            ...targets[0],
            days: [{ day: 20_656, downloads: 1, installs: 1, bookmarks: -1 }],
          },
        ],
      }),
    ).toThrow("bookmarks must be non-negative");
  });
});
