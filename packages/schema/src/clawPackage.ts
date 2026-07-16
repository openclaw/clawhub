import { isScalar, parseDocument, visit } from "yaml";
import {
  summarizeClawManifest,
  validateClawManifest,
  type ClawManifest,
  type ClawManifestSummary,
} from "./claws.js";

export type ClawPackageTextFile = { path: string; text?: string };
export type ClawPackageValidationIssue = {
  code: string;
  path: string;
  message: string;
};
export type ValidatedClawPackage = {
  manifestPath: string;
  manifest: ClawManifest;
  summary: ClawManifestSummary;
};

const EXACT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isSafeClawPackagePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized !== value ||
    normalized !== normalized.trim() ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return false;
  }
  return normalized
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !WINDOWS_INVALID_PATH_CHARS.test(segment) &&
        !Array.from(segment).some((character) => character.charCodeAt(0) <= 0x1f) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    );
}

function portablePathKey(value: string): string {
  return value.replaceAll("\\", "/").normalize("NFC").toLowerCase();
}

function issue(code: string, path: string, message: string): ClawPackageValidationIssue {
  return { code, path, message };
}

function parseManifestDocument(raw: string, manifestPath: string) {
  const filename = manifestPath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  if (filename === "claw.md") {
    const markdown = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) {
      return {
        issues: [
          issue(
            "missing_claw_frontmatter",
            manifestPath,
            `${manifestPath} must start with YAML frontmatter delimited by --- lines.`,
          ),
        ],
      };
    }
    const document = parseDocument(match[1], { prettyErrors: false, uniqueKeys: true });
    if (document.errors.length > 0) {
      return {
        issues: document.errors.map((error) =>
          issue("invalid_claw_frontmatter", manifestPath, error.message),
        ),
      };
    }
    let unsupportedFeature: string | undefined;
    visit(document, {
      Alias() {
        unsupportedFeature ??= "aliases";
      },
      Node(_key, node) {
        if (node.anchor) {
          unsupportedFeature ??= "anchors";
        } else if (node.tag) {
          unsupportedFeature ??= "explicit tags";
        }
      },
      Pair(_key, pair) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
          unsupportedFeature ??= "non-string mapping keys";
        } else if (pair.key.value === "<<") {
          unsupportedFeature ??= "merge keys";
        }
      },
    });
    if (unsupportedFeature) {
      return {
        issues: [
          issue(
            "unsupported_claw_yaml_feature",
            manifestPath,
            `${manifestPath} uses ${unsupportedFeature}; CLAW.md frontmatter must map directly to JSON data.`,
          ),
        ],
      };
    }
    try {
      return { value: document.toJSON() };
    } catch (error) {
      return {
        issues: [
          issue(
            "invalid_claw_frontmatter",
            manifestPath,
            error instanceof Error ? error.message : "Could not parse Claw frontmatter.",
          ),
        ],
      };
    }
  }
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch (error) {
    return {
      issues: [
        issue(
          "invalid_claw_json",
          manifestPath,
          error instanceof Error ? error.message : "Could not parse Claw JSON.",
        ),
      ],
    };
  }
}

export function validateClawPackageContents(input: {
  packageName: string;
  version: string;
  packageJson: unknown;
  files: readonly ClawPackageTextFile[];
}):
  | { ok: true; value: ValidatedClawPackage }
  | { ok: false; issues: ClawPackageValidationIssue[] } {
  const issues: ClawPackageValidationIssue[] = [];
  if (!isRecord(input.packageJson)) {
    return {
      ok: false,
      issues: [
        issue("missing_package_json", "package.json", "Claw packages require package.json."),
      ],
    };
  }
  const declaredName = typeof input.packageJson.name === "string" ? input.packageJson.name : "";
  const declaredVersion =
    typeof input.packageJson.version === "string" ? input.packageJson.version : "";
  const openclaw = isRecord(input.packageJson.openclaw) ? input.packageJson.openclaw : undefined;
  const manifestPath = typeof openclaw?.claw === "string" ? openclaw.claw : "";
  if (declaredName !== input.packageName) {
    issues.push(
      issue("package_name_mismatch", "package.json.name", `Must match ${input.packageName}.`),
    );
  }
  if (!EXACT_VERSION_PATTERN.test(declaredVersion) || declaredVersion !== input.version) {
    issues.push(
      issue(
        "package_version_mismatch",
        "package.json.version",
        `Must be exact semver ${input.version}.`,
      ),
    );
  }
  if (!manifestPath || !isSafeClawPackagePath(manifestPath)) {
    issues.push(
      issue(
        "invalid_claw_manifest_path",
        "package.json.openclaw.claw",
        "Must name a safe package-relative Claw manifest path.",
      ),
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  const fileByPath = new Map<string, ClawPackageTextFile>();
  const portablePaths = new Set<string>();
  for (const file of input.files) {
    if (!isSafeClawPackagePath(file.path)) {
      issues.push(
        issue(
          "invalid_package_path",
          file.path,
          "Package files must use safe canonical package-relative paths.",
        ),
      );
      continue;
    }
    const key = portablePathKey(file.path);
    if (portablePaths.has(key)) {
      issues.push(
        issue(
          "duplicate_portable_path",
          file.path,
          "Package paths must be unique across supported filesystems.",
        ),
      );
    } else {
      portablePaths.add(key);
      fileByPath.set(file.path, file);
    }
  }
  const manifestFile = fileByPath.get(manifestPath);
  if (!manifestFile || manifestFile.text === undefined) {
    issues.push(
      issue(
        "missing_claw_manifest",
        manifestPath,
        "The declared Claw manifest is missing or is not UTF-8 text.",
      ),
    );
    return { ok: false, issues };
  }
  const parsed = parseManifestDocument(manifestFile.text, manifestPath);
  if (parsed.issues) return { ok: false, issues: parsed.issues };
  const validated = validateClawManifest(parsed.value);
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map((entry) =>
        issue("invalid_claw_manifest", entry.path, entry.message),
      ),
    };
  }

  const sources = [
    ...Object.values(validated.manifest.workspace?.bootstrapFiles ?? {}).map(
      (entry) => entry.source,
    ),
    ...(validated.manifest.workspace?.files ?? []).map((entry) => entry.source),
  ];
  for (const source of sources) {
    if (!fileByPath.has(source)) {
      issues.push(
        issue(
          "missing_workspace_source",
          source,
          "Declared workspace source is missing from the package.",
        ),
      );
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      manifestPath,
      manifest: validated.manifest,
      summary: summarizeClawManifest(validated.manifest),
    },
  };
}
