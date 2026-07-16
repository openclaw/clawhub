export type SecurityScanMode = "legacy" | "shadow" | "clawscan";

export type SecurityScanQueueHealth = {
  snapshotAt: number;
  queueDepth: number;
  queueDepthIsEstimate: boolean;
  readyQueueDepth: number;
  readyQueueDepthIsEstimate: boolean;
  oldestReadyJobAgeSeconds: number;
  oldestReadyJobNextRunAt: number | null;
};

export type SecurityScanComparisonOutcome = {
  authoritativeVerdict?: string;
  secondaryFailureStage?: "scanner" | "judge" | "unclassified";
  secondaryScannerStageFailed: boolean;
  secondaryJudgeStageFailed: boolean;
  secondaryStatus: "completed" | "failed";
  secondaryTimedOut: boolean;
  secondaryVerdict?: string;
};

export type SecurityScanJobHealth = {
  authoritativeVerdict?: string;
  comparison?: SecurityScanComparisonOutcome;
  completed: boolean;
  durationMs: number;
  failureStage?: "scanner" | "judge" | "unclassified";
  judgeStageFailed: boolean;
  scannerStageFailed: boolean;
  timedOut: boolean;
};

export type SecurityScanWorkerPoolStats = {
  totalClaimed: number;
  totalClaimFailures: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetryableFailed: number;
};

type VerdictTotals = {
  benign: number;
  suspicious: number;
  malicious: number;
  unknown: number;
};

export type SecurityScanWorkerHealthSummary = {
  authoritative: {
    averageDurationMs: number;
    completed: number;
    failed: number;
    judgeStageFailures: number;
    scannerStageFailures: number;
    timedOut: number;
    unclassifiedFailures: number;
    verdicts: VerdictTotals;
  };
  claimFailures: number;
  comparison?: {
    authoritativeMoreSevere: number;
    completedPairs: number;
    exactMatchRate: number | null;
    exactMatches: number;
    pairs: Record<string, number>;
    secondaryFailures: number;
    secondaryJudgeStageFailures: number;
    secondaryMoreSevere: number;
    secondaryScannerStageFailures: number;
    secondaryTimedOut: number;
    unknownDirection: number;
  };
  durationMs: number;
  mode: SecurityScanMode;
  queueHealth?: SecurityScanQueueHealth;
  queueHealthError?: string;
  throughputPerMinute: number;
  totalClaimed: number;
  workerId: string;
};

function normalizedVerdict(verdict: string | undefined) {
  const normalized = verdict?.trim().toLowerCase();
  return normalized === "clean" ? "benign" : normalized;
}

function incrementVerdict(totals: VerdictTotals, verdict: string | undefined) {
  const normalized = normalizedVerdict(verdict);
  if (normalized === "benign" || normalized === "suspicious" || normalized === "malicious") {
    totals[normalized] += 1;
  } else {
    totals.unknown += 1;
  }
}

function verdictSeverity(verdict: string | undefined) {
  const normalized = normalizedVerdict(verdict);
  if (normalized === "benign") return 0;
  if (normalized === "suspicious") return 1;
  if (normalized === "malicious") return 2;
  return undefined;
}

export function calculateSecurityScanWorkerHealthSummary(input: {
  durationMs: number;
  mode: SecurityScanMode;
  outcomes: SecurityScanJobHealth[];
  pool: SecurityScanWorkerPoolStats;
  queueHealth?: SecurityScanQueueHealth;
  queueHealthError?: string;
  workerId: string;
}): SecurityScanWorkerHealthSummary {
  const failed = input.outcomes.filter((outcome) => !outcome.completed).length;
  const completed = input.outcomes.length - failed;
  const durationTotal = input.outcomes.reduce((total, outcome) => total + outcome.durationMs, 0);
  const verdicts: VerdictTotals = {
    benign: 0,
    suspicious: 0,
    malicious: 0,
    unknown: 0,
  };
  for (const outcome of input.outcomes) {
    if (outcome.completed) incrementVerdict(verdicts, outcome.authoritativeVerdict);
  }

  const summary: SecurityScanWorkerHealthSummary = {
    authoritative: {
      averageDurationMs:
        input.outcomes.length > 0 ? Math.round(durationTotal / input.outcomes.length) : 0,
      completed,
      failed,
      judgeStageFailures: input.outcomes.filter((outcome) => outcome.judgeStageFailed).length,
      scannerStageFailures: input.outcomes.filter((outcome) => outcome.scannerStageFailed).length,
      timedOut: input.outcomes.filter((outcome) => outcome.timedOut).length,
      unclassifiedFailures: input.outcomes.filter(
        (outcome) => !outcome.completed && outcome.failureStage === "unclassified",
      ).length,
      verdicts,
    },
    claimFailures: input.pool.totalClaimFailures,
    durationMs: input.durationMs,
    mode: input.mode,
    queueHealth: input.queueHealth,
    queueHealthError: input.queueHealthError,
    throughputPerMinute:
      input.durationMs > 0 ? (input.outcomes.length * 60_000) / input.durationMs : 0,
    totalClaimed: input.pool.totalClaimed,
    workerId: input.workerId,
  };

  if (input.mode === "legacy") return summary;

  const comparisons = input.outcomes
    .map((outcome) => outcome.comparison)
    .filter((comparison): comparison is SecurityScanComparisonOutcome => Boolean(comparison));
  const pairs: Record<string, number> = {};
  let exactMatches = 0;
  let authoritativeMoreSevere = 0;
  let secondaryMoreSevere = 0;
  let unknownDirection = 0;
  const completedPairs = comparisons.filter(
    (comparison) =>
      comparison.secondaryStatus === "completed" &&
      Boolean(normalizedVerdict(comparison.authoritativeVerdict)) &&
      Boolean(normalizedVerdict(comparison.secondaryVerdict)),
  );

  for (const comparison of completedPairs) {
    const authoritative = normalizedVerdict(comparison.authoritativeVerdict) ?? "unknown";
    const secondary = normalizedVerdict(comparison.secondaryVerdict) ?? "unknown";
    const pair = `${authoritative} -> ${secondary}`;
    pairs[pair] = (pairs[pair] ?? 0) + 1;
    if (authoritative === secondary) {
      exactMatches += 1;
      continue;
    }
    const authoritativeSeverity = verdictSeverity(authoritative);
    const secondarySeverity = verdictSeverity(secondary);
    if (authoritativeSeverity === undefined || secondarySeverity === undefined) {
      unknownDirection += 1;
    } else if (authoritativeSeverity > secondarySeverity) {
      authoritativeMoreSevere += 1;
    } else {
      secondaryMoreSevere += 1;
    }
  }

  summary.comparison = {
    authoritativeMoreSevere,
    completedPairs: completedPairs.length,
    exactMatchRate:
      completedPairs.length > 0
        ? Math.round((exactMatches / completedPairs.length) * 10_000) / 100
        : null,
    exactMatches,
    pairs,
    secondaryFailures: comparisons.filter((comparison) => comparison.secondaryStatus === "failed")
      .length,
    secondaryJudgeStageFailures: comparisons.filter(
      (comparison) => comparison.secondaryJudgeStageFailed,
    ).length,
    secondaryMoreSevere,
    secondaryScannerStageFailures: comparisons.filter(
      (comparison) => comparison.secondaryScannerStageFailed,
    ).length,
    secondaryTimedOut: comparisons.filter((comparison) => comparison.secondaryTimedOut).length,
    unknownDirection,
  };
  return summary;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function estimatePrefix(isEstimate: boolean) {
  return isEstimate ? ">=" : "";
}

export function renderSecurityScanWorkerSummaryMarkdown(summary: SecurityScanWorkerHealthSummary) {
  const lines = [
    "## Security scan worker health",
    "",
    `**Mode:** \`${summary.mode}\`  `,
    `**Worker:** \`${summary.workerId}\`  `,
    `**Run duration:** ${formatDuration(summary.durationMs)}  `,
    `**Throughput:** ${summary.throughputPerMinute.toFixed(2)} scans/min`,
    "",
    "| Authoritative scans | Count |",
    "| --- | ---: |",
    `| Completed | ${summary.authoritative.completed} |`,
    `| Failed | ${summary.authoritative.failed} |`,
    `| Timed out | ${summary.authoritative.timedOut} |`,
    `| Scanner-stage failures | ${summary.authoritative.scannerStageFailures} |`,
    `| Judge-stage failures | ${summary.authoritative.judgeStageFailures} |`,
    `| Unclassified failures | ${summary.authoritative.unclassifiedFailures} |`,
    `| Average duration | ${formatDuration(summary.authoritative.averageDurationMs)} |`,
    `| Claim failures | ${summary.claimFailures} |`,
    "",
    "| Authoritative verdict | Count |",
    "| --- | ---: |",
    `| Benign | ${summary.authoritative.verdicts.benign} |`,
    `| Suspicious | ${summary.authoritative.verdicts.suspicious} |`,
    `| Malicious | ${summary.authoritative.verdicts.malicious} |`,
    `| Unknown | ${summary.authoritative.verdicts.unknown} |`,
  ];

  if (summary.queueHealth) {
    lines.push(
      "",
      "### Queue health",
      "",
      `- Queued: ${estimatePrefix(summary.queueHealth.queueDepthIsEstimate)}${summary.queueHealth.queueDepth}`,
      `- Ready now: ${estimatePrefix(summary.queueHealth.readyQueueDepthIsEstimate)}${summary.queueHealth.readyQueueDepth}`,
      `- Oldest ready job age: ${formatDuration(summary.queueHealth.oldestReadyJobAgeSeconds * 1_000)}`,
    );
  } else if (summary.queueHealthError) {
    lines.push("", "### Queue health", "", `- Unavailable: ${summary.queueHealthError}`);
  }

  if (summary.comparison) {
    const rate =
      summary.comparison.exactMatchRate === null
        ? "n/a"
        : `${summary.comparison.exactMatchRate.toFixed(2)}%`;
    lines.push(
      "",
      "### Authoritative vs secondary",
      "",
      `- Completed pairs: ${summary.comparison.completedPairs}`,
      `- Exact matches: ${summary.comparison.exactMatches} (${rate})`,
      `- Secondary failures: ${summary.comparison.secondaryFailures}`,
      `- Secondary timeouts: ${summary.comparison.secondaryTimedOut}`,
      `- Secondary scanner-stage failures: ${summary.comparison.secondaryScannerStageFailures}`,
      `- Secondary judge-stage failures: ${summary.comparison.secondaryJudgeStageFailures}`,
      `- Authoritative more severe: ${summary.comparison.authoritativeMoreSevere}`,
      `- Secondary more severe: ${summary.comparison.secondaryMoreSevere}`,
      `- Unknown disagreement direction: ${summary.comparison.unknownDirection}`,
      "",
      "| Verdict pair | Count |",
      "| --- | ---: |",
    );
    const pairs = Object.entries(summary.comparison.pairs).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (pairs.length === 0) {
      lines.push("| No completed pairs | 0 |");
    } else {
      for (const [pair, count] of pairs) lines.push(`| \`${pair}\` | ${count} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}
