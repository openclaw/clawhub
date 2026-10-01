import assert from "node:assert/strict";
import { test } from "vitest";
import {
  classifyPlugin,
  classifySkill,
  PLUGIN_CATEGORY_SLUGS,
  SKILL_CATEGORY_SLUGS,
  TOPIC_CLASSIFIER_VERSION,
} from "./catalogClassifier.mjs";

test("category registries include visible Other fallbacks", () => {
  assert.deepEqual(PLUGIN_CATEGORY_SLUGS, [
    "channels",
    "models",
    "memory",
    "context",
    "voice",
    "media",
    "web",
    "tools",
    "runtime",
    "gateway",
    "security",
    "other",
  ]);
  assert.deepEqual(SKILL_CATEGORY_SLUGS, [
    "integrations",
    "automation",
    "research",
    "development",
    "productivity",
    "communication",
    "creative",
    "knowledge",
    "agents",
    "operations",
    "security",
    "finance",
    "lifestyle",
    "other",
  ]);
});

test("explicit plugin categories preserve author order after retained exclusive kinds", () => {
  const result = classifyPlugin({
    explicitCategories: ["web", "models", "media", "voice"],
    manifest: {
      kind: "memory",
      providers: ["demo"],
      contracts: { speechProviders: ["demo"] },
    },
  });

  assert.deepEqual(result.categories, ["memory", "web", "models"]);
  assert.equal(result.provenance, "author");
  assert.equal(result.needsAi, false);
});

test("plugin context-engine kind is retained as Context rather than Memory", () => {
  const result = classifyPlugin({
    manifest: {
      kind: "context-engine",
      contracts: { tools: ["demo"] },
    },
  });

  assert.deepEqual(result.categories, ["context", "tools"]);
});

test("plugin exclusive memory kind is retained when auto candidates exceed three", () => {
  const result = classifyPlugin({
    manifest: {
      kind: "memory",
      channels: ["demo"],
      providers: ["demo"],
      contracts: {
        speechProviders: ["demo"],
        imageGenerationProviders: ["demo"],
        webSearchProviders: ["demo"],
      },
    },
  });

  assert.equal(result.categories.includes("memory"), true);
  assert.equal(result.categories.length, 3);
  assert.equal(result.rawCandidates.length > 3, true);
  assert.equal(result.needsAi, true);
});

test("plugin contribution contracts map without inspecting runtime code", () => {
  const result = classifyPlugin({
    manifest: {
      contracts: {
        webSearchProviders: ["demo"],
        externalAuthProviders: ["demo"],
        gatewayMethodDispatch: ["authenticated-request"],
      },
    },
  });

  assert.deepEqual(result.categories, ["web", "gateway", "security"]);
  assert.equal(result.confidence, "high");
  assert.equal(result.needsAi, false);
});

test("generic skills-only plugin contribution maps to broad Tools and enters AI review", () => {
  const result = classifyPlugin({
    manifest: {
      skills: ["skills/research/SKILL.md"],
    },
  });

  assert.deepEqual(result.categories, ["tools"]);
  assert.equal(result.rawCandidates[0].category, "tools");
  assert.equal(result.confidence, "medium");
  assert.equal(result.needsAi, true);
});

test("static plugin text classifies hook-only and missing-manifest plugins", () => {
  const result = classifyPlugin({
    slug: "clawguard",
    text: "Security policy enforcement, permission checks, and prompt injection protection.",
    manifest: {
      kind: "hook-only",
      configSchema: { type: "object" },
    },
  });

  assert.deepEqual(result.categories, ["security", "runtime"]);
  assert.equal(result.categories.includes("other"), false);
  assert.equal(result.needsAi, true);
});

test("specific static plugin text suppresses broad weak Tools fallback", () => {
  const result = classifyPlugin({
    slug: "research-bundle",
    text: "Web search and browser research toolkit.",
    manifest: {
      skills: ["skills/research/SKILL.md"],
    },
  });

  assert.deepEqual(result.categories, ["web"]);
});

test("unknown plugin contracts are preserved and force review", () => {
  const result = classifyPlugin({
    manifest: {
      contracts: {
        webSearchProviders: ["demo"],
        futureQuantumProviders: ["demo"],
      },
    },
  });

  assert.deepEqual(result.categories, ["web"]);
  assert.deepEqual(result.unknownSignals, ["contracts.futureQuantumProviders"]);
  assert.equal(result.confidence, "medium");
  assert.equal(result.needsAi, true);
});

test("hook-only plugin uses weak Runtime fallback instead of Other", () => {
  const result = classifyPlugin({
    manifest: {
      kind: "hook-only",
      configSchema: { type: "object" },
    },
  });

  assert.deepEqual(result.categories, ["runtime"]);
  assert.equal(result.confidence, "medium");
  assert.equal(result.needsAi, true);
});

test("high-confidence web search skill can skip AI", () => {
  const result = classifySkill({
    slug: "search-with-tavily",
    text: [
      "--- name: tavily-search description: Web search using Tavily API for current research. ---",
      "# Tavily Search",
      "Search the web, retrieve current news, and collect research sources.",
    ].join("\n"),
  });

  assert.deepEqual(result.categories, ["research"]);
  assert.equal(result.confidence, "high");
  assert.equal(result.needsAi, false);
});

test("incidental API authentication does not classify a skill as security", () => {
  const result = classifySkill({
    slug: "invoice-api-client",
    text: [
      "---",
      "name: invoice-api-client",
      "description: Fetch invoice records from a REST API and return JSON.",
      "metadata:",
      "  requires:",
      "    env: [API_SECRET]",
      "---",
      "# Invoice API Client",
      "Authenticate with the API token, then request invoice records.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("integrations"), true);
  assert.equal(result.categories.includes("security"), false);
});

test("intent-level security skill is classified as security", () => {
  const result = classifySkill({
    slug: "dependency-security-audit",
    text: [
      "---",
      "name: dependency-security-audit",
      "description: Audit dependencies for vulnerabilities and credential leaks.",
      "---",
      "# Dependency Security Audit",
      "Scan source dependencies and report remediation guidance.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("security"), true);
  assert.equal(result.confidence, "high");
});

test("operations and security are separate skill categories", () => {
  const result = classifySkill({
    slug: "docker-deployer",
    text: [
      "---",
      "name: docker-deployer",
      "description: Deploy and monitor Docker services in production.",
      "---",
      "# Docker Deployer",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("operations"), true);
  assert.equal(result.categories.includes("security"), false);
});

test("frontmatter operational metadata is not treated as primary category intent", () => {
  const result = classifySkill({
    slug: "image-maker",
    text: [
      "---",
      "name: image-maker",
      "description: Generate and edit images for social media campaigns.",
      "metadata:",
      "  openclaw:",
      "    requires:",
      "      env: [IMAGE_API_SECRET]",
      "---",
      "# Image Maker",
      "Use authentication to call the hosted service.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("security"), false);
});

test("inline frontmatter does not promote incidental body terms over the stated purpose", () => {
  const result = classifySkill({
    slug: "ffmpeg-master-pro",
    text: [
      "--- name: ffmpeg-master-pro description: 全能视频处理技能，支持视频转换、压缩和编辑。 ---",
      "# 视频处理",
      "Includes presets named wechat and social_media for output compatibility.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("communication"), false);
});

test("body-only category evidence remains raw evidence instead of an exposed category", () => {
  const result = classifySkill({
    slug: "pentest-reference",
    text: [
      "--- name: pentest-reference description: Browse penetration testing resources for security audits. ---",
      "# Pentest Reference",
      "The implementation can be used in a larger automation pipeline and batch workflow.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("security"), true);
  assert.equal(result.categories.includes("automation"), false);
  assert.equal(
    result.rawCandidates.some((candidate) => candidate.category === "automation"),
    true,
  );
});

test("inline frontmatter closes before a later Markdown separator", () => {
  const result = classifySkill({
    slug: "awesome-pentest",
    text: [
      "--- name: awesome-pentest description: Security audits and penetration testing reference. ---",
      "# Awesome Pentest",
      "Use this reference from an automation pipeline and batch workflow.",
      "",
      "---",
      "Footer: automation pipeline workflow.",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("security"), true);
  assert.equal(result.categories.includes("automation"), false);
  assert.equal(
    result.rawCandidates.some((candidate) => candidate.category === "automation"),
    true,
  );
});

test("later Markdown separator does not promote communication platforms from the body", () => {
  const result = classifySkill({
    slug: "ffmpeg-master-pro",
    text: [
      "--- name: ffmpeg-master-pro description: 全能视频处理技能，支持视频转换、压缩和编辑。 ---",
      "# 视频处理",
      "输出兼容微信、抖音和小红书。",
      "",
      "---",
      "更多平台预设。",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("communication"), false);
});

test("flattened inline frontmatter does not treat the entire body as a heading", () => {
  const result = classifySkill({
    slug: "find-stl",
    text: "--- name: find-stl description: Search and download ready-to-print 3D model files. --- # find-stl This skill writes manifest.json files and uses GraphQL. ## Resources API integration details.",
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("integrations"), false);
});

test("every exposed secondary skill category requires purpose-level primary evidence", () => {
  const result = classifySkill({
    slug: "video-editor",
    text: "--- name: video-editor description: Edit and process videos with a simple API. --- # Video Editor ## Implementation Automate workflows and batch processing.",
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("integrations"), false);
  assert.equal(result.categories.includes("automation"), false);
  assert.equal(
    result.rawCandidates.some((candidate) => candidate.category === "automation"),
    true,
  );
});

test("a corroborated single primary signal may expose only a medium top candidate", () => {
  const result = classifySkill({
    slug: "desktime",
    text: "--- name: desktime description: DeskTime integration for user and project records. --- # DeskTime ## Implementation Uses an API and returns JSON.",
  });

  assert.deepEqual(result.categories, ["integrations"]);
  assert.equal(result.confidence, "medium");
  assert.equal(result.needsAi, true);
});

test("owner handle words do not become skill category evidence", () => {
  const result = classifySkill({
    slug: "design-owner/local-service-booking",
    text: "--- name: local-service-booking description: Find and book local plumbers and electricians. --- # Local Service Booking",
  });

  assert.equal(result.categories.includes("creative"), false);
});

test("a social-media destination does not outrank a creative media purpose", () => {
  const result = classifySkill({
    slug: "video-generator",
    text: "--- name: video-generator description: Generate and edit videos ready to share on social media. --- # Video Generator",
  });

  assert.equal(result.categories.includes("creative"), true);
  assert.equal(result.categories.includes("communication"), false);
});

test("a communication platform mention alone cannot create high confidence", () => {
  const result = classifySkill({
    slug: "prediction-market-creator",
    text: "--- name: prediction-market-creator description: Create prediction markets by analyzing trending Twitter content. --- # Prediction Market Creator",
  });

  assert.notEqual(result.confidence, "high");
  assert.equal(result.needsAi, true);
});

test("full-stack development intent outranks incidental deployment scope", () => {
  const result = classifySkill({
    slug: "fullstack-dev-engineer",
    text: "--- name: fullstack-dev-engineer description: 全栈开发、前端开发、后端开发与运维部署指导。 --- # 全栈开发工程师",
  });

  assert.equal(result.categories[0], "development");
});

test("recurring domain-specific titles map to their purpose categories", () => {
  const competitor = classifySkill({
    slug: "competitor-monitoring",
    text: "--- name: competitor-monitoring description: Track competitors with pricing alerts and positioning analysis. --- # Competitor Monitoring",
  });
  const privacy = classifySkill({
    slug: "dpia-drafter",
    text: "--- name: dpia-drafter description: Draft a GDPR data protection impact assessment for privacy counsel. --- # DPIA Drafter",
  });
  const document = classifySkill({
    slug: "driving-license-recognition",
    text: "--- name: driving-license-recognition description: OCR document recognition and information extraction for driving licenses. --- # License Recognition",
  });

  assert.equal(competitor.categories.includes("research"), true);
  assert.equal(privacy.categories.includes("security"), true);
  assert.equal(document.categories.includes("knowledge"), true);
});

test("remaining recurring purpose cues map without lowering global thresholds", () => {
  const research = classifySkill({
    slug: "arxiv-literature-review",
    text: "--- name: arxiv-literature-review description: Read arXiv papers and prepare a literature review. ---",
  });
  const communication = classifySkill({
    slug: "gmail-forward",
    text: "--- name: gmail-forward description: Forward Gmail messages to new recipients. ---",
  });
  const integrations = classifySkill({
    slug: "google-sheets",
    text: "--- name: google-sheets description: Read and write spreadsheets in Google Sheets. ---",
  });
  const agents = classifySkill({
    slug: "weekly-self-improve-loop",
    text: "--- name: weekly-self-improve-loop description: Run a weekly self-improve review for the agent. ---",
  });
  const operations = classifySkill({
    slug: "log-analyzer",
    text: "--- name: log-analyzer description: Perform log analysis for running services. ---",
  });
  const security = classifySkill({
    slug: "privacy-review",
    text: "--- name: privacy-review description: Review privacy requirements and controls. ---",
  });

  assert.equal(research.categories.includes("research"), true);
  assert.equal(communication.categories.includes("communication"), true);
  assert.equal(integrations.categories.includes("integrations"), true);
  assert.equal(agents.categories.includes("agents"), true);
  assert.equal(operations.categories.includes("operations"), true);
  assert.equal(security.categories.includes("security"), true);
});

test("crisis communication purpose maps to Communication", () => {
  const result = classifySkill({
    slug: "crisis-communication",
    text: "--- name: crisis-communication description: Develop crisis communication scripts, media response strategies, and statement drafting. --- # Crisis Communication ## Operations Automate business workflows.",
  });

  assert.equal(result.categories.includes("communication"), true);
  assert.equal(result.categories.includes("automation"), false);
});

test("delimiter-free flattened metadata uses the first declared description only", () => {
  const result = classifySkill({
    slug: "weather-skill",
    text: "name: weather-skill description: Fetches current weather information for a specified location. name: weather-skill description: Send messages through Feishu. # Implementation",
  });

  assert.equal(result.categories.includes("lifestyle"), true);
  assert.equal(result.categories.includes("communication"), false);
});

test("delimiter-free flattened heading does not promote later body categories", () => {
  const result = classifySkill({
    slug: "weather-query",
    text: "# Weather Query Fetch current weather information for a city. ## Implementation Send messages, publish social media posts, and automate workflows.",
  });

  assert.equal(result.categories.includes("lifestyle"), true);
  assert.equal(result.categories.includes("communication"), false);
  assert.equal(result.categories.includes("automation"), false);
});

test("generic monitoring language does not imply local systems operations", () => {
  const result = classifySkill({
    slug: "competitor-monitoring",
    text: [
      "---",
      "name: competitor-monitoring",
      "description: Monitor competitors, pricing, positioning, and marketing campaigns.",
      "---",
      "# Competitor Monitoring",
    ].join("\n"),
  });

  assert.equal(result.categories.includes("operations"), false);
});

test("generic primary keywords cannot create a high-confidence skill result", () => {
  const result = classifySkill({
    slug: "business-helper",
    text: [
      "---",
      "name: business-helper",
      "description: Help with business projects and tasks.",
      "---",
      "# Business Helper",
    ].join("\n"),
  });

  assert.notEqual(result.confidence, "high");
  assert.equal(result.needsAi, true);
});

test("Chinese creative intent classifies video scripting as Creative", () => {
  const result = classifySkill({
    slug: "ai-video-script",
    text: "--- name: ai-video-script description: AI视频脚本生成器，支持视频策划、分镜、配音文案和短视频创作。 --- # AI 视频脚本生成器",
  });

  assert.equal(result.categories.includes("creative"), true);
});

test("Chinese productivity intent classifies recurring work reports as Productivity", () => {
  const result = classifySkill({
    slug: "report-summary-builder",
    text: "--- name: report-summary-builder description: 基于已有日报自动汇总生成周报和月报。 --- # 工作汇总助手",
  });

  assert.equal(result.categories.includes("productivity"), true);
});

test("Chinese agent memory intent classifies memory synchronization as Agents", () => {
  const result = classifySkill({
    slug: "memory-auto-sync",
    text: "# 极简记忆自动同步\n\n自动监听对话并写入记忆文件，支持会话记忆和上下文管理。",
  });

  assert.equal(result.categories.includes("agents"), true);
});

test("Chinese finance and security intent map to their separate categories", () => {
  const finance = classifySkill({
    slug: "asset-allocator",
    text: "--- name: asset-allocator description: 提供资产配置、股票投资、量化交易和财报分析。 --- # 资产配置",
  });
  const security = classifySkill({
    slug: "security-scanner",
    text: "--- name: security-scanner description: 执行安全审计、漏洞扫描、权限检查和恶意软件检测。 --- # 安全扫描",
  });

  assert.equal(finance.categories.includes("finance"), true);
  assert.equal(security.categories.includes("security"), true);
  assert.equal(security.categories.includes("finance"), false);
});

test("ambiguous skill stays Other until AI or author classification", () => {
  const result = classifySkill({
    slug: "cult-of-carcinization",
    text: "# Cult of Carcinization\n\nBecome crab.",
  });

  assert.deepEqual(result.categories, ["other"]);
  assert.equal(result.confidence, "low");
  assert.equal(result.needsAi, true);
});

test("explicit skill categories are validated, ordered, and capped", () => {
  const result = classifySkill({
    slug: "demo",
    text: "# Demo",
    explicitCategories: ["finance", "lifestyle", "communication", "creative", "not-a-category"],
  });

  assert.deepEqual(result.categories, ["finance", "lifestyle", "communication"]);
  assert.equal(result.provenance, "author");
  assert.equal(result.needsAi, false);
});

test("explicit author topics preserve labels, reject reserved values, deduplicate, and cap", () => {
  const result = classifySkill({
    slug: "demo",
    text: "# Demo",
    explicitTopics: [
      "GPU Development",
      "CUDA",
      "gpu-development",
      "official",
      "AI",
      "MCP",
      "GraphQL",
      "Docker",
    ],
  });

  assert.deepEqual(result.topics, ["GPU Development", "CUDA", "AI", "MCP", "GraphQL"]);
  assert.equal(result.topicConfidence, "high");
  assert.equal(result.topicsNeedAi, false);
  assert.equal(result.topicProvenance, "author");
  assert.equal(result.topicClassifierVersion, TOPIC_CLASSIFIER_VERSION);
});

test("skill root tags become inferred topics only when specific and corroborated", () => {
  const result = classifySkill({
    slug: "docker-development",
    text: [
      "---",
      "name: docker-development",
      "description: Build and optimize Docker containers and Dockerfiles.",
      "tags:",
      "  - docker",
      "  - development",
      "  - openclaw",
      "  - latest",
      "---",
      "# Docker Development",
    ].join("\n"),
  });

  assert.deepEqual(result.topics, ["Docker"]);
  assert.equal(result.topicConfidence, "high");
  assert.equal(result.topicsNeedAi, false);
  assert.equal(
    result.rawTopicCandidates.some((candidate) => candidate.slug === "development"),
    false,
  );
  assert.equal(
    result.rawTopicCandidates.some((candidate) => candidate.slug === "openclaw"),
    false,
  );
});

test("an uncorroborated skill tag remains a medium-confidence review candidate", () => {
  const result = classifySkill({
    slug: "infrastructure-helper",
    text: [
      "---",
      "name: infrastructure-helper",
      "description: Help manage infrastructure configuration.",
      "tags: [terraform]",
      "---",
      "# Infrastructure Helper",
    ].join("\n"),
  });

  assert.deepEqual(result.topics, ["Terraform"]);
  assert.equal(result.topicConfidence, "medium");
  assert.equal(result.topicsNeedAi, true);
});

test("specific primary purpose phrases may become medium topic suggestions without tags", () => {
  const result = classifySkill({
    slug: "current-research",
    text: [
      "---",
      "name: current-research",
      "description: Run web search for current research sources.",
      "---",
      "# Current Research",
    ].join("\n"),
  });

  assert.equal(result.topics.includes("Web Search"), true);
  assert.equal(result.topicConfidence, "medium");
  assert.equal(result.topicsNeedAi, true);
});

test("body-only topic evidence remains raw evidence instead of an exposed topic", () => {
  const result = classifySkill({
    slug: "project-planner",
    text: [
      "---",
      "name: project-planner",
      "description: Organize project milestones and task lists.",
      "---",
      "# Project Planner",
      "The implementation can deploy Docker containers and Kubernetes workloads.",
    ].join("\n"),
  });

  assert.equal(result.topics.includes("Docker"), false);
  assert.equal(
    result.rawTopicCandidates.some((candidate) => candidate.slug === "docker"),
    true,
  );
});

test("structured plugin contributions create high-confidence specific topics", () => {
  const result = classifyPlugin({
    manifest: {
      channels: ["discord"],
      providers: ["openai"],
      contracts: {
        webSearchProviders: ["tavily"],
        mcpServers: ["demo"],
      },
    },
  });

  assert.deepEqual(result.topics, ["Discord", "MCP", "OpenAI", "Tavily", "Web Search"]);
  assert.equal(result.topicConfidence, "high");
  assert.equal(result.topicsNeedAi, false);
});

test("plugin package tags require corroboration before becoming high confidence", () => {
  const result = classifyPlugin({
    slug: "docker-runner",
    topicTags: ["docker", "plugin", "latest"],
  });

  assert.deepEqual(result.topics, ["Docker"]);
  assert.equal(result.topicConfidence, "high");
  assert.equal(result.topicsNeedAi, false);
});

test("topic aliases deduplicate into a stable canonical label", () => {
  const result = classifySkill({
    slug: "postgresql-helper",
    text: [
      "---",
      "name: postgresql-helper",
      "description: Inspect PostgreSQL databases and queries.",
      "tags: [postgres, postgresql]",
      "---",
      "# PostgreSQL Helper",
    ].join("\n"),
  });

  assert.deepEqual(result.topics, ["PostgreSQL"]);
});

test("topic aliases merge platform rebrands and redundant package labels", () => {
  const result = classifyPlugin({
    topicTags: ["x", "twitter", "mcp-server", "mcp", "mongodb", "crm"],
  });

  assert.deepEqual(result.topics, ["CRM", "MCP", "MongoDB", "Twitter"]);
});

test("known inferred topic labels preserve conventional brand and acronym casing", () => {
  const result = classifyPlugin({
    topicTags: ["ffmpeg", "http", "linkedin", "oauth", "url"],
  });

  assert.deepEqual(result.topics, ["FFmpeg", "HTTP", "LinkedIn", "OAuth", "URL"]);
});

test("a more specific inferred topic suppresses its broad fragment", () => {
  const result = classifySkill({
    slug: "code-review",
    text: [
      "---",
      "name: code-review",
      "description: Run a code review and report actionable quality findings.",
      "tags: [review, code-review, quality]",
      "---",
      "# Code Review",
    ].join("\n"),
  });

  assert.deepEqual(result.topics, ["Code Review"]);
  assert.equal(
    result.rawTopicCandidates.some(
      (candidate) => candidate.slug === "review" && candidate.suppressedBy === "code-review",
    ),
    true,
  );
});

test("generic lifecycle and category-like compound values never become inferred topics", () => {
  const result = classifyPlugin({
    slug: "demo",
    topicText: "Deprecated reference plugin with status checks for an AI agent model provider.",
    topicTags: [
      "deprecated",
      "reference",
      "status",
      "check",
      "quality",
      "ai-agent",
      "model-provider",
      "search-provider",
      "runner",
      "test",
      "项目",
    ],
  });

  assert.deepEqual(result.topics, []);
});

test("more than five supported topics is capped and forced into review", () => {
  const result = classifyPlugin({
    manifest: {
      channels: ["discord", "slack", "telegram", "whatsapp", "signal", "matrix"],
    },
  });

  assert.equal(result.topics.length, 5);
  assert.equal(result.topicCandidateCountBeforeCap, 6);
  assert.equal(result.topicConfidence, "medium");
  assert.equal(result.topicsNeedAi, true);
});

test("skill slugs cannot self-corroborate an unrelated inferred topic", () => {
  const result = classifySkill({
    slug: "humanizer-backup",
    text: [
      "---",
      "name: humanizer",
      "description: Rewrite generated text so it sounds natural and human.",
      "---",
      "# Humanizer",
    ].join("\n"),
  });

  assert.equal(result.topics.includes("Backup"), false);
});

test("packaging terms and broad category synonyms never become inferred topics", () => {
  const plugin = classifyPlugin({
    slug: "@demo/openclaw-youtube-plugin",
    topicText: "OpenClaw plugin provider for YouTube.",
    topicTags: ["openclaw-plugin", "provider", "youtube"],
  });
  const skill = classifySkill({
    slug: "video-editing",
    text: [
      "---",
      "name: video-editing",
      "description: Edit videos into polished clips.",
      "tags: [video, creative]",
      "---",
      "# Video Editing",
    ].join("\n"),
  });

  assert.deepEqual(plugin.topics, ["YouTube"]);
  assert.equal(skill.topics.includes("Video"), false);
  assert.equal(skill.topics.includes("Video Editing"), true);
});

test("arbitrary plugin tool names remain review candidates instead of trusted topics", () => {
  const result = classifyPlugin({
    manifest: {
      contracts: {
        tools: ["requirement_bootstrap"],
      },
    },
  });

  assert.deepEqual(result.topics, ["Requirement Bootstrap"]);
  assert.equal(result.topicConfidence, "medium");
  assert.equal(result.topicsNeedAi, true);
});
