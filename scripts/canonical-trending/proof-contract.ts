export const EXPECTED_FIRST_20_LANES = [
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-rising",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-rising",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-rising",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-rising",
  "clawhub-trending",
  "skills-sh-trending",
] as const;

type ProofMetrics = {
  trending24hInstalls: number | null;
  trending24hBookmarks: number | null;
  lifetimeInstalls: number | null;
  lifetimeInstallsPeriod: string;
};

export type ProofSampleRow = {
  rank: number;
  id: string;
  lane: string;
  publisherKey: string;
  upstreamRank: number | null;
  metrics: ProofMetrics;
};

export function assertFirstPageContract(sample: ProofSampleRow[]) {
  if (sample.length !== EXPECTED_FIRST_20_LANES.length) {
    throw new Error(`Expected a 20-row Trending sample, received ${sample.length}`);
  }
  const publisherCounts = new Map<string, number>();
  const upstreamRanks: number[] = [];
  for (const [index, row] of sample.entries()) {
    if (row.rank !== index + 1) throw new Error(`Unexpected rank at sample offset ${index}`);
    if (row.lane !== EXPECTED_FIRST_20_LANES[index]) {
      throw new Error(`40/20/40 lane mismatch at rank ${row.rank}`);
    }
    const publisherCount = (publisherCounts.get(row.publisherKey) ?? 0) + 1;
    publisherCounts.set(row.publisherKey, publisherCount);
    if (publisherCount > 2) throw new Error(`Publisher cap exceeded by ${row.publisherKey}`);
    if (row.metrics.lifetimeInstallsPeriod !== "lifetime") {
      throw new Error(`Lifetime metric period is mislabeled for ${row.id}`);
    }
    if (row.lane === "skills-sh-trending") {
      if (row.metrics.trending24hInstalls !== null || row.metrics.trending24hBookmarks !== null) {
        throw new Error(`skills.sh 24-hour metrics were inferred for ${row.id}`);
      }
      if (typeof row.metrics.lifetimeInstalls !== "number") {
        throw new Error(`skills.sh lifetime installs are missing for ${row.id}`);
      }
      if (!Number.isSafeInteger(row.upstreamRank) || (row.upstreamRank ?? 0) < 1) {
        throw new Error(`skills.sh upstream rank is missing for ${row.id}`);
      }
      upstreamRanks.push(row.upstreamRank as number);
    } else if (
      typeof row.metrics.trending24hInstalls !== "number" ||
      typeof row.metrics.trending24hBookmarks !== "number"
    ) {
      throw new Error(`Native 24-hour metrics are missing for ${row.id}`);
    }
  }
  if (upstreamRanks.some((rank, index) => index > 0 && rank <= upstreamRanks[index - 1]!)) {
    throw new Error("skills.sh upstream order was not preserved");
  }
  return {
    laneCounts: Object.fromEntries(
      [...new Set(EXPECTED_FIRST_20_LANES)].map((lane) => [
        lane,
        sample.filter((row) => row.lane === lane).length,
      ]),
    ),
    maximumPublisherCount: Math.max(...publisherCounts.values()),
    skillsShUpstreamRanks: upstreamRanks,
  };
}

export function latencySummary(samples: number[]) {
  if (samples.length === 0) throw new Error("Latency samples are required");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio: number) => sorted[Math.ceil(sorted.length * ratio) - 1] ?? sorted[0]!;
  return {
    samplesMs: samples.map((value) => Number(value.toFixed(2))),
    medianMs: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
  };
}
