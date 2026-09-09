export declare const CATALOG_CATEGORY_LIMIT = 3;
export declare const CATALOG_TOPIC_LIMIT = 5;
export declare const CATALOG_TOPIC_MAX_LENGTH = 48;
export declare const INTERNAL_UNCATEGORIZED_CATEGORY = "other";
export declare const RESERVED_CATALOG_TOPIC_SLUGS: readonly ["approved", "audited", "certified", "clawhub", "community", "curated", "endorsed", "featured", "official", "officials", "openclaw", "recommended", "staff-pick", "trusted", "trusted-publisher", "verified"];
export declare const PLUGIN_CATEGORY_DEFINITIONS: readonly [{
    readonly slug: "channels";
    readonly label: "Channels";
    readonly icon: "message-circle";
    readonly description: "Messaging transports that let people talk to the agent through a channel.";
}, {
    readonly slug: "models";
    readonly label: "Models";
    readonly icon: "brain";
    readonly description: "Model providers, inference backends, and model routing.";
}, {
    readonly slug: "memory";
    readonly label: "Memory";
    readonly icon: "database";
    readonly description: "Memory providers, embeddings, and retrieval.";
}, {
    readonly slug: "context";
    readonly label: "Context";
    readonly icon: "book-open";
    readonly description: "Context engines and context management.";
}, {
    readonly slug: "voice";
    readonly label: "Voice";
    readonly icon: "message-square";
    readonly description: "Speech synthesis, transcription, voice calls, and audio interaction.";
}, {
    readonly slug: "web";
    readonly label: "Web";
    readonly icon: "globe";
    readonly description: "Web search providers, browser control, and fetching web pages.";
}, {
    readonly slug: "media";
    readonly label: "Media";
    readonly icon: "palette";
    readonly description: "Image, video, audio, and other media understanding or generation.";
}, {
    readonly slug: "security";
    readonly label: "Security";
    readonly icon: "shield";
    readonly description: "Authentication, authorization, security controls, and policy enforcement.";
}, {
    readonly slug: "integrations";
    readonly label: "Integrations";
    readonly icon: "plug";
    readonly description: "General connectors, API bridges, and service integration platforms. Prefer a specific use category when the connected service has a clear purpose.";
}, {
    readonly slug: "developer-tools";
    readonly label: "Developer tools";
    readonly icon: "code-xml";
    readonly description: "Writing, reviewing, testing, and debugging software; coding agents and development environments.";
}, {
    readonly slug: "infrastructure";
    readonly label: "Infrastructure";
    readonly icon: "server";
    readonly description: "Deploying, hosting, monitoring, and operating systems, networks, services, and agent runtimes.";
}, {
    readonly slug: "documents-files";
    readonly label: "Documents & files";
    readonly icon: "files";
    readonly description: "Reading, creating, extracting, transferring, and managing documents and files.";
}, {
    readonly slug: "inbox-collaboration";
    readonly label: "Inbox & collaboration";
    readonly icon: "inbox";
    readonly description: "Managing email, inboxes, team communication, and collaborative workspaces. Channel transport alone belongs in Channels.";
}, {
    readonly slug: "productivity";
    readonly label: "Productivity";
    readonly icon: "list-todo";
    readonly description: "Tasks, notes, projects, planning, and personal or team work management.";
}, {
    readonly slug: "scheduling";
    readonly label: "Scheduling";
    readonly icon: "calendar-days";
    readonly description: "Calendars, appointments, availability, and booking. Technical job scheduling belongs with the workflow it supports.";
}, {
    readonly slug: "finance-payments";
    readonly label: "Finance & payments";
    readonly icon: "wallet-cards";
    readonly description: "Payments, banking, accounting, financial markets, trading, and financial analysis.";
}, {
    readonly slug: "sales-marketing";
    readonly label: "Sales & marketing";
    readonly icon: "megaphone";
    readonly description: "Customer relationships, sales, support, outreach, campaigns, and marketing operations.";
}, {
    readonly slug: "data-analytics";
    readonly label: "Data & analytics";
    readonly icon: "chart-no-axes-combined";
    readonly description: "Querying databases, processing datasets, analysis, reporting, and business intelligence. Agent memory storage belongs in Memory.";
}, {
    readonly slug: "agent-orchestration";
    readonly label: "Agent orchestration";
    readonly icon: "workflow";
    readonly description: "Coordinating agents, delegating work, and running multi-step agent workflows.";
}, {
    readonly slug: "research";
    readonly label: "Research";
    readonly icon: "search";
    readonly description: "Investigating topics, finding and evaluating sources, scientific literature, and synthesizing evidence. General web access belongs in Web.";
}, {
    readonly slug: "other";
    readonly label: "Other";
    readonly icon: "package";
    readonly description: "Plugins that do not yet fit another browse category.";
}];
export declare const LEGACY_PLUGIN_CATEGORY_DEFINITIONS: readonly [{
    readonly slug: "tools";
    readonly label: "Tools";
    readonly icon: "wrench";
}, {
    readonly slug: "runtime";
    readonly label: "Runtime";
    readonly icon: "git-branch";
}, {
    readonly slug: "gateway";
    readonly label: "Gateway";
    readonly icon: "activity";
}];
export declare const SKILL_CATEGORY_DEFINITIONS: readonly [{
    readonly slug: "integrations";
    readonly label: "Integrations";
    readonly icon: "plug";
    readonly description: "Connect services, fetch data, reconcile records, and operate APIs.";
    readonly keywords: readonly ["api", "data", "database", "integration", "fetch", "http", "graphql"];
}, {
    readonly slug: "automation";
    readonly label: "Automation";
    readonly icon: "zap";
    readonly description: "Build repeatable processes, scheduled jobs, pipelines, and orchestration.";
    readonly keywords: readonly ["automation", "automate", "workflow", "workflows", "cron", "schedule", "pipeline", "orchestrate"];
}, {
    readonly slug: "research";
    readonly label: "Research";
    readonly icon: "globe";
    readonly description: "Search, browse, scrape, summarize, monitor, and extract web information.";
    readonly keywords: readonly ["web", "browser", "search", "scrape", "research", "crawl", "rss"];
}, {
    readonly slug: "development";
    readonly label: "Development";
    readonly icon: "wrench";
    readonly description: "Inspect, edit, test, build, debug, and operate codebases.";
    readonly keywords: readonly ["developer", "debug", "lint", "test", "build", "code", "git", "repo"];
}, {
    readonly slug: "productivity";
    readonly label: "Productivity";
    readonly icon: "list-checks";
    readonly description: "Manage tasks, calendars, email, meetings, projects, and business work.";
    readonly keywords: readonly ["task", "todo", "calendar", "email", "meeting", "project", "productivity"];
}, {
    readonly slug: "communication";
    readonly label: "Communication";
    readonly icon: "message-circle";
    readonly description: "Message, publish, and operate social or communication services.";
    readonly keywords: readonly ["message", "social", "discord", "slack", "telegram", "whatsapp", "chat"];
}, {
    readonly slug: "creative";
    readonly label: "Creative";
    readonly icon: "palette";
    readonly description: "Create and edit images, video, audio, music, design, and writing.";
    readonly keywords: readonly ["image", "video", "audio", "music", "design", "creative", "writing"];
}, {
    readonly slug: "knowledge";
    readonly label: "Knowledge";
    readonly icon: "book-open";
    readonly description: "Work with documents, notes, knowledge bases, teaching, and learning.";
    readonly keywords: readonly ["document", "docs", "pdf", "notes", "knowledge", "study", "learning"];
}, {
    readonly slug: "agents";
    readonly label: "Agents";
    readonly icon: "brain";
    readonly description: "Change how an agent plans, reflects, learns, remembers, or collaborates.";
    readonly keywords: readonly ["agent", "memory", "planning", "reflect", "reasoning", "context"];
}, {
    readonly slug: "operations";
    readonly label: "Operations";
    readonly icon: "activity";
    readonly description: "Inspect, monitor, deploy, and operate local systems or infrastructure.";
    readonly keywords: readonly ["deploy", "observability", "monitor", "infrastructure", "filesystem", "shell", "terminal"];
}, {
    readonly slug: "security";
    readonly label: "Security";
    readonly icon: "shield";
    readonly description: "Audit, scan, authenticate, and protect systems or data.";
    readonly keywords: readonly ["security", "audit", "scan", "auth", "encrypt", "policy", "secret"];
}, {
    readonly slug: "finance";
    readonly label: "Finance";
    readonly icon: "wallet-cards";
    readonly description: "Work with payments, budgets, banking, shopping, markets, and commerce.";
    readonly keywords: readonly ["finance", "payment", "budget", "bank", "shopping", "market", "commerce"];
}, {
    readonly slug: "lifestyle";
    readonly label: "Lifestyle";
    readonly icon: "shapes";
    readonly description: "Travel, health, fitness, cooking, sports, home, and daily-life utilities.";
    readonly keywords: readonly ["travel", "health", "fitness", "cooking", "sports", "weather", "home"];
}, {
    readonly slug: "other";
    readonly label: "Other";
    readonly icon: "package";
    readonly description: "Skills that do not yet fit another browse category.";
    readonly keywords: readonly [];
}];
export type PluginCategorySlug = (typeof PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"] | (typeof LEGACY_PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"];
export type SkillCategorySlug = (typeof SKILL_CATEGORY_DEFINITIONS)[number]["slug"];
export declare const PLUGIN_CATEGORY_SLUGS: ("agent-orchestration" | "channels" | "context" | "data-analytics" | "developer-tools" | "documents-files" | "finance-payments" | "inbox-collaboration" | "infrastructure" | "integrations" | "media" | "memory" | "models" | "other" | "productivity" | "research" | "sales-marketing" | "scheduling" | "security" | "voice" | "web")[];
export declare const SKILL_CATEGORY_SLUGS: ("agents" | "automation" | "communication" | "creative" | "development" | "finance" | "integrations" | "knowledge" | "lifestyle" | "operations" | "other" | "productivity" | "research" | "security")[];
export declare function isPluginCategorySlug(value: string | null | undefined): value is PluginCategorySlug;
export declare function isSkillCategorySlug(value: string | null | undefined): value is SkillCategorySlug;
export declare function normalizePluginCategories(values: readonly string[] | null | undefined): PluginCategorySlug[];
export declare function normalizeSkillCategories(values: readonly string[] | null | undefined): SkillCategorySlug[];
export declare function resolvePluginCategories(input: {
    declared?: readonly string[] | null;
    inferred?: readonly string[] | null;
}): PluginCategorySlug[];
export declare function resolveSkillCategories(input: {
    declared?: readonly string[] | null;
    inferred?: readonly string[] | null;
}): SkillCategorySlug[];
export declare function inferSkillCategories(input: {
    slug?: string | null;
    displayName?: string | null;
    summary?: string | null;
}): SkillCategorySlug[];
export declare function normalizeCatalogTopic(value: string): string | undefined;
export declare function normalizeCatalogTopics(values: readonly string[] | null | undefined): string[];
export declare function normalizeInferredCatalogTopics(values: readonly string[] | null | undefined): string[];
export declare function resolveCatalogTopics(input: {
    declared?: readonly string[] | null;
    inferred?: readonly string[] | null;
    inferenceCurrent?: boolean;
}): string[];
export declare function getCatalogTopicSlugs(values: readonly string[] | null | undefined): string[];
type SkillCategoryCandidate = {
    categories?: readonly string[] | null;
    inferredCategories?: readonly string[] | null;
    latestVersionId?: string | null;
    inferredFromVersionId?: string | null;
    slug: string;
    displayName: string;
    summary?: string | null;
};
export declare function resolveStoredSkillCategories(skill: SkillCategoryCandidate): SkillCategorySlug[];
export {};
