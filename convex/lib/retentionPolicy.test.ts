/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  RETENTION_POLICIES,
  RETENTION_STANDARD_BATCH_SIZE,
  getRetentionPolicy,
} from "./retentionPolicy";

describe("retention policies", () => {
  it("classifies auth session tables as indexed expiring tables", () => {
    expect(getRetentionPolicy("authSessions")).toMatchObject({
      classification: "ephemeral",
      expirationField: "expirationTime",
      expirationIndex: "by_expiration_time",
      prune: "retention.pruneExpiredAuthSessionsInternal",
    });
    expect(getRetentionPolicy("authRefreshTokens")).toMatchObject({
      classification: "ephemeral",
      expirationField: "expirationTime",
      expirationIndex: "by_expiration_time",
      prune: "retention.pruneExpiredAuthRefreshTokensInternal",
    });
  });

  it("uses one standard batch size for retention jobs", () => {
    expect(RETENTION_STANDARD_BATCH_SIZE).toBe(500);
    const batchSizes = Object.values(RETENTION_POLICIES)
      .filter((policy) => policy.classification === "ephemeral")
      .map((policy) => policy.standardBatchSize);

    expect(batchSizes.length).toBeGreaterThan(0);
    expect(new Set(batchSizes)).toEqual(new Set([RETENTION_STANDARD_BATCH_SIZE]));
  });

  it("documents active expiring operational tables", () => {
    expect(getRetentionPolicy("rateLimitCounters")).toMatchObject({
      classification: "ephemeral",
      expirationField: "expiresAt",
      expirationIndex: "by_expires_at",
    });
  });
});
