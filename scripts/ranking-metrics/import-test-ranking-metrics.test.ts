import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import {
  assertRankingTablesUnchanged,
  assertTestDeployment,
  copySnapshotTable,
  mergeDailyTable,
  parseArgs,
  type ResolvedRankingMetricTarget,
} from "./import-test-ranking-metrics";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Test ranking metric command guard", () => {
  it("accepts only the exact permanent Test deployment", () => {
    expect(() => assertTestDeployment(CLAWHUB_TEST_DEPLOYMENT)).not.toThrow();
    expect(() => assertTestDeployment("wry-manatee-359")).toThrow("may only target");
    expect(() => assertTestDeployment("unknown")).toThrow("may only target");
  });

  it("requires an explicit backup path for every mutating operation", () => {
    expect(() => parseArgs(["--dataset", "dataset.json"])).toThrow("--backup-dir");
    expect(parseArgs(["--dataset", "dataset.json", "--backup-dir", "proof/backup"])).toEqual(
      expect.objectContaining({
        mode: "import",
        deployment: CLAWHUB_TEST_DEPLOYMENT,
      }),
    );
  });

  it("streams an idempotent replacement while preserving feature-owned rows", async () => {
    const workDir = join(tmpdir(), `ranking-import-${crypto.randomUUID()}`);
    cleanupPaths.push(workDir);
    const firstSnapshot = join(workDir, "first.zip");
    const firstOutput = join(workDir, "first.jsonl");
    const secondSnapshot = join(workDir, "second.zip");
    const secondOutput = join(workDir, "second.jsonl");
    await mkdir(workDir);
    await writeFile(
      firstSnapshot,
      zipSync({
        "skillDailyStats/documents.jsonl": encodeRows([
          dailyRow("legacy", "snapshot-skill", 20_655, 1),
          dailyRow("feature", "feature-skill", 20_655, 99),
          dailyRow("sparse-stale", "snapshot-skill", 20_654, 8),
          dailyRow("absent-stale", "snapshot-absent", 20_655, 6),
          dailyRow("outside-window", "snapshot-absent", 20_596, 5),
          {
            ...dailyRow("prior-import", "snapshot-skill", 20_653, 7),
            rankingDatasetVersion: "ranking-metrics-2026-07-09-v1",
            rankingImportedAt: 2,
          },
        ]),
      }),
    );

    const targets: ResolvedRankingMetricTarget[] = [
      {
        kind: "skill",
        targetId: "snapshot-skill",
        legacySnapshotTarget: true,
        days: [
          { day: 20_655, downloads: 10, installs: 4, bookmarks: 2 },
          { day: 20_656, downloads: 12, installs: 5, bookmarks: 3 },
        ],
      },
    ];
    const input = {
      table: "skillDailyStats" as const,
      idField: "skillId" as const,
      datasetVersion: "ranking-metrics-2026-07-23-v1",
      importedAt: 3,
      startDay: 20_597,
      endDay: 20_656,
      legacyTargetIds: new Set(["snapshot-skill", "snapshot-absent"]),
      targets,
    };

    expect(
      await mergeDailyTable({
        ...input,
        snapshot: firstSnapshot,
        output: firstOutput,
      }),
    ).toEqual({ importedRows: 2 });
    const firstRows = await readJsonLines(firstOutput);
    expect(firstRows).toContainEqual(
      expect.objectContaining({
        _id: "feature",
        _creationTime: 1,
        skillId: "feature-skill",
        day: 20_655,
        downloads: 99,
      }),
    );
    expect(firstRows).toContainEqual(
      expect.objectContaining({
        _id: "legacy",
        _creationTime: 1,
        skillId: "snapshot-skill",
        day: 20_655,
        rankingDatasetVersion: "ranking-metrics-2026-07-23-v1",
      }),
    );
    expect(firstRows.find((row) => row.skillId === "feature-skill")).not.toHaveProperty(
      "rankingDatasetVersion",
    );
    expect(firstRows).not.toContainEqual(expect.objectContaining({ _id: "prior-import" }));
    expect(firstRows).not.toContainEqual(
      expect.objectContaining({ skillId: "snapshot-skill", day: 20_654 }),
    );
    expect(firstRows).not.toContainEqual(
      expect.objectContaining({ skillId: "snapshot-absent", day: 20_655 }),
    );
    expect(firstRows).toContainEqual(
      expect.objectContaining({ skillId: "snapshot-absent", day: 20_596 }),
    );

    const persistedFirstRows = firstRows.map((row, index) => ({
      ...row,
      _id: row._id ?? `first-import-${index}`,
      _creationTime: row._creationTime ?? 4,
    }));
    await writeFile(
      secondSnapshot,
      zipSync({
        "skillDailyStats/documents.jsonl": encodeRows(persistedFirstRows),
      }),
    );
    expect(
      await mergeDailyTable({
        ...input,
        snapshot: secondSnapshot,
        output: secondOutput,
      }),
    ).toEqual({ importedRows: 2 });

    expect(sortRows(await readJsonLines(secondOutput))).toEqual(sortRows(persistedFirstRows));
  });

  it("can regenerate rollback table artifacts after a partial restore", async () => {
    const workDir = join(tmpdir(), `ranking-rollback-${crypto.randomUUID()}`);
    cleanupPaths.push(workDir);
    await mkdir(workDir);
    const snapshot = join(workDir, "backup.zip");
    const output = join(workDir, "skillDailyStats.restore.jsonl");
    await writeFile(
      snapshot,
      zipSync({
        "skillDailyStats/documents.jsonl": encodeRows([
          dailyRow("restore", "snapshot-skill", 20_655, 10),
        ]),
      }),
    );

    await copySnapshotTable(snapshot, "skillDailyStats", output);
    await copySnapshotTable(snapshot, "skillDailyStats", output);

    expect(await readJsonLines(output)).toEqual([
      expect.objectContaining({
        _id: "restore",
        _creationTime: 1,
        skillId: "snapshot-skill",
        downloads: 10,
      }),
    ]);
  });

  it("fails closed when a target table changes after the backup snapshot", async () => {
    const workDir = join(tmpdir(), `ranking-preflight-${crypto.randomUUID()}`);
    cleanupPaths.push(workDir);
    await mkdir(workDir);
    const baseline = join(workDir, "baseline.zip");
    const unchanged = join(workDir, "unchanged.zip");
    const changed = join(workDir, "changed.zip");
    const tables = {
      "skillDailyStats/documents.jsonl": encodeRows([
        dailyRow("skill-row", "snapshot-skill", 20_655, 10),
      ]),
      "packageDailyStats/documents.jsonl": encodeRows([]),
      "rankingMetricImports/documents.jsonl": encodeRows([]),
    };
    await writeFile(baseline, zipSync(tables));
    await writeFile(unchanged, zipSync(tables));
    await writeFile(
      changed,
      zipSync({
        ...tables,
        "skillDailyStats/documents.jsonl": encodeRows([
          dailyRow("skill-row", "snapshot-skill", 20_655, 11),
        ]),
      }),
    );

    await expect(assertRankingTablesUnchanged(baseline, unchanged)).resolves.toBeUndefined();
    await expect(assertRankingTablesUnchanged(baseline, changed)).rejects.toThrow(
      "skillDailyStats changed after the backup snapshot",
    );
  });
});

function dailyRow(id: string, skillId: string, day: number, downloads: number) {
  return {
    _id: id,
    _creationTime: 1,
    skillId,
    day,
    downloads,
    installs: 0,
    updatedAt: 1,
  };
}

function encodeRows(rows: Record<string, unknown>[]) {
  return new TextEncoder().encode(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function readJsonLines(path: string) {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sortRows(rows: Record<string, unknown>[]) {
  return [...rows].sort(
    (left, right) =>
      String(left.skillId).localeCompare(String(right.skillId)) ||
      Number(left.day) - Number(right.day),
  );
}
