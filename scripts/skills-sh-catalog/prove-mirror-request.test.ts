import { describe, expect, it } from "vitest";
import {
  buildMirrorStepRequest,
  buildMirrorProofHeaders,
  capturedMirrorSourceRunId,
  findCompletedLiveMirrorRun,
  findRecoverableMirrorRun,
  mirrorRateLimitRetryDelayMs,
  reconcileMirrorRunToCompletion,
  resolveCompletedLiveMirrorRun,
  mirrorRunFromPayload,
  mirrorRunAccounting,
} from "./prove-mirror-request";

describe("skills.sh mirror proof request headers", () => {
  it("carries the Test deployment protection bypass without changing operator auth", () => {
    expect(buildMirrorProofHeaders("operator-token", " bypass-secret ")).toEqual({
      Authorization: "Bearer operator-token",
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": "bypass-secret",
    });
  });

  it("omits the bypass header outside protected deployments", () => {
    expect(buildMirrorProofHeaders("operator-token")).toEqual({
      Authorization: "Bearer operator-token",
      "Content-Type": "application/json",
    });
  });

  it("selects the newest durable active run for interruption recovery", () => {
    expect(
      findRecoverableMirrorRun({
        runs: [
          {
            runId: "completed-run",
            status: "completed",
            page: 20,
            offset: 0,
            sourceTotal: 9_571,
            sourcePageSize: 500,
            sourceMeasuredAt: "2026-07-22T20:14:00.000Z",
            startedAt: 1,
          },
          {
            runId: "active-run",
            snapshotId: "skills-sh:2026-07-22T21:18:13.365Z:9571",
            status: "running",
            page: 0,
            offset: 50,
            sourceTotal: 9_571,
            sourcePageSize: 500,
            sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
            startedAt: 2,
          },
        ],
      }),
    ).toEqual({
      runId: "active-run",
      snapshotId: "skills-sh:2026-07-22T21:18:13.365Z:9571",
      status: "running",
      page: 0,
      offset: 50,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 2,
    });
  });

  it("normalizes direct and nested mirror run responses", () => {
    expect(mirrorRunFromPayload({ runId: "run", status: "completed" }, "reconcile")).toEqual({
      runId: "run",
      status: "completed",
    });
    expect(
      mirrorRunFromPayload(
        { run: { runId: "run", status: "reconciling" }, cursor: "next" },
        "reconcile",
      ),
    ).toEqual({
      runId: "run",
      status: "reconciling",
    });
    expect(() => mirrorRunFromPayload({ runId: "run" }, "start-replay")).toThrow(
      'start-replay mirror response lacks run status: {"runId":"run"}',
    );
  });

  it("keeps a resumed captured run on the replay operation and exact cursor", () => {
    expect(
      buildMirrorStepRequest({
        runId: "captured-run",
        page: 1,
        offset: 50,
        capturedSource: {
          externalIds: Array.from({ length: 175 }, (_, index) => `owner/repo/skill-${index}`),
          sourcePageSize: 100,
        },
      }),
    ).toMatchObject({
      operation: "step-replay",
      runId: "captured-run",
      page: 1,
      offset: 50,
      pageLength: 75,
      hasMore: false,
      sourceTotal: 175,
      externalIds: Array.from({ length: 25 }, (_, index) => `owner/repo/skill-${index + 150}`),
    });
  });

  it("keeps live source steps bound to the server-side run", () => {
    expect(
      buildMirrorStepRequest({
        runId: "live-run",
        page: 3,
        offset: 50,
      }),
    ).toEqual({
      operation: "step",
      runId: "live-run",
      page: 3,
      offset: 50,
    });
  });

  it("normalizes reconciliation responses through completion", async () => {
    const responses = [
      { run: { runId: "run", status: "reconciling", page: 20, offset: 0 } },
      { runId: "run", status: "completed", page: 20, offset: 0 },
    ];
    const reconcile = vi.fn(async () => responses.shift()!);

    await expect(
      reconcileMirrorRunToCompletion(
        { runId: "run", status: "reconciling", page: 20, offset: 0 },
        reconcile,
      ),
    ).resolves.toEqual({
      run: { runId: "run", status: "completed", page: 20, offset: 0 },
      reconciliationBatches: 2,
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("ties a captured replay recovery to its completed authenticated source run", () => {
    const liveRun = {
      runId: "live-run",
      snapshotId: "skills-sh:2026-07-22T21:18:13.365Z:9571",
      status: "completed",
      page: 20,
      offset: 0,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 1,
      completedAt: 2,
      counts: { observed: 9_571 },
      operations: { sourceRequests: 18_360 },
    };
    const payload = { runs: [{ ...liveRun, status: "running" }, liveRun] };

    expect(capturedMirrorSourceRunId("skills-sh-captured:live-run")).toBe("live-run");
    expect(capturedMirrorSourceRunId("skills-sh:live-run")).toBeNull();
    expect(findCompletedLiveMirrorRun(payload, "live-run")).toEqual(liveRun);
    expect(findCompletedLiveMirrorRun(liveRun, "live-run")).toEqual(liveRun);
    expect(findCompletedLiveMirrorRun(payload, "missing")).toBeNull();
  });

  it("resolves a completed captured ancestor to its authenticated live source run", async () => {
    const liveRun = {
      runId: "live-run",
      snapshotId: "skills-sh:2026-07-22T21:18:13.365Z:9571",
      status: "completed" as const,
      page: 20,
      offset: 0,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 1,
      completedAt: 2,
      counts: { observed: 9_571 },
      operations: { sourceRequests: 18_360 },
    };
    const capturedRun = {
      ...liveRun,
      runId: "captured-run",
      snapshotId: "skills-sh-captured:live-run",
      startedAt: 3,
      completedAt: 4,
    };
    const readRun = vi.fn(async (runId: string) => {
      expect(runId).toBe("live-run");
      return liveRun;
    });

    await expect(
      resolveCompletedLiveMirrorRun({
        payload: { runs: [capturedRun] },
        runId: "captured-run",
        readRun,
      }),
    ).resolves.toEqual(liveRun);
    expect(readRun).toHaveBeenCalledTimes(1);
  });

  it("bounds cyclic captured-run lineage", async () => {
    const completedRun = {
      status: "completed" as const,
      page: 20,
      offset: 0,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 1,
      completedAt: 2,
      counts: { observed: 9_571 },
      operations: { sourceRequests: 18_360 },
    };
    const first = {
      ...completedRun,
      runId: "first",
      snapshotId: "skills-sh-captured:second",
    };
    const second = {
      ...completedRun,
      runId: "second",
      snapshotId: "skills-sh-captured:first",
    };
    const readRun = vi.fn(async (runId: string) => (runId === "first" ? first : second));

    await expect(
      resolveCompletedLiveMirrorRun({
        payload: { runs: [first] },
        runId: "first",
        readRun,
      }),
    ).resolves.toBeNull();
    expect(readRun).toHaveBeenCalledTimes(1);
  });

  it("treats a missing captured ancestor as stale lineage", async () => {
    const capturedRun = {
      runId: "captured-run",
      snapshotId: "skills-sh-captured:missing-live-run",
      status: "completed" as const,
      page: 20,
      offset: 0,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 1,
      completedAt: 2,
      counts: { observed: 9_571 },
      operations: { sourceRequests: 18_360 },
    };
    const readRun = vi.fn(async () => null);

    await expect(
      resolveCompletedLiveMirrorRun({
        payload: { runs: [capturedRun] },
        runId: "captured-run",
        readRun,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed without canceling when captured lineage exceeds the read bound", async () => {
    const completedRun = {
      status: "completed" as const,
      page: 20,
      offset: 0,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 1,
      completedAt: 2,
      counts: { observed: 9_571 },
      operations: { sourceRequests: 18_360 },
    };
    const runs = new Map(
      Array.from({ length: 9 }, (_, index) => [
        `captured-${index}`,
        {
          ...completedRun,
          runId: `captured-${index}`,
          snapshotId: `skills-sh-captured:captured-${index + 1}`,
        },
      ]),
    );

    await expect(
      resolveCompletedLiveMirrorRun({
        payload: { runs: [runs.get("captured-0")] },
        runId: "captured-0",
        readRun: async (runId) => runs.get(runId) ?? null,
      }),
    ).rejects.toThrow("captured mirror lineage exceeded 8 runs");
  });

  it("bounds rate-limit recovery delays while preserving Retry-After", () => {
    expect(mirrorRateLimitRetryDelayMs(429, "17", 0)).toBe(17_000);
    expect(mirrorRateLimitRetryDelayMs(429, "120", 0)).toBe(120_000);
    expect(mirrorRateLimitRetryDelayMs(429, null, 3)).toBe(8_000);
    expect(mirrorRateLimitRetryDelayMs(502, "17", 0)).toBeNull();
  });

  it("accounts fail-closed identity conflicts separately from source quarantines", () => {
    expect(
      mirrorRunAccounting(9_571, {
        conflicts: 205,
        rejected: 205,
        quarantined: 166,
      }),
    ).toEqual({
      accepted: 9_366,
      rejected: 205,
      quarantined: 166,
    });
  });

  it("rejects unrecorded failures and impossible quarantine counts", () => {
    expect(() =>
      mirrorRunAccounting(100, {
        rejected: 0,
        quarantined: 0,
      }),
    ).toThrow("mirror conflicts must be a nonnegative integer");
    expect(() =>
      mirrorRunAccounting(100, {
        conflicts: 0,
        rejected: Number.NaN,
        quarantined: 0,
      }),
    ).toThrow("mirror rejected must be a nonnegative integer");
    expect(() =>
      mirrorRunAccounting(100, {
        conflicts: 4,
        rejected: 5,
        quarantined: 3,
      }),
    ).toThrow("mirror conflict accounting");
    expect(() =>
      mirrorRunAccounting(100, {
        conflicts: 5,
        rejected: 5,
        quarantined: 6,
      }),
    ).toThrow("mirror quarantine accounting");
  });
});
