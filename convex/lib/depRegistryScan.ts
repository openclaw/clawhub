import {
  MODERATION_ENGINE_VERSION,
  REASON_CODES,
  type ModerationFinding,
  type ModerationVerdict,
} from "./moderationReasonCodes";

export const SUPPORTED_DEP_REGISTRIES = ["pypi", "npm", "cargo"] as const;

export type SupportedDepRegistry = (typeof SUPPORTED_DEP_REGISTRIES)[number];

export type DepRegistryStatus = "clean" | "suspicious" | "error";

export type DepEntry = {
  name: string;
  registry: SupportedDepRegistry;
  source: string;
};

export type DepRegistryResult = DepEntry & {
  exists: boolean;
  httpStatus?: number;
};

export type DepRegistryUnresolved = DepEntry & {
  reason: string;
};

export type DepRegistryAnalysis = {
  status: DepRegistryStatus;
  results: DepRegistryResult[];
  notFoundPackages: string[];
  unresolvedPackages: string[];
  summary: string;
  checkedAt: number;
};

const DEP_FILE_PARSERS: Record<string, (content: string, path: string) => DepEntry[]> = {
  "requirements.txt": parseRequirementsTxt,
  "requirements-dev.txt": parseRequirementsTxt,
  "requirements_dev.txt": parseRequirementsTxt,
  "requirements-test.txt": parseRequirementsTxt,
  "requirements_test.txt": parseRequirementsTxt,
  "package.json": parsePackageJson,
  "cargo.toml": parseCargoToml,
  "pyproject.toml": parsePyprojectToml,
};

const NON_REGISTRY_NPM_SPEC_PREFIXES = [
  "file:",
  "link:",
  "git+",
  "git://",
  "github:",
  "bitbucket:",
  "gist:",
  "http:",
  "https:",
  "workspace:",
  "npm:",
];

const VENDORED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.venv\//,
  /(^|\/)venv\//,
  /(^|\/)target\//,
  /(^|\/)\.cargo\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
];

function normalizeName(name: string, registry: SupportedDepRegistry) {
  const normalized = name.trim().toLowerCase();
  return registry === "cargo" ? normalized.replaceAll("_", "-") : normalized;
}

export function isVendoredDependencyPath(path: string) {
  return VENDORED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function parseDependencyFile(path: string, content: string): DepEntry[] {
  if (isVendoredDependencyPath(path)) return [];
  const basename = path.split("/").pop()?.toLowerCase() ?? "";
  const parser = DEP_FILE_PARSERS[basename];
  return parser ? dedupeDeps(parser(content, path)) : [];
}

export function dedupeDeps(entries: DepEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.registry}:${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripInlineComment(line: string) {
  return line.replace(/\s+#.*$/, "").trim();
}

function parseRequirementsTxt(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = stripInlineComment(rawLine);
    if (!line || line.startsWith("-")) continue;
    if (/^(?:git\+|https?:|file:|\.{0,2}\/)/i.test(line)) continue;
    if (/\s@\s/.test(line)) continue;
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)/);
    if (!match) continue;
    entries.push({ name: normalizeName(match[1], "pypi"), registry: "pypi", source: path });
  }
  return entries;
}

function parsePackageJson(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return entries;
  }

  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [rawName, rawSpec] of Object.entries(deps as Record<string, unknown>)) {
      const spec = typeof rawSpec === "string" ? rawSpec.trim().toLowerCase() : "";
      if (NON_REGISTRY_NPM_SPEC_PREFIXES.some((prefix) => spec.startsWith(prefix))) continue;
      entries.push({ name: normalizeName(rawName, "npm"), registry: "npm", source: path });
    }
  }
  return entries;
}

function parseCargoToml(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  let inDepSection = false;
  for (const rawLine of content.split("\n")) {
    const line = stripInlineComment(rawLine);
    if (/^\[.*\]$/.test(line)) {
      const section = line.replace(/[[\]\s]/g, "").toLowerCase();
      inDepSection =
        section === "dependencies" ||
        section === "dev-dependencies" ||
        section === "build-dependencies";
      continue;
    }
    if (!inDepSection || !line) continue;
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9_-]*)\s*=/);
    if (!match) continue;
    entries.push({ name: normalizeName(match[1], "cargo"), registry: "cargo", source: path });
  }
  return entries;
}

function parsePyprojectToml(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  let inDepArray = false;
  let inPoetryDepTable = false;
  for (const rawLine of content.split("\n")) {
    const line = stripInlineComment(rawLine);
    if (/^\[.*\]$/.test(line)) {
      inDepArray = false;
      const section = line.replace(/[[\]\s]/g, "").toLowerCase();
      inPoetryDepTable =
        section === "tool.poetry.dependencies" ||
        section === "tool.poetry.dev-dependencies" ||
        section === "tool.poetry.group.dev.dependencies";
      continue;
    }
    if (/^dependencies\s*=\s*\[/.test(line)) {
      inDepArray = true;
      const inline = line.match(/\[\s*(.*)\s*\]/);
      if (inline) {
        for (const item of extractQuotedStrings(inline[1])) addPyPiDependency(entries, item, path);
        inDepArray = false;
      }
      continue;
    }
    if (inDepArray) {
      if (line === "]") {
        inDepArray = false;
        continue;
      }
      const quoted = line.match(/^["']([^"']+)["']/);
      if (quoted) addPyPiDependency(entries, quoted[1], path);
      continue;
    }
    if (!inPoetryDepTable || !line) continue;
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)\s*=/);
    if (!match || match[1].toLowerCase() === "python") continue;
    entries.push({ name: normalizeName(match[1], "pypi"), registry: "pypi", source: path });
  }
  return entries;
}

function addPyPiDependency(entries: DepEntry[], spec: string, path: string) {
  if (/\s@\s/.test(spec)) return;
  const match = spec.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)/);
  if (!match) return;
  entries.push({ name: normalizeName(match[1], "pypi"), registry: "pypi", source: path });
}

function extractQuotedStrings(s: string) {
  return [...s.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

export function depRegistryUrl(registry: SupportedDepRegistry, packageName: string) {
  const encoded =
    registry === "npm" && packageName.startsWith("@")
      ? `@${encodeURIComponent(packageName.slice(1))}`
      : encodeURIComponent(packageName);
  if (registry === "pypi") return `https://pypi.org/pypi/${encoded}/json`;
  if (registry === "npm") return `https://registry.npmjs.org/${encoded}`;
  return `https://crates.io/api/v1/crates/${encoded}`;
}

export function summarizeDepRegistryChecks(params: {
  results: DepRegistryResult[];
  unresolved: DepRegistryUnresolved[];
  checkedAt?: number;
}): DepRegistryAnalysis {
  const notFound = params.results.filter((result) => !result.exists);
  const notFoundPackages = notFound.map((result) => `${result.name} (${result.registry})`);
  const unresolvedPackages = params.unresolved.map(
    (result) => `${result.name} (${result.registry})`,
  );
  const checkedAt = params.checkedAt ?? Date.now();

  if (notFoundPackages.length > 0) {
    const partial =
      unresolvedPackages.length > 0
        ? ` ${unresolvedPackages.length} package(s) could not be checked and will be retried.`
        : "";
    return {
      status: "suspicious",
      results: params.results,
      notFoundPackages,
      unresolvedPackages,
      summary: `${notFoundPackages.length} declared dependency package(s) were not found on their public registry: ${notFoundPackages.join(", ")}.${partial}`,
      checkedAt,
    };
  }

  if (unresolvedPackages.length > 0) {
    return {
      status: "error",
      results: params.results,
      notFoundPackages: [],
      unresolvedPackages,
      summary: `${unresolvedPackages.length} dependency package(s) could not be verified due to registry lookup errors. The scan will be retried.`,
      checkedAt,
    };
  }

  return {
    status: "clean",
    results: params.results,
    notFoundPackages: [],
    unresolvedPackages: [],
    summary: `All ${params.results.length} declared dependency package(s) verified as present on their public registries.`,
    checkedAt,
  };
}

export function buildDepRegistryFinding(analysis: DepRegistryAnalysis): ModerationFinding | null {
  if (analysis.status !== "suspicious" || analysis.notFoundPackages.length === 0) return null;
  return {
    code: REASON_CODES.DEP_NOT_FOUND,
    severity: "critical",
    file: "Dependency manifests",
    line: 1,
    message: `${analysis.notFoundPackages.length} package(s) referenced in dependency files do not exist on their public registries: ${analysis.notFoundPackages.join(", ")}`,
    evidence:
      "An attacker could register these phantom package names and inject malicious install-time code through dependency confusion.",
  };
}

export function mergeDepRegistryFinding(params: {
  staticScan:
    | {
        status: ModerationVerdict;
        reasonCodes: string[];
        findings: ModerationFinding[];
        summary: string;
        engineVersion: string;
        checkedAt: number;
      }
    | undefined;
  analysis: DepRegistryAnalysis;
  statusFromCodes: (codes: string[]) => ModerationVerdict;
  summarizeCodes: (codes: string[]) => string;
}) {
  const base = params.staticScan ?? {
    status: "clean" as ModerationVerdict,
    reasonCodes: [],
    findings: [],
    summary: "No suspicious patterns detected.",
    engineVersion: MODERATION_ENGINE_VERSION,
    checkedAt: params.analysis.checkedAt,
  };
  const findings = base.findings.filter((finding) => finding.code !== REASON_CODES.DEP_NOT_FOUND);
  const depFinding = buildDepRegistryFinding(params.analysis);
  if (depFinding) findings.push(depFinding);
  const reasonCodes = Array.from(new Set(findings.map((finding) => finding.code))).sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    ...base,
    status: params.statusFromCodes(reasonCodes),
    reasonCodes,
    findings,
    summary: params.summarizeCodes(reasonCodes),
    checkedAt: params.analysis.checkedAt,
  };
}
