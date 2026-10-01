import { ArkErrors, type } from "arktype";
import { caseFold } from "unicode-case-folding";
import { isScalar, parseDocument, visit } from "yaml";
import { summarizeClawManifest, validateClawManifest, } from "./claws.js";
const EXACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;
const MAX_CLAW_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const MAX_HARNESS_PROFILE_BYTES = 256 * 1024;
const HARNESS_PROFILE_PATH_PATTERN = /^profiles\/[a-z][a-z0-9_-]{0,63}\.yml$/;
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const CONCRETE_MCP_TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*__[A-Za-z][A-Za-z0-9_-]*$/;
export const OPENCLAW_CLAW_PROFILE_POLICY_V1 = {
    contractVersion: 1,
    source: {
        repository: "openclaw/openclaw",
        commit: "f8c0e1b8325b1fc36e039cf357a2c4602f76d5aa",
        path: "src/claws/schema.ts",
    },
    profiles: ["minimal", "coding", "messaging", "full"],
};
const OPENCLAW_PROFILE_TOOL_ALLOW = {
    minimal: new Set(["session_status"]),
    coding: new Set([
        "read",
        "write",
        "edit",
        "apply_patch",
        "exec",
        "process",
        "code_execution",
        "web_search",
        "web_fetch",
        "x_search",
        "memory_search",
        "memory_get",
        "sessions",
        "sessions_list",
        "sessions_history",
        "sessions_search",
        "conversations_list",
        "conversations_send",
        "conversations_turn",
        "sessions_send",
        "sessions_spawn",
        "agents_wait",
        "sessions_yield",
        "subagents",
        "session_status",
        "suggest_task",
        "dismiss_task",
        "screen",
        "dashboard",
        "terminal",
        "get_goal",
        "create_goal",
        "update_goal",
        "update_plan",
        "ask_user",
        "skill_workshop",
        "image",
        "image_generate",
        "music_generate",
        "video_generate",
    ]),
    messaging: new Set([
        "sessions",
        "sessions_list",
        "sessions_history",
        "sessions_search",
        "conversations_list",
        "conversations_send",
        "conversations_turn",
        "sessions_send",
        "sessions_spawn",
        "sessions_yield",
        "subagents",
        "session_status",
        "message",
        "ask_user",
    ]),
    full: null,
};
const OPENCLAW_STATIC_TOOL_GROUPS = {
    "group:openclaw": new Set([
        "code_execution",
        "web_search",
        "web_fetch",
        "x_search",
        "memory_search",
        "memory_get",
        "sessions",
        "sessions_list",
        "sessions_history",
        "sessions_search",
        "conversations_list",
        "conversations_send",
        "conversations_turn",
        "sessions_send",
        "sessions_spawn",
        "agents_wait",
        "sessions_yield",
        "subagents",
        "session_status",
        "suggest_task",
        "dismiss_task",
        "browser",
        "screen",
        "dashboard",
        "terminal",
        "show_widget",
        "message",
        "heartbeat_respond",
        "automations",
        "gateway",
        "nodes",
        "computer",
        "mobile_ui",
        "agents_list",
        "get_goal",
        "create_goal",
        "update_goal",
        "update_plan",
        "ask_user",
        "skill_workshop",
        "image",
        "image_generate",
        "music_generate",
        "video_generate",
        "tts",
    ]),
    "group:fs": new Set(["read", "write", "edit", "apply_patch"]),
    "group:runtime": new Set(["exec", "process", "code_execution"]),
    "group:web": new Set(["web_search", "web_fetch", "x_search"]),
    "group:memory": new Set(["memory_search", "memory_get"]),
    "group:sessions": new Set([
        "sessions",
        "sessions_list",
        "sessions_history",
        "sessions_search",
        "conversations_list",
        "conversations_send",
        "conversations_turn",
        "sessions_send",
        "sessions_spawn",
        "agents_wait",
        "sessions_yield",
        "subagents",
        "session_status",
        "suggest_task",
        "dismiss_task",
    ]),
    "group:ui": new Set(["browser", "screen", "dashboard", "terminal", "canvas", "show_widget"]),
    "group:messaging": new Set(["message"]),
    "group:automation": new Set(["heartbeat_respond", "automations", "gateway"]),
    "group:nodes": new Set(["nodes", "computer", "mobile_ui"]),
    "group:agents": new Set([
        "agents_list",
        "get_goal",
        "create_goal",
        "update_goal",
        "update_plan",
        "ask_user",
        "skill_workshop",
    ]),
    "group:media": new Set(["image", "image_generate", "music_generate", "video_generate", "tts"]),
};
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
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isJsonCompatibleValue(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJsonCompatibleValue);
    if (isRecord(value))
        return Object.values(value).every(isJsonCompatibleValue);
    return false;
}
export function isSafeClawPackagePath(value) {
    const normalized = value.replaceAll("\\", "/");
    if (!normalized ||
        normalized !== value ||
        normalized !== normalized.trim() ||
        normalized.startsWith("/") ||
        /^[A-Za-z]:\//.test(normalized)) {
        return false;
    }
    return normalized
        .split("/")
        .every((segment) => segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !WINDOWS_INVALID_PATH_CHARS.test(segment) &&
        !UNICODE_CONTROL_CHARACTER.test(segment) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment));
}
function portablePathKey(value) {
    return caseFold(value.replaceAll("\\", "/").normalize("NFC"));
}
export function findClawPackagePathHierarchyCollision(paths) {
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
function issue(code, path, message) {
    return { code, path, message };
}
function parseJsonCompatibleYaml(raw, path) {
    const document = parseDocument(raw.startsWith("\uFEFF") ? raw.slice(1) : raw, {
        prettyErrors: false,
        uniqueKeys: true,
    });
    if (document.errors.length > 0) {
        return {
            issues: document.errors.map((error) => issue("invalid_openclaw_profile", path, error.message)),
        };
    }
    let unsupportedFeature;
    visit(document, {
        Alias() {
            unsupportedFeature ??= "aliases";
        },
        Node(_key, node) {
            if (node.anchor) {
                unsupportedFeature ??= "anchors";
            }
            else if (node.tag) {
                unsupportedFeature ??= "explicit tags";
            }
        },
        Pair(_key, pair) {
            if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
                unsupportedFeature ??= "non-string mapping keys";
            }
            else if (pair.key.value === "<<") {
                unsupportedFeature ??= "merge keys";
            }
        },
    });
    if (unsupportedFeature) {
        return {
            issues: [
                issue("unsupported_openclaw_profile_yaml_feature", path, `${path} uses ${unsupportedFeature}; OpenClaw profile YAML must map directly to JSON data.`),
            ],
        };
    }
    try {
        return { value: document.toJSON() };
    }
    catch (error) {
        return {
            issues: [
                issue("invalid_openclaw_profile", path, error instanceof Error ? error.message : "Could not parse OpenClaw profile."),
            ],
        };
    }
}
function parseGenericHarnessProfile(raw, path) {
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
                issue("invalid_harness_profile", path, "Harness profiles must be JSON-compatible YAML mappings."),
            ],
        };
    }
    return parsed;
}
function isStrictNonEmpty(value) {
    return value.length > 0 && value === value.trim();
}
function normalizeOpenClawToolGrant(value) {
    const normalized = value.toLowerCase();
    if (normalized === "bash")
        return "exec";
    if (normalized === "apply-patch")
        return "apply_patch";
    if (normalized === "cron")
        return "automations";
    return normalized;
}
function isBoundedOpenClawToolGrant(value) {
    if (!isStrictNonEmpty(value))
        return false;
    const normalized = normalizeOpenClawToolGrant(value);
    if (/[*?[\]{}]/u.test(normalized) ||
        normalized === "bundle-mcp" ||
        normalized === "group:plugins") {
        return false;
    }
    if (normalized.startsWith("group:")) {
        return Object.hasOwn(OPENCLAW_STATIC_TOOL_GROUPS, normalized);
    }
    return !normalized.includes("__") || isConcreteOpenClawMcpToolName(value);
}
function isConcreteOpenClawMcpToolName(value) {
    return value.length <= 64 && CONCRETE_MCP_TOOL_PATTERN.test(value);
}
function isOpenClawBuiltinProfile(value) {
    return Object.hasOwn(OPENCLAW_PROFILE_TOOL_ALLOW, value);
}
function toolGrantOverlapsProfile(value, profile) {
    if (profile === "full")
        return true;
    const normalized = normalizeOpenClawToolGrant(value);
    const group = OPENCLAW_STATIC_TOOL_GROUPS[normalized];
    return (OPENCLAW_PROFILE_TOOL_ALLOW[profile].has(normalized) ||
        (group !== undefined &&
            Array.from(group).some((tool) => OPENCLAW_PROFILE_TOOL_ALLOW[profile].has(tool))) ||
        ((profile === "coding" || profile === "messaging") && isConcreteOpenClawMcpToolName(value)));
}
function isValidDuration(value) {
    if (!isStrictNonEmpty(value))
        return false;
    const multipliers = {
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
        if (match.index !== consumed)
            return false;
        totalMs += Number(match[1]) * multipliers[match[2]];
        consumed += match[0].length;
    }
    return (consumed === normalized.length && consumed > 0 && Number.isSafeInteger(Math.round(totalMs)));
}
function validateOpenClawProfile(value, profilePath, profilePolicy) {
    const parsed = OpenClawProfileSchema(value);
    if (parsed instanceof ArkErrors) {
        return {
            issues: Array.from(parsed, (error) => issue("invalid_openclaw_profile", `${profilePath}${error.path.length > 0 ? `.${error.path.join(".")}` : ""}`, error.description ?? "Invalid value.")),
            extensionCount: 0,
        };
    }
    const issues = [];
    const add = (path, message) => issues.push(issue("invalid_openclaw_profile", `${profilePath}.${path}`, message));
    const requireNonEmpty = (path, values) => {
        if (values !== undefined && values.length === 0)
            add(path, "Must contain at least one value.");
        for (const [index, entry] of (values ?? []).entries()) {
            if (!isStrictNonEmpty(entry)) {
                add(`${path}.${index}`, "Must be non-empty without leading or trailing whitespace.");
            }
        }
    };
    requireNonEmpty("agent.groupChat.mentionPatterns", parsed.agent?.groupChat?.mentionPatterns);
    const tools = parsed.agent?.tools;
    const profile = tools?.profile;
    if (profile !== undefined && !isStrictNonEmpty(profile)) {
        add("agent.tools.profile", "Must be non-empty without leading or trailing whitespace.");
    }
    else if (profilePolicy === "current" &&
        profile !== undefined &&
        !isOpenClawBuiltinProfile(profile)) {
        add("agent.tools.profile", "Must name a registered OpenClaw built-in profile.");
    }
    requireNonEmpty("agent.tools.allow", parsed.agent?.tools?.allow);
    requireNonEmpty("agent.tools.alsoAllow", parsed.agent?.tools?.alsoAllow);
    requireNonEmpty("agent.tools.deny", parsed.agent?.tools?.deny);
    if (profilePolicy === "current") {
        for (const field of ["allow", "alsoAllow"]) {
            for (const [index, grant] of (tools?.[field] ?? []).entries()) {
                if (!isBoundedOpenClawToolGrant(grant)) {
                    add(`agent.tools.${field}.${index}`, "Tool grants must be bounded concrete names.");
                }
            }
        }
    }
    if (profilePolicy === "current" && tools?.alsoAllow && !profile) {
        add("agent.tools.alsoAllow", "May be set only when a built-in profile is selected.");
    }
    if (tools?.allow && tools.alsoAllow) {
        add("agent.tools.alsoAllow", "Must not be combined with tools.allow.");
    }
    if (profilePolicy === "current" && profile && isOpenClawBuiltinProfile(profile)) {
        if (profile === "full" && !tools?.allow) {
            add("agent.tools.profile", "The full profile requires a bounded explicit allowlist.");
        }
        if ((profile === "coding" || profile === "messaging") && !tools?.allow) {
            add("agent.tools.allow", "Profiles containing bundle MCP tools require a bounded explicit allowlist.");
        }
        for (const [index, grant] of (tools?.allow ?? []).entries()) {
            if (isBoundedOpenClawToolGrant(grant) && !toolGrantOverlapsProfile(grant, profile)) {
                add(`agent.tools.allow.${index}`, "Must overlap the selected built-in profile.");
            }
        }
    }
    if (parsed.agent?.memory?.search?.sources?.length === 0) {
        add("agent.memory.search.sources", "Must contain at least one source.");
    }
    if (parsed.agent?.memory?.search?.sources?.includes("sessions") &&
        parsed.agent?.memory.search.rememberAcrossConversations !== true) {
        add("agent.memory.search.rememberAcrossConversations", "Must be true when memory.search.sources includes sessions.");
    }
    const heartbeat = parsed.agent?.heartbeat;
    if (heartbeat?.every !== undefined && !isValidDuration(heartbeat.every)) {
        add("agent.heartbeat.every", "Must be a valid duration.");
    }
    const activeHours = heartbeat?.activeHours;
    if (activeHours?.start !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(activeHours.start)) {
        add("agent.heartbeat.activeHours.start", "Must be a valid 24-hour start time.");
    }
    if (activeHours?.end !== undefined &&
        !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(activeHours.end)) {
        add("agent.heartbeat.activeHours.end", "Must be a valid 24-hour end time.");
    }
    if (activeHours?.timezone !== undefined) {
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: activeHours.timezone }).format();
        }
        catch {
            add("agent.heartbeat.activeHours.timezone", "Must be a valid IANA timezone.");
        }
    }
    if (heartbeat?.timeoutSeconds !== undefined &&
        (!Number.isInteger(heartbeat.timeoutSeconds) || heartbeat.timeoutSeconds <= 0)) {
        add("agent.heartbeat.timeoutSeconds", "Must be a positive integer.");
    }
    for (const field of ["minMs", "maxMs"]) {
        const delay = parsed.agent?.humanDelay?.[field];
        if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) {
            add(`agent.humanDelay.${field}`, "Must be a nonnegative integer.");
        }
    }
    const extensionIds = new Set();
    const extensionRefs = new Set();
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
    return { issues, extensionCount: parsed.extensions?.length ?? 0 };
}
function parseManifestDocument(raw, manifestPath) {
    const filename = manifestPath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
    if (filename === "claw.md") {
        const markdown = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
        const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match) {
            return {
                issues: [
                    issue("missing_claw_frontmatter", manifestPath, `${manifestPath} must start with YAML frontmatter delimited by --- lines.`),
                ],
            };
        }
        const document = parseDocument(match[1], { prettyErrors: false, uniqueKeys: true });
        if (document.errors.length > 0) {
            return {
                issues: document.errors.map((error) => issue("invalid_claw_frontmatter", manifestPath, error.message)),
            };
        }
        let unsupportedFeature;
        visit(document, {
            Alias() {
                unsupportedFeature ??= "aliases";
            },
            Node(_key, node) {
                if (node.anchor) {
                    unsupportedFeature ??= "anchors";
                }
                else if (node.tag) {
                    unsupportedFeature ??= "explicit tags";
                }
            },
            Pair(_key, pair) {
                if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
                    unsupportedFeature ??= "non-string mapping keys";
                }
                else if (pair.key.value === "<<") {
                    unsupportedFeature ??= "merge keys";
                }
            },
        });
        if (unsupportedFeature) {
            return {
                issues: [
                    issue("unsupported_claw_yaml_feature", manifestPath, `${manifestPath} uses ${unsupportedFeature}; CLAW.md frontmatter must map directly to JSON data.`),
                ],
            };
        }
        try {
            return {
                value: document.toJSON(),
                clawMarkdownBody: markdown.slice(match[0].length),
            };
        }
        catch (error) {
            return {
                issues: [
                    issue("invalid_claw_frontmatter", manifestPath, error instanceof Error ? error.message : "Could not parse Claw frontmatter."),
                ],
            };
        }
    }
    try {
        return { value: JSON.parse(raw) };
    }
    catch (error) {
        return {
            issues: [
                issue("invalid_claw_json", manifestPath, error instanceof Error ? error.message : "Could not parse Claw JSON."),
            ],
        };
    }
}
export function validateClawPackageContents(input) {
    const issues = [];
    if (!isRecord(input.packageJson)) {
        return {
            ok: false,
            issues: [
                issue("missing_package_json", "package.json", "Claw packages require package.json."),
            ],
        };
    }
    const declaredName = typeof input.packageJson.name === "string" ? input.packageJson.name : "";
    const declaredVersion = typeof input.packageJson.version === "string" ? input.packageJson.version : "";
    const openclaw = isRecord(input.packageJson.openclaw) ? input.packageJson.openclaw : undefined;
    const manifestPath = typeof openclaw?.claw === "string" ? openclaw.claw : "";
    if (declaredName !== input.packageName) {
        issues.push(issue("package_name_mismatch", "package.json.name", `Must match ${input.packageName}.`));
    }
    if (!EXACT_VERSION_PATTERN.test(declaredVersion) || declaredVersion !== input.version) {
        issues.push(issue("package_version_mismatch", "package.json.version", `Must be exact semver ${input.version}.`));
    }
    if (!manifestPath || !isSafeClawPackagePath(manifestPath)) {
        issues.push(issue("invalid_claw_manifest_path", "package.json.openclaw.claw", "Must name a safe package-relative Claw manifest path."));
    }
    if (issues.length > 0)
        return { ok: false, issues };
    const fileByPath = new Map();
    const portablePaths = new Set();
    for (const file of input.files) {
        if (!isSafeClawPackagePath(file.path)) {
            issues.push(issue("invalid_package_path", file.path, "Package files must use safe canonical package-relative paths."));
            continue;
        }
        const key = portablePathKey(file.path);
        if (portablePaths.has(key)) {
            issues.push(issue("duplicate_portable_path", file.path, "Package paths must be unique across supported filesystems."));
        }
        else {
            portablePaths.add(key);
            fileByPath.set(file.path, file);
        }
    }
    const hierarchyCollision = findClawPackagePathHierarchyCollision([...fileByPath.keys()]);
    if (hierarchyCollision) {
        issues.push(issue("portable_path_hierarchy_collision", hierarchyCollision.descendant, `Package file ${hierarchyCollision.ancestor} cannot also be an ancestor of ${hierarchyCollision.descendant}.`));
    }
    const manifestFile = fileByPath.get(manifestPath);
    if (!manifestFile || manifestFile.text === undefined) {
        issues.push(issue("missing_claw_manifest", manifestPath, "The declared Claw manifest is missing or is not UTF-8 text."));
        return { ok: false, issues };
    }
    if (new TextEncoder().encode(manifestFile.text).byteLength > MAX_CLAW_MANIFEST_BYTES) {
        return {
            ok: false,
            issues: [
                issue("claw_manifest_too_large", manifestPath, `The Claw manifest exceeds ${MAX_CLAW_MANIFEST_BYTES} bytes.`),
            ],
        };
    }
    const parsed = parseManifestDocument(manifestFile.text, manifestPath);
    if ("issues" in parsed)
        return { ok: false, issues: parsed.issues };
    const validated = validateClawManifest(parsed.value);
    if (!validated.ok) {
        return {
            ok: false,
            issues: validated.issues.map((entry) => issue("invalid_claw_manifest", entry.path, entry.message)),
        };
    }
    const hasClawMarkdownBody = (parsed.clawMarkdownBody?.trim().length ?? 0) > 0;
    const implicitSoulPath = "SOUL.md";
    const workspaceTargets = [
        ...Object.keys(validated.manifest.workspace?.bootstrapFiles ?? {}),
        ...(validated.manifest.workspace?.files ?? []).map((entry) => entry.path),
    ];
    const hasImplicitSoulConflict = workspaceTargets.some((path) => portablePathKey(path) === portablePathKey(implicitSoulPath)) ||
        findClawPackagePathHierarchyCollision([implicitSoulPath, ...workspaceTargets]) !== null;
    if (hasClawMarkdownBody && hasImplicitSoulConflict) {
        issues.push(issue("claw_body_soul_conflict", "$.workspace", "CLAW.md body content and an explicit SOUL.md workspace declaration cannot both be present."));
    }
    const packageBootstrap = [...fileByPath.values()].find((file) => portablePathKey(file.path) === portablePathKey("BOOTSTRAP.md"));
    if (packageBootstrap && packageBootstrap.path !== "BOOTSTRAP.md") {
        issues.push(issue("invalid_package_path", packageBootstrap.path, "Package-root bootstrap files must use the exact path BOOTSTRAP.md."));
    }
    else if (packageBootstrap) {
        if (packageBootstrap.text === undefined) {
            issues.push(issue("package_bootstrap_invalid", "BOOTSTRAP.md", "Package-root BOOTSTRAP.md must be UTF-8 text."));
        }
        else if (new TextEncoder().encode(packageBootstrap.text).byteLength > MAX_PACKAGE_BOOTSTRAP_BYTES) {
            issues.push(issue("package_bootstrap_too_large", "BOOTSTRAP.md", `Package-root BOOTSTRAP.md exceeds ${MAX_PACKAGE_BOOTSTRAP_BYTES} bytes.`));
        }
        else if (packageBootstrap.text.trim().length === 0) {
            issues.push(issue("package_bootstrap_empty", "BOOTSTRAP.md", "Package-root BOOTSTRAP.md must contain first-run instructions."));
        }
    }
    const profileFiles = [...fileByPath.values()].filter((file) => portablePathKey(file.path).startsWith("profiles/"));
    let openClawExtensionCount = 0;
    for (const profileFile of profileFiles) {
        if (!HARNESS_PROFILE_PATH_PATTERN.test(profileFile.path)) {
            issues.push(issue("invalid_harness_profile_path", profileFile.path, "Harness profiles must use profiles/<lowercase-harness-id>.yml conventional paths."));
            continue;
        }
        if (profileFile.text === undefined) {
            issues.push(issue("invalid_harness_profile", profileFile.path, "Harness profiles must be UTF-8 text."));
            continue;
        }
        if (new TextEncoder().encode(profileFile.text).byteLength > MAX_HARNESS_PROFILE_BYTES) {
            const isOpenClawProfile = profileFile.path === "profiles/openclaw.yml";
            issues.push(issue(isOpenClawProfile ? "openclaw_profile_too_large" : "harness_profile_too_large", profileFile.path, isOpenClawProfile
                ? `OpenClaw profiles may not exceed ${MAX_HARNESS_PROFILE_BYTES} bytes.`
                : `Harness profiles may not exceed ${MAX_HARNESS_PROFILE_BYTES} bytes.`));
            continue;
        }
        if (profileFile.path === "profiles/openclaw.yml") {
            const profile = parseJsonCompatibleYaml(profileFile.text, profileFile.path);
            if (profile.issues)
                issues.push(...profile.issues);
            else {
                const validatedProfile = validateOpenClawProfile(profile.value, profileFile.path, input.openClawProfilePolicy ?? "current");
                issues.push(...validatedProfile.issues);
                openClawExtensionCount = validatedProfile.extensionCount;
            }
        }
        else {
            const profile = parseGenericHarnessProfile(profileFile.text, profileFile.path);
            if (profile.issues)
                issues.push(...profile.issues);
        }
    }
    const sources = [
        ...Object.values(validated.manifest.workspace?.bootstrapFiles ?? {}).map((entry) => entry.source),
        ...(validated.manifest.workspace?.files ?? []).map((entry) => entry.source),
    ];
    for (const source of sources) {
        if (!fileByPath.has(source)) {
            issues.push(issue("missing_workspace_source", source, "Declared workspace source is missing from the package."));
        }
    }
    if (issues.length > 0)
        return { ok: false, issues };
    const summary = summarizeClawManifest(validated.manifest, {
        clawMarkdownBody: hasClawMarkdownBody,
    });
    summary.profiles = {
        count: profileFiles.length,
        hasOpenClaw: profileFiles.some((file) => file.path === "profiles/openclaw.yml"),
    };
    summary.extensions = { count: openClawExtensionCount };
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
//# sourceMappingURL=clawPackage.js.map