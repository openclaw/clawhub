/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  calculateSecurityScanWorkerHealthSummary,
  renderSecurityScanWorkerSummaryMarkdown,
  type SecurityScanJobHealth,
} from "./security-scan-worker-summary";

function outcome(overrides: Partial<SecurityScanJobHealth> = {}): SecurityScanJobHealth {
  return {
    authoritativeVerdict: "benign",
    completed: true,
    durationMs: 30_000,
    judgeStageFailed: false,
    scannerStageFailed: false,
    timedOut: false,
    ...overrides,
  };
}

describe("security scan worker summary", () => {
  it("calculates authoritative health, throughput, queue age, and verdict totals", () => {
    const summary = calculateSecurityScanWorkerHealthSummary({
      durationMs: 120_000,
      mode: "legacy",
      outcomes: [
        outcome(),
        outcome({
          authoritativeVerdict: "suspicious",
          durationMs: 60_000,
          scannerStageFailed: true,
        }),
        outcome({
          authoritativeVerdict: undefined,
          completed: false,
          durationMs: 90_000,
          failureStage: "judge",
          judgeStageFailed: true,
          timedOut: true,
        }),
      ],
      pool: {
        totalClaimed: 3,
        totalClaimFailures: 1,
        totalCompleted: 2,
        totalFailed: 0,
        totalRetryableFailed: 1,
      },
      queueHealth: {
        snapshotAt: 1_000_000,
        queueDepth: 512,
        queueDepthIsEstimate: true,
        readyQueueDepth: 7,
        readyQueueDepthIsEstimate: false,
        oldestReadyJobAgeSeconds: 900,
        oldestReadyJobNextRunAt: 100_000,
      },
      workerId: "fixture-worker",
    });

    expect(summary).toMatchObject({
      authoritative: {
        averageDurationMs: 60_000,
        completed: 2,
        failed: 1,
        judgeStageFailures: 1,
        scannerStageFailures: 1,
        timedOut: 1,
        verdicts: {
          benign: 1,
          suspicious: 1,
          malicious: 0,
          unknown: 0,
        },
      },
      claimFailures: 1,
      throughputPerMinute: 1.5,
    });
    const markdown = renderSecurityScanWorkerSummaryMarkdown(summary);
    expect(markdown).toContain("| Completed | 2 |");
    expect(markdown).toContain("| Timed out | 1 |");
    expect(markdown).toContain("- Queued: >=512");
    expect(markdown).toContain("- Oldest ready job age: 15.0 min");
  });

  it("calculates verdict pairs, exact match rate, failures, and disagreement direction", () => {
    const summary = calculateSecurityScanWorkerHealthSummary({
      durationMs: 60_000,
      mode: "clawscan",
      outcomes: [
        outcome({
          authoritativeVerdict: "benign",
          comparison: {
            authoritativeVerdict: "benign",
            secondaryJudgeStageFailed: false,
            secondaryScannerStageFailed: false,
            secondaryStatus: "completed",
            secondaryTimedOut: false,
            secondaryVerdict: "benign",
          },
        }),
        outcome({
          authoritativeVerdict: "malicious",
          comparison: {
            authoritativeVerdict: "malicious",
            secondaryJudgeStageFailed: false,
            secondaryScannerStageFailed: false,
            secondaryStatus: "completed",
            secondaryTimedOut: false,
            secondaryVerdict: "suspicious",
          },
        }),
        outcome({
          authoritativeVerdict: "suspicious",
          comparison: {
            authoritativeVerdict: "suspicious",
            secondaryJudgeStageFailed: false,
            secondaryScannerStageFailed: false,
            secondaryStatus: "completed",
            secondaryTimedOut: false,
            secondaryVerdict: "malicious",
          },
        }),
        outcome({
          authoritativeVerdict: "benign",
          comparison: {
            authoritativeVerdict: "benign",
            secondaryFailureStage: "scanner",
            secondaryJudgeStageFailed: false,
            secondaryScannerStageFailed: true,
            secondaryStatus: "failed",
            secondaryTimedOut: true,
          },
        }),
      ],
      pool: {
        totalClaimed: 4,
        totalClaimFailures: 0,
        totalCompleted: 4,
        totalFailed: 0,
        totalRetryableFailed: 0,
      },
      workerId: "fixture-worker",
    });

    expect(summary.comparison).toEqual({
      authoritativeMoreSevere: 1,
      completedPairs: 3,
      exactMatchRate: 33.33,
      exactMatches: 1,
      pairs: {
        "benign -> benign": 1,
        "malicious -> suspicious": 1,
        "suspicious -> malicious": 1,
      },
      secondaryFailures: 1,
      secondaryJudgeStageFailures: 0,
      secondaryMoreSevere: 1,
      secondaryScannerStageFailures: 1,
      secondaryTimedOut: 1,
      unknownDirection: 0,
    });
    const markdown = renderSecurityScanWorkerSummaryMarkdown(summary);
    expect(markdown).toContain("Exact matches: 1 (33.33%)");
    expect(markdown).toContain("| `malicious -> suspicious` | 1 |");
    expect(markdown).toContain("Secondary scanner-stage failures: 1");
  });

  it("reports unavailable queue diagnostics without changing scan health", () => {
    const summary = calculateSecurityScanWorkerHealthSummary({
      durationMs: 60_000,
      mode: "clawscan",
      outcomes: [outcome()],
      pool: {
        totalClaimed: 1,
        totalClaimFailures: 0,
        totalCompleted: 1,
        totalFailed: 0,
        totalRetryableFailed: 0,
      },
      queueHealthError: "queue health request failed",
      workerId: "fixture-worker",
    });

    expect(summary.authoritative).toMatchObject({ completed: 1, failed: 0 });
    expect(renderSecurityScanWorkerSummaryMarkdown(summary)).toContain(
      "- Unavailable: queue health request failed",
    );
  });
});
