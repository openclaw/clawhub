export type SnapshotManifestInput = {
  snapshotId: string;
  sourceSnapshotId?: string | null;
  createdAt: string;
  repoGitSha: string;
  convexDeployment: string;
  exportMode: "public";
  pageSize: number;
  concurrency: number;
  shards: number;
  shardCount: number;
  rowCounts: {
    sourceArtifacts: number;
    artifacts: number;
    scanResults: number;
    staticFindings: number;
    clawScanFindings: number;
    labels: number;
    splits: number;
    huggingFaceRows?: number;
  };
  outputSizes?: Record<string, number>;
  scannerVersions: string[];
  modelNames: string[];
  redactionPolicyVersion: string;
  sourceTables: string[];
  timeWindow?: {
    createdAtGte: number | null;
    createdAtLt: number | null;
  };
  huggingFaceDataset?: {
    repo: string;
    revision: string;
    commit: string | null;
    configNames: string[];
    splitNames: string[];
    rowCountsBySplit: Record<string, number>;
  };
};

export function buildSecurityDatasetManifest(input: SnapshotManifestInput) {
  return {
    snapshot_id: input.snapshotId,
    source_snapshot_id: input.sourceSnapshotId ?? input.snapshotId,
    created_at: input.createdAt,
    repo_git_sha: input.repoGitSha,
    convex_deployment: input.convexDeployment,
    convex_project: inferConvexProject(input.convexDeployment),
    export_mode: input.exportMode,
    page_size: input.pageSize,
    concurrency: input.concurrency,
    shards: input.shards,
    shard_count: input.shardCount,
    row_counts: {
      source_artifacts: input.rowCounts.sourceArtifacts,
      artifacts: input.rowCounts.artifacts,
      scan_results: input.rowCounts.scanResults,
      static_findings: input.rowCounts.staticFindings,
      clawscan_findings: input.rowCounts.clawScanFindings,
      labels: input.rowCounts.labels,
      splits: input.rowCounts.splits,
      huggingface_rows: input.rowCounts.huggingFaceRows ?? 0,
    },
    output_sizes: input.outputSizes ?? {},
    scanner_versions: input.scannerVersions,
    model_names: input.modelNames,
    redaction_policy_version: input.redactionPolicyVersion,
    source_tables: input.sourceTables,
    source_commit: input.repoGitSha,
    created_time_window: {
      created_at_gte: input.timeWindow?.createdAtGte ?? null,
      created_at_lt: input.timeWindow?.createdAtLt ?? null,
    },
    huggingface_dataset: input.huggingFaceDataset ?? null,
  };
}

export function inferConvexProject(convexDeployment: string) {
  const parts = convexDeployment.split(":");
  if (parts.length >= 3 && parts[1]) return parts[1];
  return null;
}
