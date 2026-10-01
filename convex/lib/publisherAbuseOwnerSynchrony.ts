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
  correlationFloor: number;
  correlationMedian: number;
  peak7DownloadsMin: number;
  peak7DownloadsMax: number;
  catalogCoverage: number;
};

function peakRollingDownloads(values: number[], windowDays: number) {
  if (values.length < windowDays) return 0;
  let rollingTotal = 0;
  let peak = 0;
  for (let index = 0; index < values.length; index += 1) {
    rollingTotal += values[index];
    if (index >= windowDays) rollingTotal -= values[index - windowDays];
    if (index >= windowDays - 1) peak = Math.max(peak, rollingTotal / windowDays);
  }
  return peak;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function normalizedShape(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return null;
  return centered.map((value) => value / magnitude);
}

function correlationWithReference(shape: number[], reference: number[]) {
  return shape.reduce((sum, value, index) => sum + value * reference[index], 0);
}

function medianPortfolioReference(shapes: number[][]) {
  const reference = Array.from({ length: PUBLISHER_ABUSE_OWNER_SYNCHRONY_WINDOW_DAYS }, (_, day) =>
    median(shapes.map((shape) => shape[day])),
  );
  return normalizedShape(reference);
}

/**
 * Builds one robust reference from the portfolio's median normalized shape,
 * then finds the largest aligned group with similar absolute peaks. Requiring
 * the group to contain more than half of the anomalous skills keeps the median
 * resistant to outliers and bounds work to O(skills × window × log(skills)).
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

  const normalizedCurves = usableCurves.flatMap((curve) => {
    const shape = normalizedShape(curve.dailyDownloads);
    return shape ? [{ curve, shape, peak: peakRollingDownloads(curve.dailyDownloads, 7) }] : [];
  });
  if (normalizedCurves.length < 2) return null;
  const reference = medianPortfolioReference(normalizedCurves.map(({ shape }) => shape));
  if (!reference) return null;
  const alignedByPeak = normalizedCurves
    .map(({ curve, shape, peak }) => ({
      curve,
      peak,
      correlation: correlationWithReference(shape, reference),
    }))
    .filter(
      ({ peak, correlation }) =>
        peak > 0 && correlation >= PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CORRELATION,
    )
    .sort(
      (left, right) =>
        left.peak - right.peak || left.curve.skillSlug.localeCompare(right.curve.skillSlug),
    );

  let left = 0;
  let bestStart = 0;
  let bestLength = 0;
  for (let right = 0; right < alignedByPeak.length; right += 1) {
    while (
      left < right &&
      alignedByPeak[right].peak / alignedByPeak[left].peak >
        PUBLISHER_ABUSE_OWNER_SYNCHRONY_MAX_PEAK_RATIO
    ) {
      left += 1;
    }
    const length = right - left + 1;
    if (length > bestLength) {
      bestStart = left;
      bestLength = length;
    }
  }
  const bestCluster = alignedByPeak.slice(bestStart, bestStart + bestLength);

  if (bestCluster.length < 2 || bestCluster.length * 2 <= normalizedCurves.length) return null;
  const catalogCoverage = bestCluster.length / publisherSkillCount;
  if (catalogCoverage < PUBLISHER_ABUSE_OWNER_SYNCHRONY_MIN_CATALOG_COVERAGE) return null;
  const clusterCorrelations = bestCluster.map(({ correlation }) => correlation);
  const clusterPeaks = bestCluster.map(({ peak }) => peak);
  const sortedCluster = [...bestCluster].sort((candidateA, candidateB) =>
    candidateA.curve.skillSlug.localeCompare(candidateB.curve.skillSlug),
  );
  return {
    skillIds: sortedCluster.map(({ curve }) => curve.skillId),
    correlationFloor: Math.min(...clusterCorrelations),
    correlationMedian: median(clusterCorrelations),
    peak7DownloadsMin: Math.min(...clusterPeaks),
    peak7DownloadsMax: Math.max(...clusterPeaks),
    catalogCoverage,
  };
}
