import { ArkErrors, type } from "arktype";
import { caseFold } from "unicode-case-folding";
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
  hasClawMarkdownBody: boolean;
};

const EXACT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;
const MAX_CLAW_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const MAX_HARNESS_PROFILE_BYTES = 256 * 1024;
const HARNESS_PROFILE_PATH_PATTERN = /^profiles\/[a-z][a-z0-9_-]{0,63}\.yml$/;
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const StrictStringArraySchema = type("string[]");
const OpenClawExtensionSchema = type({
  "+": "reject",
  id: "string",
  kind: '"plugin"',
  format: '"openclaw"|"claude"|"codex"|"cursor"',
  source: '"clawhub"',
  ref: "string",
  version: "string",
});
const OpenClawProfileSchema = type({
  "+": "reject",
  schemaVersion: "1",
  agent: type({
    "+": "reject",
    groupChat: type({
      "+": "reject",
      mentionPatterns: StrictStringArraySchema.optional(),
    }).optional(),
    sandbox: type({
      "+": "reject",
      mode: '"off"|"non-main"|"all"?',
      scope: '"session"|"agent"|"shared"?',
      workspaceAccess: '"none"|"ro"|"rw"?',
    }).optional(),
    tools: type({
      "+": "reject",
      profile: "string?",
      allow: StrictStringArraySchema.optional(),
      alsoAllow: StrictStringArraySchema.optional(),
      deny: StrictStringArraySchema.optional(),
      fs: type({
        "+": "reject",
        workspaceOnly: "true?",
      }).optional(),
    }).optional(),
    memory: type({
      "+": "reject",
      search: type({
        "+": "reject",
        enabled: "boolean?",
        rememberAcrossConversations: "boolean?",
        sources: type("('memory' | 'sessions')[]").optional(),
      }).optional(),
    }).optional(),
    heartbeat: type({
      "+": "reject",
      every: "string?",
      activeHours: type({
        "+": "reject",
        start: "string?",
        end: "string?",
        timezone: "string?",
      }).optional(),
      lightContext: "boolean?",
      isolatedSession: "boolean?",
      timeoutSeconds: "number?",
    }).optional(),
    humanDelay: type({
      "+": "reject",
      mode: '"off"|"natural"|"custom"?',
      minMs: "number?",
      maxMs: "number?",
    }).optional(),
  }),
  extensions: OpenClawExtensionSchema.array().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonCompatibleValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatibleValue);
  if (isRecord(value)) return Object.values(value).every(isJsonCompatibleValue);
  return false;
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
        !UNICODE_CONTROL_CHARACTER.test(segment) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    );
}

function portablePathKey(value: string): string {
  return caseFold(value.replaceAll("\\", "/").normalize("NFC"));
}

export function findClawPackagePathHierarchyCollision(
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

function issue(code: string, path: string, message: string): ClawPackageValidationIssue {
  return { code, path, message };
}

function parseJsonCompatibleYaml(raw: string, path: string) {
  const document = parseDocument(raw.startsWith("\uFEFF") ? raw.slice(1) : raw, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {
      issues: document.errors.map((error) =>
        issue("invalid_openclaw_profile", path, error.message),
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
          "unsupported_openclaw_profile_yaml_feature",
          path,
          `${path} uses ${unsupportedFeature}; OpenClaw profile YAML must map directly to JSON data.`,
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
          "invalid_openclaw_profile",
          path,
          error instanceof Error ? error.message : "Could not parse OpenClaw profile.",
        ),
      ],
    };
  }
}

function parseGenericHarnessProfile(raw: string, path: string) {
  const parsed = parseJsonCompatibleYaml(raw, path);
  if (parsed.issues) {
    return {
      issues: parsed.issues.map((entry) => ({
        ...entry,
        code: entry.code.replace("openclaw", "harness"),
        message: entry.message.replaceAll("OpenClaw profile", "Harness profile"),
      })),
    };
  }
  if (!isRecord(parsed.value) || !isJsonCompatibleValue(parsed.value)) {
    return {
      issues: [
        issue(
          "invalid_harness_profile",
          path,
          "Harness profiles must be JSON-compatible YAML mappings.",
        ),
      ],
    };
  }
  return parsed;
}

function isStrictNonEmpty(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function isValidDuration(value: string): boolean {
  if (!isStrictNonEmpty(value)) return false;
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const normalized = value.toLowerCase();
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(normalized);
  if (single) {
    return Number.isSafeInteger(Math.round(Number(single[1]) * multipliers[single[2] ?? "m"]));
  }
  let totalMs = 0;
  let consumed = 0;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
    if (match.index !== consumed) return false;
    totalMs += Number(match[1]) * multipliers[match[2]];
    consumed += match[0].length;
  }
  return (
    consumed === normalized.length && consumed > 0 && Number.isSafeInteger(Math.round(totalMs))
  );
}

function validateOpenClawProfile(
  value: unknown,
  profilePath: string,
): ClawPackageValidationIssue[] {
  const parsed = OpenClawProfileSchema(value);
  if (parsed instanceof ArkErrors) {
    return Array.from(parsed, (error) =>
      issue(
        "invalid_openclaw_profile",
        `${profilePath}${error.path.length > 0 ? `.${error.path.join(".")}` : ""}`,
        error.description ?? "Invalid value.",
      ),
    );
  }
  const issues: ClawPackageValidationIssue[] = [];
  const add = (path: string, message: string) =>
    issues.push(issue("invalid_openclaw_profile", `${profilePath}.${path}`, message));
  const requireNonEmpty = (path: string, values: string[] | undefined) => {
    if (values !== undefined && values.length === 0) add(path, "Must contain at least one value.");
    for (const [index, entry] of (values ?? []).entries()) {
      if (!isStrictNonEmpty(entry)) {
        add(`${path}.${index}`, "Must be non-empty without leading or trailing whitespace.");
      }
    }
  };

  requireNonEmpty("agent.groupChat.mentionPatterns", parsed.agent?.groupChat?.mentionPatterns);
  if (
    parsed.agent?.tools?.profile !== undefined &&
    !isStrictNonEmpty(parsed.agent?.tools.profile)
  ) {
    add("agent.tools.profile", "Must be non-empty without leading or trailing whitespace.");
  }
  requireNonEmpty("agent.tools.allow", parsed.agent?.tools?.allow);
  requireNonEmpty("agent.tools.alsoAllow", parsed.agent?.tools?.alsoAllow);
  requireNonEmpty("agent.tools.deny", parsed.agent?.tools?.deny);
  if (parsed.agent?.tools?.allow && parsed.agent?.tools.alsoAllow) {
    add("agent.tools.alsoAllow", "Must not be combined with tools.allow.");
  }
  if (parsed.agent?.memory?.search?.sources?.length === 0) {
    add("agent.memory.search.sources", "Must contain at least one source.");
  }
  if (
    parsed.agent?.memory?.search?.sources?.includes("sessions") &&
    parsed.agent?.memory.search.rememberAcrossConversations !== true
  ) {
    add(
      "agent.memory.search.rememberAcrossConversations",
      "Must be true when memory.search.sources includes sessions.",
    );
  }
  const heartbeat = parsed.agent?.heartbeat;
  if (heartbeat?.every !== undefined && !isValidDuration(heartbeat.every)) {
    add("agent.heartbeat.every", "Must be a valid duration.");
  }
  const activeHours = heartbeat?.activeHours;
  if (activeHours?.start !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(activeHours.start)) {
    add("agent.heartbeat.activeHours.start", "Must be a valid 24-hour start time.");
  }
  if (
    activeHours?.end !== undefined &&
    !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(activeHours.end)
  ) {
    add("agent.heartbeat.activeHours.end", "Must be a valid 24-hour end time.");
  }
  if (activeHours?.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: activeHours.timezone }).format();
    } catch {
      add("agent.heartbeat.activeHours.timezone", "Must be a valid IANA timezone.");
    }
  }
  if (
    heartbeat?.timeoutSeconds !== undefined &&
    (!Number.isInteger(heartbeat.timeoutSeconds) || heartbeat.timeoutSeconds <= 0)
  ) {
    add("agent.heartbeat.timeoutSeconds", "Must be a positive integer.");
  }
  for (const field of ["minMs", "maxMs"] as const) {
    const delay = parsed.agent?.humanDelay?.[field];
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) {
      add(`agent.humanDelay.${field}`, "Must be a nonnegative integer.");
    }
  }
  const extensionIds = new Set<string>();
  const extensionRefs = new Set<string>();
  for (const [index, extension] of (parsed.extensions ?? []).entries()) {
    const path = `extensions.${index}`;
    if (!AGENT_ID_PATTERN.test(extension.id)) {
      add(`${path}.id`, "Must use the portable agent-id syntax.");
    }
    if (!PACKAGE_NAME_PATTERN.test(extension.ref)) {
      add(`${path}.ref`, "Must use a canonical lowercase ClawHub package name.");
    }
    if (!EXACT_VERSION_PATTERN.test(extension.version)) {
      add(`${path}.version`, "Must use an exact semantic version.");
    }
    if (extensionIds.has(extension.id)) {
      add(`${path}.id`, "Extension ids must be unique.");
    }
    if (extensionRefs.has(extension.ref.toLowerCase())) {
      add(`${path}.ref`, "Extension package references must be unique.");
    }
    extensionIds.add(extension.id);
    extensionRefs.add(extension.ref.toLowerCase());
  }
  return issues;
}

function parseManifestDocument(
  raw: string,
  manifestPath: string,
): { value: unknown; clawMarkdownBody?: string } | { issues: ClawPackageValidationIssue[] } {
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
      return {
        value: document.toJSON(),
        clawMarkdownBody: markdown.slice(match[0].length),
      };
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
  const hierarchyCollision = findClawPackagePathHierarchyCollision([...fileByPath.keys()]);
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
        "missing_claw_manifest",
        manifestPath,
        "The declared Claw manifest is missing or is not UTF-8 text.",
      ),
    );
    return { ok: false, issues };
  }
  if (new TextEncoder().encode(manifestFile.text).byteLength > MAX_CLAW_MANIFEST_BYTES) {
    return {
      ok: false,
      issues: [
        issue(
          "claw_manifest_too_large",
          manifestPath,
          `The Claw manifest exceeds ${MAX_CLAW_MANIFEST_BYTES} bytes.`,
        ),
      ],
    };
  }
  const parsed = parseManifestDocument(manifestFile.text, manifestPath);
  if ("issues" in parsed) return { ok: false, issues: parsed.issues };
  const validated = validateClawManifest(parsed.value);
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map((entry) =>
        issue("invalid_claw_manifest", entry.path, entry.message),
      ),
    };
  }
  const hasClawMarkdownBody = (parsed.clawMarkdownBody?.trim().length ?? 0) > 0;
  const implicitSoulPath = "SOUL.md";
  const workspaceTargets = [
    ...Object.keys(validated.manifest.workspace?.bootstrapFiles ?? {}),
    ...(validated.manifest.workspace?.files ?? []).map((entry) => entry.path),
  ];
  const hasImplicitSoulConflict =
    workspaceTargets.some((path) => portablePathKey(path) === portablePathKey(implicitSoulPath)) ||
    findClawPackagePathHierarchyCollision([implicitSoulPath, ...workspaceTargets]) !== null;
  if (hasClawMarkdownBody && hasImplicitSoulConflict) {
    issues.push(
      issue(
        "claw_body_soul_conflict",
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

  const profileFiles = [...fileByPath.values()].filter((file) =>
    portablePathKey(file.path).startsWith("profiles/"),
  );
  for (const profileFile of profileFiles) {
    if (!HARNESS_PROFILE_PATH_PATTERN.test(profileFile.path)) {
      issues.push(
        issue(
          "invalid_harness_profile_path",
          profileFile.path,
          "Harness profiles must use profiles/<lowercase-harness-id>.yml conventional paths.",
        ),
      );
      continue;
    }
    if (profileFile.text === undefined) {
      issues.push(
        issue("invalid_harness_profile", profileFile.path, "Harness profiles must be UTF-8 text."),
      );
      continue;
    }
    if (new TextEncoder().encode(profileFile.text).byteLength > MAX_HARNESS_PROFILE_BYTES) {
      const isOpenClawProfile = profileFile.path === "profiles/openclaw.yml";
      issues.push(
        issue(
          isOpenClawProfile ? "openclaw_profile_too_large" : "harness_profile_too_large",
          profileFile.path,
          isOpenClawProfile
            ? `OpenClaw profiles may not exceed ${MAX_HARNESS_PROFILE_BYTES} bytes.`
            : `Harness profiles may not exceed ${MAX_HARNESS_PROFILE_BYTES} bytes.`,
        ),
      );
      continue;
    }
    if (profileFile.path === "profiles/openclaw.yml") {
      const profile = parseJsonCompatibleYaml(profileFile.text, profileFile.path);
      if (profile.issues) issues.push(...profile.issues);
      else issues.push(...validateOpenClawProfile(profile.value, profileFile.path));
    } else {
      const profile = parseGenericHarnessProfile(profileFile.text, profileFile.path);
      if (profile.issues) issues.push(...profile.issues);
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
  const summary = summarizeClawManifest(validated.manifest, {
    clawMarkdownBody: hasClawMarkdownBody,
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
      hasClawMarkdownBody,
    },
  };
}
