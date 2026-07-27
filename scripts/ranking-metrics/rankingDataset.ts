import { createHash } from "node:crypto";

export const RANKING_DATASET_SCHEMA_VERSION = 1;

export type RankingMetricDay = {
  day: number;
  downloads: number;
  installs: number;
  bookmarks: number;
};

export type RankingMetricSkillTarget = {
  kind: "skill";
  ownerHandle: string;
  slug: string;
  createdAt: number;
  days: RankingMetricDay[];
};

export type RankingMetricPackageTarget = {
  kind: "package";
  normalizedName: string;
  family: "code-plugin" | "bundle-plugin";
  channel: string;
  createdAt: number;
  days: RankingMetricDay[];
};

export type RankingMetricTarget = RankingMetricSkillTarget | RankingMetricPackageTarget;

export type RankingDataset = {
  schemaVersion: typeof RANKING_DATASET_SCHEMA_VERSION;
  datasetVersion: string;
  generatedAt: string;
  source: {
    environment: "production";
    access: "read-only";
    windowDays: 60;
  };
  startDay: number;
  endDay: number;
  counts: {
    targets: number;
    skillTargets: number;
    packageTargets: number;
    dailyRows: number;
    downloads: number;
    installs: number;
    bookmarks: number;
  };
  targets: RankingMetricTarget[];
  checksum: string;
};

type BuildRankingDatasetInput = Pick<
  RankingDataset,
  "datasetVersion" | "generatedAt" | "startDay" | "endDay" | "targets"
>;

const DATASET_KEYS = [
  "schemaVersion",
  "datasetVersion",
  "generatedAt",
  "source",
  "startDay",
  "endDay",
  "counts",
  "targets",
  "checksum",
] as const;
const SOURCE_KEYS = ["environment", "access", "windowDays"] as const;
const COUNT_KEYS = [
  "targets",
  "skillTargets",
  "packageTargets",
  "dailyRows",
  "downloads",
  "installs",
  "bookmarks",
] as const;
const SKILL_KEYS = ["kind", "ownerHandle", "slug", "createdAt", "days"] as const;
const PACKAGE_KEYS = ["kind", "normalizedName", "family", "channel", "createdAt", "days"] as const;
const DAY_KEYS = ["day", "downloads", "installs", "bookmarks"] as const;

export function buildRankingDataset(input: BuildRankingDatasetInput): RankingDataset {
  assertVersion(input.datasetVersion);
  assertIsoTimestamp(input.generatedAt);
  assertDayRange(input.startDay, input.endDay);
  validateTargets(input.targets, input.startDay, input.endDay);

  const counts = countTargets(input.targets);
  const withoutChecksum: Omit<RankingDataset, "checksum"> = {
    schemaVersion: RANKING_DATASET_SCHEMA_VERSION,
    datasetVersion: input.datasetVersion,
    generatedAt: input.generatedAt,
    source: {
      environment: "production",
      access: "read-only",
      windowDays: 60,
    },
    startDay: input.startDay,
    endDay: input.endDay,
    counts,
    targets: input.targets,
  };
  const dataset = { ...withoutChecksum, checksum: checksumValue(withoutChecksum) };
  validateDataset(dataset);
  return dataset;
}

export function parseRankingDataset(input: string): RankingDataset {
  const value: unknown = JSON.parse(input);
  validateDataset(value);
  return value;
}

export function rankingDatasetChecksum(dataset: RankingDataset) {
  const { checksum: _checksum, ...withoutChecksum } = dataset;
  return checksumValue(withoutChecksum);
}

function validateDataset(value: unknown): asserts value is RankingDataset {
  const dataset = recordWithKeys(value, DATASET_KEYS, "dataset");
  if (dataset.schemaVersion !== RANKING_DATASET_SCHEMA_VERSION) {
    throw new Error(`Unsupported ranking dataset schema version: ${String(dataset.schemaVersion)}`);
  }
  const datasetVersion = stringValue(dataset.datasetVersion, "datasetVersion");
  const generatedAt = stringValue(dataset.generatedAt, "generatedAt");
  assertVersion(datasetVersion);
  assertIsoTimestamp(generatedAt);

  const source = recordWithKeys(dataset.source, SOURCE_KEYS, "source");
  if (
    source.environment !== "production" ||
    source.access !== "read-only" ||
    source.windowDays !== 60
  ) {
    throw new Error("Ranking dataset source contract is invalid");
  }

  const startDay = integerValue(dataset.startDay, "startDay");
  const endDay = integerValue(dataset.endDay, "endDay");
  assertDayRange(startDay, endDay);
  if (!Array.isArray(dataset.targets)) throw new Error("targets must be an array");
  validateTargets(dataset.targets, startDay, endDay);

  const counts = recordWithKeys(dataset.counts, COUNT_KEYS, "counts");
  const expectedCounts = countTargets(dataset.targets);
  for (const key of COUNT_KEYS) {
    if (integerValue(counts[key], `counts.${key}`) !== expectedCounts[key]) {
      throw new Error(`counts.${key} does not match dataset rows`);
    }
  }

  const checksum = stringValue(dataset.checksum, "checksum");
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("checksum must be a SHA-256 hex digest");
  if (checksum !== rankingDatasetChecksum(dataset as RankingDataset)) {
    throw new Error("Ranking dataset checksum does not match");
  }
}

function validateTargets(
  targets: unknown[],
  startDay: number,
  endDay: number,
): asserts targets is RankingMetricTarget[] {
  const identities = new Set<string>();
  for (const [targetIndex, rawTarget] of targets.entries()) {
    if (!isRecord(rawTarget)) throw new Error(`targets[${targetIndex}] must be an object`);
    const kind = rawTarget.kind;
    if (kind !== "skill" && kind !== "package") {
      throw new Error(`targets[${targetIndex}].kind is invalid`);
    }
    const target =
      kind === "skill"
        ? recordWithKeys(rawTarget, SKILL_KEYS, `targets[${targetIndex}]`)
        : recordWithKeys(rawTarget, PACKAGE_KEYS, `targets[${targetIndex}]`);

    const identity = (() => {
      if (kind === "skill") {
        const skillTarget = recordWithKeys(rawTarget, SKILL_KEYS, `targets[${targetIndex}]`);
        const ownerHandle = stringValue(skillTarget.ownerHandle, "ownerHandle");
        if (!/^test-snapshot-(?:user|publisher)-[a-f0-9]{12}$/.test(ownerHandle)) {
          throw new Error("ownerHandle must be a deterministic Test snapshot identity");
        }
        return `skill:${ownerHandle}/${stringValue(skillTarget.slug, "slug")}`;
      }
      const packageTarget = recordWithKeys(rawTarget, PACKAGE_KEYS, `targets[${targetIndex}]`);
      const normalizedName = stringValue(packageTarget.normalizedName, "normalizedName");
      if (packageTarget.family !== "code-plugin" && packageTarget.family !== "bundle-plugin") {
        throw new Error(`package:${normalizedName}.family is invalid`);
      }
      const channel = stringValue(packageTarget.channel, `package:${normalizedName}.channel`);
      return packageTargetIdentity(normalizedName, packageTarget.family, channel);
    })();
    if (identities.has(identity)) throw new Error(`duplicate target identity: ${identity}`);
    identities.add(identity);

    nonNegativeInteger(target.createdAt, `${identity}.createdAt`);
    if (!Array.isArray(target.days)) throw new Error(`${identity}.days must be an array`);

    const days = new Set<number>();
    for (const [dayIndex, rawDay] of target.days.entries()) {
      const row = recordWithKeys(rawDay, DAY_KEYS, `${identity}.days[${dayIndex}]`);
      const day = integerValue(row.day, `${identity}.days[${dayIndex}].day`);
      if (day < startDay || day > endDay) {
        throw new Error(`${identity} day ${day} is outside the declared window`);
      }
      if (days.has(day)) throw new Error(`${identity} has duplicate day ${day}`);
      days.add(day);
      nonNegativeInteger(row.downloads, `${identity}.${day}.downloads`);
      nonNegativeInteger(row.installs, `${identity}.${day}.installs`);
      nonNegativeInteger(row.bookmarks, `${identity}.${day}.bookmarks`);
    }
  }
}

export function packageTargetIdentity(normalizedName: string, family: string, channel: string) {
  return `package:${JSON.stringify([normalizedName, family, channel])}`;
}

function countTargets(targets: RankingMetricTarget[]): RankingDataset["counts"] {
  const counts: RankingDataset["counts"] = {
    targets: targets.length,
    skillTargets: 0,
    packageTargets: 0,
    dailyRows: 0,
    downloads: 0,
    installs: 0,
    bookmarks: 0,
  };
  for (const target of targets) {
    if (target.kind === "skill") counts.skillTargets += 1;
    else counts.packageTargets += 1;
    for (const row of target.days) {
      counts.dailyRows += 1;
      counts.downloads += row.downloads;
      counts.installs += row.installs;
      counts.bookmarks += row.bookmarks;
    }
  }
  return counts;
}

function checksumValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
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

function recordWithKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  label: string,
): Record<Keys[number], unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set<string>(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains prohibited field ${key}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  }
  return value as Record<Keys[number], unknown>;
}

function assertVersion(value: string) {
  if (!/^ranking-metrics-\d{4}-\d{2}-\d{2}-v\d+$/.test(value)) {
    throw new Error("datasetVersion must be an explicit ranking-metrics YYYY-MM-DD version");
  }
}

function assertIsoTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) {
    throw new Error("generatedAt must be an ISO-8601 UTC timestamp");
  }
}

function assertDayRange(startDay: number, endDay: number) {
  if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || endDay - startDay !== 59) {
    throw new Error("Ranking datasets must declare an exact 60-day window");
  }
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integerValue(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = integerValue(value, label);
  if (number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
