#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { RANKING_METRICS_IMPORT_LOCK_ENV } from "../../convex/lib/rankingMetricsImportLock";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import { readSnapshotTable } from "../staging-seed/snapshotIo";
import {
  packageTargetIdentity,
  parseRankingDataset,
  type RankingDataset,
  type RankingMetricDay,
  type RankingMetricTarget,
} from "./rankingDataset";

type Mode = "import" | "readback" | "cleanup" | "rollback";
type DailyTable = "skillDailyStats" | "packageDailyStats";
type DailyIdField = "skillId" | "packageId";
const RANKING_TABLES = ["skillDailyStats", "packageDailyStats", "rankingMetricImports"] as const;
type RankingTable = (typeof RANKING_TABLES)[number];
const IMPORT_SOURCE_TABLES = [
  "users",
  "publishers",
  "skills",
  "packages",
  ...RANKING_TABLES,
] as const;
const TEST_LANE_WORKFLOW_PATH = ".github/workflows/reserve-test.yml";
const TEST_LANE_MAX_AGE_MS = 5 * 60 * 60 * 1_000;
export type ResolvedRankingMetricTarget = {
  kind: "skill" | "package";
  targetId: string;
  legacySnapshotTarget: boolean;
  days: RankingMetricDay[];
};
type TargetMatch = { targetId: string; legacySnapshotTarget: boolean; createdAt: number | null };
type PlannedTablePaths = {
  root: string;
  skillDailyStats: string;
  packageDailyStats: string;
  rankingMetricImports: string;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertTestDeployment(options.deployment);

  if (options.mode === "rollback") {
    await restoreBackup(options.backupDir, options.deployment, options.laneRunId);
    return;
  }
  if (options.mode === "readback") {
    if (!options.datasetVersion) throw new Error("--dataset-version is required for readback");
    console.log(
      JSON.stringify(await readback(options.deployment, options.datasetVersion), null, 2),
    );
    return;
  }

  const dataset = parseRankingDataset(await readFile(options.dataset, "utf8"));
  await withRankingMetricsWriteLock(
    options.deployment,
    options.laneRunId,
    dataset.datasetVersion,
    async (lockValue) => {
      await assertEmptyDirectory(options.backupDir);
      await mkdir(options.backupDir, { recursive: true });
      const snapshot = `${options.backupDir}/test-before.zip`;
      exportDeploymentSnapshot(options.deployment, snapshot);
      const current = await readCurrentTestMetadata(snapshot);
      await writeBackupManifest(
        options.backupDir,
        current.rankingMetricImports.length,
        dataset.datasetVersion,
      );

      if (options.mode === "cleanup") {
        await applyCleanup(
          current,
          dataset,
          options.deployment,
          options.backupDir,
          options.laneRunId,
          lockValue,
        );
      } else {
        await applyImport(
          current,
          dataset,
          options.deployment,
          options.backupDir,
          options.laneRunId,
          lockValue,
        );
      }
    },
  );
}

async function applyImport(
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
  dataset: RankingDataset,
  deployment: string,
  workDir: string,
  laneRunId: number,
  lockValue: string,
) {
  const resolved = resolveTargets(dataset.targets, current);
  const importedAt = Date.now();
  const snapshot = `${workDir}/test-before.zip`;
  const planned = await createPlannedTablePaths(workDir);
  const skillPlan = await mergeDailyTable({
    snapshot,
    table: "skillDailyStats",
    idField: "skillId",
    output: planned.skillDailyStats,
    datasetVersion: dataset.datasetVersion,
    importedAt,
    startDay: dataset.startDay,
    endDay: dataset.endDay,
    legacyTargetIds: current.legacySkillTargetIds,
    targets: resolved.targets.filter((target) => target.kind === "skill"),
  });
  const packagePlan = await mergeDailyTable({
    snapshot,
    table: "packageDailyStats",
    idField: "packageId",
    output: planned.packageDailyStats,
    datasetVersion: dataset.datasetVersion,
    importedAt,
    startDay: dataset.startDay,
    endDay: dataset.endDay,
    legacyTargetIds: current.legacyPackageTargetIds,
    targets: resolved.targets.filter((target) => target.kind === "package"),
  });
  const metadata = mergeRankingMetricImportRows(current.rankingMetricImports, {
    datasetVersion: dataset.datasetVersion,
    checksum: dataset.checksum,
    generatedAt: dataset.generatedAt,
    importedAt,
    startDay: dataset.startDay,
    endDay: dataset.endDay,
    targetCount: dataset.counts.targets,
    skillTargetCount: dataset.counts.skillTargets,
    packageTargetCount: dataset.counts.packageTargets,
    dailyRowCount: dataset.counts.dailyRows,
    importedSkillRows: skillPlan.importedRows,
    importedPackageRows: packagePlan.importedRows,
    unresolvedTargets: resolved.unresolvedTargets,
    skippedOverlayRows: 0,
  });
  await writeJsonLines(planned.rankingMetricImports, metadata);

  const importedSnapshot = await importPlannedTables(
    workDir,
    planned.root,
    deployment,
    laneRunId,
    dataset.datasetVersion,
    lockValue,
  );
  const proof = await readbackSnapshot(
    deployment,
    importedSnapshot,
    dataset.datasetVersion,
  ).finally(() => rm(importedSnapshot, { force: true }));
  console.log(JSON.stringify({ ok: true, mode: "import", ...proof }, null, 2));
}

async function applyCleanup(
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
  dataset: RankingDataset,
  deployment: string,
  workDir: string,
  laneRunId: number,
  lockValue: string,
) {
  const snapshot = `${workDir}/test-before.zip`;
  const planned = await createPlannedTablePaths(workDir);
  const [skill, packageRows] = await Promise.all([
    filterDailyTable(snapshot, "skillDailyStats", planned.skillDailyStats, dataset.datasetVersion),
    filterDailyTable(
      snapshot,
      "packageDailyStats",
      planned.packageDailyStats,
      dataset.datasetVersion,
    ),
  ]);
  await writeJsonLines(
    planned.rankingMetricImports,
    current.rankingMetricImports.filter((row) => row.datasetVersion !== dataset.datasetVersion),
  );
  const cleanedSnapshot = await importPlannedTables(
    workDir,
    planned.root,
    deployment,
    laneRunId,
    dataset.datasetVersion,
    lockValue,
  );
  await rm(cleanedSnapshot, { force: true });
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "cleanup",
        datasetVersion: dataset.datasetVersion,
        removedSkillRows: skill.removed,
        removedPackageRows: packageRows.removed,
      },
      null,
      2,
    ),
  );
}

export async function readCurrentTestMetadata(snapshot: string) {
  const [users, publishers, skills, packages, imports] = await Promise.all([
    collectSnapshotTable(snapshot, "users"),
    collectSnapshotTable(snapshot, "publishers"),
    collectSnapshotTable(snapshot, "skills"),
    collectSnapshotTable(snapshot, "packages"),
    collectSnapshotTable(snapshot, "rankingMetricImports"),
  ]);
  const userHandles = new Map(users.map((row) => [String(row._id), String(row.handle ?? "")]));
  const publisherHandles = new Map(
    publishers.map((row) => [String(row._id), String(row.handle ?? "")]),
  );
  const skillsByIdentity = new Map<string, TargetMatch>();
  const legacySkillTargetIds = new Set<string>();
  for (const row of skills) {
    const ownerHandle =
      publisherHandles.get(String(row.ownerPublisherId ?? "")) ??
      userHandles.get(String(row.ownerUserId ?? ""));
    if (!ownerHandle || typeof row.slug !== "string") continue;
    const targetId = String(row._id);
    const legacySnapshotTarget = ownerHandle.startsWith("test-snapshot-");
    skillsByIdentity.set(`${ownerHandle}/${row.slug}`, {
      targetId,
      legacySnapshotTarget,
      createdAt: snapshotCreatedAt(row),
    });
    if (legacySnapshotTarget) legacySkillTargetIds.add(targetId);
  }
  const packagesByIdentity = new Map<string, TargetMatch[]>();
  const packageCandidatesByName = new Map<string, TargetMatch[]>();
  const legacyPackageTargetIds = new Set<string>();
  for (const row of packages) {
    const ownerHandle =
      publisherHandles.get(String(row.ownerPublisherId ?? "")) ??
      userHandles.get(String(row.ownerUserId ?? ""));
    if (typeof row.normalizedName !== "string") continue;
    const targetId = String(row._id);
    const legacySnapshotTarget = ownerHandle?.startsWith("test-snapshot-") ?? false;
    const match = { targetId, legacySnapshotTarget, createdAt: snapshotCreatedAt(row) };
    appendMapValue(packageCandidatesByName, row.normalizedName, match);
    if (
      (row.family === "code-plugin" || row.family === "bundle-plugin") &&
      typeof row.channel === "string"
    ) {
      appendMapValue(
        packagesByIdentity,
        packageIdentity(row.normalizedName, row.family, row.channel),
        match,
      );
    }
    if (legacySnapshotTarget) legacyPackageTargetIds.add(targetId);
  }
  return {
    skillsByIdentity,
    packagesByIdentity,
    packageCandidatesByName,
    legacySkillTargetIds,
    legacyPackageTargetIds,
    rankingMetricImports: imports,
  };
}

export function resolveTargets(
  targets: RankingMetricTarget[],
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
) {
  const resolved: ResolvedRankingMetricTarget[] = [];
  let unresolvedTargets = 0;
  for (const target of targets) {
    const match = (() => {
      if (target.kind === "skill") {
        return current.skillsByIdentity.get(`${target.ownerHandle}/${target.slug}`);
      }
      const matches =
        current.packagesByIdentity.get(
          packageIdentity(target.normalizedName, target.family, target.channel),
        ) ?? [];
      if (matches.length > 1) {
        throw new Error(
          `ambiguous package identity: ${target.normalizedName} (${target.family}/${target.channel})`,
        );
      }
      if (matches.length === 0 && current.packageCandidatesByName.has(target.normalizedName)) {
        throw new Error(
          `package identity mismatch: ${target.normalizedName} (${target.family}/${target.channel})`,
        );
      }
      const exact = matches[0];
      if (exact && !exact.legacySnapshotTarget) {
        throw new Error(
          `package identity mismatch: ${target.normalizedName} is not a Test snapshot target`,
        );
      }
      return exact;
    })();
    if (!match?.legacySnapshotTarget) {
      unresolvedTargets += 1;
      continue;
    }
    if (match.createdAt !== target.createdAt) {
      const identity =
        target.kind === "skill"
          ? `skill creation timestamp mismatch: ${target.ownerHandle}/${target.slug}`
          : `package creation timestamp mismatch: ${target.normalizedName}`;
      throw new Error(identity);
    }
    resolved.push({
      kind: target.kind,
      targetId: match.targetId,
      legacySnapshotTarget: true,
      days: target.days,
    });
  }
  return { targets: resolved, unresolvedTargets };
}

function snapshotCreatedAt(row: Record<string, unknown>) {
  const createdAt = row.createdAt;
  if (typeof createdAt === "number" && Number.isSafeInteger(createdAt) && createdAt >= 0) {
    return createdAt;
  }
  const creationTime = row._creationTime;
  return typeof creationTime === "number" && Number.isFinite(creationTime) && creationTime >= 0
    ? Math.floor(creationTime)
    : null;
}

function packageIdentity(normalizedName: string, family: string, channel: string) {
  return packageTargetIdentity(normalizedName, family, channel);
}

function appendMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

export async function mergeDailyTable(input: {
  snapshot: string;
  table: DailyTable;
  idField: DailyIdField;
  output: string;
  datasetVersion: string;
  importedAt: number;
  startDay: number;
  endDay: number;
  legacyTargetIds: ReadonlySet<string>;
  targets: ResolvedRankingMetricTarget[];
}) {
  const incoming = new Map<
    string,
    { rows: Array<RankingMetricDay | undefined>; imported: number }
  >();
  for (const target of input.targets) {
    const rows: Array<RankingMetricDay | undefined> = Array.from({ length: 60 });
    for (const row of target.days) rows[row.day - input.startDay] = row;
    incoming.set(target.targetId, { rows, imported: 0 });
  }

  const stream = createWriteStream(input.output, { flags: "wx" });
  for await (const raw of readSnapshotTable(input.snapshot, input.table)) {
    const targetId = String(raw[input.idField]);
    const state = incoming.get(targetId);
    const day = Number(raw.day);
    const offset = day - input.startDay;
    const replacement = state?.rows[offset];
    if (replacement) {
      await writeLine(
        stream,
        serializeImportedDailyRow(
          targetId,
          input.idField,
          replacement,
          input.datasetVersion,
          input.importedAt,
          raw,
        ),
      );
      state.rows[offset] = undefined;
      state.imported += 1;
      continue;
    }
    if (typeof raw.rankingDatasetVersion === "string") continue;
    if (input.legacyTargetIds.has(targetId) && day >= input.startDay && day <= input.endDay) {
      continue;
    }
    await writeLine(stream, raw);
  }

  let importedRows = 0;
  for (const [targetId, state] of incoming) {
    importedRows += state.imported;
    for (const row of state.rows) {
      if (!row) continue;
      await writeLine(
        stream,
        serializeImportedDailyRow(
          targetId,
          input.idField,
          row,
          input.datasetVersion,
          input.importedAt,
        ),
      );
      importedRows += 1;
    }
  }
  await closeStream(stream);
  return { importedRows };
}

async function filterDailyTable(
  snapshot: string,
  table: DailyTable,
  output: string,
  datasetVersion: string,
) {
  const stream = createWriteStream(output, { flags: "wx" });
  let removed = 0;
  for await (const row of readSnapshotTable(snapshot, table)) {
    if (row.rankingDatasetVersion === datasetVersion) {
      removed += 1;
      continue;
    }
    await writeLine(stream, row);
  }
  await closeStream(stream);
  return { removed };
}

async function readback(deployment: string, datasetVersion: string) {
  const workDir = await mkdtemp(`${tmpdir()}/clawhub-ranking-readback-`);
  const snapshot = `${workDir}/test-readback.zip`;
  try {
    exportDeploymentSnapshot(deployment, snapshot);
    return await readbackSnapshot(deployment, snapshot, datasetVersion);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function readbackSnapshot(deployment: string, snapshot: string, datasetVersion: string) {
  const imports = await collectSnapshotTable(snapshot, "rankingMetricImports");
  const metadata = imports.find((row) => row.datasetVersion === datasetVersion);
  if (!metadata) throw new Error(`No Test import metadata found for ${datasetVersion}`);
  const startDay = Number(metadata.startDay);
  const endDay = Number(metadata.endDay);
  const [skill, packageRows] = await Promise.all([
    summarizeSnapshotTable(
      snapshot,
      "skillDailyStats",
      "skillId",
      datasetVersion,
      startDay,
      endDay,
    ),
    summarizeSnapshotTable(
      snapshot,
      "packageDailyStats",
      "packageId",
      datasetVersion,
      startDay,
      endDay,
    ),
  ]);
  return {
    deployment,
    datasetVersion,
    checksum: metadata.checksum,
    generatedAt: metadata.generatedAt,
    importedAt: metadata.importedAt,
    declared: {
      targets: metadata.targetCount,
      skillTargets: metadata.skillTargetCount,
      packageTargets: metadata.packageTargetCount,
      dailyRows: metadata.dailyRowCount,
      startDay,
      endDay,
    },
    imported: {
      skill,
      package: packageRows,
      unresolvedTargets: metadata.unresolvedTargets,
      skippedOverlayRows: metadata.skippedOverlayRows,
    },
  };
}

async function summarizeSnapshotTable(
  snapshot: string,
  table: DailyTable,
  idField: DailyIdField,
  datasetVersion: string,
  startDay: number,
  endDay: number,
) {
  let rows = 0;
  let minimumDay: number | null = null;
  let maximumDay: number | null = null;
  const targets = new Set<string>();
  const window24h = { downloads: 0, installs: 0, bookmarks: 0 };
  const window60d = { downloads: 0, installs: 0, bookmarks: 0 };
  for await (const row of readSnapshotTable(snapshot, table)) {
    if (row.rankingDatasetVersion !== datasetVersion) continue;
    const day = Number(row.day);
    const downloads = Number(row.downloads);
    const installs = Number(row.installs);
    const bookmarks = Number(row.bookmarks ?? 0);
    rows += 1;
    targets.add(String(row[idField]));
    minimumDay = minimumDay === null ? day : Math.min(minimumDay, day);
    maximumDay = maximumDay === null ? day : Math.max(maximumDay, day);
    if (day >= startDay && day <= endDay) {
      window60d.downloads += downloads;
      window60d.installs += installs;
      window60d.bookmarks += bookmarks;
    }
    if (day === endDay) {
      window24h.downloads += downloads;
      window24h.installs += installs;
      window24h.bookmarks += bookmarks;
    }
  }
  return {
    rows,
    targets: targets.size,
    startDay: minimumDay,
    endDay: maximumDay,
    window24h,
    window60d,
  };
}

async function writeBackupManifest(
  backupDir: string,
  metadataRows: number,
  datasetVersion: string,
) {
  await writeFile(
    `${backupDir}/backup-manifest.json`,
    `${JSON.stringify(
      {
        deployment: CLAWHUB_TEST_DEPLOYMENT,
        datasetVersion,
        createdAt: new Date().toISOString(),
        snapshot: "test-before.zip",
        tables: {
          skillDailyStats: "snapshot",
          packageDailyStats: "snapshot",
          rankingMetricImports: metadataRows,
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function createPlannedTablePaths(workDir: string): Promise<PlannedTablePaths> {
  const root = join(workDir, "planned-ranking-tables");
  const paths = {
    root,
    skillDailyStats: join(root, "skillDailyStats", "documents.jsonl"),
    packageDailyStats: join(root, "packageDailyStats", "documents.jsonl"),
    rankingMetricImports: join(root, "rankingMetricImports", "documents.jsonl"),
  };
  await Promise.all([
    mkdir(join(root, "skillDailyStats"), { recursive: true }),
    mkdir(join(root, "packageDailyStats"), { recursive: true }),
    mkdir(join(root, "rankingMetricImports"), { recursive: true }),
  ]);
  return paths;
}

async function importPlannedTables(
  workDir: string,
  plannedRoot: string,
  deployment: string,
  laneRunId: number,
  datasetVersion: string,
  lockValue: string,
) {
  assertTestRankingWriteLock(deployment, lockValue);
  const baseline = `${workDir}/test-before.zip`;
  const preflight = `${workDir}/test-preflight.zip`;
  exportDeploymentSnapshot(deployment, preflight);
  await assertRankingTablesUnchanged(baseline, preflight);
  const archive = join(workDir, "ranking-tables.next.zip");
  createTableArchive(plannedRoot, archive);
  assertExclusiveTestLane(laneRunId, datasetVersion);
  assertTestRankingWriteLock(deployment, lockValue);
  const expectedLogicalDigests = await rankingTableLogicalDigests(archive);
  await recordRollbackSourceState(workDir, expectedLogicalDigests);
  importArchive(deployment, archive);
  const importedSnapshot = join(workDir, "test-after.zip");
  exportDeploymentSnapshot(deployment, importedSnapshot);
  await assertRankingTablesMatchLogicalDigests(importedSnapshot, expectedLogicalDigests);
  return importedSnapshot;
}

export async function assertRankingTablesUnchanged(baseline: string, current: string) {
  for (const table of IMPORT_SOURCE_TABLES) {
    const [baselineDigest, currentDigest] = await Promise.all([
      digestSnapshotTable(baseline, table),
      digestSnapshotTable(current, table),
    ]);
    if (baselineDigest !== currentDigest) {
      throw new Error(`${table} changed after the backup snapshot; aborting before import`);
    }
  }
}

export async function rankingTableDigests(snapshot: string) {
  const entries = await Promise.all(
    RANKING_TABLES.map(
      async (table) => [table, await digestSnapshotTable(snapshot, table)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RankingTable, string>;
}

export async function assertRankingTablesMatchDigests(
  snapshot: string,
  expected: Partial<Record<RankingTable, unknown>>,
) {
  for (const table of RANKING_TABLES) {
    if (typeof expected[table] !== "string") {
      throw new Error(`Backup manifest is missing the ${table} rollback source digest`);
    }
    if ((await digestSnapshotTable(snapshot, table)) !== expected[table]) {
      throw new Error(`${table} no longer matches the rollback source state`);
    }
  }
}

export async function rankingTableLogicalDigests(snapshot: string) {
  const entries = await Promise.all(
    RANKING_TABLES.map(
      async (table) => [table, await logicalDigestSnapshotTable(snapshot, table)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RankingTable, string>;
}

export async function assertRankingTablesMatchLogicalDigests(
  snapshot: string,
  expected: Partial<Record<RankingTable, unknown>>,
) {
  for (const table of RANKING_TABLES) {
    if (typeof expected[table] !== "string") {
      throw new Error(`Backup manifest is missing the ${table} rollback source digest`);
    }
    if ((await logicalDigestSnapshotTable(snapshot, table)) !== expected[table]) {
      throw new Error(`${table} no longer matches the rollback source state`);
    }
  }
}

async function logicalDigestSnapshotTable(snapshot: string, table: RankingTable) {
  // Convex assigns system IDs on import, so bind rollback to an order-independent logical multiset.
  const mask = (1n << 256n) - 1n;
  let count = 0;
  let xor = 0n;
  let sum = 0n;
  for await (const row of readSnapshotTable(snapshot, table)) {
    const { _id: _id, _creationTime: _creationTime, ...logicalRow } = row;
    const rowHash = BigInt(
      `0x${createHash("sha256").update(stableStringify(logicalRow)).digest("hex")}`,
    );
    count += 1;
    xor ^= rowHash;
    sum = (sum + rowHash) & mask;
  }
  return `${count}:${xor.toString(16).padStart(64, "0")}:${sum.toString(16).padStart(64, "0")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function recordRollbackSourceState(
  backupDir: string,
  expectedCurrentLogicalDigests: Record<RankingTable, string>,
) {
  const manifestPath = join(backupDir, "backup-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.expectedCurrentLogicalDigests = expectedCurrentLogicalDigests;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function digestSnapshotTable(snapshot: string, table: string) {
  const digest = createHash("sha256");
  for await (const row of readSnapshotTable(snapshot, table)) {
    digest.update(JSON.stringify(row));
    digest.update("\n");
  }
  return digest.digest("hex");
}

async function restoreBackup(backupDir: string, deployment: string, laneRunId: number) {
  const manifest = JSON.parse(await readFile(`${backupDir}/backup-manifest.json`, "utf8")) as {
    deployment?: unknown;
    datasetVersion?: unknown;
    expectedCurrentLogicalDigests?: Partial<Record<RankingTable, unknown>>;
    snapshot?: unknown;
  };
  if (
    manifest.deployment !== CLAWHUB_TEST_DEPLOYMENT ||
    typeof manifest.datasetVersion !== "string" ||
    !manifest.expectedCurrentLogicalDigests ||
    manifest.snapshot !== "test-before.zip"
  ) {
    throw new Error("Backup manifest is not for the permanent Test deployment");
  }
  const datasetVersion = manifest.datasetVersion;
  const expectedCurrentLogicalDigests = manifest.expectedCurrentLogicalDigests;
  await withRankingMetricsWriteLock(deployment, laneRunId, datasetVersion, async (lockValue) => {
    const snapshot = `${backupDir}/test-before.zip`;
    const workDir = await mkdtemp(`${tmpdir()}/clawhub-ranking-rollback-`);
    try {
      const planned = await createPlannedTablePaths(workDir);
      await Promise.all([
        copySnapshotTable(snapshot, "skillDailyStats", planned.skillDailyStats),
        copySnapshotTable(snapshot, "packageDailyStats", planned.packageDailyStats),
        copySnapshotTable(snapshot, "rankingMetricImports", planned.rankingMetricImports),
      ]);
      assertTestRankingWriteLock(deployment, lockValue);
      const currentSnapshot = join(workDir, "test-current.zip");
      exportDeploymentSnapshot(deployment, currentSnapshot);
      await assertRankingTablesMatchLogicalDigests(currentSnapshot, expectedCurrentLogicalDigests);
      const archive = join(workDir, "ranking-tables.rollback.zip");
      createTableArchive(planned.root, archive);
      assertExclusiveTestLane(laneRunId, datasetVersion);
      assertTestRankingWriteLock(deployment, lockValue);
      importArchive(deployment, archive);
      console.log(JSON.stringify({ ok: true, mode: "rollback", deployment, backupDir }, null, 2));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}

function createTableArchive(root: string, archive: string) {
  const result = spawnSync("zip", ["-q", "-r", archive, "."], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Failed to create ranking table import archive");
}

export function buildConvexImportArchiveCommand(archive: string, deployment: string) {
  assertTestDeployment(deployment);
  return {
    command: "bunx",
    args: ["convex", "import", "--deployment", deployment, "--replace", "--yes", archive],
  };
}

function assertExclusiveTestLane(runId: number, datasetVersion: string) {
  const reservation = JSON.parse(
    commandOutput("gh", ["api", `repos/openclaw/clawhub/actions/runs/${runId}`]),
  ) as unknown;
  const localSha = commandOutput("git", ["rev-parse", "HEAD"]);
  const mainSha = commandOutput("gh", [
    "api",
    "repos/openclaw/clawhub/commits/main",
    "--jq",
    ".sha",
  ]);
  validateExclusiveTestLane({
    reservation,
    runId,
    datasetVersion,
    localSha,
    mainSha,
    now: Date.now(),
  });
}

async function withRankingMetricsWriteLock<Result>(
  deployment: string,
  laneRunId: number,
  datasetVersion: string,
  operation: (lockValue: string) => Promise<Result>,
) {
  assertTestDeployment(deployment);
  assertExclusiveTestLane(laneRunId, datasetVersion);
  const existing = readTestRankingWriteLock(deployment);
  if (existing && !isExpiredRankingWriteLock(existing)) {
    throw new Error("The permanent Test ranking metric write lock is already active");
  }
  const lockValue = `${datasetVersion}:${laneRunId}:${Date.now() + 6 * 60 * 60 * 1_000}`;
  runConvexEnvCommand(deployment, ["set", RANKING_METRICS_IMPORT_LOCK_ENV, lockValue]);
  try {
    await delay(5_000);
    assertExclusiveTestLane(laneRunId, datasetVersion);
    assertTestRankingWriteLock(deployment, lockValue);
    return await operation(lockValue);
  } finally {
    const current = readTestRankingWriteLock(deployment);
    if (current !== lockValue) {
      throw new Error("Refusing to clear a Test ranking metric write lock owned by another run");
    }
    runConvexEnvCommand(deployment, ["remove", RANKING_METRICS_IMPORT_LOCK_ENV]);
  }
}

function assertTestRankingWriteLock(deployment: string, expected: string) {
  const current = readTestRankingWriteLock(deployment);
  const expiresAt = Number(expected.split(":").at(-1));
  if (
    current !== expected ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt - Date.now() < 30 * 60_000
  ) {
    throw new Error("The permanent Test ranking metric write lock is not safely active");
  }
}

function isExpiredRankingWriteLock(value: string) {
  const expiresAt = Number(value.split(":").at(-1));
  return Number.isSafeInteger(expiresAt) && expiresAt <= Date.now();
}

function readTestRankingWriteLock(deployment: string) {
  const result = spawnSync(
    "bunx",
    ["convex", "env", "get", RANKING_METRICS_IMPORT_LOCK_ENV, "--deployment", deployment],
    { cwd: process.cwd(), encoding: "utf8", env: process.env },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (output.includes(`Environment variable "${RANKING_METRICS_IMPORT_LOCK_ENV}" not found`)) {
    return "";
  }
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Failed to read the permanent Test ranking metric write lock");
  }
  return result.stdout.trim();
}

function runConvexEnvCommand(deployment: string, args: string[]) {
  assertTestDeployment(deployment);
  const result = spawnSync("bunx", ["convex", "env", ...args, "--deployment", deployment], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error("Failed to update the permanent Test ranking metric write lock");
  }
}

export function validateExclusiveTestLane(input: {
  reservation: unknown;
  runId: number;
  datasetVersion: string;
  localSha: string;
  mainSha: string;
  now: number;
}) {
  if (!isRecord(input.reservation)) {
    throw new Error("Test lane reservation response is invalid");
  }
  const run = input.reservation;
  if (
    run.id !== input.runId ||
    run.status !== "in_progress" ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.path !== TEST_LANE_WORKFLOW_PATH ||
    run.display_title !== `Reserve Test for ${input.datasetVersion}`
  ) {
    throw new Error(`GitHub Actions run ${input.runId} is not actively holding the Test lane`);
  }
  if (run.head_sha !== input.localSha || run.head_sha !== input.mainSha) {
    throw new Error("Test lane reservation, local checkout, and exact current main must match");
  }
  const startedAt = typeof run.run_started_at === "string" ? Date.parse(run.run_started_at) : NaN;
  const ageMs = input.now - startedAt;
  if (!Number.isFinite(startedAt) || ageMs < 0 || ageMs >= TEST_LANE_MAX_AGE_MS) {
    throw new Error(`GitHub Actions run ${input.runId} is not actively holding a fresh Test lane`);
  }
}

function commandOutput(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Failed to verify Test lane with ${command} ${args[0] ?? ""}`);
  }
  return result.stdout.trim();
}

function importArchive(deployment: string, archive: string) {
  const step = buildConvexImportArchiveCommand(archive, deployment);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Failed to atomically import Test ranking tables");
}

function exportDeploymentSnapshot(deployment: string, path: string) {
  assertTestDeployment(deployment);
  const result = spawnSync(
    "bunx",
    ["convex", "export", "--deployment", deployment, "--path", path],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Failed to export the permanent Test deployment");
}

async function collectSnapshotTable(snapshot: string, table: string) {
  const rows: Record<string, unknown>[] = [];
  for await (const row of readSnapshotTable(snapshot, table)) rows.push(row);
  return rows;
}

export async function copySnapshotTable(
  snapshot: string,
  table: DailyTable | "rankingMetricImports",
  output: string,
) {
  const stream = createWriteStream(output, { flags: "w" });
  for await (const row of readSnapshotTable(snapshot, table)) {
    await writeLine(stream, row);
  }
  await closeStream(stream);
}

function serializeImportedDailyRow(
  targetId: string,
  idField: DailyIdField,
  row: RankingMetricDay,
  datasetVersion: string,
  importedAt: number,
  existing?: Record<string, unknown>,
) {
  return {
    ...(existing ? systemFields(existing) : {}),
    [idField]: targetId,
    day: row.day,
    downloads: row.downloads,
    installs: row.installs,
    bookmarks: row.bookmarks,
    updatedAt: importedAt,
    rankingDatasetVersion: datasetVersion,
    rankingImportedAt: importedAt,
  };
}

function systemFields(row: Record<string, unknown>) {
  return {
    ...(typeof row._id === "string" ? { _id: row._id } : {}),
    ...(typeof row._creationTime === "number" ? { _creationTime: row._creationTime } : {}),
  };
}

export function mergeRankingMetricImportRows(
  current: Record<string, unknown>[],
  next: Record<string, unknown>,
) {
  const datasetVersion = next.datasetVersion;
  let replaced = false;
  const rows = current.map((row) => {
    if (row.datasetVersion !== datasetVersion) return row;
    if (replaced) {
      throw new Error(`duplicate ranking import provenance for ${String(datasetVersion)}`);
    }
    replaced = true;
    return { ...next, ...systemFields(row) };
  });
  if (!replaced) rows.push(next);
  return rows;
}

async function writeJsonLines(path: string, rows: Record<string, unknown>[]) {
  const stream = createWriteStream(path, { flags: "wx" });
  for (const row of rows) await writeLine(stream, row);
  await closeStream(stream);
}

async function writeLine(stream: WriteStream, row: Record<string, unknown>) {
  if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, "drain");
}

async function closeStream(stream: WriteStream) {
  stream.end();
  await once(stream, "close");
}

async function assertEmptyDirectory(path: string) {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(`${path} is not a directory`);
    if ((await readdir(path)).length > 0)
      throw new Error(`Backup directory must be empty: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function assertTestDeployment(deployment: string) {
  if (deployment !== CLAWHUB_TEST_DEPLOYMENT) {
    throw new Error(
      `Ranking metric imports may only target ${CLAWHUB_TEST_DEPLOYMENT}; received ${deployment}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseArgs(args: string[]) {
  let mode: Mode = "import";
  let deployment = CLAWHUB_TEST_DEPLOYMENT;
  let dataset = "";
  let datasetVersion = "";
  let backupDir = "";
  let laneRunId = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--readback") mode = "readback";
    else if (arg === "--cleanup") mode = "cleanup";
    else if (arg === "--rollback") mode = "rollback";
    else if (arg === "--deployment") deployment = args[++index] ?? "";
    else if (arg.startsWith("--deployment=")) deployment = arg.slice("--deployment=".length);
    else if (arg === "--dataset") dataset = args[++index] ?? "";
    else if (arg.startsWith("--dataset=")) dataset = arg.slice("--dataset=".length);
    else if (arg === "--dataset-version") datasetVersion = args[++index] ?? "";
    else if (arg.startsWith("--dataset-version=")) {
      datasetVersion = arg.slice("--dataset-version=".length);
    } else if (arg === "--backup-dir") backupDir = args[++index] ?? "";
    else if (arg.startsWith("--backup-dir=")) backupDir = arg.slice("--backup-dir=".length);
    else if (arg === "--lane-run-id") laneRunId = Number(args[++index]);
    else if (arg.startsWith("--lane-run-id=")) {
      laneRunId = Number(arg.slice("--lane-run-id=".length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  assertTestDeployment(deployment);
  if (mode !== "readback" && !backupDir) throw new Error("--backup-dir is required");
  if (mode !== "readback" && (!Number.isSafeInteger(laneRunId) || laneRunId <= 0)) {
    throw new Error("--lane-run-id is required for mutating operations");
  }
  if ((mode === "import" || mode === "cleanup") && !dataset)
    throw new Error("--dataset is required");
  if (mode === "rollback" && dataset) throw new Error("--dataset is not valid with --rollback");
  return {
    mode: mode as Mode,
    deployment,
    dataset: dataset ? resolve(dataset) : "",
    datasetVersion,
    backupDir: backupDir ? resolve(backupDir) : "",
    laneRunId,
  };
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
