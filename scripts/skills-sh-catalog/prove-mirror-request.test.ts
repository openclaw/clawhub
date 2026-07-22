import { describe, expect, it } from "vitest";
import {
  buildMirrorProofHeaders,
  findRecoverableMirrorRun,
  mirrorRateLimitRetryDelayMs,
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
      status: "running",
      page: 0,
      offset: 50,
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T21:18:13.365Z",
      startedAt: 2,
    });
  });

  it("bounds rate-limit recovery delays while preserving Retry-After", () => {
    expect(mirrorRateLimitRetryDelayMs(429, "17", 0)).toBe(17_000);
    expect(mirrorRateLimitRetryDelayMs(429, "120", 0)).toBe(120_000);
    expect(mirrorRateLimitRetryDelayMs(429, null, 3)).toBe(8_000);
    expect(mirrorRateLimitRetryDelayMs(502, "17", 0)).toBeNull();
  });
});
