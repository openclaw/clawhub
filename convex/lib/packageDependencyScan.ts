import semver from "semver";

export type PackageDependencyScanStatus =
  | "clean"
  | "suspicious"
  | "malicious"
  | "skipped"
  | "error";
export type PackageDependencyScanProvider = "osv";
export type PackageDependencyEcosystem = "npm";
export type PackageDependencyKind =
  | "dependencies"
  | "optionalDependencies"
  | "peerDependencies"
  | "bundledDependencies"
  | "bundleDependencies";

export type PackageDependency = {
  name: string;
  resolvedPackageName: string;
  ecosystem: PackageDependencyEcosystem;
  dependencyKind?: PackageDependencyKind;
  manifestPath: string;
  requestedRange?: string;
  resolvedVersion?: string;
};

export type PackageDependencyScanFinding = {
  source: PackageDependencyScanProvider;
  advisoryId: string;
  packageName: string;
  manifestName?: string;
  ecosystem: PackageDependencyEcosystem;
  version?: string;
  summary: string;
  aliases: string[];
  classification: "malware" | "vulnerability";
  confidence: "high" | "medium";
  severity?: string;
  url?: string;
  manifestPath?: string;
  dependencyKind?: PackageDependencyKind;
};

export type PackageDependencyScanResult = {
  status: PackageDependencyScanStatus;
  provider: PackageDependencyScanProvider;
  scannerVersion: string;
  dependencyCount: number;
  scannedDependencyCount: number;
  skippedDependencyCount: number;
  manifests: string[];
  findings: PackageDependencyScanFinding[];
  summary: string;
  checkedAt: number;
  error?: string;
};

export type DependencyManifestFile = {
  path: string;
  content: string;
};

type JsonRecord = Record<string, unknown>;

type OsvVulnerability = {
  id: string;
  summary?: string;
  aliases: string[];
  severity?: string;
  url?: string;
  classification: "malware" | "vulnerability";
};

const SCANNER_VERSION = "osv-npm-lockfile-v1";
const OSV_QUERY_BATCH_LIMIT = 1_000;
const DEPENDENCY_KINDS: PackageDependencyKind[] = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePackageName(name: string) {
  return name.trim().toLowerCase();
}

function isPackageJsonPath(path: string) {
  return path.toLowerCase().endsWith("package.json");
}

function isNodeModulesPackageJsonPath(path: string) {
  return /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/i.test(path);
}

function packageRootFromPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function npmLockfilePathsForRoot(root: string) {
  const prefix = root ? `${root}/` : "";
  return [`${prefix}package-lock.json`, `${prefix}npm-shrinkwrap.json`];
}

function isNpmLockfilePath(path: string) {
  return /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/i.test(path);
}

function dependencyEntries(value: unknown): Array<{ name: string; requestedRange?: string }> {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .map((name) => ({ name: name.trim() }));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([name]) => Boolean(name.trim()))
    .map(([name, range]) => ({
      name: name.trim(),
      requestedRange: stringValue(range),
    }));
}

function parseJson(content: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function lockPackages(lockfile: JsonRecord): JsonRecord | null {
  return isRecord(lockfile.packages) ? lockfile.packages : null;
}

function nodeModulesKeyForDependency(name: string) {
  return `node_modules/${name}`;
}

function dependencyNameFromLockfilePackagePath(path: string) {
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const packagePath = path.slice(markerIndex + marker.length);
  const segments = packagePath.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments[0]?.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }
  return segments[0];
}

function exactVersionFromRequestedRange(requestedRange: string | undefined) {
  if (!requestedRange) return undefined;
  return semver.valid(requestedRange) ?? semver.valid(requestedRange.replace(/^=\s*/, ""));
}

function resolutionFromPackageSpec(params: { manifestName: string; packageSpec?: string }) {
  const exactVersion = exactVersionFromRequestedRange(params.packageSpec);
  if (exactVersion) {
    return {
      resolvedPackageName: params.manifestName,
      resolvedVersion: exactVersion,
    };
  }

  const npmAlias = params.packageSpec?.match(/^npm:(.+)$/)?.[1];
  if (!npmAlias) return undefined;
  const versionDelimiter = npmAlias.lastIndexOf("@");
  if (versionDelimiter <= 0) return undefined;
  const resolvedPackageName = npmAlias.slice(0, versionDelimiter);
  const resolvedVersion = exactVersionFromRequestedRange(npmAlias.slice(versionDelimiter + 1));
  if (!resolvedPackageName || !resolvedVersion) return undefined;
  return { resolvedPackageName, resolvedVersion };
}

function lockfileResolutionForDependency(lockfile: JsonRecord | null, dependencyName: string) {
  if (!lockfile) return undefined;
  const packages = lockPackages(lockfile);
  const packageEntry = packages?.[nodeModulesKeyForDependency(dependencyName)];
  if (isRecord(packageEntry)) {
    const version = stringValue(packageEntry.version);
    const resolvedVersion = exactVersionFromRequestedRange(version);
    if (resolvedVersion) {
      return {
        resolvedPackageName: stringValue(packageEntry.name) ?? dependencyName,
        resolvedVersion,
      };
    }
  }
  const dependencies = isRecord(lockfile.dependencies) ? lockfile.dependencies : null;
  const dependencyEntry = dependencies?.[dependencyName];
  if (!isRecord(dependencyEntry)) return undefined;
  const version = stringValue(dependencyEntry.version);
  if (!version) return undefined;
  const exactVersion = exactVersionFromRequestedRange(version);
  if (exactVersion) {
    return {
      resolvedPackageName: stringValue(dependencyEntry.name) ?? dependencyName,
      resolvedVersion: exactVersion,
    };
  }
  return resolutionFromPackageSpec({
    manifestName: dependencyName,
    packageSpec: version,
  });
}

function packageSpecResolutionForDependency(dependency: { name: string; requestedRange?: string }) {
  return resolutionFromPackageSpec({
    manifestName: dependency.name,
    packageSpec: dependency.requestedRange,
  });
}

function packageManifestSelfDependency(
  file: DependencyManifestFile,
  manifest: JsonRecord,
): PackageDependency | null {
  if (!isNodeModulesPackageJsonPath(file.path)) return null;
  const resolvedPackageName = stringValue(manifest.name);
  const resolvedVersion = exactVersionFromRequestedRange(stringValue(manifest.version));
  if (!resolvedPackageName || !resolvedVersion) return null;
  return {
    name:
      dependencyNameFromLockfilePackagePath(packageRootFromPath(file.path)) ?? resolvedPackageName,
    resolvedPackageName,
    ecosystem: "npm",
    manifestPath: file.path,
    resolvedVersion,
  };
}

function lockfilePackageDependencies(file: DependencyManifestFile): PackageDependency[] {
  const lockfile = parseJson(file.content);
  if (!lockfile) return [];
  const packages = lockPackages(lockfile);

  const dependencies: PackageDependency[] = [];
  if (packages) {
    for (const [path, entry] of Object.entries(packages)) {
      if (!isRecord(entry) || !path) continue;
      if (entry.dev === true) continue;
      const packageName = dependencyNameFromLockfilePackagePath(path);
      const resolvedPackageName = stringValue(entry.name) ?? packageName;
      const resolvedVersion = exactVersionFromRequestedRange(stringValue(entry.version));
      if (!packageName || !resolvedPackageName || !resolvedVersion) continue;
      dependencies.push({
        name: packageName,
        resolvedPackageName,
        ecosystem: "npm",
        manifestPath: file.path,
        resolvedVersion,
      });
    }
  }
  dependencies.push(...lockfileNestedDependencies(lockfile.dependencies, file.path));
  return dependencies;
}

function lockfileNestedDependencies(value: unknown, manifestPath: string): PackageDependency[] {
  if (!isRecord(value)) return [];
  const dependencies: PackageDependency[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!name.trim() || !isRecord(entry) || entry.dev === true) {
      continue;
    }
    const resolution = resolutionFromPackageSpec({
      manifestName: name.trim(),
      packageSpec: stringValue(entry.version),
    });
    if (resolution) {
      dependencies.push({
        name: name.trim(),
        resolvedPackageName: resolution.resolvedPackageName,
        ecosystem: "npm",
        manifestPath,
        resolvedVersion: resolution.resolvedVersion,
      });
    }
    dependencies.push(...lockfileNestedDependencies(entry.dependencies, manifestPath));
  }
  return dependencies;
}

export function extractNpmDependencies(files: DependencyManifestFile[]): PackageDependency[] {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const dependencies: PackageDependency[] = [];

  for (const file of files.filter((entry) => isPackageJsonPath(entry.path))) {
    const manifest = parseJson(file.content);
    if (!manifest) continue;
    const selfDependency = packageManifestSelfDependency(file, manifest);
    if (selfDependency) dependencies.push(selfDependency);
    const root = packageRootFromPath(file.path);
    const lockfile =
      npmLockfilePathsForRoot(root)
        .map((path) => fileByPath.get(path)?.content)
        .map((content) => (content ? parseJson(content) : null))
        .find((parsed) => parsed !== null) ?? null;

    for (const dependencyKind of DEPENDENCY_KINDS) {
      for (const dependency of dependencyEntries(manifest[dependencyKind])) {
        const lockfileResolution = lockfileResolutionForDependency(lockfile, dependency.name);
        const packageSpecResolution = packageSpecResolutionForDependency(dependency);
        const resolution = lockfileResolution ?? packageSpecResolution;
        dependencies.push({
          name: dependency.name,
          resolvedPackageName: resolution?.resolvedPackageName ?? dependency.name,
          ecosystem: "npm",
          dependencyKind,
          manifestPath: file.path,
          requestedRange: dependency.requestedRange,
          resolvedVersion: resolution?.resolvedVersion,
        });
      }
    }
  }
  for (const file of files.filter((entry) => isNpmLockfilePath(entry.path))) {
    dependencies.push(...lockfilePackageDependencies(file));
  }

  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = [
      normalizePackageName(dependency.resolvedPackageName),
      dependency.resolvedVersion ?? "",
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type OsvQueryBatchRequest = {
  queries: Array<{
    package: {
      name: string;
      ecosystem: "npm";
    };
    version: string;
  }>;
};

export function buildOsvQueryBatchRequest(dependencies: PackageDependency[]): OsvQueryBatchRequest {
  const scanned = dependencies.filter(
    (dependency): dependency is PackageDependency & { resolvedVersion: string } =>
      Boolean(dependency.resolvedVersion),
  );
  return {
    queries: scanned.map((dependency) => ({
      package: {
        name: dependency.resolvedPackageName,
        ecosystem: "npm",
      },
      version: dependency.resolvedVersion,
    })),
  };
}

export function splitOsvQueryBatchRequest(
  request: OsvQueryBatchRequest,
  maxQueries = OSV_QUERY_BATCH_LIMIT,
): OsvQueryBatchRequest[] {
  if (maxQueries < 1) throw new Error("OSV query batch size must be at least 1");
  const batches: OsvQueryBatchRequest[] = [];
  for (let index = 0; index < request.queries.length; index += maxQueries) {
    batches.push({ queries: request.queries.slice(index, index + maxQueries) });
  }
  return batches;
}

export function mergeOsvQueryBatchResponses(responses: unknown[]): unknown {
  const results: unknown[] = [];
  for (const response of responses) {
    if (!isRecord(response) || !Array.isArray(response.results)) {
      throw new Error("OSV response did not include a results array");
    }
    results.push(...response.results);
  }
  return { results };
}

function vulnerabilityAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry));
}

function vulnerabilitySeverity(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const score = stringValue(entry.score);
    if (score) return score;
  }
  return undefined;
}

function isMaliciousOsvAdvisory(id: string, aliases: string[]) {
  return id.startsWith("MAL-") || aliases.some((alias) => alias.startsWith("MAL-"));
}

function normalizeOsvVulnerability(value: unknown): OsvVulnerability | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  const aliases = vulnerabilityAliases(value.aliases);
  const classification = isMaliciousOsvAdvisory(id, aliases) ? "malware" : "vulnerability";
  return {
    id,
    aliases,
    classification,
    summary: stringValue(value.summary),
    severity: vulnerabilitySeverity(value.severity),
    url: stringValue(value.details)
      ? `https://osv.dev/vulnerability/${encodeURIComponent(id)}`
      : undefined,
  };
}

export function normalizeOsvQueryBatchResponse(params: {
  dependencies: PackageDependency[];
  response: unknown;
  checkedAt: number;
}): PackageDependencyScanResult {
  const scannedDependencies = params.dependencies.filter(
    (dependency) => dependency.resolvedVersion,
  );
  if (!isRecord(params.response) || !Array.isArray(params.response.results)) {
    throw new Error("OSV response did not include a results array");
  }
  const results = params.response.results;
  if (results.length !== scannedDependencies.length) {
    throw new Error(
      `OSV response result count ${results.length} did not match query count ${scannedDependencies.length}`,
    );
  }
  const findings: PackageDependencyScanFinding[] = [];

  for (let index = 0; index < scannedDependencies.length; index += 1) {
    const dependency = scannedDependencies[index];
    const result = results[index];
    const vulns = isRecord(result) && Array.isArray(result.vulns) ? result.vulns : [];
    for (const vuln of vulns) {
      const normalized = normalizeOsvVulnerability(vuln);
      if (!normalized) continue;
      findings.push({
        source: "osv",
        advisoryId: normalized.id,
        packageName: dependency.resolvedPackageName,
        ...(dependency.name !== dependency.resolvedPackageName
          ? { manifestName: dependency.name }
          : {}),
        ecosystem: dependency.ecosystem,
        version: dependency.resolvedVersion,
        summary: normalized.summary ?? normalized.id,
        aliases: normalized.aliases,
        classification: normalized.classification,
        confidence: normalized.classification === "malware" ? "high" : "medium",
        ...(normalized.severity ? { severity: normalized.severity } : {}),
        ...(normalized.url ? { url: normalized.url } : {}),
        manifestPath: dependency.manifestPath,
        ...(dependency.dependencyKind ? { dependencyKind: dependency.dependencyKind } : {}),
      });
    }
  }

  const hasMalware = findings.some((finding) => finding.classification === "malware");
  const hasVulnerabilities = findings.length > 0;
  const skippedDependencyCount = params.dependencies.length - scannedDependencies.length;
  const status: PackageDependencyScanStatus = hasMalware
    ? "malicious"
    : hasVulnerabilities
      ? "suspicious"
      : skippedDependencyCount > 0
        ? "skipped"
        : "clean";
  const manifests = [...new Set(params.dependencies.map((dependency) => dependency.manifestPath))];
  return {
    status,
    provider: "osv",
    scannerVersion: SCANNER_VERSION,
    dependencyCount: params.dependencies.length,
    scannedDependencyCount: scannedDependencies.length,
    skippedDependencyCount,
    manifests,
    findings,
    summary: summarizeDependencyScan(status, findings, scannedDependencies.length),
    checkedAt: params.checkedAt,
  };
}

export function cleanDependencyScanResult(params: {
  dependencies: PackageDependency[];
  checkedAt: number;
}): PackageDependencyScanResult {
  const scannedDependencyCount = params.dependencies.filter(
    (dependency) => dependency.resolvedVersion,
  ).length;
  const status: PackageDependencyScanStatus =
    params.dependencies.length > 0 && scannedDependencyCount === 0 ? "skipped" : "clean";
  return {
    status,
    provider: "osv",
    scannerVersion: SCANNER_VERSION,
    dependencyCount: params.dependencies.length,
    scannedDependencyCount,
    skippedDependencyCount: params.dependencies.length - scannedDependencyCount,
    manifests: [...new Set(params.dependencies.map((dependency) => dependency.manifestPath))],
    findings: [],
    summary:
      params.dependencies.length === 0
        ? "No npm dependency manifests found."
        : "No exact npm dependency versions found for OSV scanning.",
    checkedAt: params.checkedAt,
  };
}

export function failedDependencyScanResult(params: {
  dependencies: PackageDependency[];
  checkedAt: number;
  error: string;
}): PackageDependencyScanResult {
  return {
    status: "error",
    provider: "osv",
    scannerVersion: SCANNER_VERSION,
    dependencyCount: params.dependencies.length,
    scannedDependencyCount: params.dependencies.filter((dependency) => dependency.resolvedVersion)
      .length,
    skippedDependencyCount: params.dependencies.filter((dependency) => !dependency.resolvedVersion)
      .length,
    manifests: [...new Set(params.dependencies.map((dependency) => dependency.manifestPath))],
    findings: [],
    summary: "Dependency scan failed.",
    checkedAt: params.checkedAt,
    error: params.error,
  };
}

function summarizeDependencyScan(
  status: PackageDependencyScanStatus,
  findings: PackageDependencyScanFinding[],
  scannedDependencyCount: number,
) {
  if (status === "malicious") {
    const count = findings.filter((finding) => finding.classification === "malware").length;
    return `Detected ${count} malicious dependency advisory${count === 1 ? "" : "ies"}.`;
  }
  if (status === "suspicious") {
    return `Detected ${findings.length} dependency vulnerabilit${findings.length === 1 ? "y" : "ies"}.`;
  }
  if (status === "skipped") {
    return "No exact npm dependency versions found for OSV scanning.";
  }
  return `Scanned ${scannedDependencyCount} exact npm dependenc${scannedDependencyCount === 1 ? "y" : "ies"} with no OSV findings.`;
}
