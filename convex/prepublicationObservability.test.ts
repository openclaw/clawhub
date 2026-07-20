import { describe, expect, it, vi } from "vitest";
import {
  getPrePublicationQueueHealthInternal,
  logPrePublicationQueueHealthInternal,
} from "./prepublicationObservability";

const getQueueHealthHandler = (
  getPrePublicationQueueHealthInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const logQueueHealthHandler = (
  logPrePublicationQueueHealthInternal as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;

function makeQueueHealthCtx(attempts: Array<Record<string, unknown>>) {
  return {
    db: {
      query: vi.fn((table: string) => {
        expect(table).toBe("publishAttempts");
        return {
          withIndex: vi.fn(
            (
              indexName: string,
              buildRange: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
            ) => {
              expect(indexName).toBe("by_status_and_created");
              const equals = new Map<string, unknown>();
              const range = {
                eq(field: string, value: unknown) {
                  equals.set(field, value);
                  return range;
                },
              };
              buildRange(range);
              const matched = attempts
                .filter((attempt) =>
                  Array.from(equals.entries()).every(([field, value]) => attempt[field] === value),
                )
                .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
              return {
                order: vi.fn((direction: string) => {
                  expect(direction).toBe("asc");
                  return {
                    take: vi.fn(async (limit: number) => matched.slice(0, limit)),
                  };
                }),
              };
            },
          ),
        };
      }),
    },
  };
}

describe("prepublication observability", () => {
  it("reports timeout accumulation, active claims, and oldest ready age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const ctx = makeQueueHealthCtx([
      {
        status: "pending_checks",
        createdAt: 100_000,
        checkClaimExpiresAt: 0,
        checks: { clawscan: { status: "failed", summary: "clawscan timed out" } },
      },
      {
        status: "pending_checks",
        createdAt: 200_000,
        checkClaimExpiresAt: 1_100_000,
        checks: { clawscan: { status: "pending" } },
      },
      {
        status: "finalized",
        createdAt: 50_000,
        checks: { clawscan: { status: "clean" } },
      },
    ]);

    await expect(getQueueHealthHandler(ctx, {})).resolves.toEqual({
      snapshotAt: 1_000_000,
      pendingChecks: 2,
      pendingChecksIsEstimate: false,
      readyChecks: 1,
      activeClaims: 1,
      timeoutPending: 1,
      scannerFailurePending: 1,
      oldestPendingAgeSeconds: 900,
      oldestReadyAgeSeconds: 900,
    });
  });

  it("logs a structured event for Axiom monitors", async () => {
    const snapshot = {
      snapshotAt: 1_000_000,
      pendingChecks: 4,
      pendingChecksIsEstimate: false,
      readyChecks: 3,
      activeClaims: 1,
      timeoutPending: 2,
      scannerFailurePending: 2,
      oldestPendingAgeSeconds: 901,
      oldestReadyAgeSeconds: 901,
    };
    const runQuery = vi.fn(async () => snapshot);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(logQueueHealthHandler({ runQuery }, {})).resolves.toEqual(snapshot);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "prepublication_queue.snapshot",
        ...snapshot,
      }),
    );
  });
});
