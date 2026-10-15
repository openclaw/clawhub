import { parse } from "convex-helpers/validators";
import { type Infer, v } from "convex/values";

export const SDK_USAGE_SCHEMA_VERSION = 1;
export const SDK_USAGE_ANALYSIS_VERSION = "1";
// Replacement is atomic. Reject an oversized inventory explicitly, never keep its first N APIs.
export const MAX_SDK_USAGE_ENTRIES = 2000;
export const MAX_SDK_USAGE_EVIDENCE = 3;
export const MAX_SDK_USAGE_BYTES = 4 * 1024 * 1024;
export const MAX_SDK_USAGE_ENTRY_BYTES = 64 * 1024;
export const MAX_SDK_USAGE_UNKNOWNS = 20;

export const sdkUsageEvidence = v.object({
  path: v.string(),
  line: v.number(),
  snippet: v.string(),
  note: v.optional(v.string()),
});

export const sdkUsageEntry = v.object({
  key: v.string(),
  kind: v.union(
    v.literal("sdk-module"),
    v.literal("sdk-export"),
    v.literal("api-member"),
    v.literal("runtime-member"),
    v.literal("hook"),
    v.literal("manifest-contract"),
  ),
  identity: v.string(),
  classification: v.union(
    v.literal("runtime"),
    v.literal("type"),
    v.literal("mixed"),
    v.literal("declarative"),
  ),
  referenceKinds: v.array(
    v.union(
      v.literal("import"),
      v.literal("type-import"),
      v.literal("reexport"),
      v.literal("type-reexport"),
      v.literal("side-effect-import"),
      v.literal("dynamic-import"),
      v.literal("require"),
      v.literal("member-access"),
      v.literal("call"),
      v.literal("type-reference"),
      v.literal("hook-registration"),
      v.literal("manifest-declaration"),
    ),
  ),
  evidence: v.array(sdkUsageEvidence),
  deprecationCodes: v.array(v.string()),
});

export const sdkUsageUnknown = v.object({
  path: v.string(),
  line: v.number(),
  expression: v.string(),
  reason: v.string(),
});

export const sdkUsageCoverage = v.object({
  filesDiscovered: v.number(),
  filesAnalyzed: v.number(),
  filesExcluded: v.number(),
});

export const sdkUsageReport = v.object({
  schemaVersion: v.number(),
  analysisVersion: v.string(),
  inputKind: v.union(v.literal("source"), v.literal("artifact")),
  status: v.union(v.literal("complete"), v.literal("partial"), v.literal("failed")),
  entries: v.array(sdkUsageEntry),
  unknowns: v.array(sdkUsageUnknown),
  coverage: sdkUsageCoverage,
});

export const sdkUsageScan = v.object({
  schemaVersion: v.number(),
  analysisVersion: v.string(),
  inputKind: v.optional(v.union(v.literal("source"), v.literal("artifact"))),
  status: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("failed"),
    v.literal("incompatible"),
  ),
  artifactSha256: v.string(),
  applied: v.boolean(),
  entryCount: v.number(),
  unknownCount: v.number(),
  unknowns: v.array(sdkUsageUnknown),
  coverage: sdkUsageCoverage,
  reason: v.optional(v.string()),
});

export type SdkUsageReport = Infer<typeof sdkUsageReport>;
export type SdkUsageScan = Infer<typeof sdkUsageScan>;

export function failedSdkUsageReport(reason: string): SdkUsageReport {
  return {
    schemaVersion: SDK_USAGE_SCHEMA_VERSION,
    analysisVersion: SDK_USAGE_ANALYSIS_VERSION,
    inputKind: "artifact",
    status: "failed",
    entries: [],
    unknowns: [{ path: ".", line: 1, expression: "sdkUsage", reason: reason.slice(0, 1000) }],
    coverage: { filesDiscovered: 0, filesAnalyzed: 0, filesExcluded: 0 },
  };
}

/** An inventory failure must not change the author's existing compatibility result. */
export function normalizeSdkUsageReport(value: unknown): SdkUsageReport | undefined {
  if (value === undefined) return undefined;
  try {
    const report = parse(sdkUsageReport, value);
    const validLocation = (site: { path: string; line: number }) =>
      Boolean(site.path.trim()) && Number.isSafeInteger(site.line) && site.line >= 1;
    const { filesDiscovered, filesAnalyzed, filesExcluded } = report.coverage;
    if (
      Object.values(report.coverage).some((count) => !Number.isSafeInteger(count) || count < 0) ||
      filesAnalyzed + filesExcluded > filesDiscovered ||
      report.unknowns.some((site) => !validLocation(site)) ||
      report.entries.some(
        (entry) =>
          entry.key !== `${entry.kind}:${entry.identity}` ||
          !entry.identity.trim() ||
          entry.key.length > 1024 ||
          entry.evidence.some((site) => !validLocation(site)),
      )
    )
      return failedSdkUsageReport(
        "Inspector returned invalid SDK inventory identities, evidence, or coverage",
      );
    if (
      report.status === "complete" &&
      (report.unknowns.length > 0 || filesAnalyzed + filesExcluded < filesDiscovered)
    ) {
      return { ...report, status: "partial" };
    }
    return report;
  } catch {
    return failedSdkUsageReport("Inspector returned an invalid SDK inventory");
  }
}
