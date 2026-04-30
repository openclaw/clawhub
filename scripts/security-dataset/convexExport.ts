import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type {
  ArtifactExportInput,
  DatasetLabel,
  ExportFileInput,
  LlmAnalysisInput,
  ModerationConsensusInput,
  StaticScanInput,
  VtAnalysisInput,
} from "./normalize";

type ConvexDoc = Record<string, unknown> & { _id?: unknown };

type ConvexExportTables = {
  skills: ConvexDoc[];
  skillVersions: ConvexDoc[];
  packages: ConvexDoc[];
  packageReleases: ConvexDoc[];
};

const REQUIRED_TABLES = ["skills", "skillVersions", "packages", "packageReleases"] as const;

export async function artifactInputsFromConvexExportZip(
  zipPath: string,
): Promise<ArtifactExportInput[]> {
  const zipBytes = new Uint8Array(await readFile(zipPath));
  const entries = unzipSync(zipBytes);
  const tables = Object.fromEntries(
    REQUIRED_TABLES.map((table) => [table, readExportTable(entries, table)]),
  ) as ConvexExportTables;
  return artifactInputsFromConvexExportTables(tables);
}

export function artifactInputsFromConvexExportTables(
  tables: ConvexExportTables,
): ArtifactExportInput[] {
  const skillsById = buildIdMap(tables.skills);
  const packagesById = buildIdMap(tables.packages);
  const rows = [
    ...tables.skillVersions.flatMap((version) => skillVersionToExportRow(version, skillsById)),
    ...tables.packageReleases.flatMap((release) =>
      packageReleaseToExportRow(release, packagesById),
    ),
  ];
  return rows.sort((left, right) => {
    const createdDelta = left.createdAt - right.createdAt;
    if (createdDelta !== 0) return createdDelta;
    return `${left.sourceKind}:${left.sourceDocId}`.localeCompare(
      `${right.sourceKind}:${right.sourceDocId}`,
    );
  });
}

function readExportTable(
  entries: Record<string, Uint8Array>,
  table: (typeof REQUIRED_TABLES)[number],
): ConvexDoc[] {
  const entryName = findExportTableEntry(Object.keys(entries), table);
  const bytes = entries[entryName];
  if (!bytes) throw new Error(`Convex export table entry disappeared: ${entryName}`);
  const text = strFromU8(bytes);
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ConvexDoc);
}

function findExportTableEntry(entryNames: string[], table: string) {
  const normalized = entryNames.map((name) => ({ name, parts: name.split("/") }));
  const exactJsonl = normalized.find(({ name }) => name === `${table}.jsonl`);
  if (exactJsonl) return exactJsonl.name;
  const basenameJsonl = normalized.find(({ parts }) => parts.at(-1) === `${table}.jsonl`);
  if (basenameJsonl) return basenameJsonl.name;
  const documentsJsonl = normalized.find(
    ({ parts }) => parts.at(-2) === table && parts.at(-1) === "documents.jsonl",
  );
  if (documentsJsonl) return documentsJsonl.name;
  const tableJsonl = normalized.find(
    ({ parts }) => parts.includes(table) && parts.at(-1)?.endsWith(".jsonl"),
  );
  if (tableJsonl) return tableJsonl.name;
  throw new Error(
    `Missing ${table} JSONL table in Convex export. Entries: ${entryNamePreview(entryNames)}`,
  );
}

function entryNamePreview(entryNames: string[]) {
  const preview = entryNames.slice(0, 20).join(", ");
  const remaining = entryNames.length - 20;
  return remaining > 0 ? `${preview}, ... ${remaining} more` : preview;
}

function buildIdMap(rows: ConvexDoc[]) {
  const map = new Map<string, ConvexDoc>();
  for (const row of rows) {
    const id = stringValue(row._id);
    if (id) map.set(id, row);
  }
  return map;
}

function skillVersionToExportRow(
  version: ConvexDoc,
  skillsById: Map<string, ConvexDoc>,
): ArtifactExportInput[] {
  if (numberOrNull(version.softDeletedAt) !== null) return [];
  const skill = skillsById.get(stringValue(version.skillId));
  if (!skill || numberOrNull(skill.softDeletedAt) !== null) return [];
  const versionId = requiredString(version._id, "skillVersions._id");
  const moderationConsensus =
    stringValue(skill.moderationSourceVersionId) === versionId
      ? moderationConsensusFromSkill(skill)
      : null;
  return [
    {
      sourceKind: "skill",
      sourceDocId: versionId,
      parentDocId: requiredString(skill._id, "skills._id"),
      publicName: requiredString(skill.displayName, "skills.displayName"),
      publicSlug: stringOrNull(skill.slug),
      version: requiredString(version.version, "skillVersions.version"),
      artifactSha256: stringOrNull(version.sha256hash),
      createdAt: numberValue(version.createdAt, "skillVersions.createdAt"),
      softDeletedAt: numberOrNull(version.softDeletedAt),
      files: filesFromExport(version.files),
      capabilityTags: stringArray(version.capabilityTags ?? skill.capabilityTags),
      packageFamily: null,
      packageChannel: null,
      packageExecutesCode: null,
      sourceRepoHost: null,
      vtAnalysis: vtAnalysisFromExport(version.vtAnalysis),
      staticScan: staticScanFromExport(version.staticScan),
      llmAnalysis: llmAnalysisFromExport(version.llmAnalysis),
      moderationConsensus,
    },
  ];
}

function packageReleaseToExportRow(
  release: ConvexDoc,
  packagesById: Map<string, ConvexDoc>,
): ArtifactExportInput[] {
  if (numberOrNull(release.softDeletedAt) !== null) return [];
  const pkg = packagesById.get(stringValue(release.packageId));
  if (!pkg || numberOrNull(pkg.softDeletedAt) !== null || pkg.channel === "private") return [];
  return [
    {
      sourceKind: "package",
      sourceDocId: requiredString(release._id, "packageReleases._id"),
      parentDocId: requiredString(pkg._id, "packages._id"),
      publicName: requiredString(pkg.displayName, "packages.displayName"),
      publicSlug: stringOrNull(pkg.name),
      version: requiredString(release.version, "packageReleases.version"),
      artifactSha256: stringOrNull(release.sha256hash) ?? stringOrNull(release.integritySha256),
      createdAt: numberValue(release.createdAt, "packageReleases.createdAt"),
      softDeletedAt: numberOrNull(release.softDeletedAt),
      files: filesFromExport(release.files),
      capabilityTags: stringArray(pkg.capabilityTags),
      packageFamily: stringOrNull(pkg.family),
      packageChannel: stringOrNull(pkg.channel),
      packageExecutesCode: booleanOrNull(pkg.executesCode),
      sourceRepoHost: sourceRepoHost(stringOrNull(pkg.sourceRepo)),
      vtAnalysis: vtAnalysisFromExport(release.vtAnalysis),
      staticScan: staticScanFromExport(release.staticScan),
      llmAnalysis: llmAnalysisFromExport(release.llmAnalysis),
      moderationConsensus: null,
    },
  ];
}

function filesFromExport(value: unknown): ExportFileInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((file) => {
    if (!isRecord(file)) return [];
    const path = stringValue(file.path);
    const sha256 = stringValue(file.sha256);
    const size = typeof file.size === "number" ? file.size : null;
    if (!path || !sha256 || size === null) return [];
    return [{ path, size, sha256, contentType: stringOrNull(file.contentType) }];
  });
}

function vtAnalysisFromExport(value: unknown): VtAnalysisInput | null {
  if (!isRecord(value)) return null;
  return {
    status: requiredString(value.status, "vtAnalysis.status"),
    verdict: stringOrNull(value.verdict),
    analysis: stringOrNull(value.analysis),
    source: stringOrNull(value.source),
    scanner: stringOrNull(value.scanner),
    engineStats: engineStatsFromExport(value.engineStats),
    checkedAt: numberValue(value.checkedAt, "vtAnalysis.checkedAt"),
  };
}

function staticScanFromExport(value: unknown): StaticScanInput | null {
  if (!isRecord(value)) return null;
  const status = datasetLabelOrNull(value.status);
  if (!status || status === "unknown") return null;
  return {
    status,
    reasonCodes: stringArray(value.reasonCodes),
    findings: staticFindingsFromExport(value.findings),
    summary: requiredString(value.summary, "staticScan.summary"),
    engineVersion: requiredString(value.engineVersion, "staticScan.engineVersion"),
    checkedAt: numberValue(value.checkedAt, "staticScan.checkedAt"),
  };
}

function staticFindingsFromExport(value: unknown): StaticScanInput["findings"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((finding) => {
    if (!isRecord(finding)) return [];
    const severity = finding.severity;
    if (severity !== "info" && severity !== "warn" && severity !== "critical") return [];
    return [
      {
        code: requiredString(finding.code, "staticScan.finding.code"),
        severity,
        file: requiredString(finding.file, "staticScan.finding.file"),
        line: numberValue(finding.line, "staticScan.finding.line"),
        message: requiredString(finding.message, "staticScan.finding.message"),
        evidence: requiredString(finding.evidence, "staticScan.finding.evidence"),
      },
    ];
  });
}

function llmAnalysisFromExport(value: unknown): LlmAnalysisInput | null {
  if (!isRecord(value)) return null;
  return {
    status: requiredString(value.status, "llmAnalysis.status"),
    verdict: stringOrNull(value.verdict),
    confidence: stringOrNull(value.confidence),
    summary: stringOrNull(value.summary),
    dimensions: llmDimensionsFromExport(value.dimensions),
    guidance: stringOrNull(value.guidance),
    findings: stringOrNull(value.findings),
    model: stringOrNull(value.model),
    checkedAt: numberValue(value.checkedAt, "llmAnalysis.checkedAt"),
  };
}

function llmDimensionsFromExport(value: unknown): LlmAnalysisInput["dimensions"] {
  if (!Array.isArray(value)) return null;
  return value.flatMap((dimension) => {
    if (!isRecord(dimension)) return [];
    return [
      {
        name: requiredString(dimension.name, "llmAnalysis.dimension.name"),
        label: requiredString(dimension.label, "llmAnalysis.dimension.label"),
        rating: requiredString(dimension.rating, "llmAnalysis.dimension.rating"),
        detail: requiredString(dimension.detail, "llmAnalysis.dimension.detail"),
      },
    ];
  });
}

function moderationConsensusFromSkill(skill: ConvexDoc): ModerationConsensusInput | null {
  const verdict = datasetLabelOrNull(skill.moderationVerdict);
  return {
    verdict,
    reasonCodes: stringArray(skill.moderationReasonCodes),
    summary: stringOrNull(skill.moderationSummary),
    engineVersion: stringOrNull(skill.moderationEngineVersion),
    evaluatedAt: numberOrNull(skill.moderationEvaluatedAt),
  };
}

function engineStatsFromExport(value: unknown): VtAnalysisInput["engineStats"] {
  if (!isRecord(value)) return null;
  return {
    malicious: optionalNumber(value.malicious),
    suspicious: optionalNumber(value.suspicious),
    undetected: optionalNumber(value.undetected),
    harmless: optionalNumber(value.harmless),
  };
}

function sourceRepoHost(sourceRepo: string | null) {
  if (!sourceRepo) return null;
  try {
    return new URL(sourceRepo).host.toLowerCase();
  } catch {
    const match = sourceRepo.match(/^[^/:]+[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/);
    return match?.groups?.owner && match.groups.repo ? "github.com" : null;
  }
}

function datasetLabelOrNull(value: unknown): DatasetLabel | null {
  if (value === "clean" || value === "suspicious" || value === "malicious" || value === "unknown")
    return value;
  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requiredString(value: unknown, field: string) {
  const result = stringValue(value);
  if (!result) throw new Error(`Missing string field in Convex export: ${field}`);
  return result;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, field: string) {
  if (typeof value === "number") return value;
  throw new Error(`Missing number field in Convex export: ${field}`);
}

function optionalNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
