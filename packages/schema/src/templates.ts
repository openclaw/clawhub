import { ArkErrors, type BaseType, type inferred, type } from "arktype";
import { Cron } from "croner";
import { nativeAgentSettingsFields, validateNativeAgentSettings } from "./templateAgent.js";
import { hasPortablePathSegments, portablePathKey } from "./templatePaths.js";

export const TEMPLATE_SCHEMA_VERSION = 1 as const;
export const TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS = 128;
export const TEMPLATE_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS = 1_024;
export const TEMPLATE_DEPENDENCY_INVENTORY_MAX_BYTES = 256 * 1024;
export const TEMPLATE_BOOTSTRAP_FILE_NAMES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

const StringArraySchema = type("string[]");
const WorkspaceSourceSchema = type({ "+": "reject", source: "string" });
const ToolFilterSchema = type({
  "+": "reject",
  include: StringArraySchema.optional(),
  exclude: StringArraySchema.optional(),
});
const StdioMcpServerSchema = type({
  "+": "reject",
  command: "string",
  transport: '"stdio"?',
  args: StringArraySchema.optional(),
  env: type({ "[string]": "string" }).optional(),
  toolFilter: ToolFilterSchema.optional(),
  timeout: "number?",
  connectTimeout: "number?",
});
const RemoteMcpServerSchema = type({
  "+": "reject",
  url: "string",
  transport: '"sse"|"streamable-http"',
  auth: '"oauth"?',
  toolFilter: ToolFilterSchema.optional(),
  timeout: "number?",
  connectTimeout: "number?",
});
const TemplateDependencyDeclarationSchema = type({
  "+": "reject",
  ref: "string",
  version: "string",
}).or(type({ "+": "reject", path: "string" }));

export const TemplateManifestSchema = type({
  "+": "reject",
  schemaVersion: "1",
  agent: {
    "+": "reject",
    ...nativeAgentSettingsFields,
    id: "string",
    name: "string?",
    description: "string?",
    identity: type({
      "+": "reject",
      name: "string?",
      theme: "string?",
      emoji: "string?",
      avatar: "string?",
    }).optional(),
  },
  categories: StringArraySchema.optional(),
  metadata: type({ "[string]": "string" }).optional(),
  workspace: type({
    "+": "reject",
    bootstrapFiles: type({
      "+": "reject",
      "AGENTS.md": WorkspaceSourceSchema.optional(),
      "SOUL.md": WorkspaceSourceSchema.optional(),
      "IDENTITY.md": WorkspaceSourceSchema.optional(),
      "TOOLS.md": WorkspaceSourceSchema.optional(),
      "HEARTBEAT.md": WorkspaceSourceSchema.optional(),
    }).optional(),
    files: type({ "+": "reject", source: "string", path: "string" }).array().optional(),
  }).optional(),
  skills: TemplateDependencyDeclarationSchema.array().optional(),
  plugins: TemplateDependencyDeclarationSchema.array().optional(),
  mcpServers: type({
    "[string]": StdioMcpServerSchema.or(RemoteMcpServerSchema),
  }).optional(),
  automations: type({
    "+": "reject",
    id: "string",
    name: "string?",
    enabled: "boolean?",
    schedule: { "+": "reject", cron: "string", timezone: "string" },
    session: '"main"|"isolated"',
    message: "string",
    delivery: type({
      "+": "reject",
      mode: '"none"|"announce"',
      channel: '"last"?',
    }).optional(),
  })
    .array()
    .optional(),
});
export type TemplateManifest = (typeof TemplateManifestSchema)[inferred];

export type TemplateManifestSummary = {
  schemaVersion: 1;
  agent: { id: string; name?: string; description?: string };
  workspace: { bootstrapFiles: string[]; fileCount: number };
  packages: { skillCount: number; pluginCount: number };
  // Historical immutable release summaries may retain these stored fields. New summaries never emit them.
  profiles?: { count: number; hasOpenClaw: boolean };
  extensions?: { count: number };
  mcpServerCount: number;
  cronJobCount: number;
};

export type TemplateManifestSummarySchemaAdapter<TValue, TOptional = TValue> = {
  literalOne: TValue;
  string: TValue;
  number: TValue;
  boolean: TValue;
  stringArray: TValue;
  boundedString: (maxCharacters: number) => TValue;
  optional: (schema: TValue) => TOptional;
  object: (fields: Record<string, TValue | TOptional>) => TValue;
};

/** Builds the v1 summary structure for both the public schema and durable storage validators. */
export function createTemplateManifestSummarySchema<TValue, TOptional = TValue>(
  adapter: TemplateManifestSummarySchemaAdapter<TValue, TOptional>,
): TValue {
  return adapter.object({
    schemaVersion: adapter.literalOne,
    agent: adapter.object({
      id: adapter.string,
      name: adapter.optional(adapter.boundedString(TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS)),
      description: adapter.optional(
        adapter.boundedString(TEMPLATE_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS),
      ),
    }),
    workspace: adapter.object({
      bootstrapFiles: adapter.stringArray,
      fileCount: adapter.number,
    }),
    packages: adapter.object({
      skillCount: adapter.number,
      pluginCount: adapter.number,
    }),
    profiles: adapter.optional(
      adapter.object({
        count: adapter.number,
        hasOpenClaw: adapter.boolean,
      }),
    ),
    extensions: adapter.optional(
      adapter.object({
        count: adapter.number,
      }),
    ),
    mcpServerCount: adapter.number,
    cronJobCount: adapter.number,
  });
}

export const TemplateManifestSummarySchema = createTemplateManifestSummarySchema<
  BaseType,
  [BaseType, "?"]
>({
  literalOne: type("1"),
  string: type("string"),
  number: type("number"),
  boolean: type("boolean"),
  stringArray: type("string[]"),
  boundedString: (maxCharacters) =>
    type("string").narrow((value) => Array.from(value).length <= maxCharacters),
  optional: (schema) => schema.optional(),
  object: (fields) => type({ "+": "reject", ...fields }),
}) as BaseType<TemplateManifestSummary>;

export const TEMPLATE_MANIFEST_VALIDATION_PHASE = "schema" as const;
export const TEMPLATE_MANIFEST_VALIDATION_CODES = {
  invalidManifestShape: "template_v1_invalid_manifest_shape",
  invalidAgentSettings: "template_v1_invalid_agent_settings",
  invalidAgentId: "template_v1_invalid_agent_id",
  invalidCategory: "template_v1_invalid_category",
  nonCanonicalString: "template_v1_non_canonical_string",
  emptyList: "template_v1_empty_list",
  legacyProfilePointer: "template_v1_legacy_profile_pointer",
  reservedWorkspaceTarget: "template_v1_reserved_workspace_target",
  unsafePath: "template_v1_unsafe_path",
  duplicateWorkspaceDestination: "template_v1_duplicate_workspace_destination",
  invalidAvatar: "template_v1_invalid_avatar",
  undeclaredAvatar: "template_v1_undeclared_avatar",
  invalidPackageReference: "template_v1_invalid_package_reference",
  invalidPackageVersion: "template_v1_invalid_package_version",
  duplicatePackage: "template_v1_duplicate_package",
  invalidMcpServerId: "template_v1_invalid_mcp_server_id",
  invalidMcpUrl: "template_v1_invalid_mcp_url",
  mcpUrlCredentials: "template_v1_mcp_url_credentials",
  unpinnedMcpPackage: "template_v1_unpinned_mcp_package",
  invalidToolFilter: "template_v1_invalid_tool_filter",
  duplicateToolFilter: "template_v1_duplicate_tool_filter",
  invalidEnvironmentKey: "template_v1_invalid_environment_key",
  blockedEnvironmentKey: "template_v1_blocked_environment_key",
  invalidEnvironmentReference: "template_v1_invalid_environment_reference",
  invalidTimeout: "template_v1_invalid_timeout",
  invalidCronJobId: "template_v1_invalid_cron_job_id",
  invalidCronSchedule: "template_v1_invalid_cron_schedule",
  invalidCronDelivery: "template_v1_invalid_cron_delivery",
  duplicateCronJob: "template_v1_duplicate_cron_job",
} as const;
export type TemplateManifestValidationCode =
  (typeof TEMPLATE_MANIFEST_VALIDATION_CODES)[keyof typeof TEMPLATE_MANIFEST_VALIDATION_CODES];
export type TemplateManifestValidationIssue = {
  code: TemplateManifestValidationCode;
  phase: typeof TEMPLATE_MANIFEST_VALIDATION_PHASE;
  path: string;
  message: string;
};

const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
const EXACT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ENV_REFERENCE_PATTERN = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MAX_DATA_URL_CHARS = 2_796_230;
const AVATAR_DATA_URL_PATTERN = /^data:image\/[^,]*,/i;
const AVATAR_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const BASE64_PAYLOAD_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PORTABLE_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Versioned compatibility artifact for the OpenClaw policy applied by the v1 consumer.
export const OPENCLAW_TEMPLATE_HOST_ENV_POLICY_V1 = {
  contractVersion: 1,
  source: {
    repository: "openclaw/openclaw",
    commit: "f021018db951ea3a4bb37c8e5cf902c0e038b647",
    path: "src/infra/host-env-security-policy.json",
    sha256: "6923ab681c0e701381ea5fccebe36b7c6d2bfeadd72cfa08b0d542640d5e9601",
  },
  blockedKeys: [
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_REDIRECT_WARNINGS",
    "NODE_REPL_EXTERNAL_MODULE",
    "NODE_REPL_HISTORY",
    "NODE_V8_COVERAGE",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERL5LIB",
    "PERL5OPT",
    "RUBYLIB",
    "RUBYOPT",
    "BASHOPTS",
    "BASH_ENV",
    "ENV",
    "KSH_ENV",
    "BROWSER",
    "GIT_ALLOW_PROTOCOL",
    "GIT_EDITOR",
    "GIT_EXTERNAL_DIFF",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_EXEC_PATH",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PROTOCOL_FROM_USER",
    "GIT_SEQUENCE_EDITOR",
    "GIT_TEMPLATE_DIR",
    "GIT_SSL_NO_VERIFY",
    "GIT_SSL_CAINFO",
    "GIT_SSL_CAPATH",
    "CC",
    "CPP",
    "CXX",
    "CXXCPP",
    "CARGO_BUILD_RUSTC",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
    "CARGO_BUILD_RUSTDOC",
    "RUSTC",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "RUSTDOC",
    "CMAKE_C_COMPILER",
    "CMAKE_CXX_COMPILER",
    "SHELL",
    "SHELLOPTS",
    "PS4",
    "GCONV_PATH",
    "IFS",
    "SSLKEYLOGFILE",
    "JAVA_OPTS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "PYTHONBREAKPOINT",
    "DOTNET_STARTUP_HOOKS",
    "DOTNET_ADDITIONAL_DEPS",
    "FPATH",
    "GLIBC_TUNABLES",
    "MAVEN_OPTS",
    "MAKE",
    "MAKEFLAGS",
    "MFLAGS",
    "SBT_OPTS",
    "GRADLE_OPTS",
    "ANT_OPTS",
    "HGRCPATH",
    "HGEDITOR",
    "HGMERGE",
    "EXINIT",
    "VIMINIT",
    "MYVIMRC",
    "GVIMINIT",
    "LUA_INIT",
    "LUA_INIT_5_1",
    "LUA_INIT_5_2",
    "LUA_INIT_5_3",
    "LUA_INIT_5_4",
    "EMACSLOADPATH",
    "RUBYSHELL",
    "GIT_HOOK_PATH",
    "SVN_EDITOR",
    "SVN_SSH",
    "BZR_EDITOR",
    "BZR_SSH",
    "BZR_PLUGIN_PATH",
    "SUDO_ASKPASS",
    "JULIA_EDITOR",
    "CONFIG_SITE",
    "CONFIG_SHELL",
    "CMAKE_TOOLCHAIN_FILE",
    "CATALINA_OPTS",
    "CORECLR_PROFILER",
    "HELM_PLUGINS",
    "PACKER_PLUGIN_PATH",
    "VAGRANT_VAGRANTFILE",
    "ERL_AFLAGS",
    "ERL_FLAGS",
    "ERL_ZFLAGS",
    "ELIXIR_ERL_OPTIONS",
    "R_ENVIRON",
    "R_PROFILE",
    "R_ENVIRON_USER",
    "R_PROFILE_USER",
    "TCLLIBPATH",
    "HOSTALIASES",
  ],
  blockedPrefixes: ["DYLD_", "LD_", "BASH_FUNC_"],
} as const;

const BLOCKED_PROCESS_ENV_KEYS = new Set<string>(OPENCLAW_TEMPLATE_HOST_ENV_POLICY_V1.blockedKeys);
const BLOCKED_PROCESS_ENV_PREFIXES = OPENCLAW_TEMPLATE_HOST_ENV_POLICY_V1.blockedPrefixes;

function isStrictNonEmpty(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function isBlockedProcessEnvKey(value: string): boolean {
  const upper = value.toUpperCase();
  return (
    BLOCKED_PROCESS_ENV_KEYS.has(upper) ||
    BLOCKED_PROCESS_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

function isSafePackagePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (
    !isStrictNonEmpty(normalized) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return false;
  }
  return hasPortablePathSegments(normalized);
}

function isPortableAvatar(value: string): boolean {
  if (AVATAR_DATA_URL_PATTERN.test(value)) {
    if (value.length > AVATAR_MAX_DATA_URL_CHARS) return false;
    const comma = value.indexOf(",");
    if (comma < 0) return false;
    const metadata = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    try {
      const base64 = /;base64(?:;|$)/i.test(metadata);
      if (payload.length === 0 || (base64 && !BASE64_PAYLOAD_PATTERN.test(payload))) return false;
      const byteLength = base64
        ? (payload.length / 4) * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0)
        : new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
      return byteLength > 0 && byteLength <= AVATAR_MAX_BYTES;
    } catch {
      return false;
    }
  }
  return isSafePackagePath(value) && AVATAR_EXTENSION_PATTERN.test(value);
}

function conflictsWithWorkspaceTarget(targets: Set<string>, candidate: string): boolean {
  for (const target of targets) {
    if (
      target === candidate ||
      target.startsWith(`${candidate}/`) ||
      candidate.startsWith(`${target}/`)
    ) {
      return true;
    }
  }
  return false;
}

function packageManagerArtifacts(command: string, args: string[]): string[] | undefined {
  const executable = command
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(?:cmd|exe)$/i, "")
    .toLowerCase();
  let start = 0;
  let scansOptionsAfterPositional = false;
  if (executable === "npm") {
    if (args[0] !== "exec" && args[0] !== "x") return undefined;
    start = 1;
    scansOptionsAfterPositional = true;
  } else if (executable === "bun") {
    if (args[0] !== "x") return undefined;
    start = 1;
  } else if (executable === "pnpm" || executable === "yarn") {
    if (args[0] !== "dlx") return undefined;
    start = 1;
  } else if (executable !== "npx" && executable !== "pnpx" && executable !== "bunx") {
    return undefined;
  }
  const selected: string[] = [];
  let positional: string | undefined;
  for (let index = start; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value === "--") {
      positional ??= args[index + 1] ?? "";
      break;
    }
    if (value === "-p" || value === "--package") {
      selected.push(args[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (value.startsWith("--package=")) {
      selected.push(value.slice("--package=".length));
      continue;
    }
    if (value === "-y" || value === "--yes") continue;
    if (value.startsWith("-")) return [""];
    if (positional === undefined && !value.startsWith("-")) {
      positional = value;
      if (!scansOptionsAfterPositional) break;
    }
  }
  return selected.length > 0 ? selected : [positional ?? ""];
}

function truncateSummaryText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  return Array.from(value).slice(0, maxChars).join("");
}

function isPackageManagerArtifactPinned(command: string, args: string[]): boolean | undefined {
  const artifacts = packageManagerArtifacts(command, args);
  if (artifacts === undefined) return undefined;
  return artifacts.every((artifact) => {
    const separator = artifact.lastIndexOf("@");
    const scopedSlash = artifact.startsWith("@") ? artifact.indexOf("/") : -1;
    return (
      separator > 0 &&
      separator > scopedSlash &&
      EXACT_VERSION_PATTERN.test(artifact.slice(separator + 1))
    );
  });
}

function validationIssue(
  code: TemplateManifestValidationCode,
  path: string,
  message: string,
): TemplateManifestValidationIssue {
  return { code, phase: TEMPLATE_MANIFEST_VALIDATION_PHASE, path, message };
}

function arkIssues(errors: ArkErrors): TemplateManifestValidationIssue[] {
  return Array.from(errors, (error) =>
    validationIssue(
      TEMPLATE_MANIFEST_VALIDATION_CODES.invalidManifestShape,
      error.path.length > 0 ? `$.${error.path.join(".")}` : "$",
      error.description ?? "Manifest must match the strict Template v1 shape.",
    ),
  );
}

function pushNonEmpty(
  issues: TemplateManifestValidationIssue[],
  path: string,
  value: string | undefined,
): void {
  if (value !== undefined && !isStrictNonEmpty(value)) {
    issues.push(
      validationIssue(
        TEMPLATE_MANIFEST_VALIDATION_CODES.nonCanonicalString,
        path,
        "Must be non-empty without leading or trailing whitespace.",
      ),
    );
  }
}

function pushNonEmptyArray(
  issues: TemplateManifestValidationIssue[],
  path: string,
  values: string[] | undefined,
  requireEntry: boolean,
): void {
  if (requireEntry && values !== undefined && values.length === 0) {
    issues.push(
      validationIssue(
        TEMPLATE_MANIFEST_VALIDATION_CODES.emptyList,
        path,
        "Must contain at least one value.",
      ),
    );
  }
  for (const [index, value] of (values ?? []).entries()) {
    pushNonEmpty(issues, `${path}.${index}`, value);
  }
}

export function validateTemplateManifest(
  value: unknown,
):
  | { ok: true; manifest: TemplateManifest }
  | { ok: false; issues: TemplateManifestValidationIssue[] } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const key of ["packages", "profiles", "extensions", "cronJobs"]) {
      if (Object.hasOwn(value, key))
        return {
          ok: false,
          issues: [
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.invalidManifestShape,
              `$.${key}`,
              "Retired Template field. Use agent for native settings, skills/plugins for exact ClawHub dependencies, and automations for scheduled work in CLAW.md.",
            ),
          ],
        };
    }
  }
  const parsed = TemplateManifestSchema(value);
  if (parsed instanceof ArkErrors) return { ok: false, issues: arkIssues(parsed) };

  const issues: TemplateManifestValidationIssue[] = validateNativeAgentSettings(parsed.agent).map(
    (entry) =>
      validationIssue(
        TEMPLATE_MANIFEST_VALIDATION_CODES.invalidAgentSettings,
        entry.path,
        entry.message,
      ),
  );
  if (!AGENT_ID_PATTERN.test(parsed.agent.id)) {
    issues.push(
      validationIssue(
        TEMPLATE_MANIFEST_VALIDATION_CODES.invalidAgentId,
        "$.agent.id",
        "Invalid portable agent id.",
      ),
    );
  }
  if (parsed.categories !== undefined) {
    if (parsed.categories.length < 1 || parsed.categories.length > 3) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidCategory,
          "$.categories",
          "Declare between one and three categories.",
        ),
      );
    }
    const seenCategories = new Set<string>();
    for (const [index, category] of parsed.categories.entries()) {
      if (!CATEGORY_SLUG_PATTERN.test(category) || seenCategories.has(category)) {
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.invalidCategory,
            `$.categories.${index}`,
            "Categories must be unique lowercase slugs.",
          ),
        );
      }
      seenCategories.add(category);
    }
  }
  pushNonEmpty(issues, "$.agent.name", parsed.agent.name);
  pushNonEmpty(issues, "$.agent.description", parsed.agent.description);
  for (const field of ["name", "theme", "emoji", "avatar"] as const) {
    pushNonEmpty(issues, `$.agent.identity.${field}`, parsed.agent.identity?.[field]);
  }
  for (const key of Object.keys(parsed.metadata ?? {})) {
    pushNonEmpty(issues, `$.metadata.${key}`, key);
  }
  if (Object.hasOwn(parsed.metadata ?? {}, "openclaw.config")) {
    issues.push(
      validationIssue(
        TEMPLATE_MANIFEST_VALIDATION_CODES.legacyProfilePointer,
        "$.metadata.openclaw.config",
        "metadata.openclaw.config is no longer supported; move native settings into CLAW.md agent and remove the metadata entry.",
      ),
    );
  }
  const workspaceTargets = new Set<string>();
  for (const name of TEMPLATE_BOOTSTRAP_FILE_NAMES) {
    const source = parsed.workspace?.bootstrapFiles?.[name]?.source;
    if (source === undefined) continue;
    if (!isSafePackagePath(source)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.unsafePath,
          `$.workspace.bootstrapFiles.${name}.source`,
          "Must be a safe package-relative path.",
        ),
      );
    }
    workspaceTargets.add(portablePathKey(name));
  }
  for (const [index, file] of (parsed.workspace?.files ?? []).entries()) {
    if (!isSafePackagePath(file.source)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.unsafePath,
          `$.workspace.files.${index}.source`,
          "Must be a safe package-relative path.",
        ),
      );
    }
    if (!isSafePackagePath(file.path)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.unsafePath,
          `$.workspace.files.${index}.path`,
          "Must be a safe package-relative path.",
        ),
      );
    }
    const destinationKey = portablePathKey(file.path);
    if (destinationKey === portablePathKey("BOOTSTRAP.md")) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.reservedWorkspaceTarget,
          `$.workspace.files.${index}.path`,
          "Root BOOTSTRAP.md is reserved for the package-root seed-once bootstrap file.",
        ),
      );
    }
    if (conflictsWithWorkspaceTarget(workspaceTargets, destinationKey)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.duplicateWorkspaceDestination,
          `$.workspace.files.${index}.path`,
          "Workspace destination is declared more than once.",
        ),
      );
    }
    workspaceTargets.add(destinationKey);
  }
  const avatar = parsed.agent.identity?.avatar;
  if (avatar !== undefined) {
    if (!isPortableAvatar(avatar)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidAvatar,
          "$.agent.identity.avatar",
          "Must be a bounded image data URL or managed workspace-relative image path.",
        ),
      );
    } else if (
      !AVATAR_DATA_URL_PATTERN.test(avatar) &&
      !workspaceTargets.has(portablePathKey(avatar))
    ) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.undeclaredAvatar,
          "$.agent.identity.avatar",
          "Workspace-relative avatar must match a workspace.files destination.",
        ),
      );
    }
  }

  const bundledPaths = new Set<string>();
  for (const kind of ["skills", "plugins"] as const) {
    const references = new Set<string>();
    for (const [index, entry] of (parsed[kind] ?? []).entries()) {
      if ("path" in entry) {
        const key = portablePathKey(entry.path);
        if (
          !isSafePackagePath(entry.path) ||
          key.split("/").some((part) => part === ".git" || part === "node_modules")
        ) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.unsafePath,
              `$.${kind}.${index}.path`,
              "Bundled dependency must name a safe package-relative directory.",
            ),
          );
        }
        if (conflictsWithWorkspaceTarget(bundledPaths, key)) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.duplicatePackage,
              `$.${kind}.${index}.path`,
              "Bundled dependency directories must not overlap.",
            ),
          );
        }
        bundledPaths.add(key);
        continue;
      }
      if (!PACKAGE_NAME_PATTERN.test(entry.ref))
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.invalidPackageReference,
            `$.${kind}.${index}.ref`,
            "Must be a lowercase ClawHub package name.",
          ),
        );
      if (!EXACT_VERSION_PATTERN.test(entry.version))
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.invalidPackageVersion,
            `$.${kind}.${index}.version`,
            "Must be an exact semantic version.",
          ),
        );
      if (references.has(entry.ref))
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.duplicatePackage,
            `$.${kind}.${index}`,
            "Dependency is declared more than once.",
          ),
        );
      references.add(entry.ref);
    }
  }

  for (const [name, server] of Object.entries(parsed.mcpServers ?? {})) {
    if (!AGENT_ID_PATTERN.test(name)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidMcpServerId,
          `$.mcpServers.${name}`,
          "Invalid MCP server name.",
        ),
      );
    }
    if ("url" in server) {
      pushNonEmpty(issues, `$.mcpServers.${name}.url`, server.url);
      try {
        const url = new URL(server.url);
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
          throw new Error("protocol");
        }
        if (url.username || url.password || url.hash) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.mcpUrlCredentials,
              `$.mcpServers.${name}.url`,
              "Must not contain embedded credentials or fragments.",
            ),
          );
        }
      } catch {
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.invalidMcpUrl,
            `$.mcpServers.${name}.url`,
            "Must use HTTPS, except HTTP on an exact loopback host.",
          ),
        );
      }
    }
    if ("command" in server) {
      pushNonEmpty(issues, `$.mcpServers.${name}.command`, server.command);
      pushNonEmptyArray(issues, `$.mcpServers.${name}.args`, server.args, false);
      if (isPackageManagerArtifactPinned(server.command, server.args ?? []) === false) {
        issues.push(
          validationIssue(
            TEMPLATE_MANIFEST_VALIDATION_CODES.unpinnedMcpPackage,
            `$.mcpServers.${name}.args`,
            "Package-manager MCP commands must select one exact immutable package version.",
          ),
        );
      }
    }
    pushNonEmptyArray(
      issues,
      `$.mcpServers.${name}.toolFilter.include`,
      server.toolFilter?.include,
      true,
    );
    pushNonEmptyArray(
      issues,
      `$.mcpServers.${name}.toolFilter.exclude`,
      server.toolFilter?.exclude,
      true,
    );
    for (const field of ["include", "exclude"] as const) {
      const seen = new Set<string>();
      for (const [index, entry] of (server.toolFilter?.[field] ?? []).entries()) {
        if (entry.includes("?") || entry.includes("[") || entry.includes("]")) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.invalidToolFilter,
              `$.mcpServers.${name}.toolFilter.${field}.${index}`,
              "Tool filters support only exact names and * wildcards.",
            ),
          );
        }
        if (seen.has(entry)) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.duplicateToolFilter,
              `$.mcpServers.${name}.toolFilter.${field}.${index}`,
              "Tool filter entries must be unique.",
            ),
          );
        }
        seen.add(entry);
      }
    }
    if ("env" in server) {
      for (const [key, envValue] of Object.entries(server.env ?? {})) {
        pushNonEmpty(issues, `$.mcpServers.${name}.env`, key);
        if (!PORTABLE_ENV_KEY_PATTERN.test(key)) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.invalidEnvironmentKey,
              `$.mcpServers.${name}.env.${key}`,
              "Invalid portable environment key.",
            ),
          );
        }
        if (isBlockedProcessEnvKey(key)) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.blockedEnvironmentKey,
              `$.mcpServers.${name}.env.${key}`,
              "Environment key is blocked by the spawned-process safety policy.",
            ),
          );
        }
        if (!ENV_REFERENCE_PATTERN.test(envValue)) {
          issues.push(
            validationIssue(
              TEMPLATE_MANIFEST_VALIDATION_CODES.invalidEnvironmentReference,
              `$.mcpServers.${name}.env.${key}`,
              "Must be an unresolved ${ENV_VAR} reference.",
            ),
          );
        }
      }
    }
    if (server.timeout !== undefined && (!Number.isFinite(server.timeout) || server.timeout <= 0)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidTimeout,
          `$.mcpServers.${name}.timeout`,
          "Must be positive.",
        ),
      );
    }
    if (
      server.connectTimeout !== undefined &&
      (!Number.isFinite(server.connectTimeout) || server.connectTimeout <= 0)
    ) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidTimeout,
          `$.mcpServers.${name}.connectTimeout`,
          "Must be positive.",
        ),
      );
    }
  }

  const cronIds = new Set<string>();
  for (const [index, job] of (parsed.automations ?? []).entries()) {
    if (!AGENT_ID_PATTERN.test(job.id)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidCronJobId,
          `$.automations.${index}.id`,
          "Invalid cron job id.",
        ),
      );
    }
    pushNonEmpty(issues, `$.automations.${index}.name`, job.name);
    pushNonEmpty(issues, `$.automations.${index}.schedule.cron`, job.schedule.cron);
    pushNonEmpty(issues, `$.automations.${index}.schedule.timezone`, job.schedule.timezone);
    pushNonEmpty(issues, `$.automations.${index}.message`, job.message);
    try {
      if (job.schedule.cron.trim().split(/\s+/).length !== 5) throw new Error("fields");
      const cron = new Cron(job.schedule.cron.trim(), {
        timezone: job.schedule.timezone.trim(),
        catch: false,
        paused: true,
      });
      if (!cron.nextRun(new Date())) throw new Error("No future run");
    } catch {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidCronSchedule,
          `$.automations.${index}.schedule`,
          "Must contain a valid cron expression and timezone.",
        ),
      );
    }
    if (
      (job.delivery?.mode === "none" && job.delivery.channel !== undefined) ||
      (job.delivery?.mode === "announce" && job.delivery.channel !== "last")
    ) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.invalidCronDelivery,
          `$.automations.${index}.delivery`,
          'Must be { mode: "none" } or { mode: "announce", channel: "last" }.',
        ),
      );
    }
    if (cronIds.has(job.id)) {
      issues.push(
        validationIssue(
          TEMPLATE_MANIFEST_VALIDATION_CODES.duplicateCronJob,
          `$.automations.${index}.id`,
          "Cron job id is declared more than once.",
        ),
      );
    }
    cronIds.add(job.id);
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, manifest: parsed };
}

export function summarizeTemplateManifest(
  manifest: TemplateManifest,
  options: { templateMarkdownBody?: boolean } = {},
): TemplateManifestSummary {
  const packages = templateDependencyInventory(manifest);
  const agentName = truncateSummaryText(manifest.agent.name, TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS);
  const agentDescription = truncateSummaryText(
    manifest.agent.description,
    TEMPLATE_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS,
  );
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    agent: {
      id: manifest.agent.id,
      ...(agentName ? { name: agentName } : {}),
      ...(agentDescription ? { description: agentDescription } : {}),
    },
    workspace: {
      bootstrapFiles: TEMPLATE_BOOTSTRAP_FILE_NAMES.filter(
        (name) =>
          manifest.workspace?.bootstrapFiles?.[name] !== undefined ||
          (name === "SOUL.md" && options.templateMarkdownBody === true),
      ),
      fileCount: manifest.workspace?.files?.length ?? 0,
    },
    packages: {
      skillCount: packages.filter((pkg) => pkg.kind === "skill").length,
      pluginCount: packages.filter((pkg) => pkg.kind === "plugin").length,
    },
    mcpServerCount: Object.keys(manifest.mcpServers ?? {}).length,
    cronJobCount: manifest.automations?.length ?? 0,
  };
}

/** The sole dependency projection used by validation, summaries and detail consumers. */
export function templateDependencyInventory(
  manifest: TemplateManifest,
  bundledSources: ReadonlyArray<{ kind: "skill" | "plugin"; path: string; name?: string }> = [],
): TemplateDependencyInventory {
  return (["skills", "plugins"] as const).flatMap((collection) =>
    (manifest[collection] ?? []).map((entry): TemplateDependencyInventory[number] => {
      const kind = collection === "skills" ? "skill" : "plugin";
      if ("path" in entry) {
        const name = truncateSummaryText(
          bundledSources.find((source) => source.kind === kind && source.path === entry.path)?.name,
          TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS,
        );
        return { kind, source: "bundled", path: entry.path, ...(name ? { name } : {}) };
      }
      return { kind, source: "clawhub", ref: entry.ref, version: entry.version };
    }),
  );
}
export const TemplateDependencyInventorySchema = type({
  "+": "reject",
  kind: '"skill"|"plugin"',
  source: '"clawhub"',
  ref: "string",
  version: "string",
})
  .or(
    type({
      "+": "reject",
      kind: '"skill"|"plugin"',
      source: '"bundled"',
      path: "string",
      name: "string?",
    }),
  )
  .array();
export type TemplateDependencyInventory = (typeof TemplateDependencyInventorySchema)[inferred];
