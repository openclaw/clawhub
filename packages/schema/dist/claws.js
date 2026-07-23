import { ArkErrors, type } from "arktype";
import { Cron } from "croner";
export const CLAW_SCHEMA_VERSION = 1;
export const CLAW_SUMMARY_AGENT_NAME_MAX_CHARS = 128;
export const CLAW_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS = 1_024;
export const CLAW_BOOTSTRAP_FILE_NAMES = [
    "AGENTS.md",
    "SOUL.md",
    "IDENTITY.md",
    "TOOLS.md",
    "HEARTBEAT.md",
];
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
export const ClawManifestSchema = type({
    "+": "reject",
    schemaVersion: "1",
    agent: {
        "+": "reject",
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
    packages: type({
        "+": "reject",
        kind: '"skill"|"plugin"',
        source: '"clawhub"',
        ref: "string",
        version: "string",
    })
        .array()
        .optional(),
    mcpServers: type({
        "[string]": StdioMcpServerSchema.or(RemoteMcpServerSchema),
    }).optional(),
    cronJobs: type({
        "+": "reject",
        id: "string",
        name: "string?",
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
const ClawSummaryAgentNameSchema = type("string").narrow((value) => Array.from(value).length <= CLAW_SUMMARY_AGENT_NAME_MAX_CHARS);
const ClawSummaryAgentDescriptionSchema = type("string").narrow((value) => Array.from(value).length <= CLAW_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS);
export const ClawManifestSummarySchema = type({
    "+": "reject",
    schemaVersion: "1",
    agent: {
        "+": "reject",
        id: "string",
        name: ClawSummaryAgentNameSchema.optional(),
        description: ClawSummaryAgentDescriptionSchema.optional(),
    },
    workspace: {
        "+": "reject",
        bootstrapFiles: "string[]",
        fileCount: "number",
    },
    packages: {
        "+": "reject",
        skillCount: "number",
        pluginCount: "number",
    },
    mcpServerCount: "number",
    cronJobCount: "number",
});
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const EXACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ENV_REFERENCE_PATTERN = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MAX_DATA_URL_CHARS = 2_796_230;
const AVATAR_DATA_URL_PATTERN = /^data:image\/[^,]*,/i;
const AVATAR_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const BASE64_PAYLOAD_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PORTABLE_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Snapshot of OpenClaw's host-wide blocked process environment policy for v1 conformance.
const BLOCKED_PROCESS_ENV_KEYS = new Set([
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
    "CXX",
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
]);
const BLOCKED_PROCESS_ENV_PREFIXES = ["DYLD_", "LD_", "BASH_FUNC_"];
function isStrictNonEmpty(value) {
    return value.length > 0 && value === value.trim();
}
function isBlockedProcessEnvKey(value) {
    const upper = value.toUpperCase();
    return (BLOCKED_PROCESS_ENV_KEYS.has(upper) ||
        BLOCKED_PROCESS_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix)));
}
function isSafePackagePath(value) {
    const normalized = value.replaceAll("\\", "/");
    if (!isStrictNonEmpty(normalized) ||
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
        !Array.from(segment).some((character) => character.charCodeAt(0) <= 0x1f) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment));
}
function portablePathKey(value) {
    return value.replaceAll("\\", "/").normalize("NFC").toLowerCase();
}
function isPortableAvatar(value) {
    if (AVATAR_DATA_URL_PATTERN.test(value)) {
        if (value.length > AVATAR_MAX_DATA_URL_CHARS)
            return false;
        const comma = value.indexOf(",");
        if (comma < 0)
            return false;
        const metadata = value.slice(0, comma);
        const payload = value.slice(comma + 1);
        try {
            const base64 = /;base64(?:;|$)/i.test(metadata);
            if (payload.length === 0 || (base64 && !BASE64_PAYLOAD_PATTERN.test(payload)))
                return false;
            const byteLength = base64
                ? (payload.length / 4) * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0)
                : new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
            return byteLength > 0 && byteLength <= AVATAR_MAX_BYTES;
        }
        catch {
            return false;
        }
    }
    return isSafePackagePath(value) && AVATAR_EXTENSION_PATTERN.test(value);
}
function conflictsWithWorkspaceTarget(targets, candidate) {
    for (const target of targets) {
        if (target === candidate ||
            target.startsWith(`${candidate}/`) ||
            candidate.startsWith(`${target}/`)) {
            return true;
        }
    }
    return false;
}
function packageManagerArtifacts(command, args) {
    const executable = command
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/\.(?:cmd|exe)$/i, "")
        .toLowerCase();
    let start = 0;
    if (executable === "npm") {
        if (args[0] !== "exec" && args[0] !== "x")
            return [""];
        start = 1;
    }
    else if (executable === "bun") {
        if (args[0] !== "x")
            return [""];
        start = 1;
    }
    else if (executable === "pnpm" || executable === "yarn") {
        if (args[0] !== "dlx")
            return [""];
        start = 1;
    }
    else if (executable !== "npx" && executable !== "pnpx" && executable !== "bunx") {
        return undefined;
    }
    const selected = [];
    let positional;
    for (let index = start; index < args.length; index += 1) {
        const value = args[index];
        if (!value)
            continue;
        if (value === "--") {
            positional = args[index + 1] ?? "";
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
        if (positional === undefined && !value.startsWith("-")) {
            positional = value;
            break;
        }
    }
    return selected.length > 0 ? selected : [positional ?? ""];
}
function truncateSummaryText(value, maxChars) {
    if (!value)
        return undefined;
    return Array.from(value).slice(0, maxChars).join("");
}
function isPackageManagerArtifactPinned(command, args) {
    const artifacts = packageManagerArtifacts(command, args);
    if (artifacts === undefined)
        return undefined;
    return artifacts.every((artifact) => {
        const separator = artifact.lastIndexOf("@");
        const scopedSlash = artifact.startsWith("@") ? artifact.indexOf("/") : -1;
        return (separator > 0 &&
            separator > scopedSlash &&
            EXACT_VERSION_PATTERN.test(artifact.slice(separator + 1)));
    });
}
function arkIssues(errors) {
    return Array.from(errors, (error) => ({
        path: error.path.length > 0 ? `$.${error.path.join(".")}` : "$",
        message: error.description ?? "Invalid value.",
    }));
}
function pushNonEmpty(issues, path, value) {
    if (value !== undefined && !isStrictNonEmpty(value)) {
        issues.push({ path, message: "Must be non-empty without leading or trailing whitespace." });
    }
}
function pushNonEmptyArray(issues, path, values, requireEntry) {
    if (requireEntry && values !== undefined && values.length === 0) {
        issues.push({ path, message: "Must contain at least one value." });
    }
    for (const [index, value] of (values ?? []).entries()) {
        pushNonEmpty(issues, `${path}.${index}`, value);
    }
}
export function validateClawManifest(value) {
    const parsed = ClawManifestSchema(value);
    if (parsed instanceof ArkErrors)
        return { ok: false, issues: arkIssues(parsed) };
    const issues = [];
    if (!AGENT_ID_PATTERN.test(parsed.agent.id)) {
        issues.push({ path: "$.agent.id", message: "Invalid portable agent id." });
    }
    pushNonEmpty(issues, "$.agent.name", parsed.agent.name);
    pushNonEmpty(issues, "$.agent.description", parsed.agent.description);
    for (const field of ["name", "theme", "emoji", "avatar"]) {
        pushNonEmpty(issues, `$.agent.identity.${field}`, parsed.agent.identity?.[field]);
    }
    const openClawProfilePath = parsed.metadata?.["openclaw.config"];
    if (openClawProfilePath !== undefined &&
        (!isSafePackagePath(openClawProfilePath) || !/\.ya?ml$/i.test(openClawProfilePath))) {
        issues.push({
            path: "$.metadata.openclaw.config",
            message: "Must reference a safe package-relative .yml or .yaml file.",
        });
    }
    const workspaceTargets = new Set();
    for (const name of CLAW_BOOTSTRAP_FILE_NAMES) {
        const source = parsed.workspace?.bootstrapFiles?.[name]?.source;
        if (source === undefined)
            continue;
        if (!isSafePackagePath(source)) {
            issues.push({
                path: `$.workspace.bootstrapFiles.${name}.source`,
                message: "Must be a safe package-relative path.",
            });
        }
        workspaceTargets.add(portablePathKey(name));
    }
    for (const [index, file] of (parsed.workspace?.files ?? []).entries()) {
        if (!isSafePackagePath(file.source)) {
            issues.push({
                path: `$.workspace.files.${index}.source`,
                message: "Must be a safe package-relative path.",
            });
        }
        if (!isSafePackagePath(file.path)) {
            issues.push({
                path: `$.workspace.files.${index}.path`,
                message: "Must be a safe package-relative path.",
            });
        }
        const destinationKey = portablePathKey(file.path);
        if (conflictsWithWorkspaceTarget(workspaceTargets, destinationKey)) {
            issues.push({
                path: `$.workspace.files.${index}.path`,
                message: "Workspace destination is declared more than once.",
            });
        }
        workspaceTargets.add(destinationKey);
    }
    const avatar = parsed.agent.identity?.avatar;
    if (avatar !== undefined) {
        if (!isPortableAvatar(avatar)) {
            issues.push({
                path: "$.agent.identity.avatar",
                message: "Must be a bounded image data URL or managed workspace-relative image path.",
            });
        }
        else if (!AVATAR_DATA_URL_PATTERN.test(avatar) &&
            !workspaceTargets.has(portablePathKey(avatar))) {
            issues.push({
                path: "$.agent.identity.avatar",
                message: "Workspace-relative avatar must match a workspace.files destination.",
            });
        }
    }
    const packageKeys = new Set();
    for (const [index, pkg] of (parsed.packages ?? []).entries()) {
        pushNonEmpty(issues, `$.packages.${index}.ref`, pkg.ref);
        if (!PACKAGE_NAME_PATTERN.test(pkg.ref)) {
            issues.push({
                path: `$.packages.${index}.ref`,
                message: "Must be a lowercase ClawHub package name.",
            });
        }
        if (!EXACT_VERSION_PATTERN.test(pkg.version)) {
            issues.push({
                path: `$.packages.${index}.version`,
                message: "Must be an exact semantic version.",
            });
        }
        const key = `${pkg.kind}:${pkg.source}:${pkg.ref.toLowerCase()}`;
        if (packageKeys.has(key)) {
            issues.push({
                path: `$.packages.${index}`,
                message: "Package is declared more than once.",
            });
        }
        packageKeys.add(key);
    }
    for (const [name, server] of Object.entries(parsed.mcpServers ?? {})) {
        if (!AGENT_ID_PATTERN.test(name)) {
            issues.push({
                path: `$.mcpServers.${name}`,
                message: "Invalid MCP server name.",
            });
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
                    issues.push({
                        path: `$.mcpServers.${name}.url`,
                        message: "Must not contain embedded credentials or fragments.",
                    });
                }
            }
            catch {
                issues.push({
                    path: `$.mcpServers.${name}.url`,
                    message: "Must use HTTPS, except HTTP on an exact loopback host.",
                });
            }
        }
        if ("command" in server) {
            pushNonEmpty(issues, `$.mcpServers.${name}.command`, server.command);
            pushNonEmptyArray(issues, `$.mcpServers.${name}.args`, server.args, false);
            if (isPackageManagerArtifactPinned(server.command, server.args ?? []) === false) {
                issues.push({
                    path: `$.mcpServers.${name}.args`,
                    message: "Package-manager MCP commands must select one exact immutable package version.",
                });
            }
        }
        pushNonEmptyArray(issues, `$.mcpServers.${name}.toolFilter.include`, server.toolFilter?.include, true);
        pushNonEmptyArray(issues, `$.mcpServers.${name}.toolFilter.exclude`, server.toolFilter?.exclude, true);
        for (const field of ["include", "exclude"]) {
            const seen = new Set();
            for (const [index, entry] of (server.toolFilter?.[field] ?? []).entries()) {
                if (entry.includes("?") || entry.includes("[") || entry.includes("]")) {
                    issues.push({
                        path: `$.mcpServers.${name}.toolFilter.${field}.${index}`,
                        message: "Tool filters support only exact names and * wildcards.",
                    });
                }
                if (seen.has(entry)) {
                    issues.push({
                        path: `$.mcpServers.${name}.toolFilter.${field}.${index}`,
                        message: "Tool filter entries must be unique.",
                    });
                }
                seen.add(entry);
            }
        }
        if ("env" in server) {
            for (const [key, envValue] of Object.entries(server.env ?? {})) {
                pushNonEmpty(issues, `$.mcpServers.${name}.env`, key);
                if (!PORTABLE_ENV_KEY_PATTERN.test(key)) {
                    issues.push({
                        path: `$.mcpServers.${name}.env.${key}`,
                        message: "Invalid portable environment key.",
                    });
                }
                if (isBlockedProcessEnvKey(key)) {
                    issues.push({
                        path: `$.mcpServers.${name}.env.${key}`,
                        message: "Environment key is blocked by the spawned-process safety policy.",
                    });
                }
                if (!ENV_REFERENCE_PATTERN.test(envValue)) {
                    issues.push({
                        path: `$.mcpServers.${name}.env.${key}`,
                        message: "Must be an unresolved ${ENV_VAR} reference.",
                    });
                }
            }
        }
        if (server.timeout !== undefined && (!Number.isFinite(server.timeout) || server.timeout <= 0)) {
            issues.push({
                path: `$.mcpServers.${name}.timeout`,
                message: "Must be positive.",
            });
        }
        if (server.connectTimeout !== undefined &&
            (!Number.isFinite(server.connectTimeout) || server.connectTimeout <= 0)) {
            issues.push({
                path: `$.mcpServers.${name}.connectTimeout`,
                message: "Must be positive.",
            });
        }
    }
    const cronIds = new Set();
    for (const [index, job] of (parsed.cronJobs ?? []).entries()) {
        if (!AGENT_ID_PATTERN.test(job.id)) {
            issues.push({
                path: `$.cronJobs.${index}.id`,
                message: "Invalid cron job id.",
            });
        }
        pushNonEmpty(issues, `$.cronJobs.${index}.name`, job.name);
        pushNonEmpty(issues, `$.cronJobs.${index}.schedule.cron`, job.schedule.cron);
        pushNonEmpty(issues, `$.cronJobs.${index}.schedule.timezone`, job.schedule.timezone);
        pushNonEmpty(issues, `$.cronJobs.${index}.message`, job.message);
        try {
            if (job.schedule.cron.trim().split(/\s+/).length !== 5)
                throw new Error("fields");
            const cron = new Cron(job.schedule.cron.trim(), {
                timezone: job.schedule.timezone.trim(),
                catch: false,
            });
            if (!cron.nextRun(new Date()))
                throw new Error("No future run");
        }
        catch {
            issues.push({
                path: `$.cronJobs.${index}.schedule`,
                message: "Must contain a valid cron expression and timezone.",
            });
        }
        if ((job.delivery?.mode === "none" && job.delivery.channel !== undefined) ||
            (job.delivery?.mode === "announce" && job.delivery.channel !== "last")) {
            issues.push({
                path: `$.cronJobs.${index}.delivery`,
                message: 'Must be { mode: "none" } or { mode: "announce", channel: "last" }.',
            });
        }
        if (cronIds.has(job.id)) {
            issues.push({
                path: `$.cronJobs.${index}.id`,
                message: "Cron job id is declared more than once.",
            });
        }
        cronIds.add(job.id);
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, manifest: parsed };
}
export function summarizeClawManifest(manifest) {
    const packages = manifest.packages ?? [];
    const agentName = truncateSummaryText(manifest.agent.name, CLAW_SUMMARY_AGENT_NAME_MAX_CHARS);
    const agentDescription = truncateSummaryText(manifest.agent.description, CLAW_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS);
    return {
        schemaVersion: CLAW_SCHEMA_VERSION,
        agent: {
            id: manifest.agent.id,
            ...(agentName ? { name: agentName } : {}),
            ...(agentDescription ? { description: agentDescription } : {}),
        },
        workspace: {
            bootstrapFiles: CLAW_BOOTSTRAP_FILE_NAMES.filter((name) => manifest.workspace?.bootstrapFiles?.[name] !== undefined),
            fileCount: manifest.workspace?.files?.length ?? 0,
        },
        packages: {
            skillCount: packages.filter((pkg) => pkg.kind === "skill").length,
            pluginCount: packages.filter((pkg) => pkg.kind === "plugin").length,
        },
        mcpServerCount: Object.keys(manifest.mcpServers ?? {}).length,
        cronJobCount: manifest.cronJobs?.length ?? 0,
    };
}
//# sourceMappingURL=claws.js.map