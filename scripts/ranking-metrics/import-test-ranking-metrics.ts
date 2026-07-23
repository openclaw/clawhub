#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import { readSnapshotTable } from "../staging-seed/snapshotIo";
import {
  parseRankingDataset,
  type RankingDataset,
  type RankingMetricDay,
  type RankingMetricTarget,
} from "./rankingDataset";

type Mode = "import" | "readback" | "cleanup" | "rollback";
type DailyTable = "skillDailyStats" | "packageDailyStats";
type DailyIdField = "skillId" | "packageId";
export type ResolvedRankingMetricTarget = {
  kind: "skill" | "package";
  targetId: string;
  legacySnapshotTarget: boolean;
  days: RankingMetricDay[];
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertTestDeployment(options.deployment);

  if (options.mode === "rollback") {
    await restoreBackup(options.backupDir, options.deployment);
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
  await assertEmptyDirectory(options.backupDir);
  await mkdir(options.backupDir, { recursive: true });
  const snapshot = `${options.backupDir}/test-before.zip`;
  exportDeploymentSnapshot(options.deployment, snapshot);
  const current = await readCurrentTestMetadata(snapshot);
  await writeBackupManifest(options.backupDir, current.rankingMetricImports.length);

  if (options.mode === "cleanup") {
    await applyCleanup(current, dataset, options.deployment, options.backupDir);
  } else {
    await applyImport(current, dataset, options.deployment, options.backupDir);
  }
}

async function applyImport(
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
  dataset: RankingDataset,
  deployment: string,
  workDir: string,
) {
  const resolved = resolveTargets(dataset.targets, current);
  const importedAt = Date.now();
  const snapshot = `${workDir}/test-before.zip`;
  const skillPlan = await mergeDailyTable({
    snapshot,
    table: "skillDailyStats",
    idField: "skillId",
    output: `${workDir}/skillDailyStats.next.jsonl`,
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
    output: `${workDir}/packageDailyStats.next.jsonl`,
    datasetVersion: dataset.datasetVersion,
    importedAt,
    startDay: dataset.startDay,
    endDay: dataset.endDay,
    legacyTargetIds: current.legacyPackageTargetIds,
    targets: resolved.targets.filter((target) => target.kind === "package"),
  });
  const metadata = [
    {
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
    },
  ];
  await writeJsonLines(`${workDir}/rankingMetricImports.next.jsonl`, metadata);

  await importPlannedTables(workDir, deployment);
  const proof = await readback(deployment, dataset.datasetVersion);
  console.log(JSON.stringify({ ok: true, mode: "import", ...proof }, null, 2));
}

async function applyCleanup(
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
  dataset: RankingDataset,
  deployment: string,
  workDir: string,
) {
  const snapshot = `${workDir}/test-before.zip`;
  const [skill, packageRows] = await Promise.all([
    filterDailyTable(
      snapshot,
      "skillDailyStats",
      `${workDir}/skillDailyStats.next.jsonl`,
      dataset.datasetVersion,
    ),
    filterDailyTable(
      snapshot,
      "packageDailyStats",
      `${workDir}/packageDailyStats.next.jsonl`,
      dataset.datasetVersion,
    ),
  ]);
  await writeJsonLines(
    `${workDir}/rankingMetricImports.next.jsonl`,
    current.rankingMetricImports.filter((row) => row.datasetVersion !== dataset.datasetVersion),
  );
  await importPlannedTables(workDir, deployment);
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

async function readCurrentTestMetadata(snapshot: string) {
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
  const skillsByIdentity = new Map<string, { targetId: string; legacySnapshotTarget: boolean }>();
  const legacySkillTargetIds = new Set<string>();
  for (const row of skills) {
    const ownerHandle =
      publisherHandles.get(String(row.ownerPublisherId ?? "")) ??
      userHandles.get(String(row.ownerUserId ?? ""));
    if (!ownerHandle || typeof row.slug !== "string") continue;
    const targetId = String(row._id);
    const legacySnapshotTarget = ownerHandle.startsWith("test-snapshot-");
    skillsByIdentity.set(`${ownerHandle}/${row.slug}`, { targetId, legacySnapshotTarget });
    if (legacySnapshotTarget) legacySkillTargetIds.add(targetId);
  }
  const packagesByIdentity = new Map<string, { targetId: string; legacySnapshotTarget: boolean }>();
  const legacyPackageTargetIds = new Set<string>();
  for (const row of packages) {
    const ownerHandle =
      publisherHandles.get(String(row.ownerPublisherId ?? "")) ??
      userHandles.get(String(row.ownerUserId ?? ""));
    if (!ownerHandle || typeof row.normalizedName !== "string") continue;
    const targetId = String(row._id);
    const legacySnapshotTarget = ownerHandle.startsWith("test-snapshot-");
    packagesByIdentity.set(row.normalizedName, { targetId, legacySnapshotTarget });
    if (legacySnapshotTarget) legacyPackageTargetIds.add(targetId);
  }
  return {
    skillsByIdentity,
    packagesByIdentity,
    legacySkillTargetIds,
    legacyPackageTargetIds,
    rankingMetricImports: imports,
  };
}

function resolveTargets(
  targets: RankingMetricTarget[],
  current: Awaited<ReturnType<typeof readCurrentTestMetadata>>,
) {
  const resolved: ResolvedRankingMetricTarget[] = [];
  let unresolvedTargets = 0;
  for (const target of targets) {
    const match =
      target.kind === "skill"
        ? current.skillsByIdentity.get(`${target.ownerHandle}/${target.slug}`)
        : current.packagesByIdentity.get(target.normalizedName);
    if (!match?.legacySnapshotTarget) {
      unresolvedTargets += 1;
      continue;
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
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
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

async function writeBackupManifest(backupDir: string, metadataRows: number) {
  await writeFile(
    `${backupDir}/backup-manifest.json`,
    `${JSON.stringify(
      {
        deployment: CLAWHUB_TEST_DEPLOYMENT,
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

async function importPlannedTables(workDir: string, deployment: string) {
  const baseline = `${workDir}/test-before.zip`;
  const preflight = `${workDir}/test-preflight.zip`;
  exportDeploymentSnapshot(deployment, preflight);
  await assertRankingTablesUnchanged(baseline, preflight);
  try {
    importTable(deployment, "skillDailyStats", `${workDir}/skillDailyStats.next.jsonl`);
    importTable(deployment, "packageDailyStats", `${workDir}/packageDailyStats.next.jsonl`);
    importTable(deployment, "rankingMetricImports", `${workDir}/rankingMetricImports.next.jsonl`);
  } catch (error) {
    await restoreBackup(workDir, deployment);
    throw error;
  }
}

export async function assertRankingTablesUnchanged(baseline: string, current: string) {
  for (const table of ["skillDailyStats", "packageDailyStats", "rankingMetricImports"] as const) {
    const [baselineDigest, currentDigest] = await Promise.all([
      digestSnapshotTable(baseline, table),
      digestSnapshotTable(current, table),
    ]);
    if (baselineDigest !== currentDigest) {
      throw new Error(`${table} changed after the backup snapshot; aborting before import`);
    }
  }
}

async function digestSnapshotTable(snapshot: string, table: string) {
  const digest = createHash("sha256");
  for await (const row of readSnapshotTable(snapshot, table)) {
    digest.update(JSON.stringify(row));
    digest.update("\n");
  }
  return digest.digest("hex");
}

async function restoreBackup(backupDir: string, deployment: string) {
  const manifest = JSON.parse(await readFile(`${backupDir}/backup-manifest.json`, "utf8")) as {
    deployment?: unknown;
    snapshot?: unknown;
  };
  if (manifest.deployment !== CLAWHUB_TEST_DEPLOYMENT || manifest.snapshot !== "test-before.zip") {
    throw new Error("Backup manifest is not for the permanent Test deployment");
  }
  const snapshot = `${backupDir}/test-before.zip`;
  await Promise.all([
    copySnapshotTable(snapshot, "skillDailyStats", `${backupDir}/skillDailyStats.restore.jsonl`),
    copySnapshotTable(
      snapshot,
      "packageDailyStats",
      `${backupDir}/packageDailyStats.restore.jsonl`,
    ),
    copySnapshotTable(
      snapshot,
      "rankingMetricImports",
      `${backupDir}/rankingMetricImports.restore.jsonl`,
    ),
  ]);
  importTable(deployment, "skillDailyStats", `${backupDir}/skillDailyStats.restore.jsonl`);
  importTable(deployment, "packageDailyStats", `${backupDir}/packageDailyStats.restore.jsonl`);
  importTable(
    deployment,
    "rankingMetricImports",
    `${backupDir}/rankingMetricImports.restore.jsonl`,
  );
  console.log(JSON.stringify({ ok: true, mode: "rollback", deployment, backupDir }, null, 2));
}

function importTable(deployment: string, table: string, file: string) {
  assertTestDeployment(deployment);
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "import",
      "--deployment",
      deployment,
      "--table",
      table,
      "--replace",
      "--yes",
      "--format",
      "jsonLines",
      file,
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`Failed to import Test table ${table}`);
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

export function parseArgs(args: string[]) {
  let mode: Mode = "import";
  let deployment = CLAWHUB_TEST_DEPLOYMENT;
  let dataset = "";
  let datasetVersion = "";
  let backupDir = "";
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assertTestDeployment(deployment);
  if (mode !== "readback" && !backupDir) throw new Error("--backup-dir is required");
  if ((mode === "import" || mode === "cleanup") && !dataset)
    throw new Error("--dataset is required");
  if (mode === "rollback" && dataset) throw new Error("--dataset is not valid with --rollback");
  return {
    mode: mode as Mode,
    deployment,
    dataset: dataset ? resolve(dataset) : "",
    datasetVersion,
    backupDir: backupDir ? resolve(backupDir) : "",
  };
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
