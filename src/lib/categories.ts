export type SkillCategory = {
  slug: string;
  label: string;
  icon: string;
  keywords: string[];
};

export const SKILL_CATEGORIES: SkillCategory[] = [
  { slug: "mcp-tools", label: "MCP Tools", icon: "plug", keywords: ["mcp", "tool", "server"] },
  {
    slug: "prompts",
    label: "Prompts",
    icon: "message-square",
    keywords: ["prompt", "template", "system"],
  },
  {
    slug: "workflows",
    label: "Workflows",
    icon: "git-branch",
    keywords: ["workflow", "pipeline", "chain"],
  },
  {
    slug: "dev-tools",
    label: "Dev Tools",
    icon: "wrench",
    keywords: ["dev", "debug", "lint", "test", "build"],
  },
  {
    slug: "data",
    label: "Data & APIs",
    icon: "database",
    keywords: ["api", "data", "fetch", "http", "rest", "graphql"],
  },
  {
    slug: "security",
    label: "Security",
    icon: "shield",
    keywords: ["security", "scan", "auth", "encrypt"],
  },
  {
    slug: "automation",
    label: "Automation",
    icon: "zap",
    keywords: ["auto", "cron", "schedule", "bot"],
  },
  { slug: "other", label: "Other", icon: "package", keywords: [] },
];

export const PLUGIN_CATEGORIES: SkillCategory[] = [
  {
    slug: "dev-tools",
    label: "Developer Tools",
    icon: "wrench",
    keywords: ["dev", "debug", "lint", "test", "build", "tool"],
  },
  {
    slug: "mcp-tooling",
    label: "MCP & Tooling",
    icon: "plug",
    keywords: ["mcp", "tool", "server", "protocol"],
  },
  {
    slug: "security",
    label: "Security",
    icon: "shield",
    keywords: ["security", "scan", "auth", "encrypt", "guardrail", "policy"],
  },
  {
    slug: "data",
    label: "Data & APIs",
    icon: "database",
    keywords: ["api", "data", "fetch", "http", "rest", "graphql", "source"],
  },
  {
    slug: "auth-identity",
    label: "Auth & Identity",
    icon: "key",
    keywords: ["auth", "identity", "login", "oauth", "sso", "permission"],
  },
  {
    slug: "observability",
    label: "Observability",
    icon: "activity",
    keywords: ["observability", "log", "trace", "monitor", "metric", "telemetry"],
  },
  {
    slug: "automation",
    label: "Automation",
    icon: "zap",
    keywords: ["auto", "cron", "schedule", "bot", "workflow", "pipeline"],
  },
  {
    slug: "deployment",
    label: "Deployment",
    icon: "rocket",
    keywords: ["deploy", "release", "publish", "ci", "cd", "infrastructure"],
  },
  { slug: "other", label: "Other", icon: "package", keywords: [] },
];

export const ALL_PLUGIN_CATEGORY_KEYWORDS = PLUGIN_CATEGORIES.flatMap((c) => c.keywords);

export const ALL_CATEGORY_KEYWORDS = SKILL_CATEGORIES.flatMap((c) => c.keywords);
