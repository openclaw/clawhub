export declare const CATALOG_TOPIC_LIMIT = 8;
export declare const CATALOG_TOPIC_MAX_LENGTH = 32;
export declare const INTERNAL_UNCATEGORIZED_CATEGORY = "uncategorized";
export declare const SKILL_CATEGORY_DEFINITIONS: readonly [{
    readonly slug: "data-apis";
    readonly label: "Data, APIs & Integrations";
    readonly icon: "database";
    readonly description: "Connect services, fetch data, reconcile records, or operate APIs.";
    readonly keywords: readonly ["api", "data", "database", "integration", "fetch", "http", "rest", "graphql"];
}, {
    readonly slug: "agent-behavior";
    readonly label: "Agent Behavior & Memory";
    readonly icon: "brain";
    readonly description: "Change how an agent plans, reflects, learns, remembers, or collaborates.";
    readonly keywords: readonly ["memory", "planning", "reflect", "learn", "reasoning", "context", "multiagent"];
}, {
    readonly slug: "media-creative";
    readonly label: "Media & Creative";
    readonly icon: "palette";
    readonly description: "Create or edit images, video, audio, music, design, and writing.";
    readonly keywords: readonly ["image", "video", "audio", "music", "design", "creative", "writing", "transcribe"];
}, {
    readonly slug: "automation-workflows";
    readonly label: "Automation & Workflows";
    readonly icon: "git-branch";
    readonly description: "Build repeatable processes, scheduled jobs, pipelines, and orchestration.";
    readonly keywords: readonly ["automation", "workflow", "cron", "schedule", "pipeline", "orchestrate", "approval"];
}, {
    readonly slug: "finance-commerce";
    readonly label: "Finance, Commerce & Crypto";
    readonly icon: "wallet-cards";
    readonly description: "Work with payments, budgets, banking, shopping, markets, and crypto.";
    readonly keywords: readonly ["finance", "payment", "budget", "bank", "subscription", "shopping", "market", "crypto"];
}, {
    readonly slug: "web-research";
    readonly label: "Web, Browser & Research";
    readonly icon: "globe";
    readonly description: "Search, browse, scrape, summarize, monitor, or extract web information.";
    readonly keywords: readonly ["web", "browser", "search", "scrape", "research", "crawl", "rss", "extract"];
}, {
    readonly slug: "docs-knowledge";
    readonly label: "Docs, Knowledge & Notes";
    readonly icon: "book-open";
    readonly description: "Work with documents, PDFs, notes, wikis, and knowledge bases.";
    readonly keywords: readonly ["document", "docs", "pdf", "notes", "knowledge", "wiki", "markdown"];
}, {
    readonly slug: "dev-tools";
    readonly label: "Coding & Dev Tools";
    readonly icon: "wrench";
    readonly description: "Inspect, edit, test, build, debug, or operate codebases.";
    readonly keywords: readonly ["dev", "developer", "debug", "lint", "test", "build", "code", "git", "repo"];
}, {
    readonly slug: "communication-social";
    readonly label: "Communication & Social";
    readonly icon: "message-circle";
    readonly description: "Message, post, publish, or operate social and communication services.";
    readonly keywords: readonly ["message", "social", "discord", "slack", "telegram", "whatsapp", "chat", "post"];
}, {
    readonly slug: "monitoring-ops";
    readonly label: "Monitoring & Ops";
    readonly icon: "activity";
    readonly description: "Run status checks, deployments, logs, alerts, and diagnostics.";
    readonly keywords: readonly ["observability", "deploy", "deployment", "log", "alert", "diagnostic", "status", "uptime"];
}, {
    readonly slug: "productivity-tasks";
    readonly label: "Productivity & Tasks";
    readonly icon: "list-checks";
    readonly description: "Manage tasks, calendars, email, meetings, planning, and lightweight work.";
    readonly keywords: readonly ["task", "todo", "calendar", "email", "planning", "project", "productivity", "meeting"];
}, {
    readonly slug: "security-review";
    readonly label: "Security, Vetting & Trust";
    readonly icon: "shield";
    readonly description: "Audit, vet, scan, and review artifacts for security and trust risks.";
    readonly keywords: readonly ["security", "scan", "audit", "vulnerability", "malware", "secret", "vetting", "risk"];
}, {
    readonly slug: "education-learning";
    readonly label: "Education & Learning";
    readonly icon: "graduation-cap";
    readonly description: "Tutor, study, practice, explain, and support learning.";
    readonly keywords: readonly ["tutor", "study", "exercise", "explain", "learning", "practice", "education", "quiz"];
}, {
    readonly slug: "local-system";
    readonly label: "Local System & Files";
    readonly icon: "folder-cog";
    readonly description: "Operate local files, shells, desktop apps, backups, and system state.";
    readonly keywords: readonly ["filesystem", "shell", "terminal", "desktop", "macos", "windows", "backup", "local"];
}, {
    readonly slug: "domain-utilities";
    readonly label: "Domain Utilities";
    readonly icon: "shapes";
    readonly description: "Use specialized helpers for focused real-world domains.";
    readonly keywords: readonly ["weather", "travel", "transit", "health", "fitness", "cooking", "sports", "home"];
}];
export type SkillCategorySlug = (typeof SKILL_CATEGORY_DEFINITIONS)[number]["slug"];
type SkillCategoryCandidate = {
    primaryCategory?: string | null;
    slug: string;
    displayName: string;
    summary?: string | null;
    capabilityTags?: string[] | null;
};
export declare function isSkillCategorySlug(value: string | null | undefined): value is SkillCategorySlug;
export declare function deriveSkillPrimaryCategory(skill: Omit<SkillCategoryCandidate, "primaryCategory">): SkillCategorySlug | undefined;
export declare function resolveSkillPrimaryCategory(skill: SkillCategoryCandidate): SkillCategorySlug | undefined;
export declare function resolveStoredSkillPrimaryCategory(skill: SkillCategoryCandidate): SkillCategorySlug | typeof INTERNAL_UNCATEGORIZED_CATEGORY;
export declare function normalizeCatalogTopic(value: string): string | undefined;
export declare function normalizeCatalogTopics(values: readonly string[] | null | undefined): string[];
export declare function normalizeInferredCatalogTopics(values: readonly string[] | null | undefined): string[];
export {};
