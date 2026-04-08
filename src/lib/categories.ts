export type SkillCategory = {
  slug: string;
  label: string;
  keywords: string[];
};

export const SKILL_CATEGORIES: SkillCategory[] = [
  { slug: "mcp-tools", label: "MCP Tools", keywords: ["mcp", "tool", "server"] },
  { slug: "prompts", label: "Prompts", keywords: ["prompt", "template", "system"] },
  { slug: "workflows", label: "Workflows", keywords: ["workflow", "pipeline", "chain"] },
  { slug: "dev-tools", label: "Dev Tools", keywords: ["dev", "debug", "lint", "test", "build"] },
  { slug: "data", label: "Data & APIs", keywords: ["api", "data", "fetch", "http", "rest", "graphql"] },
  { slug: "security", label: "Security", keywords: ["security", "scan", "auth", "encrypt"] },
  { slug: "automation", label: "Automation", keywords: ["auto", "cron", "schedule", "bot"] },
  { slug: "other", label: "Other", keywords: [] },
];

export const ALL_CATEGORY_KEYWORDS = SKILL_CATEGORIES.flatMap((c) => c.keywords);

