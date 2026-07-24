import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import {
  assertRankingTablesUnchanged,
  assertRankingTablesMatchDigests,
  assertRankingTablesMatchLogicalDigests,
  assertTestDeployment,
  buildConvexImportArchiveCommand,
  copySnapshotTable,
  mergeDailyTable,
  mergeRankingMetricImportRows,
  parseArgs,
  readCurrentTestMetadata,
  rankingTableDigests,
  rankingTableLogicalDigests,
  resolveTargets,
  type ResolvedRankingMetricTarget,
  validateExclusiveTestLane,
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
    expect(() => parseArgs(["--dataset", "dataset.json", "--backup-dir", "proof/backup"])).toThrow(
      "--lane-run-id",
    );
    expect(
      parseArgs([
        "--dataset",
        "dataset.json",
        "--backup-dir",
        "proof/backup",
        "--lane-run-id",
        "12345",
      ]),
    ).toEqual(
      expect.objectContaining({
        mode: "import",
        deployment: CLAWHUB_TEST_DEPLOYMENT,
        laneRunId: 12345,
      }),
    );
  });

  it("accepts only an active exact-main Test lane reservation", () => {
    const reservation = {
      id: 12_345,
      status: "in_progress",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: "abc123",
      path: ".github/workflows/reserve-test.yml",
      display_title: "Reserve Test for ranking-metrics-2026-07-23-v1",
      run_started_at: "2026-07-24T19:00:00.000Z",
    };
    expect(() =>
      validateExclusiveTestLane({
        reservation,
        runId: 12_345,
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        localSha: "abc123",
        mainSha: "abc123",
        now: Date.parse("2026-07-24T20:00:00.000Z"),
      }),
    ).not.toThrow();
    expect(() =>
      validateExclusiveTestLane({
        reservation: { ...reservation, status: "completed" },
        runId: 12_345,
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        localSha: "abc123",
        mainSha: "abc123",
        now: Date.parse("2026-07-24T20:00:00.000Z"),
      }),
    ).toThrow("not actively holding");
    expect(() =>
      validateExclusiveTestLane({
        reservation,
        runId: 12_345,
        datasetVersion: "ranking-metrics-2026-07-23-v1",
        localSha: "different",
        mainSha: "abc123",
        now: Date.parse("2026-07-24T20:00:00.000Z"),
      }),
    ).toThrow("exact current main");
  });

  it("reserves the same non-canceling concurrency lane as Test deploys", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/reserve-test.yml", "utf8")) as {
      concurrency?: { group?: string; "cancel-in-progress"?: boolean };
      jobs?: Record<string, { environment?: { name?: string }; "timeout-minutes"?: number }>;
    };
    expect(workflow.concurrency).toEqual({ group: "deploy-test", "cancel-in-progress": false });
    expect(workflow.jobs?.["reserve-test"]).toMatchObject({
      environment: { name: "Test" },
      "timeout-minutes": 360,
    });
  });

  it("replaces all three ranking tables in one atomic ZIP import", () => {
    expect(
      buildConvexImportArchiveCommand("/tmp/ranking-tables.zip", CLAWHUB_TEST_DEPLOYMENT),
    ).toEqual({
      command: "bunx",
      args: [
        "convex",
        "import",
        "--deployment",
        CLAWHUB_TEST_DEPLOYMENT,
        "--replace",
        "--yes",
        "/tmp/ranking-tables.zip",
      ],
    });
  });

  it("replaces only matching import provenance and preserves system identities", () => {
    const prior = {
      _id: "prior",
      _creationTime: 1,
      datasetVersion: "ranking-metrics-2026-07-01-v1",
      checksum: "prior-checksum",
    };
    const replaced = {
      _id: "same-version",
      _creationTime: 2,
      datasetVersion: "ranking-metrics-2026-07-23-v1",
      checksum: "old-checksum",
    };
    const next = {
      datasetVersion: "ranking-metrics-2026-07-23-v1",
      checksum: "new-checksum",
    };

    expect(mergeRankingMetricImportRows([prior, replaced], next)).toEqual([
      prior,
      { ...next, _id: "same-version", _creationTime: 2 },
    ]);
  });

  it("resolves package targets by normalized name, family, and channel", async () => {
    const workDir = join(tmpdir(), `ranking-packages-${crypto.randomUUID()}`);
    cleanupPaths.push(workDir);
    await mkdir(workDir);
    const snapshot = join(workDir, "packages.zip");
    await writeFile(
      snapshot,
      zipSync({
        "users/documents.jsonl": encodeRows([
          {
            _id: "snapshot-owner",
            _creationTime: 1,
            handle: "test-snapshot-user-0123456789ab",
          },
        ]),
        "publishers/documents.jsonl": encodeRows([]),
        "skills/documents.jsonl": encodeRows([
          {
            _id: "snapshot-skill",
            _creationTime: 1,
            ownerUserId: "snapshot-owner",
            slug: "calendar-skill",
          },
        ]),
        "packages/documents.jsonl": encodeRows([
          {
            _id: "code-stable",
            _creationTime: 1,
            ownerUserId: "snapshot-owner",
            normalizedName: "@openclaw/calendar",
            family: "code-plugin",
            channel: "stable",
          },
          {
            _id: "bundle-stable",
            _creationTime: 1,
            ownerUserId: "snapshot-owner",
            normalizedName: "@openclaw/calendar",
            family: "bundle-plugin",
            channel: "stable",
          },
        ]),
        "rankingMetricImports/documents.jsonl": encodeRows([]),
      }),
    );

    const current = await readCurrentTestMetadata(snapshot);
    const target = {
      kind: "package" as const,
      normalizedName: "@openclaw/calendar",
      family: "code-plugin" as const,
      channel: "stable",
      createdAt: 1,
      days: [{ day: 20_656, downloads: 1, installs: 0, bookmarks: 0 }],
    };
    expect(resolveTargets([target], current).targets).toEqual([
      expect.objectContaining({ kind: "package", targetId: "code-stable" }),
    ]);
    expect(() => resolveTargets([{ ...target, createdAt: 2 }], current)).toThrow(
      "package creation timestamp mismatch",
    );
    const skillTarget = {
      kind: "skill" as const,
      ownerHandle: "test-snapshot-user-0123456789ab",
      slug: "calendar-skill",
      createdAt: 1,
      days: target.days,
    };
    expect(resolveTargets([skillTarget], current).targets).toEqual([
      expect.objectContaining({ kind: "skill", targetId: "snapshot-skill" }),
    ]);
    expect(() => resolveTargets([{ ...skillTarget, createdAt: 2 }], current)).toThrow(
      "skill creation timestamp mismatch",
    );
    expect(() => resolveTargets([{ ...target, channel: "beta" }], current)).toThrow(
      "package identity mismatch",
    );
    const exactMatches = [...current.packagesByIdentity.values()].find(
      (matches) => matches[0]?.targetId === "code-stable",
    );
    exactMatches?.push({
      targetId: "duplicate-code-stable",
      legacySnapshotTarget: true,
      createdAt: 1,
    });
    expect(() => resolveTargets([target], current)).toThrow("ambiguous package identity");
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
    const rekeyed = join(workDir, "rekeyed.zip");
    const changed = join(workDir, "changed.zip");
    const tables = {
      "users/documents.jsonl": encodeRows([]),
      "publishers/documents.jsonl": encodeRows([]),
      "skills/documents.jsonl": encodeRows([]),
      "packages/documents.jsonl": encodeRows([]),
      "skillDailyStats/documents.jsonl": encodeRows([
        dailyRow("skill-row", "snapshot-skill", 20_655, 10),
      ]),
      "packageDailyStats/documents.jsonl": encodeRows([]),
      "rankingMetricImports/documents.jsonl": encodeRows([]),
    };
    await writeFile(baseline, zipSync(tables));
    await writeFile(unchanged, zipSync(tables));
    await writeFile(
      rekeyed,
      zipSync({
        ...tables,
        "skillDailyStats/documents.jsonl": encodeRows([
          dailyRow("replacement-system-id", "snapshot-skill", 20_655, 10),
        ]),
      }),
    );
    await writeFile(
      changed,
      zipSync({
        ...tables,
        "skillDailyStats/documents.jsonl": encodeRows([
          dailyRow("skill-row", "snapshot-skill", 20_655, 11),
        ]),
      }),
    );
    const changedIdentity = join(workDir, "changed-identity.zip");
    await writeFile(
      changedIdentity,
      zipSync({
        ...tables,
        "skills/documents.jsonl": encodeRows([
          { _id: "replacement-skill", _creationTime: 2, slug: "renamed" },
        ]),
      }),
    );

    await expect(assertRankingTablesUnchanged(baseline, unchanged)).resolves.toBeUndefined();
    await expect(assertRankingTablesUnchanged(baseline, changed)).rejects.toThrow(
      "skillDailyStats changed after the backup snapshot",
    );
    await expect(assertRankingTablesUnchanged(baseline, changedIdentity)).rejects.toThrow(
      "skills changed after the backup snapshot",
    );

    const rollbackDigests = await rankingTableDigests(baseline);
    await expect(
      assertRankingTablesMatchDigests(unchanged, rollbackDigests),
    ).resolves.toBeUndefined();
    await expect(assertRankingTablesMatchDigests(changed, rollbackDigests)).rejects.toThrow(
      "skillDailyStats no longer matches the rollback source state",
    );

    const logicalDigests = await rankingTableLogicalDigests(baseline);
    await expect(
      assertRankingTablesMatchLogicalDigests(rekeyed, logicalDigests),
    ).resolves.toBeUndefined();
    await expect(assertRankingTablesMatchLogicalDigests(changed, logicalDigests)).rejects.toThrow(
      "skillDailyStats no longer matches the rollback source state",
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
