import { PLUGIN_CATEGORY_DEFINITIONS } from "clawhub-schema";

export type SkillCategory = {
  slug: string;
  label: string;
  icon: string;
  keywords: string[];
};

export type BrowseCategory = {
  slug: string;
  label: string;
  icon: string;
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

export const PLUGIN_CATEGORIES: BrowseCategory[] = PLUGIN_CATEGORY_DEFINITIONS.map(
  ({ slug, label, icon }) => ({
    slug,
    label,
    icon,
  }),
);

export const ALL_CATEGORY_KEYWORDS = SKILL_CATEGORIES.flatMap((c) => c.keywords);
