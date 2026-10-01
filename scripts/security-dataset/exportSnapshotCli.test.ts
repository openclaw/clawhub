/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { hashString } from "./normalize";

const execFileAsync = promisify(execFile);

describe("security dataset snapshot CLI", () => {
  it("writes flat Hugging Face split files from a tiny sanitized Convex export", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clawhub-security-dataset-cli-"));
    try {
      const snapshotZip = join(directory, "snapshot.zip");
      const outDir = join(directory, "out");
      await writeFile(snapshotZip, Buffer.from(buildTinyConvexSnapshotZip()));

      const result = await execFileAsync(
        "bun",
        [
          "scripts/security-dataset/export-snapshot.ts",
          "--convex-export-zip",
          snapshotZip,
          "--source-snapshot-id",
          "live-export-prod-123-1",
          "--out-dir",
          outDir,
          "--hf-dataset",
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
          row_counts: { huggingface_rows: number };
          huggingface_dataset: {
            repo: string;
            splitNames: string[];
            rowCountsBySplit: Record<string, number>;
          };
        };
      } = JSON.parse(result.stdout);

      expect(summary.manifest.source_snapshot_id).toBe("live-export-prod-123-1");
      expect(summary.manifest.row_counts.huggingface_rows).toBe(1);
      expect(summary.manifest.huggingface_dataset.repo).toBe(
        "OpenClaw/clawhub-security-signals-live",
      );
      expect(summary.manifest.huggingface_dataset.splitNames).toEqual(["latest"]);
      expect(summary.manifest.huggingface_dataset.rowCountsBySplit).toEqual({ latest: 1 });
      const dataDir = join(summary.snapshotDir, "hf-dataset", "data");
      const files = await readdir(dataDir);
      expect(files.sort()).toEqual(["latest.jsonl"]);

      const splitContents = await Promise.all(
        files.map(async (file) => readFile(join(dataDir, file), "utf8")),
      );
      const flatRows = splitContents
        .join("")
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const expectedSkillMdContent = "# Stored Skill\n\nUse [REDACTED_SECRET]\nKeep this line.";

      expect(flatRows).toEqual([
        expect.objectContaining({
          id: "a".repeat(64),
          skill_slug: "owner/stored-skill",
          skill_version: "1.0.0",
          skill_md_content: expectedSkillMdContent,
          skill_bundle_content: [
            {
              path: "SKILL.md",
              content: expectedSkillMdContent,
              sha256: hashString(expectedSkillMdContent),
              sizeBytes: Buffer.byteLength(expectedSkillMdContent, "utf8"),
            },
            expect.objectContaining({
              path: "scripts/run.sh",
              content: "echo [REDACTED_SECRET]\n",
            }),
          ],
        }),
      ]);
      expect((flatRows[0]?.skill_md_content as string).split("\n")).toHaveLength(4);
      const skillBundleContent = flatRows[0]?.skill_bundle_content as Array<{
        path: string;
      }>;
      expect(skillBundleContent.filter((file) => file.path === "SKILL.md")).toHaveLength(1);
      const serializedRows = JSON.stringify(flatRows);
      expect(serializedRows).not.toContain("storageId");
      expect(serializedRows).not.toContain("skillVersions:1");
      expect(serializedRows).not.toContain("supersecret123");
      expect(serializedRows).not.toContain("scriptsecret123");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a minimum page size larger than the starting page size", async () => {
    await expect(
      execFileAsync(
        "bun",
        [
          "scripts/security-dataset/export-snapshot.ts",
          "--page-size",
          "5",
          "--min-page-size",
          "6",
          "--dry-run",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--min-page-size must be less than or equal to --page-size."),
    });
  });

  it("rejects a non-positive page timeout", async () => {
    await expect(
      execFileAsync(
        "bun",
        ["scripts/security-dataset/export-snapshot.ts", "--page-timeout-ms", "0", "--dry-run"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Expected positive integer for --page-timeout-ms"),
    });
  });

  it("rejects a page timeout above the runtime timer maximum", async () => {
    await expect(
      execFileAsync(
        "bun",
        [
          "scripts/security-dataset/export-snapshot.ts",
          "--page-timeout-ms",
          "2147483648",
          "--dry-run",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Expected --page-timeout-ms to be at most 2147483647."),
    });
  });
});

function buildTinyConvexSnapshotZip() {
  const skillMdContent = "# Stored Skill\n\nUse token=supersecret123\nKeep this line.";
  const scriptContent = "echo password=scriptsecret123\n";
  return zipSync({
    "skills/documents.jsonl": strToU8(
      `${JSON.stringify({
        _id: "skills:1",
        displayName: "Stored Skill",
        slug: "stored-skill",
        ownerUserId: "users:owner",
      })}\n`,
    ),
    "skillVersions/documents.jsonl": strToU8(
      `${JSON.stringify({
        _id: "skillVersions:1",
        skillId: "skills:1",
        version: "1.0.0",
        createdAt: Date.UTC(2026, 5, 23),
        sha256hash: "a".repeat(64),
        files: [
          {
            path: "SKILL.md",
            size: Buffer.byteLength(skillMdContent, "utf8"),
            sha256: "skill-md-sha",
            content: skillMdContent,
            contentType: "text/markdown",
          },
          {
            path: "scripts/run.sh",
            size: Buffer.byteLength(scriptContent, "utf8"),
            sha256: "script-sha",
            content: scriptContent,
            contentType: "text/x-shellscript",
          },
        ],
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No suspicious patterns detected.",
          engineVersion: "static-v1",
          checkedAt: Date.UTC(2026, 5, 23),
        },
        llmAnalysis: {
          status: "completed",
          verdict: "suspicious",
          confidence: "medium",
          summary: "Review before trusting.",
          agenticRiskFindings: [],
          model: "gpt-test",
          checkedAt: Date.UTC(2026, 5, 23),
        },
      })}\n`,
    ),
    "packages/documents.jsonl": strToU8(""),
    "packageReleases/documents.jsonl": strToU8(""),
    "users/documents.jsonl": strToU8(
      `${JSON.stringify({ _id: "users:owner", handle: "owner" })}\n`,
    ),
  });
}
