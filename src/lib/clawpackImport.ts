import { normalizePackageUploadFiles } from "./packageUpload";

type JsonRecord = Record<string, unknown>;

export type ClawPackImportSummary = {
  packageName?: string;
  displayName?: string;
  version?: string;
  family?: "code-plugin" | "bundle-plugin";
  sourceRepo?: string;
  sourceCommit?: string;
  sourceRef?: string;
  sourcePath?: string;
  hostTargets: string[];
  packageFileCount: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getClawPackTarget(value: unknown) {
  if (!isRecord(value)) return null;
  const os = getString(value.os);
  const arch = getString(value.arch);
  const libc = getString(value.libc);
  if (!os || !arch) return null;
  return [os, arch, libc].filter(Boolean).join("-");
}

function createPathFile(source: File, path: string) {
  return new File([source], path, {
    type: source.type,
    lastModified: source.lastModified,
  });
}

function hasGenericPackageRoot(files: Array<{ path: string }>) {
  return files.some((entry) => {
    const path = entry.path.toLowerCase();
    return (
      path === "package.json" || path === "openclaw.plugin.json" || path === "openclaw.bundle.json"
    );
  });
}

export async function normalizeClawPackImport(files: File[]) {
  const normalized = normalizePackageUploadFiles(files);
  const manifestEntry = normalized.find((entry) => {
    const fileName = entry.path.toLowerCase().split("/").at(-1);
    return fileName === "clawpack.json";
  });
  if (!manifestEntry) return { files, summary: null };

  let manifest: JsonRecord;
  try {
    const parsed = JSON.parse((await manifestEntry.file.text()).replace(/^\uFEFF/, "")) as unknown;
    if (!isRecord(parsed)) throw new Error("Invalid manifest");
    manifest = parsed;
  } catch {
    if (hasGenericPackageRoot(normalized)) return { files, summary: null };
    throw new Error("Claw Pack manifest is not valid JSON.");
  }

  if (manifest.kind !== "openclaw.clawpack") {
    if (hasGenericPackageRoot(normalized)) return { files, summary: null };
    throw new Error("Manifest is not an OpenClaw Claw Pack.");
  }

  const manifestPath = manifestEntry.path;
  const manifestDir = manifestPath.includes("/")
    ? `${manifestPath.split("/").slice(0, -1).join("/")}/`
    : "";
  const packageRoot = `${manifestDir}package/`;
  const packageFiles = normalized
    .filter((entry) => entry.path !== manifestPath && entry.path.startsWith(packageRoot))
    .map((entry) => createPathFile(entry.file, entry.path.slice(packageRoot.length)));

  if (packageFiles.length === 0) {
    throw new Error("Claw Pack archive does not contain package files under package/.");
  }

  const packageInfo = isRecord(manifest.package) ? manifest.package : {};
  const releaseInfo = isRecord(manifest.release) ? manifest.release : {};
  const sourceInfo = isRecord(releaseInfo.source) ? releaseInfo.source : {};
  const hostTargets = Array.isArray(manifest.hostTargets)
    ? manifest.hostTargets
        .map(getClawPackTarget)
        .filter((target): target is string => Boolean(target))
    : [];
  const family = getString(packageInfo.family);

  return {
    files: packageFiles,
    summary: {
      packageName: getString(packageInfo.name) ?? getString(packageInfo.slug),
      displayName: getString(packageInfo.displayName) ?? getString(packageInfo.name),
      version: getString(packageInfo.version),
      family: family === "code-plugin" || family === "bundle-plugin" ? family : undefined,
      sourceRepo: getString(sourceInfo.repo),
      sourceCommit: getString(sourceInfo.commit),
      sourceRef: getString(sourceInfo.ref),
      sourcePath: getString(sourceInfo.path),
      hostTargets,
      packageFileCount: packageFiles.length,
    } satisfies ClawPackImportSummary,
  };
}
