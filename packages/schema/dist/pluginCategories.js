export const PLUGIN_CATEGORY_DEFINITIONS = [
    {
        slug: "channels",
        label: "Channels & Communication",
        icon: "message-circle",
        signals: [
            "channel",
            "chat",
            "message",
            "messaging",
            "communication",
            "voice",
            "call",
            "discord",
            "slack",
            "teams",
            "telegram",
            "whatsapp",
            "wechat",
            "wecom",
            "qq",
            "sms",
            "email",
        ],
    },
    {
        slug: "mcp-tooling",
        label: "MCP & Tooling",
        icon: "plug",
        signals: ["mcp", "server", "protocol", "provider", "harness", "adapter"],
    },
    {
        slug: "data",
        label: "Data & APIs",
        icon: "database",
        signals: [
            "api",
            "data",
            "database",
            "db",
            "fetch",
            "http",
            "rest",
            "graphql",
            "source",
            "memory",
            "storage",
            "cache",
            "vector",
        ],
    },
    {
        slug: "security",
        label: "Security",
        icon: "shield",
        signals: [
            "security",
            "scan",
            "auth",
            "oauth",
            "encrypt",
            "guardrail",
            "policy",
            "secret",
            "permission",
            "credential",
        ],
    },
    {
        slug: "observability",
        label: "Observability",
        icon: "activity",
        signals: [
            "observability",
            "log",
            "trace",
            "monitor",
            "metric",
            "telemetry",
            "diagnostic",
            "exporter",
            "prometheus",
            "otel",
        ],
    },
    {
        slug: "automation",
        label: "Automation",
        icon: "zap",
        signals: ["auto", "automation", "cron", "schedule", "bot", "workflow", "pipeline", "approval"],
    },
    {
        slug: "deployment",
        label: "Deployment",
        icon: "rocket",
        signals: [
            "deploy",
            "deployment",
            "release",
            "publish",
            "ci",
            "cd",
            "infrastructure",
            "gateway",
            "load-balanced",
            "hosting",
        ],
    },
    {
        slug: "dev-tools",
        label: "Developer Tools",
        icon: "wrench",
        signals: [
            "dev",
            "debug",
            "lint",
            "test",
            "build",
            "tool",
            "tools",
            "browser",
            "terminal",
            "git",
            "repo",
            "code",
            "sdk",
        ],
    },
];
export const PLUGIN_CATEGORY_SLUGS = PLUGIN_CATEGORY_DEFINITIONS.map((category) => category.slug);
export const PLUGIN_CATEGORY_SLUG_SET = new Set(PLUGIN_CATEGORY_SLUGS);
export function isPluginCategorySlug(value) {
    return Boolean(value && PLUGIN_CATEGORY_SLUG_SET.has(value));
}
function normalizeCategoryText(value) {
    return value?.trim().toLowerCase() ?? "";
}
function signalMatches(text, signal) {
    const normalizedText = ` ${text.replace(/[^a-z0-9]+/g, " ")} `;
    const normalizedSignal = ` ${signal
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")} `;
    return normalizedText.includes(normalizedSignal);
}
export function derivePluginCategoryTags(input) {
    if (input.family === "skill")
        return [];
    const text = [
        input.name,
        input.displayName,
        input.runtimeId,
        input.summary,
        ...(input.capabilityTags ?? []),
    ]
        .map(normalizeCategoryText)
        .filter(Boolean)
        .join(" ");
    if (!text)
        return [];
    return PLUGIN_CATEGORY_DEFINITIONS.filter((category) => category.signals.some((signal) => signalMatches(text, signal))).map((category) => category.slug);
}
//# sourceMappingURL=pluginCategories.js.map