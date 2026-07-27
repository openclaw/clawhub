import { type BaseType, type inferred } from "arktype";
export declare const CLAW_SCHEMA_VERSION: 1;
export declare const CLAW_SUMMARY_AGENT_NAME_MAX_CHARS = 128;
export declare const CLAW_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS = 1024;
export declare const CLAW_BOOTSTRAP_FILE_NAMES: readonly ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"];
export declare const ClawManifestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: 1;
    agent: {
        id: string;
        name?: string | undefined;
        description?: string | undefined;
        identity?: {
            name?: string | undefined;
            theme?: string | undefined;
            emoji?: string | undefined;
            avatar?: string | undefined;
        } | undefined;
    };
    metadata?: {
        [x: string]: string;
    } | undefined;
    workspace?: {
        bootstrapFiles?: {
            "AGENTS.md"?: {
                source: string;
            } | undefined;
            "SOUL.md"?: {
                source: string;
            } | undefined;
            "IDENTITY.md"?: {
                source: string;
            } | undefined;
            "TOOLS.md"?: {
                source: string;
            } | undefined;
            "HEARTBEAT.md"?: {
                source: string;
            } | undefined;
        } | undefined;
        files?: {
            source: string;
            path: string;
        }[] | undefined;
    } | undefined;
    packages?: {
        kind: "plugin" | "skill";
        source: "clawhub";
        ref: string;
        version: string;
    }[] | undefined;
    mcpServers?: {
        [x: string]: {
            command: string;
            transport?: "stdio" | undefined;
            args?: string[] | undefined;
            env?: {
                [x: string]: string;
            } | undefined;
            toolFilter?: {
                include?: string[] | undefined;
                exclude?: string[] | undefined;
            } | undefined;
            timeout?: number | undefined;
            connectTimeout?: number | undefined;
        } | {
            url: string;
            transport: "sse" | "streamable-http";
            auth?: "oauth" | undefined;
            toolFilter?: {
                include?: string[] | undefined;
                exclude?: string[] | undefined;
            } | undefined;
            timeout?: number | undefined;
            connectTimeout?: number | undefined;
        };
    } | undefined;
    cronJobs?: {
        id: string;
        name?: string | undefined;
        schedule: {
            cron: string;
            timezone: string;
        };
        session: "isolated" | "main";
        message: string;
        delivery?: {
            mode: "announce" | "none";
            channel?: "last" | undefined;
        } | undefined;
    }[] | undefined;
}, {}>;
export type ClawManifest = (typeof ClawManifestSchema)[inferred];
export type ClawManifestSummary = {
    schemaVersion: 1;
    agent: {
        id: string;
        name?: string;
        description?: string;
    };
    workspace: {
        bootstrapFiles: string[];
        fileCount: number;
    };
    packages: {
        skillCount: number;
        pluginCount: number;
    };
    mcpServerCount: number;
    cronJobCount: number;
};
export type ClawManifestSummarySchemaAdapter<TValue, TOptional = TValue> = {
    literalOne: TValue;
    string: TValue;
    number: TValue;
    stringArray: TValue;
    boundedString: (maxCharacters: number) => TValue;
    optional: (schema: TValue) => TOptional;
    object: (fields: Record<string, TValue | TOptional>) => TValue;
};
/** Builds the v1 summary structure for both the public schema and durable storage validators. */
export declare function createClawManifestSummarySchema<TValue, TOptional = TValue>(adapter: ClawManifestSummarySchemaAdapter<TValue, TOptional>): TValue;
export declare const ClawManifestSummarySchema: BaseType<ClawManifestSummary>;
export declare const CLAW_MANIFEST_VALIDATION_PHASE: "schema";
export declare const CLAW_MANIFEST_VALIDATION_CODES: {
    readonly invalidManifestShape: "claw_v1_invalid_manifest_shape";
    readonly invalidAgentId: "claw_v1_invalid_agent_id";
    readonly nonCanonicalString: "claw_v1_non_canonical_string";
    readonly emptyList: "claw_v1_empty_list";
    readonly invalidProfilePath: "claw_v1_invalid_profile_path";
    readonly unsafePath: "claw_v1_unsafe_path";
    readonly duplicateWorkspaceDestination: "claw_v1_duplicate_workspace_destination";
    readonly invalidAvatar: "claw_v1_invalid_avatar";
    readonly undeclaredAvatar: "claw_v1_undeclared_avatar";
    readonly invalidPackageReference: "claw_v1_invalid_package_reference";
    readonly invalidPackageVersion: "claw_v1_invalid_package_version";
    readonly duplicatePackage: "claw_v1_duplicate_package";
    readonly invalidMcpServerId: "claw_v1_invalid_mcp_server_id";
    readonly invalidMcpUrl: "claw_v1_invalid_mcp_url";
    readonly mcpUrlCredentials: "claw_v1_mcp_url_credentials";
    readonly unpinnedMcpPackage: "claw_v1_unpinned_mcp_package";
    readonly invalidToolFilter: "claw_v1_invalid_tool_filter";
    readonly duplicateToolFilter: "claw_v1_duplicate_tool_filter";
    readonly invalidEnvironmentKey: "claw_v1_invalid_environment_key";
    readonly blockedEnvironmentKey: "claw_v1_blocked_environment_key";
    readonly invalidEnvironmentReference: "claw_v1_invalid_environment_reference";
    readonly invalidTimeout: "claw_v1_invalid_timeout";
    readonly invalidCronJobId: "claw_v1_invalid_cron_job_id";
    readonly invalidCronSchedule: "claw_v1_invalid_cron_schedule";
    readonly invalidCronDelivery: "claw_v1_invalid_cron_delivery";
    readonly duplicateCronJob: "claw_v1_duplicate_cron_job";
};
export type ClawManifestValidationCode = (typeof CLAW_MANIFEST_VALIDATION_CODES)[keyof typeof CLAW_MANIFEST_VALIDATION_CODES];
export type ClawManifestValidationIssue = {
    code: ClawManifestValidationCode;
    phase: typeof CLAW_MANIFEST_VALIDATION_PHASE;
    path: string;
    message: string;
};
export declare const OPENCLAW_CLAW_HOST_ENV_POLICY_V1: {
    readonly contractVersion: 1;
    readonly source: {
        readonly repository: "openclaw/openclaw";
        readonly commit: "f50a918af102b950721c1b380f7eb8af4e0389d1";
        readonly path: "src/infra/host-env-security-policy.json";
        readonly sha256: "4639dcfa157d4fa4c2fb84f8c5347ffe2252eb4ddb3d818afd7f87d68173b92b";
    };
    readonly blockedKeys: readonly ["NODE_OPTIONS", "NODE_PATH", "NODE_REDIRECT_WARNINGS", "NODE_REPL_EXTERNAL_MODULE", "NODE_REPL_HISTORY", "NODE_V8_COVERAGE", "PYTHONHOME", "PYTHONPATH", "PERL5LIB", "PERL5OPT", "RUBYLIB", "RUBYOPT", "BASHOPTS", "BASH_ENV", "ENV", "KSH_ENV", "BROWSER", "GIT_ALLOW_PROTOCOL", "GIT_EDITOR", "GIT_EXTERNAL_DIFF", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_EXEC_PATH", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_PROTOCOL_FROM_USER", "GIT_SEQUENCE_EDITOR", "GIT_TEMPLATE_DIR", "GIT_SSL_NO_VERIFY", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "CC", "CPP", "CXX", "CARGO_BUILD_RUSTC", "CARGO_BUILD_RUSTC_WRAPPER", "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER", "CARGO_BUILD_RUSTDOC", "RUSTC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTDOC", "CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER", "SHELL", "SHELLOPTS", "PS4", "GCONV_PATH", "IFS", "SSLKEYLOGFILE", "JAVA_OPTS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "PYTHONBREAKPOINT", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "FPATH", "GLIBC_TUNABLES", "MAVEN_OPTS", "MAKE", "MAKEFLAGS", "MFLAGS", "SBT_OPTS", "GRADLE_OPTS", "ANT_OPTS", "HGRCPATH", "HGEDITOR", "HGMERGE", "EXINIT", "VIMINIT", "MYVIMRC", "GVIMINIT", "LUA_INIT", "LUA_INIT_5_1", "LUA_INIT_5_2", "LUA_INIT_5_3", "LUA_INIT_5_4", "EMACSLOADPATH", "RUBYSHELL", "GIT_HOOK_PATH", "SVN_EDITOR", "SVN_SSH", "BZR_EDITOR", "BZR_SSH", "BZR_PLUGIN_PATH", "SUDO_ASKPASS", "JULIA_EDITOR", "CONFIG_SITE", "CONFIG_SHELL", "CMAKE_TOOLCHAIN_FILE", "CATALINA_OPTS", "CORECLR_PROFILER", "HELM_PLUGINS", "PACKER_PLUGIN_PATH", "VAGRANT_VAGRANTFILE", "ERL_AFLAGS", "ERL_FLAGS", "ERL_ZFLAGS", "ELIXIR_ERL_OPTIONS", "R_ENVIRON", "R_PROFILE", "R_ENVIRON_USER", "R_PROFILE_USER", "TCLLIBPATH", "HOSTALIASES"];
    readonly blockedPrefixes: readonly ["DYLD_", "LD_", "BASH_FUNC_"];
};
export declare function validateClawManifest(value: unknown): {
    ok: true;
    manifest: ClawManifest;
} | {
    ok: false;
    issues: ClawManifestValidationIssue[];
};
export declare function summarizeClawManifest(manifest: ClawManifest): ClawManifestSummary;
