/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvalMetrics } from "./eval";
import type { ArtifactRow, LabelRow, ScanResultRow } from "./normalize";

describe("security dataset eval CLI", () => {
  it("writes eval run files with metrics and baseline diffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-security-eval-"));
    const snapshotDir = join(root, "snapshot");
    const baselineRunDir = join(root, "baseline");
    await mkdir(snapshotDir, { recursive: true });
    await mkdir(baselineRunDir, { recursive: true });

    await writeJsonl(join(snapshotDir, "artifacts.jsonl"), [
      artifact("artifact:clean"),
      artifact("artifact:risk"),
    ]);
    await writeJsonl(join(snapshotDir, "scan_results.jsonl"), [
      scan("artifact:clean", "static", "clean"),
      scan("artifact:clean", "llm", "suspicious"),
      scan("artifact:risk", "static", "clean"),
      scan("artifact:risk", "virustotal", "malicious"),
    ]);
    await writeJsonl(join(snapshotDir, "labels.jsonl"), [
      label("artifact:clean", "clean"),
      label("artifact:risk", "malicious", ["malicious.known_blocked_signature"]),
    ]);
    await writeJson(join(baselineRunDir, "metrics.json"), baselineMetrics());

    const result = spawnSync(
      "bun",
      [
        "scripts/security-dataset/run-eval.ts",
        "--snapshot-dir",
        snapshotDir,
        "--baseline-run-dir",
        baselineRunDir,
        "--run-id",
        "fixture-run",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const stdout = JSON.parse(result.stdout) as { runId: string; runDir: string };
    expect(stdout.runId).toBe("fixture-run");
    expect(stdout.runDir).toBe(join(snapshotDir, "scan_runs", "fixture-run"));

    const metrics = await readJson<EvalMetrics>(join(stdout.runDir, "metrics.json"));
    expect(metrics).toMatchObject({
      artifact_count: 2,
      disagreement_count: 2,
      false_positive_candidate_count: 1,
      missed_known_malicious_count: 1,
      target_reason_code_distribution: {
        "malicious.known_blocked_signature": 1,
      },
    });

    await expect(readJson(join(stdout.runDir, "diff.json"))).resolves.toMatchObject({
      baseline_present: true,
      artifact_count_delta: 1,
      target_reason_code_distribution_delta: {
        "malicious.known_blocked_signature": 1,
      },
    });
    await expect(readJsonl(join(stdout.runDir, "false_negatives.jsonl"))).resolves.toEqual([
      {
        artifact_id: "artifact:risk",
        scanner: "static",
        scanner_label: "clean",
        target_label: "malicious",
      },
    ]);
    await expect(readJsonl(join(stdout.runDir, "scanner_disagreements.jsonl"))).resolves.toHaveLength(
      2,
    );
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

function scan(
  artifactId: string,
  scanner: ScanResultRow["scanner"],
  value: ScanResultRow["raw_status_family"],
): ScanResultRow {
  return {
    artifact_id: artifactId,
    scanner,
    scanner_version: "test-scanner",
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

function baselineMetrics(): EvalMetrics {
  return {
    artifact_count: 1,
    scan_result_count: 1,
    label_count: 1,
    target_label_source: "moderation_consensus",
    target_label_distribution: { clean: 1, suspicious: 0, malicious: 0, unknown: 0 },
    target_reason_code_distribution: {},
    scanner_coverage: {},
    scanner_metrics: {},
    pairwise_scanner_agreement: {},
    disagreement_count: 0,
    false_positive_candidate_count: 0,
    false_negative_count: 0,
    missed_known_malicious_count: 0,
  };
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJsonl(path: string, rows: unknown[]) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}
