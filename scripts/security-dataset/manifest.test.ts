import { describe, expect, it } from "vitest";
import { buildSecurityDatasetManifest, inferConvexProject } from "./manifest";

describe("security dataset manifest", () => {
  it("includes dataset lineage fields from the spec", () => {
    const manifest = buildSecurityDatasetManifest({
      snapshotId: "clawhub-prod-20260430T000000Z-abcdef12",
      createdAt: "2026-04-30T00:00:00.000Z",
      repoGitSha: "abcdef123456",
      convexDeployment: "amantus:clawdhub:prod",
      exportMode: "public",
      pageSize: 50,
      concurrency: 6,
      shards: 12,
      shardCount: 24,
      rowCounts: {
        sourceArtifacts: 1,
        artifacts: 1,
        scanResults: 2,
        staticFindings: 3,
        labels: 4,
        splits: 1,
      },
      scannerVersions: ["v2.4.2"],
      modelNames: ["gpt-5-mini"],
      redactionPolicyVersion: "public-signals-v1",
      sourceTables: ["skillVersions", "packageReleases"],
      timeWindow: { createdAtGte: 1777507200000, createdAtLt: 1780185600000 },
    });

    expect(manifest).toMatchObject({
      repo_git_sha: "abcdef123456",
      source_commit: "abcdef123456",
      convex_deployment: "amantus:clawdhub:prod",
      convex_project: "clawdhub",
      created_time_window: {
        created_at_gte: 1777507200000,
        created_at_lt: 1780185600000,
      },
    });
  });

  it("leaves the project null when Convex only provides a deployment name", () => {
    expect(inferConvexProject("wry-manatee-359")).toBeNull();
  });
});
