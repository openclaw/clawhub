import { ArkErrors, type } from "arktype";
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
const MAX_OPENCLAW_PROFILE_BYTES = 256 * 1024;
const StrictStringArraySchema = type("string[]");
const OpenClawProfileSchema = type({
  "+": "reject",
  schemaVersion: "1",
  agent: {
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
      skipWhenBusy: "boolean?",
      timeoutSeconds: "number?",
    }).optional(),
    humanDelay: type({
      "+": "reject",
      mode: '"off"|"natural"|"custom"?',
      minMs: "number?",
      maxMs: "number?",
    }).optional(),
  },
});

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

  requireNonEmpty("agent.groupChat.mentionPatterns", parsed.agent.groupChat?.mentionPatterns);
  if (parsed.agent.tools?.profile !== undefined && !isStrictNonEmpty(parsed.agent.tools.profile)) {
    add("agent.tools.profile", "Must be non-empty without leading or trailing whitespace.");
  }
  requireNonEmpty("agent.tools.allow", parsed.agent.tools?.allow);
  requireNonEmpty("agent.tools.alsoAllow", parsed.agent.tools?.alsoAllow);
  requireNonEmpty("agent.tools.deny", parsed.agent.tools?.deny);
  if (parsed.agent.tools?.allow && parsed.agent.tools.alsoAllow) {
    add("agent.tools.alsoAllow", "Must not be combined with tools.allow.");
  }
  if (parsed.agent.memory?.search?.sources?.length === 0) {
    add("agent.memory.search.sources", "Must contain at least one source.");
  }
  if (
    parsed.agent.memory?.search?.sources?.includes("sessions") &&
    parsed.agent.memory.search.rememberAcrossConversations !== true
  ) {
    add(
      "agent.memory.search.rememberAcrossConversations",
      "Must be true when memory.search.sources includes sessions.",
    );
  }
  const heartbeat = parsed.agent.heartbeat;
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
    const delay = parsed.agent.humanDelay?.[field];
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) {
      add(`agent.humanDelay.${field}`, "Must be a nonnegative integer.");
    }
  }
  return issues;
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

  const openClawProfilePath = validated.manifest.metadata?.["openclaw.config"];
  if (openClawProfilePath !== undefined) {
    const profileFile = fileByPath.get(openClawProfilePath);
    if (!profileFile || profileFile.text === undefined) {
      issues.push(
        issue(
          "missing_openclaw_profile",
          openClawProfilePath,
          "The declared OpenClaw profile is missing or is not UTF-8 text.",
        ),
      );
    } else if (new TextEncoder().encode(profileFile.text).byteLength > MAX_OPENCLAW_PROFILE_BYTES) {
      issues.push(
        issue(
          "openclaw_profile_too_large",
          openClawProfilePath,
          `The OpenClaw profile exceeds ${MAX_OPENCLAW_PROFILE_BYTES} bytes.`,
        ),
      );
    } else {
      const profile = parseJsonCompatibleYaml(profileFile.text, openClawProfilePath);
      if (profile.issues) {
        issues.push(...profile.issues);
      } else {
        issues.push(...validateOpenClawProfile(profile.value, openClawProfilePath));
      }
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
  return {
    ok: true,
    value: {
      manifestPath,
      manifest: validated.manifest,
      summary: summarizeClawManifest(validated.manifest),
    },
  };
}
