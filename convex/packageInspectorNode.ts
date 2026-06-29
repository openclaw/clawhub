"use node";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

type InspectorFinding = {
  id?: string;
  code: string;
  severity?: string;
  level?: string;
  issueClass?: string;
  compatStatus?: string;
  deprecated?: boolean;
  message: string;
  evidence?: string[];
  authorRemediation?: InspectorAuthorRemediation;
  fixture?: string;
  decision?: string;
};

type InspectorAuthorRemediation = {
  summary: string;
  docsUrl?: string;
};

type InspectorReport = {
  status?: string;
  targetOpenClaw?: unknown;
  summary?: {
    breakageCount?: number;
    warningCount?: number;
    deprecationWarningCount?: number;
    issueCount?: number;
  };
  breakages?: unknown[];
  warnings?: unknown[];
  suggestions?: unknown[];
  issues?: unknown[];
};

const AUTHOR_REMEDIATION_DOCS_BASE = "https://docs.openclaw.ai/clawhub/plugin-validation-fixes";

const LEGACY_AUTHOR_REMEDIATION_SUMMARIES = {
  "channel-env-vars":
    "Move legacy channel environment variable metadata into the current setup/config metadata.",
  "legacy-before-agent-start":
    "Replace the legacy before_agent_start hook with the current prompt/model hooks.",
  "legacy-root-sdk-import":
    "Prefer focused public plugin SDK subpath imports instead of the legacy root barrel.",
  "manifest-name-missing": "Add a display name to the plugin manifest.",
  "manifest-unknown-contracts":
    "Remove unsupported manifest contract keys or move them to a documented OpenClaw contract field.",
  "manifest-unknown-fields":
    "Move unsupported top-level manifest fields into supported package metadata or remove them.",
  "package-entrypoint-missing":
    "Publish the entrypoint declared in OpenClaw package metadata or update the metadata to point at an existing file.",
  "package-install-metadata-incomplete":
    "Complete the OpenClaw install metadata so ClawHub can identify the install target.",
  "package-json-missing": "Add a package.json to the plugin package.",
  "package-manifest-version-drift":
    "Align the plugin version declared in package.json and openclaw.plugin.json.",
  "package-min-host-version-drift":
    "Set the package minimum host version to the OpenClaw version range the plugin was built and tested against.",
  "package-npm-pack-entrypoint-missing":
    "Include the declared OpenClaw entrypoints in the npm-packed artifact.",
  "package-npm-pack-metadata-missing":
    "Include OpenClaw metadata files in the npm-packed artifact.",
  "package-npm-pack-unavailable": "Make the package packable before publishing it through ClawHub.",
  "package-openclaw-entry-missing":
    "Declare the plugin runtime entrypoint in package.json OpenClaw metadata.",
  "package-openclaw-metadata-missing": "Add the package.json openclaw metadata block.",
  "package-openclaw-unsupported-metadata": "Remove unsupported OpenClaw package metadata fields.",
  "package-plugin-api-compat-missing":
    "Declare the OpenClaw plugin API range this package supports.",
  "provider-auth-env-vars":
    "Move legacy provider authentication environment variables into current provider setup metadata.",
  "reserved-sdk-import": "Stop importing reserved bundled-plugin SDK compatibility paths.",
  "security-manifest-schema-unavailable":
    "Remove or update the unsupported security manifest schema reference.",
  "sdk-load-session-store":
    "Replace deprecated loadSessionStore whole-store access with row-scoped session helpers.",
  "sdk-session-file-helper":
    "Replace deprecated session file-path helpers with session entry and transcript identity APIs.",
  "sdk-session-store-write":
    "Replace deprecated whole-store session writes with row-scoped session helpers.",
  "sdk-session-transcript-file-target":
    "Replace legacy transcript file targets with public transcript identity or target helpers.",
  "sdk-session-transcript-low-level":
    "Replace low-level transcript writes with the structured transcript runtime helpers.",
  "unrecognized-security-manifest":
    "Remove unsupported security manifest files until OpenClaw documents a versioned security manifest schema.",
} satisfies Record<string, string>;

const publishFileValidator = v.object({
  path: v.string(),
  size: v.number(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  contentType: v.optional(v.string()),
});

const findingValidator = v.object({
  id: v.optional(v.string()),
  code: v.string(),
  severity: v.optional(v.string()),
  level: v.optional(v.string()),
  issueClass: v.optional(v.string()),
  compatStatus: v.optional(v.string()),
  deprecated: v.optional(v.boolean()),
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

const inspectorMetadataValidator = v.object({
  inspectorVersion: v.optional(v.string()),
  targetOpenClawVersion: v.optional(v.string()),
});

export const runPackageInspectorForPublishInternal = internalAction({
  args: {
    packageName: v.string(),
    version: v.string(),
    files: v.array(publishFileValidator),
  },
  returns: v.object({
    status: v.union(v.literal("pass"), v.literal("fail")),
    summary: v.object({
      breakageCount: v.number(),
      warningCount: v.number(),
      deprecationWarningCount: v.number(),
      issueCount: v.number(),
    }),
    breakages: v.array(findingValidator),
    warnings: v.array(findingValidator),
    metadata: inspectorMetadataValidator,
  }),
  handler: async (ctx, args) => {
    const root = path.join(
      tmpdir(),
      `clawhub-plugin-inspector-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    try {
      await mkdir(root, { recursive: true });
      for (const file of args.files) {
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) {
          throw new Error(`missing package file ${file.path}`);
        }
        const target = safeFilePath(root, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(await blob.arrayBuffer()));
      }
      await writeSyntheticInspectorConfigIfNeeded(root, args.files, args.packageName);

      const { pluginRoot } = await import("@openclaw/plugin-inspector");
      const runCheckOptions = {
        pluginRoot: root,
        openclawPath: false,
        outDir: "reports",
        capture: false,
        mockSdk: true,
        allowExecution: false,
        authorFacing: true,
        generatedAt: new Date().toISOString(),
      } as Parameters<typeof pluginRoot.runCheck>[0] & {
        authorFacing: true;
        generatedAt: string;
      };
      const { report } = await pluginRoot.runCheck(runCheckOptions);

      return normalizeInspectorReportForPublish(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "fail" as const,
        summary: {
          breakageCount: 1,
          warningCount: 0,
          deprecationWarningCount: 0,
          issueCount: 1,
        },
        breakages: [
          {
            code: "plugin-inspector-error",
            severity: "P0",
            level: "breakage",
            message: `Plugin Inspector could not inspect ${args.packageName}@${args.version}: ${message}`,
          },
        ],
        warnings: [],
        metadata: {
          inspectorVersion: getBundledInspectorVersion(),
        },
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
});

async function writeSyntheticInspectorConfigIfNeeded(
  root: string,
  files: Array<{ path: string }>,
  packageName: string,
) {
  const lowerRootPaths = new Set(files.map((file) => file.path.toLowerCase()));
  if (
    lowerRootPaths.has("plugin-inspector.config.json") ||
    lowerRootPaths.has(".plugin-inspector.json")
  ) {
    return;
  }

  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      pluginInspector?: unknown;
      "plugin-inspector"?: unknown;
    };
    if (
      packageJson.pluginInspector &&
      typeof packageJson.pluginInspector === "object" &&
      !Array.isArray(packageJson.pluginInspector)
    ) {
      return;
    }
    if (
      packageJson["plugin-inspector"] &&
      typeof packageJson["plugin-inspector"] === "object" &&
      !Array.isArray(packageJson["plugin-inspector"])
    ) {
      return;
    }
  } catch {
    // Existing publish validation and the inspector report own malformed package metadata.
  }

  await writeFile(
    path.join(root, ".plugin-inspector.json"),
    `${JSON.stringify(
      {
        version: 1,
        plugin: {
          id: toInspectorFixtureId(packageName),
        },
      },
      null,
      2,
    )}\n`,
  );
}

function toInspectorFixtureId(packageName: string) {
  const base = packageName.split("/").pop() ?? packageName;
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "published-plugin";
}

function safeFilePath(root: string, filePath: string) {
  const normalized = path.normalize(filePath).replace(/^(\.\.(?:\/|\\|$))+/, "");
  const target = path.resolve(root, normalized);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error(`unsafe package file path ${filePath}`);
  }
  return target;
}

export function normalizeInspectorReportForPublish(report: unknown) {
  const parsed = isRecord(report) ? (report as InspectorReport) : {};
  const issues = normalizeFindings(parsed.issues, "warning").filter(hasAuthorRemediation);
  const issueBreakages = issues.filter((finding) => isBreakageFinding(finding));
  const issueWarnings = issues.filter((finding) => !isBreakageFinding(finding));
  const breakages =
    issues.length > 0
      ? issueBreakages
      : normalizeFindings(parsed.breakages, "breakage").filter(hasAuthorRemediation);
  const warnings =
    issues.length > 0 ? issueWarnings : normalizeWarnings(parsed).filter(hasAuthorRemediation);
  return {
    status: breakages.length > 0 ? ("fail" as const) : ("pass" as const),
    summary: {
      breakageCount: breakages.length,
      warningCount: warnings.length,
      deprecationWarningCount: warnings.filter(
        (finding) => finding.issueClass === "deprecation-warning",
      ).length,
      issueCount: warnings.length + breakages.length,
    },
    breakages,
    warnings,
    metadata: {
      inspectorVersion: getBundledInspectorVersion(),
      targetOpenClawVersion: extractTargetOpenClawVersion(parsed.targetOpenClaw),
    },
  };
}

function normalizeWarnings(report: InspectorReport) {
  const issueWarnings = normalizeFindings(report.issues, "warning").filter(
    (finding) => !isBreakageFinding(finding),
  );
  if (issueWarnings.length > 0) return issueWarnings;
  return [
    ...normalizeFindings(report.warnings, "warning"),
    ...normalizeFindings(report.suggestions, "suggestion"),
  ];
}

function normalizeFindings(value: unknown, defaultLevel: string): InspectorFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeFinding(item, defaultLevel))
    .filter((finding): finding is InspectorFinding => Boolean(finding));
}

function normalizeFinding(value: unknown, defaultLevel: string): InspectorFinding | null {
  if (!isRecord(value)) return null;
  const message = stringValue(value.message) ?? stringValue(value.title);
  const code = stringValue(value.code) ?? "plugin-inspector-finding";
  if (!message) return null;
  return {
    id: stringValue(value.id),
    code,
    severity: stringValue(value.severity),
    level: stringValue(value.level) ?? defaultLevel,
    issueClass: stringValue(value.issueClass),
    compatStatus: stringValue(value.compatStatus),
    deprecated: typeof value.deprecated === "boolean" ? value.deprecated : undefined,
    message,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((entry) => String(entry)).slice(0, 12)
      : undefined,
    authorRemediation:
      normalizeAuthorRemediation(value.authorRemediation) ?? legacyAuthorRemediation(code),
    fixture: stringValue(value.fixture),
    decision: stringValue(value.decision),
  };
}

function normalizeAuthorRemediation(value: unknown): InspectorAuthorRemediation | undefined {
  if (!isRecord(value)) return undefined;
  const summary = stringValue(value.summary);
  if (!summary) return undefined;
  return {
    summary,
    docsUrl: stringValue(value.docsUrl),
  };
}

function hasAuthorRemediation(finding: InspectorFinding) {
  return Boolean(finding.authorRemediation?.summary);
}

function legacyAuthorRemediation(code: string): InspectorAuthorRemediation | undefined {
  const summary =
    LEGACY_AUTHOR_REMEDIATION_SUMMARIES[code as keyof typeof LEGACY_AUTHOR_REMEDIATION_SUMMARIES];
  if (!summary) return undefined;
  return {
    summary,
    docsUrl: `${AUTHOR_REMEDIATION_DOCS_BASE}#${code}`,
  };
}

function isBreakageFinding(finding: InspectorFinding) {
  return finding.level === "breakage" || finding.level === "error" || finding.severity === "P0";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBundledInspectorVersion() {
  return stringValue(process.env.CLAWHUB_PLUGIN_INSPECTOR_VERSION);
}

function extractTargetOpenClawVersion(targetOpenClaw: unknown) {
  if (!isRecord(targetOpenClaw)) return undefined;
  return (
    stringValue(targetOpenClaw.version) ??
    stringValue(targetOpenClaw.openclawVersion) ??
    stringValue(targetOpenClaw.label) ??
    stringValue(targetOpenClaw.status)
  );
}
