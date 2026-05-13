export declare const PLUGIN_CATEGORY_DEFINITIONS: readonly [{
    readonly slug: "channels";
    readonly label: "Channels & Communication";
    readonly icon: "message-circle";
    readonly signals: readonly ["channel", "chat", "message", "messaging", "communication", "voice", "call", "discord", "slack", "teams", "telegram", "whatsapp", "wechat", "wecom", "qq", "sms", "email"];
}, {
    readonly slug: "mcp-tooling";
    readonly label: "MCP & Tooling";
    readonly icon: "plug";
    readonly signals: readonly ["mcp", "server", "protocol", "provider", "harness", "adapter"];
}, {
    readonly slug: "data";
    readonly label: "Data & APIs";
    readonly icon: "database";
    readonly signals: readonly ["api", "data", "database", "db", "fetch", "http", "rest", "graphql", "source", "memory", "storage", "cache", "vector"];
}, {
    readonly slug: "security";
    readonly label: "Security";
    readonly icon: "shield";
    readonly signals: readonly ["security", "scan", "auth", "oauth", "encrypt", "guardrail", "policy", "secret", "permission", "credential"];
}, {
    readonly slug: "observability";
    readonly label: "Observability";
    readonly icon: "activity";
    readonly signals: readonly ["observability", "log", "trace", "monitor", "metric", "telemetry", "diagnostic", "exporter", "prometheus", "otel"];
}, {
    readonly slug: "automation";
    readonly label: "Automation";
    readonly icon: "zap";
    readonly signals: readonly ["auto", "automation", "cron", "schedule", "bot", "workflow", "pipeline", "approval"];
}, {
    readonly slug: "deployment";
    readonly label: "Deployment";
    readonly icon: "rocket";
    readonly signals: readonly ["deploy", "deployment", "release", "publish", "ci", "cd", "infrastructure", "gateway", "load-balanced", "hosting"];
}, {
    readonly slug: "dev-tools";
    readonly label: "Developer Tools";
    readonly icon: "wrench";
    readonly signals: readonly ["dev", "debug", "lint", "test", "build", "tool", "tools", "browser", "terminal", "git", "repo", "code", "sdk"];
}];
export type PluginCategorySlug = (typeof PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"];
export declare const PLUGIN_CATEGORY_SLUGS: ("data" | "security" | "channels" | "mcp-tooling" | "observability" | "automation" | "deployment" | "dev-tools")[];
export declare const PLUGIN_CATEGORY_SLUG_SET: Set<string>;
export declare function isPluginCategorySlug(value: string | null | undefined): value is PluginCategorySlug;
export declare function derivePluginCategoryTags(input: {
    family?: string;
    name?: string;
    displayName?: string;
    runtimeId?: string;
    summary?: string;
    capabilityTags?: string[] | null;
}): PluginCategorySlug[];
