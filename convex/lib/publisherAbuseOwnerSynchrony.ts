export const PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS = 60;
export const PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE = 0.15;
export const PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CORRELATION = 0.98;
export const PUBLISHER_ABUSE_OWNER_SYNCHRONY_MAX_PEAK_RATIO = 1.25;

export type PublisherAbuseOwnerSynchronyCurve = {
  skillId: string;
  skillSlug: string;
  dailyDownloads: number[];
};

export type PublisherAbuseOwnerSynchronyEvidence = {
  skillIds: string[];
  skillSlugs: string[];
  correlationFloor: number;
  correlationMedian: number;
  peak7DownloadsMin: number;
  peak7DownloadsMax: number;
  catalogCoverage: number;
};

function pearsonCorrelation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return null;

  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  if (leftVariance === 0 || rightVariance === 0) return null;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function peakRollingDownloads(values: number[], windowDays: number) {
  if (values.length === 0) return 0;
  let rollingTotal = 0;
  let peak = 0;
  for (let index = 0; index < values.length; index += 1) {
    rollingTotal += values[index];
    if (index >= windowDays) rollingTotal -= values[index - windowDays];
    peak = Math.max(peak, rollingTotal / Math.min(index + 1, windowDays));
  }
  return peak;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

/**
 * Finds the largest group whose members all move together and reach a similar
 * absolute download peak. Trying every skill as a seed keeps one unrelated
 * outlier from hiding an otherwise coherent portfolio-wide pattern.
 */
export function detectPublisherAbuseOwnerSynchrony(
  curves: PublisherAbuseOwnerSynchronyCurve[],
  publisherSkillCount: number,
): PublisherAbuseOwnerSynchronyEvidence | null {
  const usableCurves = curves.filter(
    (curve) =>
      curve.dailyDownloads.length === PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS &&
      curve.dailyDownloads.every((value) => Number.isFinite(value) && value >= 0),
  );
  if (usableCurves.length < 2 || publisherSkillCount < 2) return null;

  const correlations = new Map<string, number | null>();
  const peaks = new Map(
    usableCurves.map((curve) => [curve.skillId, peakRollingDownloads(curve.dailyDownloads, 7)]),
  );
  const pairKey = (leftId: string, rightId: string) =>
    leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`;
  const correlationFor = (
    left: PublisherAbuseOwnerSynchronyCurve,
    right: PublisherAbuseOwnerSynchronyCurve,
  ) => {
    const key = pairKey(left.skillId, right.skillId);
    if (!correlations.has(key)) {
      correlations.set(key, pearsonCorrelation(left.dailyDownloads, right.dailyDownloads));
    }
    return correlations.get(key) ?? null;
  };

  let bestCluster: PublisherAbuseOwnerSynchronyCurve[] = [];
  for (const seed of usableCurves) {
    const cluster = [seed];
    const candidates = usableCurves
      .filter((curve) => curve.skillId !== seed.skillId)
      .map((curve) => ({ curve, correlation: correlationFor(seed, curve) }))
      .filter(
        (
          candidate,
        ): candidate is { curve: PublisherAbuseOwnerSynchronyCurve; correlation: number } =>
          candidate.correlation !== null &&
          candidate.correlation >= PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CORRELATION,
      )
      .sort((left, right) => right.correlation - left.correlation);

    for (const { curve } of candidates) {
      if (
        !cluster.every(
          (member) =>
            (correlationFor(member, curve) ?? Number.NEGATIVE_INFINITY) >=
            PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CORRELATION,
        )
      ) {
        continue;
      }
      const nextPeaks = [...cluster, curve].map((member) => peaks.get(member.skillId) ?? 0);
      const minimumPeak = Math.min(...nextPeaks);
      const maximumPeak = Math.max(...nextPeaks);
      if (
        minimumPeak <= 0 ||
        maximumPeak / minimumPeak > PUBLISHER_ABUSE_OWNER_SYNCHRONY_MAX_PEAK_RATIO
      ) {
        continue;
      }
      cluster.push(curve);
    }

    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }

  if (bestCluster.length < 2) return null;
  const catalogCoverage = bestCluster.length / publisherSkillCount;
  if (catalogCoverage < PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE) return null;
  const clusterCorrelations: number[] = [];
  for (let leftIndex = 0; leftIndex < bestCluster.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bestCluster.length; rightIndex += 1) {
      const correlation = correlationFor(bestCluster[leftIndex], bestCluster[rightIndex]);
      if (correlation !== null) clusterCorrelations.push(correlation);
    }
  }
  const clusterPeaks = bestCluster.map((curve) => peaks.get(curve.skillId) ?? 0);
  const sortedCluster = [...bestCluster].sort((left, right) =>
    left.skillSlug.localeCompare(right.skillSlug),
  );
  return {
    skillIds: sortedCluster.map((curve) => curve.skillId),
    skillSlugs: sortedCluster.map((curve) => curve.skillSlug),
    correlationFloor: Math.min(...clusterCorrelations),
    correlationMedian: median(clusterCorrelations),
    peak7DownloadsMin: Math.min(...clusterPeaks),
    peak7DownloadsMax: Math.max(...clusterPeaks),
    catalogCoverage,
  };
}

export { pearsonCorrelation, peakRollingDownloads };
