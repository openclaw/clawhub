export type SecurityScanQueueHealth = {
  snapshotAt: number;
  queueDepth: number;
  queueDepthIsEstimate: boolean;
  readyQueueDepth: number;
  readyQueueDepthIsEstimate: boolean;
  oldestReadyJobAgeSeconds: number;
  oldestReadyJobNextRunAt: number | null;
};

export type SecurityScanJobHealth = {
  completed: boolean;
  durationMs: number;
  failureStage?: "scanner" | "judge" | "unclassified";
  judgeStageFailed: boolean;
  scannerStageFailed: boolean;
  timedOut: boolean;
  verdict?: string;
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
  clawscan: {
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
  durationMs: number;
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

export function calculateSecurityScanWorkerHealthSummary(input: {
  durationMs: number;
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
    if (outcome.completed) incrementVerdict(verdicts, outcome.verdict);
  }

  return {
    clawscan: {
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
    queueHealth: input.queueHealth,
    queueHealthError: input.queueHealthError,
    throughputPerMinute:
      input.durationMs > 0 ? (input.outcomes.length * 60_000) / input.durationMs : 0,
    totalClaimed: input.pool.totalClaimed,
    workerId: input.workerId,
  };
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
    `**Scanner:** \`clawscan\`  `,
    `**Worker:** \`${summary.workerId}\`  `,
    `**Run duration:** ${formatDuration(summary.durationMs)}  `,
    `**Throughput:** ${summary.throughputPerMinute.toFixed(2)} scans/min`,
    "",
    "| ClawScan scans | Count |",
    "| --- | ---: |",
    `| Completed | ${summary.clawscan.completed} |`,
    `| Failed | ${summary.clawscan.failed} |`,
    `| Timed out | ${summary.clawscan.timedOut} |`,
    `| Scanner-stage failures | ${summary.clawscan.scannerStageFailures} |`,
    `| Judge-stage failures | ${summary.clawscan.judgeStageFailures} |`,
    `| Unclassified failures | ${summary.clawscan.unclassifiedFailures} |`,
    `| Average duration | ${formatDuration(summary.clawscan.averageDurationMs)} |`,
    `| Claim failures | ${summary.claimFailures} |`,
    "",
    "| ClawScan verdict | Count |",
    "| --- | ---: |",
    `| Benign | ${summary.clawscan.verdicts.benign} |`,
    `| Suspicious | ${summary.clawscan.verdicts.suspicious} |`,
    `| Malicious | ${summary.clawscan.verdicts.malicious} |`,
    `| Unknown | ${summary.clawscan.verdicts.unknown} |`,
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

  return `${lines.join("\n")}\n`;
}
