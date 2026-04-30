import { describe, expect, it } from "vitest";
import { evaluateSnapshotRows } from "./eval";
import type { ArtifactRow, LabelRow, ScanResultRow } from "./normalize";

const artifacts: ArtifactRow[] = [artifact("skill:a"), artifact("skill:b"), artifact("skill:c")];

const labels: LabelRow[] = [
  label("skill:a", "clean"),
  label("skill:b", "malicious", ["malicious.known_blocked_signature"]),
  label("skill:c", "suspicious", ["suspicious.dynamic_code_execution"]),
];

const scanResults: ScanResultRow[] = [
  scan("skill:a", "static", "clean"),
  scan("skill:a", "llm", "suspicious"),
  scan("skill:b", "static", "clean"),
  scan("skill:b", "virustotal", "malicious"),
  scan("skill:c", "static", "suspicious"),
  scan("skill:c", "llm", "suspicious"),
];

describe("security dataset eval", () => {
  it("computes scanner metrics and error rows against consensus labels", () => {
    const result = evaluateSnapshotRows(
      { artifacts, labels, scanResults },
      { targetLabelSource: "moderation_consensus" },
    );

    expect(result.metrics).toMatchObject({
      artifact_count: 3,
      scan_result_count: 6,
      label_count: 3,
      target_label_distribution: {
        clean: 1,
        suspicious: 1,
        malicious: 1,
        unknown: 0,
      },
      scanner_coverage: {
        static: 3,
        virustotal: 1,
        llm: 2,
      },
      target_reason_code_distribution: {
        "malicious.known_blocked_signature": 1,
        "suspicious.dynamic_code_execution": 1,
      },
      pairwise_scanner_agreement: {
        static_vs_llm: {
          evaluated: 2,
          agreements: 1,
          disagreements: 1,
          agreement_rate: 0.5,
        },
        static_vs_virustotal: {
          evaluated: 1,
          agreements: 0,
          disagreements: 1,
          agreement_rate: 0,
        },
      },
      disagreement_count: 2,
      false_positive_candidate_count: 1,
      false_negative_count: 1,
      missed_known_malicious_count: 1,
    });
    expect(result.metrics.scanner_metrics.static).toMatchObject({
      evaluated: 3,
      true_positives: 1,
      true_negatives: 1,
      false_negatives: 1,
    });
    expect(result.falsePositives).toEqual([
      {
        artifact_id: "skill:a",
        scanner: "llm",
        scanner_label: "suspicious",
        target_label: "clean",
      },
    ]);
    expect(result.falseNegatives).toEqual([
      {
        artifact_id: "skill:b",
        scanner: "static",
        scanner_label: "clean",
        target_label: "malicious",
      },
    ]);
  });

  it("reports metric deltas when a baseline is supplied", () => {
    const result = evaluateSnapshotRows(
      { artifacts, labels, scanResults },
      { targetLabelSource: "moderation_consensus" },
      {
        artifact_count: 2,
        scan_result_count: 4,
        label_count: 2,
        target_label_source: "moderation_consensus",
        target_label_distribution: { clean: 1, suspicious: 0, malicious: 1, unknown: 0 },
        target_reason_code_distribution: {
          "malicious.known_blocked_signature": 1,
        },
        scanner_coverage: {},
        scanner_metrics: {},
        pairwise_scanner_agreement: {},
        disagreement_count: 0,
        false_positive_candidate_count: 0,
        false_negative_count: 1,
        missed_known_malicious_count: 1,
      },
    );

    expect(result.diff).toMatchObject({
      baseline_present: true,
      artifact_count_delta: 1,
      scan_result_count_delta: 2,
      label_count_delta: 1,
      target_label_distribution_delta: {
        clean: 0,
        suspicious: 1,
        malicious: 0,
        unknown: 0,
      },
      target_reason_code_distribution_delta: {
        "malicious.known_blocked_signature": 0,
        "suspicious.dynamic_code_execution": 1,
      },
      disagreement_count_delta: 2,
      false_positive_candidate_count_delta: 1,
      false_negative_count_delta: 0,
      missed_known_malicious_count_delta: 0,
    });
  });
});

function artifact(artifactId: string): ArtifactRow {
  return {
    artifact_id: artifactId,
    source_kind: "skill",
    source_table: "skillVersions",
    source_doc_id_hash: artifactId,
    parent_doc_id_hash: artifactId,
    public_name: artifactId,
    public_slug: artifactId,
    version: "1.0.0",
    artifact_sha256: artifactId,
    created_at: 0,
    created_month: "2026-04",
    soft_deleted: false,
    is_public: true,
    file_count: 1,
    total_bytes: 1,
    file_ext_counts: { ".md": 1 },
    capability_tags: [],
    package_family: null,
    package_channel: null,
    package_executes_code: null,
    source_repo_host: null,
    has_vt_scan: false,
    has_static_scan: true,
    has_llm_scan: false,
  };
}

function label(artifactId: string, value: LabelRow["label"], reasonCodes: string[] = []): LabelRow {
  return {
    artifact_id: artifactId,
    label: value,
    label_source: "moderation_consensus",
    label_confidence: "consensus",
    reason_codes: reasonCodes,
    scanner_agreement: 1,
    notes_redacted: null,
  };
}

function scan(
  artifactId: string,
  scanner: ScanResultRow["scanner"],
  value: ScanResultRow["raw_status_family"],
): ScanResultRow {
  return {
    artifact_id: artifactId,
    scanner,
    scanner_version: null,
    model: null,
    status: value,
    verdict: value,
    confidence: null,
    checked_at: 0,
    reason_codes: [],
    engine_stats: null,
    summary_redacted: null,
    raw_status_family: value,
  };
}
