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
  fixture?: string;
  decision?: string;
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
      const { report } = await pluginRoot.runCheck({
        pluginRoot: root,
        openclawPath: false,
        outDir: "reports",
        capture: false,
        mockSdk: true,
        allowExecution: false,
        generatedAt: new Date().toISOString(),
      });

      return normalizeInspectorReport(report);
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

function normalizeInspectorReport(report: unknown) {
  const parsed = isRecord(report) ? (report as InspectorReport) : {};
  const breakages = normalizeFindings(parsed.breakages, "breakage");
  const warnings = normalizeWarnings(parsed);
  return {
    status:
      breakages.length > 0 || parsed.status === "fail" ? ("fail" as const) : ("pass" as const),
    summary: {
      breakageCount: numberValue(parsed.summary?.breakageCount, breakages.length),
      warningCount: numberValue(parsed.summary?.warningCount, warnings.length),
      deprecationWarningCount: numberValue(
        parsed.summary?.deprecationWarningCount,
        warnings.filter((finding) => finding.issueClass === "deprecation-warning").length,
      ),
      issueCount: numberValue(parsed.summary?.issueCount, warnings.length + breakages.length),
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
    (finding) => finding.level !== "breakage",
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
    fixture: stringValue(value.fixture),
    decision: stringValue(value.decision),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
