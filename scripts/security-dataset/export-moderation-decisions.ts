import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  artifactInputsFromConvexExportTables,
  readConvexExportTablesFromZip,
  type ConvexDoc,
} from "./convexExport";
import { buildArtifactId, hashString, redactText } from "./normalize";

type ReviewVerdict = "clean" | "review" | "malicious" | "unknown";
type ReviewConfidence = "low" | "medium" | "high";
type CaseKind = "report" | "appeal";
type SourceKind = "skill" | "package";

type Options = {
  convexExportZip: string;
  outDir: string;
  dryRun: boolean;
};

type ModerationDecisionRow = {
  schema_version: "clawhub-moderation-decision-v1";
  decision_id: string;
  source_kind: SourceKind;
  case_kind: CaseKind;
  case_status: string;
  case_doc_id_hash: string;
  artifact_id: string | null;
  source_table: "skillVersions" | "packageReleases" | null;
  source_doc_id_hash: string | null;
  parent_doc_id_hash: string;
  public_name: string | null;
  public_slug: string | null;
  version: string | null;
  review_verdict: ReviewVerdict;
  review_confidence: ReviewConfidence | null;
  review_categories: string[];
  decision_note_redacted: string | null;
  action_taken: string | null;
  decided_at: number;
  decided_by_hash: string | null;
  created_at: number;
};

const REQUIRED_TABLES = [
  "skills",
  "skillVersions",
  "packages",
  "packageReleases",
  "skillReports",
  "skillAppeals",
  "packageReports",
  "packageAppeals",
] as const;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tables = (await readConvexExportTablesFromZip(options.convexExportZip, [
    ...REQUIRED_TABLES,
  ])) as Record<(typeof REQUIRED_TABLES)[number], ConvexDoc[]>;
  const rows = moderationDecisionRowsFromConvexExportTables(tables);

  const manifest = {
    schema_version: "clawhub-moderation-decision-export-manifest-v1",
    generated_at: Date.now(),
    convex_export_zip: options.convexExportZip,
    row_counts: {
      moderation_decisions: rows.length,
    },
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, manifest, preview: rows.slice(0, 5) }, null, 2));
    return;
  }

  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "moderation_decisions.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
  );
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, manifest }, null, 2));
}

export function moderationDecisionRowsFromConvexExportTables(
  tables: Record<(typeof REQUIRED_TABLES)[number], ConvexDoc[]>,
): ModerationDecisionRow[] {
  const skillsById = buildIdMap(tables.skills);
  const skillVersionsById = buildIdMap(tables.skillVersions);
  const packagesById = buildIdMap(tables.packages);
  const packageReleasesById = buildIdMap(tables.packageReleases);
  const artifactInputs = artifactInputsFromConvexExportTables({
    skills: tables.skills,
    skillVersions: tables.skillVersions,
    packages: tables.packages,
    packageReleases: tables.packageReleases,
  });
  const artifactsBySourceDocId = new Map(
    artifactInputs.map((input) => [input.sourceDocId, buildArtifactId(input)]),
  );

  const rows = [
    ...tables.skillReports.flatMap((doc) =>
      caseToDecisionRow({
        doc,
        sourceKind: "skill",
        caseKind: "report",
        caseTable: "skillReports",
        statusField: "status",
        noteField: "triageNote",
        decidedAtField: "triagedAt",
        decidedByField: "triagedBy",
        parentDocField: "skillId",
        sourceDocField: "skillVersionId",
        sourceTable: "skillVersions",
        parentsById: skillsById,
        artifactsById: skillVersionsById,
        artifactsBySourceDocId,
      }),
    ),
    ...tables.skillAppeals.flatMap((doc) =>
      caseToDecisionRow({
        doc,
        sourceKind: "skill",
        caseKind: "appeal",
        caseTable: "skillAppeals",
        statusField: "status",
        noteField: "resolutionNote",
        decidedAtField: "resolvedAt",
        decidedByField: "resolvedBy",
        parentDocField: "skillId",
        sourceDocField: "skillVersionId",
        sourceTable: "skillVersions",
        parentsById: skillsById,
        artifactsById: skillVersionsById,
        artifactsBySourceDocId,
      }),
    ),
    ...tables.packageReports.flatMap((doc) =>
      caseToDecisionRow({
        doc,
        sourceKind: "package",
        caseKind: "report",
        caseTable: "packageReports",
        statusField: "status",
        noteField: "triageNote",
        decidedAtField: "triagedAt",
        decidedByField: "triagedBy",
        parentDocField: "packageId",
        sourceDocField: "releaseId",
        sourceTable: "packageReleases",
        parentsById: packagesById,
        artifactsById: packageReleasesById,
        artifactsBySourceDocId,
      }),
    ),
    ...tables.packageAppeals.flatMap((doc) =>
      caseToDecisionRow({
        doc,
        sourceKind: "package",
        caseKind: "appeal",
        caseTable: "packageAppeals",
        statusField: "status",
        noteField: "resolutionNote",
        decidedAtField: "resolvedAt",
        decidedByField: "resolvedBy",
        parentDocField: "packageId",
        sourceDocField: "releaseId",
        sourceTable: "packageReleases",
        parentsById: packagesById,
        artifactsById: packageReleasesById,
        artifactsBySourceDocId,
      }),
    ),
  ];

  return rows.sort((left, right) => {
    const decidedDelta = left.decided_at - right.decided_at;
    if (decidedDelta !== 0) return decidedDelta;
    return left.decision_id.localeCompare(right.decision_id);
  });
}

function caseToDecisionRow(input: {
  doc: ConvexDoc;
  sourceKind: SourceKind;
  caseKind: CaseKind;
  caseTable: string;
  statusField: string;
  noteField: string;
  decidedAtField: string;
  decidedByField: string;
  parentDocField: string;
  sourceDocField: string;
  sourceTable: "skillVersions" | "packageReleases";
  parentsById: Map<string, ConvexDoc>;
  artifactsById: Map<string, ConvexDoc>;
  artifactsBySourceDocId: Map<string, string>;
}): ModerationDecisionRow[] {
  const verdict = reviewVerdictOrNull(input.doc.reviewVerdict);
  if (!verdict) return [];
  const caseId = requiredString(input.doc._id, `${input.caseTable}._id`);
  const parentDocId = requiredString(input.doc[input.parentDocField], input.parentDocField);
  const sourceDocId = stringOrNull(input.doc[input.sourceDocField]);
  const artifactId = sourceDocId ? (input.artifactsBySourceDocId.get(sourceDocId) ?? null) : null;
  if ((sourceDocId && !artifactId) || (input.sourceKind === "package" && !artifactId)) return [];
  const parentDoc = input.parentsById.get(parentDocId);
  const artifactDoc = sourceDocId ? input.artifactsById.get(sourceDocId) : null;
  const status = requiredString(input.doc[input.statusField], input.statusField);
  const decidedAt = numberOrNull(input.doc[input.decidedAtField]);
  if (!decidedAt || status === "open") return [];

  return [
    {
      schema_version: "clawhub-moderation-decision-v1",
      decision_id: `${input.caseTable}:${hashString(caseId).slice(0, 24)}`,
      source_kind: input.sourceKind,
      case_kind: input.caseKind,
      case_status: status,
      case_doc_id_hash: hashString(caseId),
      artifact_id: artifactId,
      source_table: sourceDocId ? input.sourceTable : null,
      source_doc_id_hash: sourceDocId ? hashString(sourceDocId) : null,
      parent_doc_id_hash: hashString(parentDocId),
      public_name: stringOrNull(parentDoc?.displayName),
      public_slug: stringOrNull(parentDoc?.slug) ?? stringOrNull(parentDoc?.name),
      version: stringOrNull(input.doc.version) ?? stringOrNull(artifactDoc?.version),
      review_verdict: verdict,
      review_confidence: reviewConfidenceOrNull(input.doc.reviewConfidence),
      review_categories: stringArray(input.doc.reviewCategories),
      decision_note_redacted: redactText(stringOrNull(input.doc[input.noteField])),
      action_taken: stringOrNull(input.doc.actionTaken),
      decided_at: decidedAt,
      decided_by_hash: stringOrNull(input.doc[input.decidedByField])
        ? hashString(requiredString(input.doc[input.decidedByField], input.decidedByField))
        : null,
      created_at: numberValue(input.doc.createdAt, "createdAt"),
    },
  ];
}

function parseArgs(args: string[]): Options {
  let convexExportZip: string | null = null;
  let outDir = ".data/security-dataset/moderation-decisions";
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--convex-export-zip") {
      convexExportZip = requireNextArg(args, (index += 1), arg);
    } else if (arg === "--out-dir") {
      outDir = requireNextArg(args, (index += 1), arg);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!convexExportZip) throw new Error("--convex-export-zip required");
  return { convexExportZip, outDir, dryRun };
}

function requireNextArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function buildIdMap(rows: ConvexDoc[]) {
  const map = new Map<string, ConvexDoc>();
  for (const row of rows) {
    const id = stringOrNull(row._id);
    if (id) map.set(id, row);
  }
  return map;
}

function reviewVerdictOrNull(value: unknown): ReviewVerdict | null {
  if (value === "clean" || value === "review" || value === "malicious" || value === "unknown") {
    return value;
  }
  return null;
}

function reviewConfidenceOrNull(value: unknown): ReviewConfidence | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const string = stringOrNull(item);
    return string ? [string] : [];
  });
}

function requiredString(value: unknown, field: string) {
  const string = stringOrNull(value);
  if (!string) throw new Error(`Missing ${field}`);
  return string;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing ${field}`);
  return value;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
