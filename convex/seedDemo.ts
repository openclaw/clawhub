import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./functions";

const DEMO_SKILLS = [
  {
    slug: "mcp-github",
    displayName: "MCP GitHub",
    summary: "Full GitHub API integration via MCP — issues, PRs, repos, code search, and actions.",
    downloads: 14200,
    stars: 342,
    installs: 8100,
  },
  {
    slug: "claude-memory",
    displayName: "Claude Memory",
    summary: "Persistent memory layer for Claude — stores context across conversations with vector recall.",
    downloads: 11800,
    stars: 287,
    installs: 6400,
  },
  {
    slug: "web-scraper-pro",
    displayName: "Web Scraper Pro",
    summary: "Intelligent web scraping with automatic pagination, JS rendering, and structured data extraction.",
    downloads: 9400,
    stars: 198,
    installs: 5200,
  },
  {
    slug: "sql-analyst",
    displayName: "SQL Analyst",
    summary: "Natural language to SQL with schema introspection, query optimization, and result visualization.",
    downloads: 8700,
    stars: 221,
    installs: 4800,
  },
  {
    slug: "pytest-agent",
    displayName: "Pytest Agent",
    summary: "Automated test generation and execution for Python — coverage analysis, mutation testing, fixtures.",
    downloads: 7200,
    stars: 156,
    installs: 3900,
  },
  {
    slug: "docker-compose-helper",
    displayName: "Docker Compose Helper",
    summary: "Generate, validate, and debug Docker Compose configurations with multi-service orchestration.",
    downloads: 6800,
    stars: 134,
    installs: 3600,
  },
  {
    slug: "api-docs-generator",
    displayName: "API Docs Generator",
    summary: "Auto-generate OpenAPI specs and beautiful documentation from any codebase or endpoint.",
    downloads: 5900,
    stars: 178,
    installs: 3100,
  },
  {
    slug: "slack-bot-builder",
    displayName: "Slack Bot Builder",
    summary: "Build and deploy Slack bots with natural language — slash commands, modals, and event handlers.",
    downloads: 5400,
    stars: 112,
    installs: 2800,
  },
  {
    slug: "terraform-assistant",
    displayName: "Terraform Assistant",
    summary: "Infrastructure as code helper — plan reviews, drift detection, module generation for AWS/GCP/Azure.",
    downloads: 4800,
    stars: 145,
    installs: 2400,
  },
  {
    slug: "regex-wizard",
    displayName: "Regex Wizard",
    summary: "Natural language to regex with live testing, explanation, and edge case generation.",
    downloads: 4200,
    stars: 89,
    installs: 2100,
  },
  {
    slug: "git-history-explorer",
    displayName: "Git History Explorer",
    summary: "Semantic search through git history — find commits by intent, trace code evolution, blame analysis.",
    downloads: 3900,
    stars: 102,
    installs: 1900,
  },
  {
    slug: "cron-scheduler",
    displayName: "Cron Scheduler",
    summary: "Natural language to cron expressions with timezone handling, overlap protection, and monitoring.",
    downloads: 3400,
    stars: 67,
    installs: 1600,
  },
  {
    slug: "jwt-debugger",
    displayName: "JWT Debugger",
    summary: "Decode, verify, and generate JWTs with visual payload inspection and expiry tracking.",
    downloads: 3100,
    stars: 78,
    installs: 1400,
  },
  {
    slug: "graphql-builder",
    displayName: "GraphQL Builder",
    summary: "Schema-first GraphQL development — type generation, resolver scaffolding, and playground integration.",
    downloads: 2800,
    stars: 94,
    installs: 1200,
  },
  {
    slug: "security-scanner",
    displayName: "Security Scanner",
    summary: "OWASP-aware security scanning for codebases — dependency audit, secret detection, SAST patterns.",
    downloads: 2500,
    stars: 156,
    installs: 1100,
  },
  {
    slug: "markdown-slides",
    displayName: "Markdown Slides",
    summary: "Turn markdown into presentation decks with themes, speaker notes, and PDF export.",
    downloads: 2200,
    stars: 45,
    installs: 900,
  },
  {
    slug: "env-manager",
    displayName: "Env Manager",
    summary: "Environment variable management across projects — sync .env files, validate schemas, rotate secrets.",
    downloads: 1800,
    stars: 56,
    installs: 800,
  },
  {
    slug: "csv-transform",
    displayName: "CSV Transform",
    summary: "Powerful CSV/TSV manipulation — column transforms, joins, pivots, and format conversion.",
    downloads: 1500,
    stars: 34,
    installs: 600,
  },
  {
    slug: "ssh-config-manager",
    displayName: "SSH Config Manager",
    summary: "Manage SSH configs, keys, and tunnels with natural language — jump hosts, port forwarding, agent setup.",
    downloads: 1200,
    stars: 42,
    installs: 500,
  },
  {
    slug: "changelog-writer",
    displayName: "Changelog Writer",
    summary: "Generate changelogs from git history with conventional commit parsing and release note formatting.",
    downloads: 980,
    stars: 28,
    installs: 400,
  },
];

const DEMO_OWNERS = [
  { handle: "anthropic", displayName: "Anthropic", highlighted: true },
  { handle: "openai-labs", displayName: "OpenAI Labs", highlighted: false },
  { handle: "devtools-co", displayName: "DevTools Co", highlighted: false },
  { handle: "securityfirst", displayName: "SecurityFirst", highlighted: true },
  { handle: "dataflow", displayName: "DataFlow", highlighted: false },
];

export const seedDemoSkills = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if we already seeded
    const existingSkill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", "mcp-github"))
      .first();
    if (existingSkill) {
      return { seeded: false, reason: "already seeded" };
    }

    // Create a seed user
    const seedUserId = await ctx.db.insert("users", {
      name: "ClawHub Demo",
      displayName: "ClawHub Demo",
      handle: "clawhub-demo",
      image: undefined,
      role: "admin",
    });

    // Create publisher accounts
    const publisherIds: string[] = [];
    for (const owner of DEMO_OWNERS) {
      const pubId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: owner.handle,
        displayName: owner.displayName,
        linkedUserId: seedUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      publisherIds.push(pubId);

      // Add membership
      await ctx.db.insert("publisherMembers", {
        publisherId: pubId as Id<"publishers">,
        userId: seedUserId,
        role: "owner",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const now = Date.now();
    const DAY = 86400000;
    let totalPublishedSkills = 0;
    let totalStars = 0;
    let totalDownloads = 0;

    for (let i = 0; i < DEMO_SKILLS.length; i++) {
      const s = DEMO_SKILLS[i];
      const ownerIdx = i % publisherIds.length;
      const createdDaysAgo = Math.floor(Math.random() * 90) + 7;
      const updatedDaysAgo = Math.floor(Math.random() * createdDaysAgo);
      const createdAt = now - createdDaysAgo * DAY;
      const updatedAt = now - updatedDaysAgo * DAY;
      const version = `${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}`;

      const isHighlighted = i < 6;
      const badges = isHighlighted
        ? { highlighted: { byUserId: seedUserId, at: now } }
        : undefined;

      const numVersions = Math.floor(Math.random() * 8) + 1;
      const numComments = Math.floor(Math.random() * 15);

      // Create skill first (without latestVersionId)
      const skillId = await ctx.db.insert("skills", {
        slug: s.slug,
        displayName: s.displayName,
        summary: s.summary,
        ownerUserId: seedUserId,
        ownerPublisherId: publisherIds[ownerIdx] as Id<"publishers">,
        tags: {},
        badges,
        moderationStatus: "active",
        moderationVerdict: "clean",
        stats: {
          downloads: s.downloads,
          installsCurrent: Math.floor(s.installs * 0.3),
          installsAllTime: s.installs,
          stars: s.stars,
          versions: numVersions,
          comments: numComments,
        },
        statsDownloads: s.downloads,
        statsStars: s.stars,
        statsInstallsCurrent: Math.floor(s.installs * 0.3),
        statsInstallsAllTime: s.installs,
        createdAt,
        updatedAt,
      });

      // Create skillBadges entry for highlighted skills
      if (isHighlighted) {
        await ctx.db.insert("skillBadges", {
          skillId,
          kind: "highlighted",
          byUserId: seedUserId,
          at: now,
        });
      }

      // Now create version with real skillId
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version,
        changelog: `Release ${version} — improvements and bug fixes.`,
        files: [],
        parsed: { frontmatter: {} },
        createdBy: seedUserId,
        createdAt: updatedAt,
      });

      // Patch skill with version info
      await ctx.db.patch(skillId, {
        latestVersionId: versionId,
        latestVersionSummary: {
          version,
          createdAt: updatedAt,
          changelog: `Release ${version}`,
        },
        tags: { latest: versionId },
      });

      totalPublishedSkills += 1;
      totalStars += s.stars;
      totalDownloads += s.downloads;

      // Create digest for search
      await ctx.db.insert("skillSearchDigest", {
        skillId,
        slug: s.slug,
        displayName: s.displayName,
        summary: s.summary,
        ownerUserId: seedUserId,
        ownerPublisherId: publisherIds[ownerIdx] as Id<"publishers">,
        ownerHandle: DEMO_OWNERS[ownerIdx].handle,
        ownerName: DEMO_OWNERS[ownerIdx].displayName,
        ownerDisplayName: DEMO_OWNERS[ownerIdx].displayName,
        ownerImage: undefined,
        latestVersionId: versionId,
        latestVersionSummary: {
          version,
          createdAt: updatedAt,
          changelog: `Release ${version}`,
        },
        tags: { latest: versionId },
        badges,
        stats: {
          downloads: s.downloads,
          installsCurrent: Math.floor(s.installs * 0.3),
          installsAllTime: s.installs,
          stars: s.stars,
          versions: numVersions,
          comments: numComments,
        },
          versions: numVersions,
          comments: numComments,
        moderationReason: undefined,
        isSuspicious: false,
        createdAt,
        updatedAt,
      });
    }

    await ctx.db.patch(seedUserId, {
      publishedSkills: totalPublishedSkills,
      totalStars,
      totalDownloads,
    });

    return { seeded: true, count: DEMO_SKILLS.length };
  },
});

// Repair globalStats count to match actual seeded data
export const repairGlobalStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Count active digests — push filter server-side
    const digests = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
      .filter((q) => q.eq(q.field("moderationStatus"), "active"))
      .collect();

    const count = digests.length;

    // Update globalStats
    const stats = await ctx.db
      .query("globalStats")
      .filter((q) => q.eq(q.field("key"), "default"))
      .first();

    if (stats) {
      await ctx.db.patch(stats._id, { activeSkillsCount: count, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("globalStats", {
        key: "default",
        activeSkillsCount: count,
        updatedAt: Date.now(),
      });
    }

    return { count };
  },
});

// Repair function to add missing skillBadges for already-seeded data
export const repairHighlightedBadges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const highlightedSlugs = DEMO_SKILLS.slice(0, 6).map((s) => s.slug);
    let fixed = 0;

    for (const slug of highlightedSlugs) {
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!skill) continue;

      // Check if badge already exists
      const existing = await ctx.db
        .query("skillBadges")
        .withIndex("by_skill_kind", (q) =>
          q.eq("skillId", skill._id).eq("kind", "highlighted"),
        )
        .first();
      if (existing) continue;

      await ctx.db.insert("skillBadges", {
        skillId: skill._id,
        kind: "highlighted",
        byUserId: skill.ownerUserId,
        at: Date.now(),
      });
      fixed++;
    }

    return { fixed };
  },
});
