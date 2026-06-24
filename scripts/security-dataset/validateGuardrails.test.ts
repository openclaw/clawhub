/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("security dataset guardrail validator", () => {
  it("allows ordinary skill content that mentions storage concepts", async () => {
    const snapshotDir = await createSnapshot([
      {
        id: "row-ok",
        skill_bundle_content: [
          {
            path: "references/components/data_collection_&_storage.md",
            content: "A user file may mention storageId as code text without leaking a raw field.",
          },
        ],
      },
    ]);
    try {
      await expect(runValidator(snapshotDir)).resolves.toMatchObject({
        stdout: expect.stringContaining("sanitized output guardrails passed"),
      });
    } finally {
      await rm(snapshotDir, { recursive: true, force: true });
    }
  });

  it("rejects raw storage fields, raw storage paths, raw Convex ids, and obvious secrets", async () => {
    const snapshotDir = await createSnapshot([
      {
        id: "row-bad",
        storageId: "abc123",
        skill_bundle_content: [
          {
            path: "_storage/raw-blob",
            content: "raw ref skillVersions:abc123def456 and token sk-abcdefghijklmnopqrstuvwxyz",
          },
        ],
      },
    ]);
    try {
      await expect(runValidator(snapshotDir)).rejects.toMatchObject({
        stderr: expect.stringContaining("raw storageId field is not allowed"),
      });
      await expect(runValidator(snapshotDir)).rejects.toMatchObject({
        stderr: expect.stringContaining("raw _storage/ bundle path is not allowed"),
      });
      await expect(runValidator(snapshotDir)).rejects.toMatchObject({
        stderr: expect.stringContaining("raw Convex document id reference is not allowed"),
      });
      await expect(runValidator(snapshotDir)).rejects.toMatchObject({
        stderr: expect.stringContaining("obvious secret-like value is not allowed"),
      });
    } finally {
      await rm(snapshotDir, { recursive: true, force: true });
    }
  });
});

async function createSnapshot(rows: unknown[]) {
  const snapshotDir = await mkdtemp(join(tmpdir(), "clawhub-security-guardrails-"));
  await mkdir(join(snapshotDir, "hf-dataset", "data"), { recursive: true });
  await writeFile(join(snapshotDir, "manifest.json"), JSON.stringify({ ok: true }));
  for (const split of ["train", "validation", "test", "eval_holdout"]) {
    await writeFile(
      join(snapshotDir, "hf-dataset", "data", `${split}.jsonl`),
      split === "train" ? rows.map((row) => JSON.stringify(row)).join("\n") : "",
    );
  }
  return snapshotDir;
}

async function runValidator(snapshotDir: string) {
  return await execFileAsync(
    "bun",
    ["scripts/security-dataset/validate-guardrails.ts", "--snapshot-dir", snapshotDir],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}
