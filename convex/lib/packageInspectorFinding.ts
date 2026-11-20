import { type Infer, v } from "convex/values";

export const packageInspectorIssueInputValidator = v.object({
  id: v.optional(v.string()),
  code: v.string(),
  severity: v.optional(v.string()),
  level: v.optional(v.string()),
  issueClass: v.optional(v.string()),
  compatStatus: v.optional(v.string()),
  deprecated: v.optional(v.boolean()),
  deprecatedApi: v.optional(v.string()),
  replacement: v.optional(v.string()),
  removeAfter: v.optional(v.string()),
  message: v.string(),
  evidence: v.optional(v.array(v.string())),
  authorRemediation: v.optional(
    v.object({
      summary: v.string(),
      docsUrl: v.optional(v.string()),
    }),
  ),
  fixture: v.optional(v.string()),
  decision: v.optional(v.string()),
});

export type PackageInspectorFinding = Infer<typeof packageInspectorIssueInputValidator>;
export type PackageInspectorAuthorRemediation = NonNullable<
  PackageInspectorFinding["authorRemediation"]
>;

// Plugin Inspector checks every upload as a native code plugin. These two
// checks ask for npm package metadata, which a configuration-only bundle
// (Codex, Claude or Cursor marker plus MCP config and skills) does not ship.
const NATIVE_ONLY_PACKAGE_FINDING_CODES = new Set([
  "package-json-missing",
  "package-openclaw-entry-missing",
]);

/**
 * Drops findings that only apply to native code plugins when the package is a
 * bundle plugin. Code plugins and every other finding code pass through.
 */
export function filterPackageInspectorFindingsForFamily<T extends { code: string }>(
  family: string,
  findings: T[],
): T[] {
  if (family !== "bundle-plugin") return findings;
  return findings.filter((finding) => !NATIVE_ONLY_PACKAGE_FINDING_CODES.has(finding.code));
}
