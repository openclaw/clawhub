/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildSecurityDatasetManifest } from "./manifest";

const execFileAsync = promisify(execFile);

describe("security dataset snapshot merge CLI", () => {
  it("merges shard manifests and Hugging Face split files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clawhub-security-dataset-merge-"));
    try {
      const shardsDir = join(directory, "shards");
      const outDir = join(directory, "out");
      await writeShardSnapshot(shardsDir, "shard-a", {
        sourceArtifacts: 1,
        split: "train",
        rowId: "row-a",
        createdAtGte: 100,
        createdAtLt: 200,
      });
      await writeShardSnapshot(shardsDir, "shard-b", {
        sourceArtifacts: 2,
        split: "test",
        rowId: "row-b",
        createdAtGte: 200,
        createdAtLt: 300,
      });

      const result = await execFileAsync(
        "bun",
        [
          "scripts/security-dataset/merge-snapshots.ts",
          "--shards-dir",
          shardsDir,
          "--out-dir",
          outDir,
          "--source-snapshot-id",
          "live-convex-test-1",
          "--hf-repo",
          "OpenClaw/clawhub-security-signals-live",
          "--hf-revision",
          "main",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      );

      const summary: {
        snapshotDir: string;
        manifest: {
          source_snapshot_id: string;
          row_counts: { source_artifacts: number; huggingface_rows: number };
          created_time_window: { created_at_gte: number; created_at_lt: number };
          huggingface_dataset: { splitNames: string[]; rowCountsBySplit: Record<string, number> };
        };
      } = JSON.parse(result.stdout);

      expect(summary.manifest.source_snapshot_id).toBe("live-convex-test-1");
      expect(summary.manifest.row_counts.source_artifacts).toBe(3);
      expect(summary.manifest.row_counts.huggingface_rows).toBe(3);
      expect(summary.manifest.created_time_window).toEqual({
        created_at_gte: 100,
        created_at_lt: 300,
      });
      expect(summary.manifest.huggingface_dataset.splitNames).toEqual(["latest"]);
      expect(summary.manifest.huggingface_dataset.rowCountsBySplit).toEqual({ latest: 3 });

      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.toContain('"id":"row-a"');
      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.toContain("[REDACTED_SECRET]");
      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.not.toContain("supersecretvalue123");
      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.toContain('"id":"row-b"');
      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.toContain('"split":"latest"');
      await expect(
        readFile(join(summary.snapshotDir, "hf-dataset", "data", "latest.jsonl"), "utf8"),
      ).resolves.not.toContain('"split":"train"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function writeShardSnapshot(
  root: string,
  name: string,
  input: {
    sourceArtifacts: number;
    split: "train" | "test";
    rowId: string;
    createdAtGte: number;
    createdAtLt: number;
  },
) {
  const dir = join(root, name);
  await mkdir(join(dir, "hf-dataset", "data"), { recursive: true });
  for (const file of [
    "artifacts.jsonl",
    "scan_results.jsonl",
    "static_findings.jsonl",
    "clawscan_findings.jsonl",
    "labels.jsonl",
    "splits.jsonl",
  ]) {
    await writeFile(join(dir, file), "");
  }
  for (const split of ["train", "validation", "test", "eval_holdout"]) {
    const rowCount = split === input.split ? input.sourceArtifacts : 0;
    const rows = Array.from({ length: rowCount }, (_, index) =>
      JSON.stringify({
        id: index === 0 ? input.rowId : `${input.rowId}-${index}`,
        split,
        skill_slug: "owner/sk-abcdefghijklmnopqrstuvwxyz",
        skill_md_content: "Use this skill. skill secret: supersecretvalue123",
        skill_bundle_content: [
          {
            path: "config/sk-abcdefghijklmnopqrstuvwxyz/settings.json",
            content: "password=supersecretvalue123\n",
          },
        ],
      }),
    );
    await writeFile(join(dir, "hf-dataset", "data", `${split}.jsonl`), rows.join("\n"));
  }
  const manifest = buildSecurityDatasetManifest({
    snapshotId: name,
    sourceSnapshotId: name,
    createdAt: new Date(0).toISOString(),
    repoGitSha: "abc123",
    convexDeployment: "wry-manatee-359",
    exportMode: "public",
    pageSize: 25,
    concurrency: 1,
    shards: 1,
    shardCount: 1,
    rowCounts: {
      sourceArtifacts: input.sourceArtifacts,
      artifacts: input.sourceArtifacts,
      scanResults: 0,
      staticFindings: 0,
      clawScanFindings: 0,
      labels: 0,
      splits: input.sourceArtifacts,
      huggingFaceRows: input.sourceArtifacts,
    },
    scannerVersions: [],
    modelNames: [],
    redactionPolicyVersion: "public-signals-v2-bundle-files",
    sourceTables: ["skillVersions"],
    timeWindow: {
      createdAtGte: input.createdAtGte,
      createdAtLt: input.createdAtLt,
    },
    huggingFaceDataset: {
      repo: "OpenClaw/clawhub-security-signals-live",
      revision: "main",
      commit: null,
      configNames: ["default"],
      splitNames: ["latest"],
      rowCountsBySplit: {
        latest: input.sourceArtifacts,
      },
    },
  });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
