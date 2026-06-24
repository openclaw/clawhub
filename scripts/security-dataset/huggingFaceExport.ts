import {
  hashString,
  type ArtifactRow,
  type DatasetSplit,
  type LabelRow,
  type NormalizedDatasetRows,
  type ScanResultRow,
  type StaticFindingRow,
} from "./normalize";

export type HuggingFaceSecuritySignalRow = {
  id: string;
  skill_slug: string | null;
  skill_version: string;
  skill_md_content: string | null;
  skill_bundle_content: Array<{
    path: string;
    content: string;
    sha256: string;
    sizeBytes: number;
  }>;
  clawscan_verdict: string;
  clawscan_confidence: string | null;
  clawscan_model: string | null;
  clawscan_summary: string | null;
  static_status: string | null;
  static_finding_count: number;
  static_reason_codes: string[];
  virustotal_status: string | null;
  virustotal_malicious_count: number | null;
  virustotal_suspicious_count: number | null;
  virustotal_harmless_count: number | null;
  virustotal_undetected_count: number | null;
  skillspector_status: string | null;
  skillspector_score: number | null;
  skillspector_severity: string | null;
  skillspector_issue_count: number;
  skillspector_issue_codes: string[];
  skillspector_issue_categories: string[];
  clawscan_context: Record<string, unknown>;
  split: DatasetSplit;
};

export function buildHuggingFaceSecuritySignalRows(
  rows: NormalizedDatasetRows,
): HuggingFaceSecuritySignalRow[] {
  const scansByArtifact = groupBy(rows.scanResults, (row) => row.artifact_id);
  const labelsByArtifact = groupBy(rows.labels, (row) => row.artifact_id);
  const staticFindingsByArtifact = groupBy(rows.staticFindings, (row) => row.artifact_id);
  const splitByArtifact = new Map(rows.splits.map((row) => [row.artifact_id, row.split]));

  return rows.artifacts.flatMap((artifact) => {
    if (artifact.source_kind !== "skill" || !artifact.is_public || artifact.soft_deleted) {
      return [];
    }
    const scans = scansByArtifact.get(artifact.artifact_id) ?? [];
    const labels = labelsByArtifact.get(artifact.artifact_id) ?? [];
    const staticFindings = staticFindingsByArtifact.get(artifact.artifact_id) ?? [];
    const split = splitByArtifact.get(artifact.artifact_id);
    if (!split) return [];

    const staticScan = scanByName(scans, "static");
    const vtScan = scanByName(scans, "virustotal");
    const skillSpectorScan = scanByName(scans, "skillspector");
    const llmScan = scanByName(scans, "llm");
    const verdict = labelBySource(labels, "moderation_consensus")?.label ?? "unknown";

    return [
      {
        id: flatArtifactId(artifact),
        skill_slug: artifact.public_qualified_slug ?? artifact.public_slug,
        skill_version: artifact.version,
        skill_md_content: artifact.skill_md_content_redacted ?? null,
        skill_bundle_content: (artifact.bundle_files_redacted ?? []).map((file) => ({
          path: file.path,
          content: file.content,
          sha256: file.sha256,
          sizeBytes: file.size_bytes,
        })),
        clawscan_verdict: verdict,
        clawscan_confidence: llmScan?.confidence ?? null,
        clawscan_model: llmScan?.model ?? null,
        clawscan_summary: llmScan?.summary_redacted ?? null,
        static_status: staticScan?.status ?? null,
        static_finding_count: staticFindings.length,
        static_reason_codes: staticScan?.reason_codes ?? [],
        virustotal_status: vtScan?.status ?? null,
        virustotal_malicious_count: vtScan?.engine_stats?.malicious ?? null,
        virustotal_suspicious_count: vtScan?.engine_stats?.suspicious ?? null,
        virustotal_harmless_count: vtScan?.engine_stats?.harmless ?? null,
        virustotal_undetected_count: vtScan?.engine_stats?.undetected ?? null,
        skillspector_status: skillSpectorScan?.status ?? null,
        skillspector_score: skillSpectorScan?.score ?? null,
        skillspector_severity: skillSpectorScan?.severity ?? null,
        skillspector_issue_count: skillSpectorScan?.issues?.length ?? 0,
        skillspector_issue_codes: skillSpectorScan?.reason_codes ?? [],
        skillspector_issue_categories: uniqueSorted(
          (skillSpectorScan?.issues ?? []).flatMap((issue) =>
            issue.category ? [issue.category] : [],
          ),
        ),
        clawscan_context: buildClawScanContext({
          staticScan,
          vtScan,
          skillSpectorScan,
          staticFindings,
        }),
        split,
      },
    ];
  });
}

function buildClawScanContext(input: {
  staticScan: ScanResultRow | undefined;
  vtScan: ScanResultRow | undefined;
  skillSpectorScan: ScanResultRow | undefined;
  staticFindings: StaticFindingRow[];
}) {
  const context: Record<string, unknown> = {};
  const { staticScan, vtScan, skillSpectorScan, staticFindings } = input;
  if (staticScan) {
    context.static = {
      status: staticScan.status,
      verdict: staticScan.verdict,
      reason_codes: staticScan.reason_codes,
      summary: staticScan.summary_redacted,
      checked_at: isoTime(staticScan.checked_at),
      scanner_version: staticScan.scanner_version,
      finding_count: staticFindings.length,
    };
  }
  if (vtScan) {
    context.virustotal = {
      status: vtScan.status,
      verdict: vtScan.verdict,
      checked_at: isoTime(vtScan.checked_at),
      scanner_version: vtScan.scanner_version,
      engine_stats: vtScan.engine_stats,
    };
  }
  if (skillSpectorScan) {
    context.skillspector = {
      status: skillSpectorScan.status,
      verdict: skillSpectorScan.verdict,
      checked_at: isoTime(skillSpectorScan.checked_at),
      scanner_version: skillSpectorScan.scanner_version,
      issue_codes: skillSpectorScan.reason_codes,
      score: skillSpectorScan.score ?? null,
      severity: skillSpectorScan.severity ?? null,
      issue_count: skillSpectorScan.issues?.length ?? 0,
      issues: (skillSpectorScan.issues ?? []).map((issue) => ({
        code: issue.code,
        category: issue.category,
        severity: issue.severity,
        confidence: issue.confidence,
        explanation: issue.explanation_redacted,
      })),
    };
  }
  return context;
}

function flatArtifactId(artifact: ArtifactRow) {
  if (artifact.artifact_sha256) return artifact.artifact_sha256;
  return hashString(artifact.artifact_id);
}

function scanByName(scans: ScanResultRow[], scanner: ScanResultRow["scanner"]) {
  return scans.find((row) => row.scanner === scanner);
}

function labelBySource(labels: LabelRow[], source: LabelRow["label_source"]) {
  return labels.find((row) => row.label_source === source);
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function isoTime(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}
