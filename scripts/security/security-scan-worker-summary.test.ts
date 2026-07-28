/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  calculateSecurityScanWorkerHealthSummary,
  renderSecurityScanWorkerSummaryMarkdown,
  type SecurityScanJobHealth,
} from "./security-scan-worker-summary";

function outcome(overrides: Partial<SecurityScanJobHealth> = {}): SecurityScanJobHealth {
  return {
    completed: true,
    durationMs: 30_000,
    judgeStageFailed: false,
    scannerStageFailed: false,
    timedOut: false,
    verdict: "benign",
    ...overrides,
  };
}

describe("security scan worker summary", () => {
  it("calculates ClawScan health, throughput, queue age, and verdict totals", () => {
    const summary = calculateSecurityScanWorkerHealthSummary({
      durationMs: 120_000,
      outcomes: [
        outcome(),
        outcome({
          durationMs: 60_000,
          scannerStageFailed: true,
          verdict: "suspicious",
        }),
        outcome({
          completed: false,
          durationMs: 90_000,
          failureStage: "judge",
          judgeStageFailed: true,
          timedOut: true,
          verdict: undefined,
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
      clawscan: {
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
    expect(markdown).toContain("**Scanner:** `clawscan`");
    expect(markdown).toContain("| Completed | 2 |");
    expect(markdown).toContain("| Timed out | 1 |");
    expect(markdown).toContain("- Queued: >=512");
    expect(markdown).toContain("- Oldest ready job age: 15.0 min");
    expect(markdown).not.toContain("secondary");
  });

  it("reports unavailable queue diagnostics without changing scan health", () => {
    const summary = calculateSecurityScanWorkerHealthSummary({
      durationMs: 60_000,
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

    expect(summary.clawscan).toMatchObject({ completed: 1, failed: 0 });
    expect(renderSecurityScanWorkerSummaryMarkdown(summary)).toContain(
      "- Unavailable: queue health request failed",
    );
  });
});
