import { isScalar, parseDocument, visit } from "yaml";
import { hasPortablePathSegments, portablePathKey } from "./templatePaths.js";
import {
  summarizeTemplateManifest,
  templateDependencyInventory,
  type TemplateDependencyInventory,
  validateTemplateManifest,
  type TemplateManifest,
  type TemplateManifestSummary,
} from "./templates.js";

export type TemplatePackageTextFile = { path: string; text?: string };
export type TemplatePackageValidationIssue = {
  code: string;
  path: string;
  message: string;
};
export type ValidatedTemplatePackage = {
  manifestPath: string;
  manifest: TemplateManifest;
  summary: TemplateManifestSummary;
  inventory: TemplateDependencyInventory;
  hasTemplateMarkdownBody: boolean;
};
const EXACT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAX_TEMPLATE_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BOOTSTRAP_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isSafeTemplatePackagePath(value: string): boolean {
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
  return hasPortablePathSegments(normalized);
}

export function findTemplatePackagePathHierarchyCollision(
  paths: readonly string[],
): { ancestor: string; descendant: string } | null {
  const pathByKey = new Map(paths.map((path) => [portablePathKey(path), path]));
  for (const descendant of paths) {
    const segments = portablePathKey(descendant).split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = pathByKey.get(segments.slice(0, length).join("/"));
      if (ancestor !== undefined) {
        return { ancestor, descendant };
      }
    }
  }
  return null;
}

function issue(code: string, path: string, message: string): TemplatePackageValidationIssue {
  return { code, path, message };
}

function findUnsupportedYamlFeature(document: ReturnType<typeof parseDocument>) {
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
  return unsupportedFeature;
}

function parseManifestDocument(
  raw: string,
  manifestPath: string,
):
  | { value: unknown; templateMarkdownBody?: string }
  | { issues: TemplatePackageValidationIssue[] } {
  const markdown = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      issues: [
        issue(
          "missing_template_frontmatter",
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
        issue("invalid_template_frontmatter", manifestPath, error.message),
      ),
    };
  }
  const unsupportedFeature = findUnsupportedYamlFeature(document);
  if (unsupportedFeature) {
    return {
      issues: [
        issue(
          "unsupported_template_yaml_feature",
          manifestPath,
          `${manifestPath} uses ${unsupportedFeature}; CLAW.md frontmatter must map directly to JSON data.`,
        ),
      ],
    };
  }
  try {
    return {
      value: document.toJSON(),
      templateMarkdownBody: markdown.slice(match[0].length),
    };
  } catch (error) {
    return {
      issues: [
        issue(
          "invalid_template_frontmatter",
          manifestPath,
          error instanceof Error ? error.message : "Could not parse Template frontmatter.",
        ),
      ],
    };
  }
}

export function validateTemplatePackageContents(input: {
  packageName: string;
  version: string;
  packageJson: unknown;
  files: readonly TemplatePackageTextFile[];
}):
  | { ok: true; value: ValidatedTemplatePackage }
  | { ok: false; issues: TemplatePackageValidationIssue[] } {
  const issues: TemplatePackageValidationIssue[] = [];
  if (!isRecord(input.packageJson)) {
    return {
      ok: false,
      issues: [
        issue("missing_package_json", "package.json", "Template packages require package.json."),
      ],
    };
  }
  const declaredName = typeof input.packageJson.name === "string" ? input.packageJson.name : "";
  const declaredVersion =
    typeof input.packageJson.version === "string" ? input.packageJson.version : "";
  const openclaw = isRecord(input.packageJson.openclaw) ? input.packageJson.openclaw : undefined;
  const manifestPath = typeof openclaw?.template === "string" ? openclaw.template : "";
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
  if (
    Object.hasOwn(openclaw ?? {}, "claw") ||
    !manifestPath ||
    manifestPath.split("/").at(-1) !== "CLAW.md" ||
    !isSafeTemplatePackagePath(manifestPath)
  ) {
    issues.push(
      issue(
        "invalid_template_manifest_path",
        "package.json.openclaw.template",
        "Must use only openclaw.template naming a safe package-relative CLAW.md.",
      ),
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  const fileByPath = new Map<string, TemplatePackageTextFile>();
  const portablePaths = new Set<string>();
  for (const file of input.files) {
    if (!isSafeTemplatePackagePath(file.path)) {
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
  const hierarchyCollision = findTemplatePackagePathHierarchyCollision([...fileByPath.keys()]);
  if (hierarchyCollision) {
    issues.push(
      issue(
        "portable_path_hierarchy_collision",
        hierarchyCollision.descendant,
        `Package file ${hierarchyCollision.ancestor} cannot also be an ancestor of ${hierarchyCollision.descendant}.`,
      ),
    );
  }
  const manifestFile = fileByPath.get(manifestPath);
  if (!manifestFile || manifestFile.text === undefined) {
    issues.push(
      issue(
        "missing_template_manifest",
        manifestPath,
        "The declared Template manifest is missing or is not UTF-8 text.",
      ),
    );
    return { ok: false, issues };
  }
  if (new TextEncoder().encode(manifestFile.text).byteLength > MAX_TEMPLATE_MANIFEST_BYTES) {
    return {
      ok: false,
      issues: [
        issue(
          "template_manifest_too_large",
          manifestPath,
          `The Template manifest exceeds ${MAX_TEMPLATE_MANIFEST_BYTES} bytes.`,
        ),
      ],
    };
  }
  const parsed = parseManifestDocument(manifestFile.text, manifestPath);
  if ("issues" in parsed) return { ok: false, issues: parsed.issues };
  const validated = validateTemplateManifest(parsed.value);
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map((entry) =>
        issue("invalid_template_manifest", entry.path, entry.message),
      ),
    };
  }
  const hasTemplateMarkdownBody = (parsed.templateMarkdownBody?.trim().length ?? 0) > 0;
  const implicitSoulPath = "SOUL.md";
  const workspaceTargets = [
    ...Object.keys(validated.manifest.workspace?.bootstrapFiles ?? {}),
    ...(validated.manifest.workspace?.files ?? []).map((entry) => entry.path),
  ];
  const hasImplicitSoulConflict =
    workspaceTargets.some((path) => portablePathKey(path) === portablePathKey(implicitSoulPath)) ||
    findTemplatePackagePathHierarchyCollision([implicitSoulPath, ...workspaceTargets]) !== null;
  if (hasTemplateMarkdownBody && hasImplicitSoulConflict) {
    issues.push(
      issue(
        "template_body_soul_conflict",
        "$.workspace",
        "CLAW.md body content and an explicit SOUL.md workspace declaration cannot both be present.",
      ),
    );
  }

  const packageBootstrap = [...fileByPath.values()].find(
    (file) => portablePathKey(file.path) === portablePathKey("BOOTSTRAP.md"),
  );
  if (packageBootstrap && packageBootstrap.path !== "BOOTSTRAP.md") {
    issues.push(
      issue(
        "invalid_package_path",
        packageBootstrap.path,
        "Package-root bootstrap files must use the exact path BOOTSTRAP.md.",
      ),
    );
  } else if (packageBootstrap) {
    if (packageBootstrap.text === undefined) {
      issues.push(
        issue(
          "package_bootstrap_invalid",
          "BOOTSTRAP.md",
          "Package-root BOOTSTRAP.md must be UTF-8 text.",
        ),
      );
    } else if (
      new TextEncoder().encode(packageBootstrap.text).byteLength > MAX_PACKAGE_BOOTSTRAP_BYTES
    ) {
      issues.push(
        issue(
          "package_bootstrap_too_large",
          "BOOTSTRAP.md",
          `Package-root BOOTSTRAP.md exceeds ${MAX_PACKAGE_BOOTSTRAP_BYTES} bytes.`,
        ),
      );
    } else if (packageBootstrap.text.trim().length === 0) {
      issues.push(
        issue(
          "package_bootstrap_empty",
          "BOOTSTRAP.md",
          "Package-root BOOTSTRAP.md must contain first-run instructions.",
        ),
      );
    }
  }

  for (const file of fileByPath.values()) {
    if (portablePathKey(file.path).startsWith("profiles/")) {
      issues.push(
        issue(
          "retired_template_profile",
          file.path,
          "Template profiles are no longer supported. Move native settings into CLAW.md agent and extensions into CLAW.md plugins.",
        ),
      );
    }
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
  const summary = summarizeTemplateManifest(validated.manifest, {
    templateMarkdownBody: hasTemplateMarkdownBody,
  });
  if (packageBootstrap) {
    summary.workspace.bootstrapFiles = [...summary.workspace.bootstrapFiles, "BOOTSTRAP.md"].sort();
  }
  return {
    ok: true,
    value: {
      manifestPath,
      manifest: validated.manifest,
      summary,
      inventory: templateDependencyInventory(validated.manifest),
      hasTemplateMarkdownBody,
    },
  };
}
