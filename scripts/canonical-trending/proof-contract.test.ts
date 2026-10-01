import { describe, expect, it } from "vitest";
import {
  assertFirstPageContract,
  EXPECTED_FIRST_20_LANES,
  latencySummary,
  type ProofSampleRow,
} from "./proof-contract";

function sampleRow(index: number): ProofSampleRow {
  const lane = EXPECTED_FIRST_20_LANES[index]!;
  const external = lane === "skills-sh-trending";
  return {
    rank: index + 1,
    id: `row-${index + 1}`,
    lane,
    publisherKey: `publisher-${Math.floor(index / 2)}`,
    upstreamRank: external ? index + 1 : null,
    metrics: {
      trending24hInstalls: external ? null : 20 - index,
      trending24hBookmarks: external ? null : index,
      lifetimeInstalls: 100 + index,
      lifetimeInstallsPeriod: "lifetime",
    },
  };
}

describe("CLAW-590 permanent Test proof contract", () => {
  it("accepts the continuous blend, cap, order, and metric provenance", () => {
    expect(assertFirstPageContract(Array.from({ length: 20 }, (_, index) => sampleRow(index))))
      .toMatchInlineSnapshot(`
        {
          "laneCounts": {
            "clawhub-rising": 4,
            "clawhub-trending": 8,
            "skills-sh-trending": 8,
          },
          "maximumPublisherCount": 2,
          "skillsShUpstreamRanks": [
            2,
            5,
            7,
            10,
            12,
            15,
            17,
            20,
          ],
        }
      `);
  });

  it("rejects publisher-cap and external metric provenance violations", () => {
    const publisherViolation = Array.from({ length: 20 }, (_, index) => sampleRow(index));
    publisherViolation[4]!.publisherKey = publisherViolation[0]!.publisherKey;
    expect(() => assertFirstPageContract(publisherViolation)).toThrow("Publisher cap exceeded");

    const metricViolation = Array.from({ length: 20 }, (_, index) => sampleRow(index));
    metricViolation[1]!.metrics.trending24hInstalls = 12;
    expect(() => assertFirstPageContract(metricViolation)).toThrow(
      "skills.sh 24-hour metrics were inferred",
    );
  });

  it("summarizes observed latency without imposing an unstated SLO", () => {
    expect(latencySummary([3, 1, 2])).toEqual({
      samplesMs: [3, 1, 2],
      medianMs: 2,
      p95Ms: 3,
    });
  });
});
