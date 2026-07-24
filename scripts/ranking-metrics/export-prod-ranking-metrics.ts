#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSnapshotTable } from "../staging-seed/snapshotIo";
import {
  dummyIdentity,
  isPublicPackageSnapshot,
  isPublicSkillSnapshot,
  type SnapshotDocument,
} from "../staging-seed/snapshotPolicy";
import {
  buildRankingDataset,
  packageTargetIdentity,
  type RankingMetricDay,
  type RankingMetricPackageTarget,
  type RankingMetricSkillTarget,
  type RankingMetricTarget,
} from "./rankingDataset";

type TargetBuilder =
  | Omit<RankingMetricSkillTarget, "days">
  | Omit<RankingMetricPackageTarget, "days">;

const SOURCE_TABLES = [
  "skills",
  "packages",
  "skillDailyStats",
  "packageDailyStats",
  "stars",
] as const;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetBySourceId = new Map<string, TargetBuilder>();
  const dayRows = new Map<string, Map<number, RankingMetricDay>>();

  for await (const row of readSnapshotTable(options.snapshot, "skills")) {
    if (!isSnapshotDocument(row) || !isPublicSkillSnapshot(row)) continue;
    const slug = stringField(row, "slug");
    const ownerPublisherId = optionalStringField(row, "ownerPublisherId");
    const ownerUserId = optionalStringField(row, "ownerUserId");
    const sourceOwnerId = ownerPublisherId ?? ownerUserId;
    if (!slug || !sourceOwnerId) continue;
    targetBySourceId.set(row._id, {
      kind: "skill",
      ownerHandle: dummyIdentity(sourceOwnerId, ownerPublisherId ? "publisher" : "user").handle,
      slug,
      createdAt: timestampField(row, "createdAt", row._creationTime),
    });
  }

  for await (const row of readSnapshotTable(options.snapshot, "packages")) {
    if (!isSnapshotDocument(row) || !isPublicPackageSnapshot(row)) continue;
    const normalizedName = stringField(row, "normalizedName");
    const family = row.family;
    const channel = stringField(row, "channel");
    if (!normalizedName || (family !== "code-plugin" && family !== "bundle-plugin") || !channel) {
      continue;
    }
    targetBySourceId.set(row._id, {
      kind: "package",
      normalizedName,
      family,
      channel,
      createdAt: timestampField(row, "createdAt", row._creationTime),
    });
  }

  await aggregateDailyTable(
    "skillDailyStats",
    "skillId",
    targetBySourceId,
    dayRows,
    options.snapshot,
    options.startDay,
    options.endDay,
  );
  await aggregateDailyTable(
    "packageDailyStats",
    "packageId",
    targetBySourceId,
    dayRows,
    options.snapshot,
    options.startDay,
    options.endDay,
  );
  await aggregateBookmarks(
    targetBySourceId,
    dayRows,
    options.snapshot,
    options.startDay,
    options.endDay,
  );

  const targets: RankingMetricTarget[] = [];
  for (const [sourceId, metadata] of targetBySourceId) {
    const days = [...(dayRows.get(sourceId)?.values() ?? [])]
      .filter((row) => row.downloads !== 0 || row.installs !== 0 || row.bookmarks !== 0)
      .sort((left, right) => left.day - right.day);
    if (days.length === 0) continue;
    targets.push({ ...metadata, days } as RankingMetricTarget);
  }
  targets.sort(compareTargets);

  const dataset = buildRankingDataset({
    datasetVersion: options.datasetVersion,
    generatedAt: new Date().toISOString(),
    startDay: options.startDay,
    endDay: options.endDay,
    targets,
  });
  await writeFile(options.output, `${JSON.stringify(dataset)}\n`, { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: options.output,
        sourceTables: SOURCE_TABLES,
        ...dataset.counts,
        datasetVersion: dataset.datasetVersion,
        checksum: dataset.checksum,
        startDay: dataset.startDay,
        endDay: dataset.endDay,
      },
      null,
      2,
    ),
  );
}

async function aggregateDailyTable(
  table: "skillDailyStats" | "packageDailyStats",
  idField: "skillId" | "packageId",
  targets: ReadonlyMap<string, TargetBuilder>,
  dayRows: Map<string, Map<number, RankingMetricDay>>,
  snapshot: string,
  startDay: number,
  endDay: number,
) {
  for await (const row of readSnapshotTable(snapshot, table)) {
    const sourceId = optionalStringField(row, idField);
    const day = integerField(row, "day");
    if (!sourceId || !targets.has(sourceId) || day === null || day < startDay || day > endDay) {
      continue;
    }
    const aggregate = ensureDay(dayRows, sourceId, day);
    aggregate.downloads += nonNegativeIntegerField(row, "downloads");
    aggregate.installs += nonNegativeIntegerField(row, "installs");
  }
}

async function aggregateBookmarks(
  targets: ReadonlyMap<string, TargetBuilder>,
  dayRows: Map<string, Map<number, RankingMetricDay>>,
  snapshot: string,
  startDay: number,
  endDay: number,
) {
  for await (const row of readSnapshotTable(snapshot, "stars")) {
    const sourceId = optionalStringField(row, "skillId");
    if (!sourceId || !targets.has(sourceId)) continue;
    const createdAt = numberField(row, "createdAt");
    if (createdAt === null) continue;
    const day = Math.floor(createdAt / 86_400_000);
    if (day < startDay || day > endDay) continue;
    ensureDay(dayRows, sourceId, day).bookmarks += 1;
  }
}

function ensureDay(
  rows: Map<string, Map<number, RankingMetricDay>>,
  sourceId: string,
  day: number,
) {
  let targetRows = rows.get(sourceId);
  if (!targetRows) {
    targetRows = new Map();
    rows.set(sourceId, targetRows);
  }
  let row = targetRows.get(day);
  if (!row) {
    row = { day, downloads: 0, installs: 0, bookmarks: 0 };
    targetRows.set(day, row);
  }
  return row;
}

export function parseArgs(args: string[]) {
  let output = "";
  let snapshot = "";
  let datasetVersion = "";
  let endDay = Math.floor(Date.now() / 86_400_000);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") output = args[++index] ?? "";
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
    else if (arg === "--snapshot") snapshot = args[++index] ?? "";
    else if (arg.startsWith("--snapshot=")) snapshot = arg.slice("--snapshot=".length);
    else if (arg === "--dataset-version") datasetVersion = args[++index] ?? "";
    else if (arg.startsWith("--dataset-version=")) {
      datasetVersion = arg.slice("--dataset-version=".length);
    } else if (arg === "--end-day") {
      endDay = Number(args[++index]);
    } else if (arg.startsWith("--end-day=")) {
      endDay = Number(arg.slice("--end-day=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!output) throw new Error("--output is required");
  if (!snapshot) throw new Error("--snapshot is required");
  if (!datasetVersion) throw new Error("--dataset-version is required");
  if (!Number.isSafeInteger(endDay)) throw new Error("--end-day must be an integer day key");
  return {
    output: resolve(output),
    snapshot: resolve(snapshot),
    datasetVersion,
    startDay: endDay - 59,
    endDay,
  };
}

function compareTargets(left: RankingMetricTarget, right: RankingMetricTarget) {
  const leftKey =
    left.kind === "skill"
      ? `skill:${left.ownerHandle}/${left.slug}`
      : packageTargetIdentity(left.normalizedName, left.family, left.channel);
  const rightKey =
    right.kind === "skill"
      ? `skill:${right.ownerHandle}/${right.slug}`
      : packageTargetIdentity(right.normalizedName, right.family, right.channel);
  return leftKey.localeCompare(rightKey);
}

function isSnapshotDocument(value: Record<string, unknown>): value is SnapshotDocument {
  return typeof value._id === "string" && typeof value._creationTime === "number";
}

function stringField(row: Record<string, unknown>, field: string) {
  const value = row[field];
  return typeof value === "string" && value ? value : null;
}

function optionalStringField(row: Record<string, unknown>, field: string) {
  return stringField(row, field);
}

function numberField(row: Record<string, unknown>, field: string) {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerField(row: Record<string, unknown>, field: string) {
  const value = numberField(row, field);
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeIntegerField(row: Record<string, unknown>, field: string) {
  const value = integerField(row, field);
  if (value === null || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function timestampField(row: Record<string, unknown>, field: string, fallback: number) {
  const value = integerField(row, field);
  return value !== null && value >= 0 ? value : Math.floor(fallback);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
