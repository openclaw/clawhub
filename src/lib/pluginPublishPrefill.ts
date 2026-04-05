import type { PackageCompatibility } from "clawhub-schema";
import {
  normalizeOpenClawExternalPluginCompatibility,
  validateOpenClawExternalCodePluginPackageJson,
} from "clawhub-schema";

type JsonRecord = Record<string, unknown>;

export type PluginPublishPrefill = {
  family?: "code-plugin" | "bundle-plugin";
  name?: string;
  displayName?: string;
  version?: string;
  sourceRepo?: string;
  bundleFormat?: string;
  hostTargets?: string;
  compatibility?: PackageCompatibility;
  missingRequiredFields?: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(getString).filter(Boolean) as string[];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

async function readJsonUploadFile(
  files: Array<{ file: File; path: string }>,
  expectedPath: string,
): Promise<JsonRecord | null> {
  const normalizedExpectedPath = expectedPath.toLowerCase();
  const expectedFileName = normalizedExpectedPath.split("/").at(-1);
  const entry =
    files.find((file) => file.path.toLowerCase() === normalizedExpectedPath) ??
    files.find((file) => file.path.toLowerCase().endsWith(`/${normalizedExpectedPath}`)) ??
    files.find((file) => {
      const normalizedPath = file.path.toLowerCase();
      return expectedFileName ? normalizedPath.split("/").at(-1) === expectedFileName : false;
    });
  if (!entry) return null;
  try {
    const parsed = JSON.parse((await entry.file.text()).replace(/^\uFEFF/, "")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "https://github.com/");
  if (!trimmed) return undefined;

  const shorthand = trimmed.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`;

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (!owner || !repo) return undefined;
    return `${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

function extractSourceRepo(packageJson: JsonRecord | null) {
  if (!packageJson) return undefined;
  const repository = packageJson.repository;
  if (typeof repository === "string") return normalizeGitHubRepo(repository);
  if (isRecord(repository) && typeof repository.url === "string") {
    return normalizeGitHubRepo(repository.url);
  }
  if (typeof packageJson.homepage === "string") return normalizeGitHubRepo(packageJson.homepage);
  if (isRecord(packageJson.bugs) && typeof packageJson.bugs.url === "string") {
    return normalizeGitHubRepo(packageJson.bugs.url);
  }
  return undefined;
}

export async function derivePluginPrefill(
  files: Array<{ file: File; path: string }>,
): Promise<PluginPublishPrefill> {
  const packageJson = await readJsonUploadFile(files, "package.json");
  const pluginManifest = await readJsonUploadFile(files, "openclaw.plugin.json");
  const bundleManifest = await readJsonUploadFile(files, "openclaw.bundle.json");
  const openclaw = isRecord(packageJson?.openclaw) ? packageJson.openclaw : undefined;
  const hostTargets = bundleManifest
    ? [
        ...new Set([
          ...getStringList(bundleManifest.hostTargets),
          ...getStringList(openclaw?.hostTargets),
        ]),
      ]
    : [];

  return {
    family: pluginManifest ? "code-plugin" : bundleManifest ? "bundle-plugin" : undefined,
    name:
      getString(packageJson?.name) ??
      getString(pluginManifest?.id) ??
      getString(bundleManifest?.id),
    displayName:
      getString(packageJson?.displayName) ??
      getString(pluginManifest?.name) ??
      getString(bundleManifest?.name),
    version: getString(packageJson?.version),
    sourceRepo: extractSourceRepo(packageJson),
    bundleFormat: getString(bundleManifest?.format) ?? getString(openclaw?.bundleFormat),
    hostTargets: hostTargets.length > 0 ? hostTargets.join(", ") : undefined,
    compatibility: pluginManifest
      ? normalizeOpenClawExternalPluginCompatibility(packageJson)
      : undefined,
    missingRequiredFields: pluginManifest
      ? validateOpenClawExternalCodePluginPackageJson(packageJson).issues.map(
          (issue) => issue.fieldPath,
        )
      : undefined,
  };
}

export function listPrefilledFields(prefill: PluginPublishPrefill) {
  const fields: string[] = [];
  if (prefill.family) fields.push("package type");
  if (prefill.name) fields.push("plugin name");
  if (prefill.displayName) fields.push("display name");
  if (prefill.version) fields.push("version");
  if (prefill.sourceRepo) fields.push("source repo");
  if (prefill.compatibility) fields.push("compatibility");
  if (prefill.bundleFormat) fields.push("bundle format");
  if (prefill.hostTargets) fields.push("host targets");
  return fields;
}

export function formatPackageCompatibility(compatibility: PackageCompatibility) {
  return [
    compatibility.pluginApiRange ? `pluginApi=${compatibility.pluginApiRange}` : null,
    compatibility.builtWithOpenClawVersion
      ? `builtWith=${compatibility.builtWithOpenClawVersion}`
      : null,
    compatibility.pluginSdkVersion ? `sdk=${compatibility.pluginSdkVersion}` : null,
    compatibility.minGatewayVersion ? `minGateway=${compatibility.minGatewayVersion}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
