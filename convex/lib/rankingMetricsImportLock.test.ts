import { afterEach, describe, expect, it } from "vitest";
import {
  assertRankingMetricWritesAllowed,
  RANKING_METRICS_IMPORT_LOCK_ENV,
} from "./rankingMetricsImportLock";

const original = process.env[RANKING_METRICS_IMPORT_LOCK_ENV];

afterEach(() => {
  if (original === undefined) delete process.env[RANKING_METRICS_IMPORT_LOCK_ENV];
  else process.env[RANKING_METRICS_IMPORT_LOCK_ENV] = original;
});

describe("ranking metric import write lock", () => {
  it("blocks aggregate writes while an import lock is active", () => {
    process.env[RANKING_METRICS_IMPORT_LOCK_ENV] =
      "ranking-metrics-2026-07-23-v1:12345:1784930400000";
    expect(() => assertRankingMetricWritesAllowed(1_784_930_000_000)).toThrow("temporarily paused");
  });

  it("fails closed for malformed locks and allows expired locks", () => {
    process.env[RANKING_METRICS_IMPORT_LOCK_ENV] = "malformed";
    expect(() => assertRankingMetricWritesAllowed(1_784_930_000_000)).toThrow("temporarily paused");

    process.env[RANKING_METRICS_IMPORT_LOCK_ENV] =
      "ranking-metrics-2026-07-23-v1:12345:1784920000000";
    expect(() => assertRankingMetricWritesAllowed(1_784_930_000_000)).not.toThrow();
  });
});
