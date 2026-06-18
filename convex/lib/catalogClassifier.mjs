"use node";

import { createHash } from "node:crypto";

export const CLASSIFIER_VERSION = "taxonomy-prototype-v9";
export const TOPIC_CLASSIFIER_VERSION = "topic-prototype-v1";

const TOPIC_LIMIT = 5;
const TOPIC_MAX_LENGTH = 48;
const RESERVED_TOPIC_SLUGS = new Set([
  "featured",
  "official",
  "recommended",
  "staff-pick",
  "trusted-publisher",
  "verified",
]);

export const PLUGIN_CATEGORIES = [
  ["channels", "Channels"],
  ["models", "Models"],
  ["memory", "Memory"],
  ["context", "Context"],
  ["voice", "Voice"],
  ["media", "Media"],
  ["web", "Web"],
  ["tools", "Tools"],
  ["runtime", "Runtime"],
  ["gateway", "Gateway"],
  ["security", "Security"],
  ["other", "Other"],
];

export const SKILL_CATEGORIES = [
  ["integrations", "Integrations"],
  ["automation", "Automation"],
  ["research", "Research"],
  ["development", "Development"],
  ["productivity", "Productivity"],
  ["communication", "Communication"],
  ["creative", "Creative"],
  ["knowledge", "Knowledge"],
  ["agents", "Agents"],
  ["operations", "Operations"],
  ["security", "Security"],
  ["finance", "Finance"],
  ["lifestyle", "Lifestyle"],
  ["other", "Other"],
];

export const PLUGIN_CATEGORY_SLUGS = PLUGIN_CATEGORIES.map(([slug]) => slug);
export const SKILL_CATEGORY_SLUGS = SKILL_CATEGORIES.map(([slug]) => slug);

const PLUGIN_CATEGORY_SET = new Set(PLUGIN_CATEGORY_SLUGS);
const SKILL_CATEGORY_SET = new Set(SKILL_CATEGORY_SLUGS);
const PLUGIN_ORDER = new Map(PLUGIN_CATEGORY_SLUGS.map((slug, index) => [slug, index]));
const SKILL_ORDER = new Map(SKILL_CATEGORY_SLUGS.map((slug, index) => [slug, index]));

const INFERRED_TOPIC_BLOCKLIST = new Set([
  ...PLUGIN_CATEGORY_SLUGS,
  ...SKILL_CATEGORY_SLUGS,
  "ai",
  "assistant",
  "assistants",
  "agent",
  "agents",
  "api",
  "app",
  "application",
  "ai-agent",
  "ai-agents",
  "automate",
  "bundle",
  "bundles",
  "channel",
  "code",
  "clawhub",
  "demo",
  "design",
  "example",
  "extension",
  "extensions",
  "free",
  "check",
  "checks",
  "deprecated",
  "deprecation",
  "helper",
  "helpers",
  "image",
  "infrastructure",
  "integration",
  "latest",
  "llm",
  "model",
  "model-provider",
  "openclaw",
  "plugin",
  "plugins",
  "project",
  "provider",
  "quality",
  "reference",
  "references",
  "runner",
  "runners",
  "search",
  "search-provider",
  "service",
  "services",
  "skill",
  "skills",
  "social",
  "status",
  "task",
  "test",
  "tests",
  "tool",
  "tools",
  "utility",
  "utilities",
  "video",
  "workflow",
  "代码",
  "任务",
  "图片",
  "搜索",
  "自动化",
  "视频",
  "设计",
  "项目",
]);

const INFERRED_TOPIC_BLOCKED_TOKENS = new Set([
  "bundle",
  "bundles",
  "clawhub",
  "openclaw",
  "plugin",
  "plugins",
  "skill",
  "skills",
]);

const TOPIC_ALIAS_SLUGS = new Map([
  ["github-action", "github-actions"],
  ["github-actions", "github-actions"],
  ["google-calendar-api", "google-calendar"],
  ["k8s", "kubernetes"],
  ["mcp-server", "mcp"],
  ["mcp-servers", "mcp"],
  ["postgres", "postgresql"],
  ["postgresql", "postgresql"],
  ["speech-to-text", "speech-to-text"],
  ["stt", "speech-to-text"],
  ["text-to-speech", "text-to-speech"],
  ["tts", "text-to-speech"],
  ["x", "twitter"],
  ["x-twitter", "twitter"],
]);

const TOPIC_CANONICAL_LABELS = new Map([
  ["3d-model", "3D Models"],
  ["3d-models", "3D Models"],
  ["anthropic", "Anthropic"],
  ["aisa", "AIsa"],
  ["cli", "CLI"],
  ["crm", "CRM"],
  ["csv", "CSV"],
  ["deepseek", "DeepSeek"],
  ["discord", "Discord"],
  ["docker", "Docker"],
  ["ffmpeg", "FFmpeg"],
  ["gemini", "Gemini"],
  ["github", "GitHub"],
  ["github-actions", "GitHub Actions"],
  ["gitlab", "GitLab"],
  ["google-calendar", "Google Calendar"],
  ["graphql", "GraphQL"],
  ["http", "HTTP"],
  ["kubernetes", "Kubernetes"],
  ["linkedin", "LinkedIn"],
  ["matrix", "Matrix"],
  ["mcp", "MCP"],
  ["microsoft-teams", "Microsoft Teams"],
  ["mongodb", "MongoDB"],
  ["mysql", "MySQL"],
  ["nostr", "Nostr"],
  ["ocr", "OCR"],
  ["ollama", "Ollama"],
  ["openai", "OpenAI"],
  ["openoffice", "OpenOffice"],
  ["oauth", "OAuth"],
  ["pdf", "PDF"],
  ["postgresql", "PostgreSQL"],
  ["rss", "RSS"],
  ["signal", "Signal"],
  ["slack", "Slack"],
  ["speech-to-text", "Speech-to-Text"],
  ["sql", "SQL"],
  ["tavily", "Tavily"],
  ["telegram", "Telegram"],
  ["terraform", "Terraform"],
  ["text-to-speech", "Text-to-Speech"],
  ["twitter", "Twitter"],
  ["url", "URL"],
  ["web-search", "Web Search"],
  ["whatsapp", "WhatsApp"],
  ["wechat", "WeChat"],
  ["wordpress", "WordPress"],
  ["xlsx", "XLSX"],
  ["youtube", "YouTube"],
]);

const STRONG_CONTRACT_VALUE_KEYS = new Set([
  "speechProviders",
  "realtimeTranscriptionProviders",
  "realtimeVoiceProviders",
  "voiceProviders",
  "mediaUnderstandingProviders",
  "transcriptSourceProviders",
  "documentExtractors",
  "imageGenerationProviders",
  "videoGenerationProviders",
  "musicGenerationProviders",
  "webContentExtractors",
  "webFetchProviders",
  "webSearchProviders",
  "webSearch",
  "embeddingProviders",
  "memoryEmbeddingProviders",
  "memoryCorpusSupplements",
  "externalAuthProviders",
]);

const CONTRACT_TOPIC_LABELS = {
  commands: "CLI",
  mcpServers: "MCP",
  speechProviders: "Text-to-Speech",
  realtimeTranscriptionProviders: "Speech-to-Text",
  realtimeVoiceProviders: "Voice Calls",
  voiceProviders: "Voice",
  mediaUnderstandingProviders: "Media Understanding",
  transcriptSourceProviders: "Transcription",
  documentExtractors: "Document Extraction",
  imageGenerationProviders: "Image Generation",
  videoGenerationProviders: "Video Generation",
  musicGenerationProviders: "Music Generation",
  webContentExtractors: "Web Extraction",
  webFetchProviders: "Web Fetch",
  webSearchProviders: "Web Search",
  webSearch: "Web Search",
  embeddingProviders: "Embeddings",
  memoryEmbeddingProviders: "Embeddings",
  memoryCorpusSupplements: "Knowledge Retrieval",
  externalAuthProviders: "Authentication",
  trustedToolPolicies: "Policy Enforcement",
  migrationProviders: "Migrations",
  gatewayMethodDispatch: "Gateway Extensions",
  routes: "Routing",
  agentToolResultMiddleware: "Middleware",
  hooks: "Hooks",
};

const PLUGIN_CATEGORY_PRIORITY = {
  memory: 1000,
  context: 990,
  channels: 900,
  models: 850,
  voice: 800,
  media: 750,
  web: 700,
  gateway: 680,
  security: 670,
  runtime: 660,
  tools: 650,
};

const CONTRACT_CATEGORY = {
  tools: "tools",
  commands: "tools",
  mcpServers: "tools",
  cli: "tools",

  speechProviders: "voice",
  realtimeTranscriptionProviders: "voice",
  realtimeVoiceProviders: "voice",
  voiceProviders: "voice",

  mediaUnderstandingProviders: "media",
  transcriptSourceProviders: "media",
  documentExtractors: "media",
  imageGenerationProviders: "media",
  videoGenerationProviders: "media",
  musicGenerationProviders: "media",

  webContentExtractors: "web",
  webFetchProviders: "web",
  webSearchProviders: "web",
  webSearch: "web",

  embeddingProviders: "memory",
  memoryEmbeddingProviders: "memory",
  memoryCorpusSupplements: "memory",

  externalAuthProviders: "security",
  trustedToolPolicies: "security",

  migrationProviders: "gateway",
  gatewayMethodDispatch: "gateway",
  routes: "gateway",

  embeddedExtensionFactories: "runtime",
  agentToolResultMiddleware: "runtime",
  hooks: "runtime",
};

const PLUGIN_KIND_CATEGORY = {
  channel: "channels",
  "bundled-channel-entry": "channels",
  provider: "models",
  tool: "tools",
  tools: "tools",
  skill: "tools",
  integration: "tools",
  hook: "runtime",
  "hook-only": "runtime",
  runtime: "runtime",
  lifecycle: "runtime",
  security: "security",
  "preflight-governance": "security",
};

const PLUGIN_TEXT_RULES = {
  channels: {
    strong: [
      "channel plugin",
      "messaging channel",
      "communication channel",
      "discord",
      "slack",
      "telegram",
      "whatsapp",
      "signal",
      "matrix",
      "microsoft teams",
      "mattermost",
      "feishu",
      "lark",
      "wechat",
      "imessage",
      "zalo",
      "nostr",
    ],
    keywords: ["channel", "messaging", "chat"],
  },
  models: {
    strong: [
      "model provider",
      "llm provider",
      "inference provider",
      "model routing",
      "model router",
      "language model",
      "openai",
      "anthropic",
      "mistral",
      "ollama",
      "deepseek",
      "gemini",
      "groq",
      "bedrock",
      "minimax",
      "xai",
    ],
    keywords: ["model", "inference", "llm"],
  },
  memory: {
    strong: [
      "agent memory",
      "long term memory",
      "memory store",
      "memory system",
      "semantic memory",
      "episodic memory",
      "vector database",
      "vector store",
      "memory embedding",
    ],
    keywords: ["memory", "recall", "embedding", "vector"],
  },
  context: {
    strong: [
      "context engine",
      "context management",
      "context window",
      "context compaction",
      "conversation context",
      "session context",
      "context guardian",
      "context topics",
    ],
    keywords: ["context", "compaction"],
  },
  voice: {
    strong: [
      "voice call",
      "voice assistant",
      "text to speech",
      "speech to text",
      "speech recognition",
      "speech synthesis",
      "audio transcription",
      "realtime voice",
      "transcription",
    ],
    keywords: ["voice", "speech", "tts", "stt", "transcription"],
  },
  media: {
    strong: [
      "image generation",
      "video generation",
      "media generation",
      "image understanding",
      "media understanding",
      "vision model",
      "image processing",
      "video processing",
      "image editing",
      "video editing",
      "music generation",
      "audio generation",
    ],
    keywords: ["image", "video", "media", "vision", "music"],
  },
  web: {
    strong: [
      "web search",
      "search provider",
      "browser automation",
      "web browser",
      "web scraping",
      "web fetch",
      "web research",
      "website crawler",
    ],
    keywords: ["browser", "search", "web", "scrape", "crawl"],
  },
  tools: {
    strong: [
      "mcp server",
      "tool plugin",
      "tool provider",
      "external api",
      "api integration",
      "integration plugin",
      "workflow tool",
      "skills bundle",
      "skill bundle",
      "toolkit",
      "command line",
    ],
    keywords: ["mcp", "integration", "toolkit"],
  },
  runtime: {
    strong: [
      "agent runtime",
      "runtime plugin",
      "plugin runtime",
      "runtime extension",
      "plugin hook",
      "runtime hook",
      "middleware",
      "telemetry",
      "tracing",
      "observability",
      "diagnostics",
      "scheduler",
      "reliability",
      "health checks",
    ],
    keywords: [
      "runtime",
      "hook",
      "middleware",
      "tracing",
      "telemetry",
      "extension",
      "scheduler",
      "diagnostics",
    ],
  },
  gateway: {
    strong: [
      "gateway plugin",
      "gateway operations",
      "gateway method",
      "gateway route",
      "gateway config",
      "gateway health",
      "gateway manager",
      "gateway proxy",
    ],
    keywords: ["gateway", "proxy"],
  },
  security: {
    strong: [
      "security plugin",
      "security audit",
      "authentication provider",
      "authorization provider",
      "access control",
      "permission checks",
      "policy enforcement",
      "prompt injection",
      "secret management",
      "credential management",
      "security policy",
      "sandbox",
      "compliance",
    ],
    keywords: ["security", "permission", "policy", "guard", "sandbox", "compliance"],
  },
};

const SKILL_RULES = {
  integrations: {
    strong: [
      "api integration",
      "data integration",
      "database",
      "data pipeline",
      "data warehouse",
      "data analysis",
      "data processing",
      "data extraction",
      "sql query",
      "rest api",
      "graphql",
      "webhook",
      "postgres",
      "mysql",
      "sqlite",
      "mongodb",
      "spreadsheet",
      "spreadsheets",
      "google sheets",
      "google forms",
      "csv",
      "etl",
      "数据分析",
      "数据处理",
      "数据提取",
      "数据库",
      "接口调用",
      "数据集成",
      "数据同步",
      "数据可视化",
    ],
    keywords: [
      "api",
      "dataset",
      "database",
      "sql",
      "json",
      "csv",
      "integration",
      "sync",
      "接口",
      "数据库",
    ],
  },
  automation: {
    strong: [
      "automation",
      "automate",
      "automated workflow",
      "workflow automation",
      "automation workflow",
      "automate workflow",
      "scheduled task",
      "task scheduler",
      "cron job",
      "batch processing",
      "orchestration",
      "n8n",
      "zapier",
      "自动化",
      "工作流自动化",
      "任务调度",
      "定时任务",
      "批量处理",
      "流程编排",
    ],
    keywords: [
      "automate",
      "workflow",
      "cron",
      "schedule",
      "pipeline",
      "orchestrate",
      "batch",
      "工作流",
      "调度",
      "定时",
      "批量",
    ],
  },
  research: {
    strong: [
      "web search",
      "search the web",
      "browser automation",
      "web browser",
      "web scraping",
      "scrape website",
      "crawl website",
      "online research",
      "market research",
      "literature review",
      "arxiv",
      "competitor monitoring",
      "competitor analysis",
      "competitive intelligence",
      "current research",
      "current information",
      "current news",
      "rss feed",
      "playwright",
      "selenium",
      "网页搜索",
      "网络搜索",
      "浏览器自动化",
      "网页抓取",
      "市场研究",
      "市场调研",
      "新闻检索",
      "舆情分析",
    ],
    keywords: [
      "browser",
      "research",
      "scrape",
      "crawl",
      "website",
      "news",
      "rss",
      "search",
      "搜索",
      "调研",
      "研究",
      "新闻",
    ],
  },
  development: {
    strong: [
      "code review",
      "software development",
      "full stack development",
      "fullstack development",
      "frontend development",
      "backend development",
      "full stack developer",
      "fullstack developer",
      "developer tool",
      "developer workflow",
      "debug code",
      "debugging",
      "unit test",
      "integration test",
      "test driven development",
      "pull request",
      "git repository",
      "source code",
      "command line interface",
      "typescript",
      "javascript",
      "python code",
      "代码审查",
      "软件开发",
      "代码开发",
      "全栈开发",
      "前端开发",
      "后端开发",
      "全栈工程师",
      "单元测试",
      "编程",
      "源码",
      "技术开发",
    ],
    keywords: [
      "code",
      "coding",
      "developer",
      "debug",
      "test",
      "git",
      "github",
      "repository",
      "sdk",
      "代码",
      "开发",
      "调试",
      "测试",
      "编程",
    ],
  },
  productivity: {
    strong: [
      "project management",
      "task management",
      "business analysis",
      "business operations",
      "sales pipeline",
      "customer relationship management",
      "meeting notes",
      "meeting assistant",
      "calendar management",
      "jira",
      "notion",
      "crm",
      "human resources",
      "marketing",
      "项目管理",
      "任务管理",
      "客户管理",
      "销售管理",
      "会议纪要",
      "日报",
      "周报",
      "月报",
      "工作汇总",
      "营销",
    ],
    keywords: [
      "business",
      "productivity",
      "project",
      "task",
      "meeting",
      "calendar",
      "sales",
      "marketing",
      "crm",
      "jira",
      "项目",
      "任务",
      "会议",
      "销售",
      "营销",
      "汇总",
    ],
  },
  communication: {
    strong: [
      "social media management",
      "social media publishing",
      "social media posting",
      "publish social media",
      "post to social media",
      "send message",
      "send email",
      "email management",
      "community management",
      "content publishing",
      "crisis communication",
      "public relations",
      "media relations",
      "press release",
      "customer support",
      "customer service",
      "gmail",
      "post tweets",
      "发送消息",
      "发送邮件",
      "邮件管理",
      "社区运营",
      "内容发布",
      "家校沟通",
    ],
    keywords: [
      "message",
      "messaging",
      "email",
      "social",
      "tweet",
      "twitter",
      "discord",
      "slack",
      "telegram",
      "whatsapp",
      "wechat",
      "feishu",
      "linkedin",
      "消息",
      "邮件",
      "社交",
      "沟通",
      "社交媒体",
      "微信",
      "飞书",
      "钉钉",
      "小红书",
      "抖音",
    ],
  },
  creative: {
    strong: [
      "image generation",
      "video generation",
      "music generation",
      "audio generation",
      "image editing",
      "video editing",
      "video editor",
      "video processing",
      "edit videos",
      "process videos",
      "audio editing",
      "graphic design",
      "creative writing",
      "content creation",
      "3d model",
      "animation",
      "podcast",
      "speech to text",
      "text to speech",
      "transcription",
      "图像生成",
      "图片生成",
      "视频生成",
      "视频编辑",
      "视频处理",
      "音频处理",
      "音乐生成",
      "创意写作",
      "内容创作",
      "小说写作",
      "平面设计",
      "视频脚本",
      "分镜",
      "剪辑",
      "配音",
      "文案",
    ],
    keywords: [
      "image",
      "video",
      "audio",
      "music",
      "media",
      "creative",
      "design",
      "animation",
      "podcast",
      "transcribe",
      "图像",
      "图片",
      "视频",
      "音频",
      "音乐",
      "创作",
      "设计",
    ],
  },
  knowledge: {
    strong: [
      "documentation",
      "knowledge base",
      "knowledge management",
      "document analysis",
      "document processing",
      "document recognition",
      "document extraction",
      "optical character recognition",
      "information extraction",
      "ocr",
      "pdf document",
      "learning assistant",
      "study guide",
      "education",
      "exam preparation",
      "course material",
      "research paper",
      "summarize document",
      "retrieval augmented generation",
      "知识库",
      "知识管理",
      "文档分析",
      "文档处理",
      "文档识别",
      "证件识别",
      "信息抽取",
      "智能识别",
      "学习助手",
      "教育助手",
      "研究论文",
      "学习笔记",
      "课程",
      "总结文档",
      "知识问答",
    ],
    keywords: [
      "document",
      "docs",
      "knowledge",
      "learn",
      "learning",
      "study",
      "exam",
      "education",
      "pdf",
      "summarize",
      "rag",
      "文档",
      "知识",
      "学习",
      "教育",
      "论文",
      "课程",
      "笔记",
      "总结",
    ],
  },
  agents: {
    strong: [
      "agent memory",
      "long term memory",
      "memory system",
      "context management",
      "prompt engineering",
      "system prompt",
      "agent behavior",
      "agent persona",
      "multi agent",
      "subagent",
      "self improvement",
      "self improving",
      "self improve",
      "智能体记忆",
      "记忆系统",
      "上下文管理",
      "提示词工程",
      "系统提示词",
      "多智能体",
      "子智能体",
      "智能体行为",
      "会话记忆",
      "记忆同步",
    ],
    keywords: [
      "memory",
      "context",
      "prompt",
      "persona",
      "subagent",
      "multiagent",
      "agentic",
      "记忆",
      "上下文",
      "提示词",
      "智能体",
      "会话",
    ],
  },
  operations: {
    strong: [
      "system administration",
      "local system",
      "local files",
      "infrastructure as code",
      "kubernetes",
      "docker",
      "deployment",
      "system monitoring",
      "service monitoring",
      "infrastructure monitoring",
      "uptime monitoring",
      "observability",
      "log analysis",
      "log analyzer",
      "backup",
      "系统管理",
      "系统运维",
      "运维部署",
      "系统监控",
      "服务监控",
      "基础设施",
      "容器管理",
      "日志分析",
      "备份恢复",
      "服务器管理",
    ],
    keywords: [
      "docker",
      "kubernetes",
      "deploy",
      "backup",
      "observability",
      "infrastructure",
      "运维",
      "部署",
      "基础设施",
      "容器",
      "备份",
      "服务器",
    ],
  },
  security: {
    strong: [
      "security audit",
      "security audits",
      "security scanning",
      "penetration testing",
      "data protection",
      "privacy compliance",
      "privacy assessment",
      "privacy impact assessment",
      "privacy",
      "gdpr",
      "dpia",
      "vulnerability",
      "malware",
      "access control",
      "identity management",
      "credential management",
      "secret management",
      "network security",
      "permission checks",
      "policy enforcement",
      "prompt injection",
      "安全审计",
      "安全扫描",
      "漏洞扫描",
      "恶意软件",
      "访问控制",
      "身份管理",
      "凭据管理",
      "密钥管理",
      "权限检查",
      "策略执行",
      "提示词注入",
      "安全防护",
    ],
    keywords: [
      "security",
      "vulnerability",
      "malware",
      "permission",
      "policy",
      "安全",
      "漏洞",
      "权限",
      "凭据",
      "密钥",
    ],
  },
  finance: {
    strong: [
      "financial analysis",
      "stock analysis",
      "stock market",
      "investment",
      "portfolio management",
      "cryptocurrency",
      "crypto trading",
      "trading strategy",
      "payment processing",
      "e commerce operations",
      "online store",
      "expense tracking",
      "accounting",
      "invoice",
      "wallet",
      "金融分析",
      "股票分析",
      "股票市场",
      "投资组合",
      "量化交易",
      "加密货币",
      "支付处理",
      "电子商务",
      "财务分析",
      "费用跟踪",
      "会计",
      "发票",
      "钱包",
      "资产配置",
      "财报分析",
    ],
    keywords: [
      "finance",
      "financial",
      "stock",
      "investment",
      "trading",
      "crypto",
      "payment",
      "commerce",
      "expense",
      "invoice",
      "accounting",
      "wallet",
      "金融",
      "股票",
      "投资",
      "交易",
      "支付",
      "财务",
      "资产",
      "财报",
    ],
  },
  lifestyle: {
    strong: [
      "travel planning",
      "trip planning",
      "weather forecast",
      "current weather",
      "weather information",
      "weather query",
      "fitness",
      "workout",
      "health tracking",
      "meal planning",
      "recipe",
      "home automation",
      "smart home",
      "shopping assistant",
      "buying guide",
      "personal assistant",
      "game",
      "entertainment",
      "旅行规划",
      "旅游规划",
      "天气预报",
      "天气查询",
      "健身",
      "锻炼",
      "健康管理",
      "膳食计划",
      "食谱",
      "智能家居",
      "购物助手",
      "生活助手",
      "穿搭",
      "美妆",
      "游戏",
      "娱乐",
    ],
    keywords: [
      "travel",
      "weather",
      "fitness",
      "health",
      "food",
      "recipe",
      "home",
      "shopping",
      "personal",
      "game",
      "entertainment",
      "旅行",
      "旅游",
      "天气",
      "健康",
      "购物",
      "生活",
    ],
  },
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function validExplicitCategories(values, allowed) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!allowed.has(value) || value === "other" || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function normalizeTopicSlug(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalTopicSlug(value) {
  const slug = normalizeTopicSlug(value);
  return TOPIC_ALIAS_SLUGS.get(slug) ?? slug;
}

function cleanTopicLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function validExplicitTopics(values) {
  const seen = new Set();
  const topics = [];
  for (const rawValue of Array.isArray(values) ? values : []) {
    const label = cleanTopicLabel(rawValue);
    const slug = normalizeTopicSlug(label);
    if (!label || label.length > TOPIC_MAX_LENGTH || !slug || RESERVED_TOPIC_SLUGS.has(slug)) {
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    topics.push(label);
    if (topics.length >= TOPIC_LIMIT) break;
  }
  return topics;
}

function formatInferredTopicLabel(value, slug) {
  const canonical = TOPIC_CANONICAL_LABELS.get(slug);
  if (canonical) return canonical;
  const cleaned = cleanTopicLabel(value).replace(/[_-]+/g, " ");
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(cleaned)) {
    return cleaned;
  }
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return (
        TOPIC_CANONICAL_LABELS.get(lower) ?? `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`
      );
    })
    .join(" ");
}

export function isAllowedInferredTopic(value) {
  const label = cleanTopicLabel(value);
  const slug = canonicalTopicSlug(label);
  if (!label || label.length > TOPIC_MAX_LENGTH || !slug) return false;
  if (RESERVED_TOPIC_SLUGS.has(slug) || INFERRED_TOPIC_BLOCKLIST.has(slug)) return false;
  if (slug.split("-").some((token) => INFERRED_TOPIC_BLOCKED_TOKENS.has(token))) return false;
  if (!/[\p{L}]/u.test(label)) return false;
  if (/^(?:v|version-?)?\d+(?:[.-]\d+){1,}$/i.test(slug)) return false;
  if (/https?:|www\.|@|\.(?:com|org|net|ai)$/i.test(label)) return false;
  if (slug.split("-").length > 5) return false;
  return true;
}

function createTopicCandidateCollector() {
  const candidates = new Map();

  function add(
    value,
    { source, evidence = value, score, primaryEvidence = false, strongEvidence = false },
  ) {
    if (!isAllowedInferredTopic(value)) return;
    const slug = canonicalTopicSlug(value);
    const existing = candidates.get(slug) ?? {
      topic: formatInferredTopicLabel(value, slug),
      slug,
      sourceScores: new Map(),
      sources: [],
      evidence: [],
      primarySources: new Set(),
      strongEvidence: false,
    };
    existing.sourceScores.set(source, Math.max(existing.sourceScores.get(source) ?? 0, score));
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
    if (primaryEvidence) existing.primarySources.add(source);
    existing.strongEvidence ||= strongEvidence;
    candidates.set(slug, existing);
  }

  function values() {
    return [...candidates.values()]
      .map((candidate) => {
        const primarySourceCount = candidate.primarySources.size;
        const score =
          [...candidate.sourceScores.values()].reduce((sum, value) => sum + value, 0) +
          Math.max(0, primarySourceCount - 1) * 4;
        const confidence =
          candidate.strongEvidence || (score >= 12 && primarySourceCount >= 2)
            ? "high"
            : primarySourceCount > 0 && score >= 6
              ? "medium"
              : "low";
        return {
          topic: candidate.topic,
          slug: candidate.slug,
          score,
          sources: candidate.sources,
          evidence: candidate.evidence.slice(0, 12),
          primaryEvidence: primarySourceCount > 0,
          primarySourceCount,
          strongEvidence: candidate.strongEvidence,
          confidence,
        };
      })
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  }

  return { add, values };
}

function annotateRedundantTopicCandidates(rawCandidates) {
  const supported = rawCandidates.filter((candidate) => candidate.confidence !== "low");
  return rawCandidates.map((candidate) => {
    const tokens = candidate.slug.split("-").filter(Boolean);
    if (candidate.confidence === "low" || tokens.length !== 1) return candidate;
    const moreSpecific = supported.find(
      (other) =>
        other.slug !== candidate.slug &&
        other.primaryEvidence &&
        other.slug.split("-").includes(candidate.slug),
    );
    return moreSpecific ? { ...candidate, suppressedBy: moreSpecific.slug } : candidate;
  });
}

function buildTopicResult({ explicitTopics, rawCandidates, topicInputHash }) {
  if (explicitTopics !== undefined) {
    const topics = validExplicitTopics(explicitTopics);
    return {
      topics,
      rawTopicCandidates: topics.map((topic, index) => ({
        topic,
        slug: normalizeTopicSlug(topic),
        score: 1000 - index,
        sources: ["author"],
        evidence: ["explicit topic"],
        primaryEvidence: true,
        primarySourceCount: 1,
        strongEvidence: true,
        confidence: "high",
      })),
      topicConfidence: "high",
      topicsNeedAi: false,
      topicProvenance: "author",
      topicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      topicCandidateCountBeforeCap: topics.length,
      topicInputHash,
    };
  }

  const annotatedCandidates = annotateRedundantTopicCandidates(rawCandidates);
  const accepted = annotatedCandidates.filter(
    (candidate) => candidate.confidence !== "low" && !candidate.suppressedBy,
  );
  const topics = accepted.slice(0, TOPIC_LIMIT).map((candidate) => candidate.topic);
  const high =
    topics.length > 0 &&
    accepted.length <= TOPIC_LIMIT &&
    accepted.every((candidate) => candidate.confidence === "high");
  return {
    topics,
    rawTopicCandidates: annotatedCandidates,
    topicConfidence: topics.length === 0 ? "low" : high ? "high" : "medium",
    topicsNeedAi: !high,
    topicProvenance: "deterministic-topic-v1",
    topicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
    topicCandidateCountBeforeCap: accepted.length,
    topicInputHash,
  };
}

function attachTopics(result, topicResult) {
  return { ...result, ...topicResult };
}

function buildResult({
  family,
  categories,
  rawCandidates,
  confidence,
  needsAi,
  provenance,
  unknownSignals = [],
  candidateCountBeforeCap = rawCandidates.length,
  inputHash,
}) {
  return {
    family,
    categories: categories.length > 0 ? categories : ["other"],
    rawCandidates,
    confidence,
    needsAi,
    provenance,
    classifierVersion: CLASSIFIER_VERSION,
    unknownSignals,
    candidateCountBeforeCap,
    inputHash,
  };
}

function pluginAutoCandidates(manifest, slug, text) {
  const candidates = new Map();
  const unknownSignals = [];
  const retained = new Set();

  function add(
    category,
    source,
    evidence,
    strongEvidence = true,
    score = PLUGIN_CATEGORY_PRIORITY[category] ?? 0,
  ) {
    const existing = candidates.get(category) ?? {
      category,
      score,
      sources: [],
      evidence: [],
      strongEvidence: false,
    };
    existing.score = Math.max(existing.score, score);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
    existing.strongEvidence ||= strongEvidence;
    candidates.set(category, existing);
  }

  const rawKinds = Array.isArray(manifest?.kind)
    ? manifest.kind
    : manifest?.kind
      ? [manifest.kind]
      : [];
  for (const kind of rawKinds) {
    if (kind === "memory") {
      add("memory", "plugin-manifest", "kind:memory");
      retained.add("memory");
    } else if (kind === "context-engine") {
      add("context", "plugin-manifest", "kind:context-engine");
      retained.add("context");
    } else {
      unknownSignals.push(`kind:${String(kind)}`);
      const weakCategory = PLUGIN_KIND_CATEGORY[kind];
      if (weakCategory) add(weakCategory, "plugin-manifest", `kind:${kind}`, false, 380);
    }
  }

  if (nonEmptyArray(manifest?.channels)) add("channels", "plugin-manifest", "channels");
  if (nonEmptyArray(manifest?.providers)) add("models", "plugin-manifest", "providers");
  if (nonEmptyArray(manifest?.cliBackends) || nonEmptyArray(manifest?.qaRunners)) {
    add(
      "runtime",
      "plugin-manifest",
      nonEmptyArray(manifest?.cliBackends) ? "cliBackends" : "qaRunners",
    );
  }
  if (nonEmptyArray(manifest?.skills)) add("tools", "plugin-manifest", "skills", false, 300);
  if (nonEmptyArray(manifest?.hooks)) add("runtime", "plugin-manifest", "hooks");

  if (
    manifest?.contracts &&
    typeof manifest.contracts === "object" &&
    !Array.isArray(manifest.contracts)
  ) {
    for (const [key, value] of Object.entries(manifest.contracts)) {
      if (!nonEmptyArray(value)) continue;
      const category = CONTRACT_CATEGORY[key];
      if (category) {
        add(category, "plugin-manifest", `contracts.${key}`);
      } else {
        unknownSignals.push(`contracts.${key}`);
      }
    }
  }

  for (const candidate of pluginTextCandidates(slug, text)) {
    for (const evidence of candidate.evidence) {
      add(candidate.category, "plugin-text", evidence, false, 400 + candidate.score);
    }
  }

  return {
    candidates: [...candidates.values()].sort(
      (a, b) =>
        b.score - a.score ||
        (PLUGIN_ORDER.get(a.category) ?? 999) - (PLUGIN_ORDER.get(b.category) ?? 999),
    ),
    retained,
    unknownSignals: [...new Set(unknownSignals)].sort(),
  };
}

export function classifyPlugin({
  manifest = {},
  slug = "",
  text = "",
  topicText = text,
  explicitCategories,
  explicitTopics,
  topicTags = [],
} = {}) {
  const inputHash = sha256(JSON.stringify({ manifest, slug, text, explicitCategories }));
  const auto = pluginAutoCandidates(manifest, slug, text);
  const explicit = validExplicitCategories(explicitCategories, PLUGIN_CATEGORY_SET);
  const topicResult = classifyPluginTopics({
    manifest,
    slug,
    topicText,
    explicitTopics,
    topicTags,
  });

  if (explicit.length > 0) {
    const retained = [...auto.retained];
    const categories = [
      ...retained,
      ...explicit.filter((category) => !auto.retained.has(category)),
    ].slice(0, 3);
    return attachTopics(
      buildResult({
        family: "plugin",
        categories,
        rawCandidates: explicit.map((category, index) => ({
          category,
          score: 1000 - index,
          sources: ["author"],
          evidence: ["explicit category"],
        })),
        confidence: "high",
        needsAi: false,
        provenance: "author",
        candidateCountBeforeCap: explicit.length + retained.length,
        inputHash,
      }),
      topicResult,
    );
  }

  const selected = [];
  for (const category of auto.retained) selected.push(category);
  const hasSpecificCandidate = auto.candidates.some((candidate) => candidate.category !== "tools");
  const acceptedCandidates = auto.candidates.filter(
    (candidate) =>
      candidate.category !== "tools" || candidate.strongEvidence || !hasSpecificCandidate,
  );
  for (const candidate of acceptedCandidates) {
    if (!selected.includes(candidate.category)) selected.push(candidate.category);
    if (selected.length >= 3) break;
  }

  const recognized = acceptedCandidates.length > 0;
  const overloaded = acceptedCandidates.length > 3;
  const hasUnknown = auto.unknownSignals.length > 0;
  const hasWeak = acceptedCandidates.some((candidate) => !candidate.strongEvidence);
  const confidence = !recognized ? "low" : overloaded || hasUnknown || hasWeak ? "medium" : "high";

  return attachTopics(
    buildResult({
      family: "plugin",
      categories: selected,
      rawCandidates: auto.candidates,
      confidence,
      needsAi: confidence !== "high",
      provenance: "deterministic-v9",
      unknownSignals: auto.unknownSignals,
      candidateCountBeforeCap: acceptedCandidates.length,
      inputHash,
    }),
    topicResult,
  );
}

function normalizeForMatching(value) {
  return ` ${value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function hasTerm(normalized, term) {
  const needle = normalizeForMatching(term).trim();
  if (!needle) return false;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(needle)) {
    return normalized.includes(needle);
  }
  return normalized.includes(` ${needle} `);
}

function scoreTextCategory(category, rules, primary, body, source) {
  let score = 0;
  const evidence = [];
  let primaryEvidence = false;
  let strongPrimaryEvidence = false;
  const primaryTerms = new Set();
  const strongPrimaryTerms = new Set();
  const bodyTerms = new Set();
  const strongBodyTerms = new Set();

  for (const term of rules.strong) {
    if (!primaryTerms.has(term) && hasTerm(primary, term)) {
      score += 8;
      primaryEvidence = true;
      strongPrimaryEvidence = true;
      primaryTerms.add(term);
      strongPrimaryTerms.add(term);
      evidence.push(term);
    }
    if (!bodyTerms.has(term) && hasTerm(body, term)) {
      score += 3;
      bodyTerms.add(term);
      strongBodyTerms.add(term);
      if (!evidence.includes(term)) evidence.push(term);
    }
  }
  for (const term of rules.keywords) {
    if (!primaryTerms.has(term) && hasTerm(primary, term)) {
      score += 4;
      primaryEvidence = true;
      primaryTerms.add(term);
      if (!evidence.includes(term)) evidence.push(term);
    }
    if (!bodyTerms.has(term) && hasTerm(body, term)) {
      score += 1;
      bodyTerms.add(term);
      if (!evidence.includes(term)) evidence.push(term);
    }
  }

  return {
    category,
    score,
    sources: [source],
    evidence: evidence.slice(0, 12),
    primaryEvidence,
    strongPrimaryEvidence,
    primaryEvidenceCount: primaryTerms.size,
    primaryEvidenceTerms: [...primaryTerms],
    strongPrimaryEvidenceTerms: [...strongPrimaryTerms],
    bodyEvidenceTerms: [...bodyTerms],
    strongBodyEvidenceTerms: [...strongBodyTerms],
  };
}

function pluginTextCandidates(slug, text) {
  if (!slug && !text) return [];
  const primary = normalizeForMatching(`${slug} ${text.slice(0, 2400)}`);
  const body = normalizeForMatching(text.slice(2400, 24000));
  const scored = Object.entries(PLUGIN_TEXT_RULES)
    .map(([category, rules]) => scoreTextCategory(category, rules, primary, body, "plugin-text"))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (PLUGIN_ORDER.get(a.category) ?? 999) - (PLUGIN_ORDER.get(b.category) ?? 999),
    );
  const top = scored[0];
  if (!top || top.score < 4) return [];
  return scored.filter((candidate) => candidate.score >= 4 && candidate.score >= top.score * 0.5);
}

const SKILL_INTENT_FIELDS = new Set([
  "name",
  "displayname",
  "description",
  "summary",
  "tags",
  "keywords",
  "category",
  "categories",
  "triggers",
  "use_when",
  "when_to_use",
]);

function extractFirstHeading(text) {
  const match = text.match(/(?:^|\r?\n)(#{1,2})\s+([^\r\n]+)/);
  if (!match) return "";
  const nextHeading = match[2].search(/\s+#{1,6}\s+/);
  const heading = (nextHeading >= 0 ? match[2].slice(0, nextHeading) : match[2]).trim();
  return `${match[1]} ${heading.slice(0, 160)}`;
}

function extractLooseDescription(text) {
  const prefix = text.slice(0, 2400);
  const field = prefix.match(/\bdescription\s*:\s*/i);
  if (!field) return "";
  const rest = prefix.slice(field.index + field[0].length);
  const boundary = rest.search(
    /\s+(?:name|description|version|author|homepage|metadata)\s*:|\s+#{1,6}\s+/i,
  );
  return (boundary >= 0 ? rest.slice(0, boundary) : rest).replace(/^["']|["']$/g, "").slice(0, 600);
}

function fallbackSkillPrimary(slug, text) {
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ");
  const firstHeading = extractFirstHeading(withoutCode);
  const looseDescription = extractLooseDescription(withoutCode);
  const firstProse = looseDescription
    ? ""
    : (withoutCode
        .split(/\r?\n\s*\r?\n/)
        .map((block) => block.trim())
        .find((block) => block && !block.startsWith("#") && !block.startsWith("---")) ?? "");
  return normalizeForMatching(
    `${slug} ${looseDescription} ${firstHeading} ${firstProse.slice(0, 400)}`,
  );
}

function splitSkillFrontmatter(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) return null;
  const afterOpening = trimmed.slice(3);
  const blockClosing = afterOpening.match(/\r?\n---(?:\r?\n|$)/);
  const inlineClosing = afterOpening.match(/\s---(?:\s|$)/);
  const blockIndex = blockClosing?.index ?? Number.POSITIVE_INFINITY;
  const inlineIndex = inlineClosing?.index ?? Number.POSITIVE_INFINITY;
  const closingIndex = Math.min(blockIndex, inlineIndex);
  if (!Number.isFinite(closingIndex) || closingIndex > 5000) return null;

  if (blockIndex <= inlineIndex) {
    return {
      frontmatter: afterOpening.slice(0, blockClosing.index),
      bodyText: afterOpening.slice(blockClosing.index + blockClosing[0].length),
      inline: false,
    };
  }

  return {
    frontmatter: afterOpening.slice(0, inlineClosing.index),
    bodyText: afterOpening.slice(inlineClosing.index + inlineClosing[0].length),
    inline: true,
  };
}

function extractFrontmatterEntries(frontmatter, inline) {
  const entries = [];
  if (inline) {
    const fields = [...frontmatter.matchAll(/\b([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*/g)];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const start = field.index + field[0].length;
      const end = fields[index + 1]?.index ?? frontmatter.length;
      entries.push({
        field: field[1].toLowerCase(),
        rawField: field[1],
        value: frontmatter.slice(start, end).trim(),
      });
    }
    return entries;
  }

  let current = null;
  for (const line of frontmatter.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (topLevel) {
      current = {
        field: topLevel[1].toLowerCase(),
        rawField: topLevel[1],
        value: topLevel[2],
      };
      entries.push(current);
      continue;
    }
    if (current && /^\s+/.test(line)) current.value += `\n${line.trim()}`;
  }
  return entries;
}

function parseTopicTags(value) {
  const cleaned = String(value ?? "")
    .replace(/^\s*\[|\]\s*$/g, "")
    .replace(/^\s*-\s*/gm, "")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:,|;|\r?\n|\s+-\s+)\s*/)
    .map(cleanTopicLabel)
    .filter(Boolean);
}

function extractSkillZones(slug, text) {
  const artifactSlug = slug.split("/").filter(Boolean).at(-1) ?? slug;
  const frontmatter = splitSkillFrontmatter(text);
  if (!frontmatter) {
    const primary = fallbackSkillPrimary(artifactSlug, text);
    return {
      artifactSlug,
      primary,
      topicPrimary: fallbackSkillPrimary("", text),
      topicTags: [],
      body: normalizeForMatching(text.slice(0, 16000)),
    };
  }

  const entries = extractFrontmatterEntries(frontmatter.frontmatter, frontmatter.inline);
  const intent = entries
    .filter((entry) => SKILL_INTENT_FIELDS.has(entry.field))
    .map((entry) => `${entry.rawField}: ${entry.value}`);
  const topicIntent = entries
    .filter(
      (entry) =>
        SKILL_INTENT_FIELDS.has(entry.field) &&
        !["tags", "keywords", "category", "categories"].includes(entry.field),
    )
    .map((entry) => `${entry.rawField}: ${entry.value}`);
  const topicTags = entries
    .filter((entry) => ["tags", "keywords"].includes(entry.field))
    .flatMap((entry) => parseTopicTags(entry.value));
  const firstHeading =
    frontmatter.inline && !/[\r\n]/.test(frontmatter.bodyText)
      ? ""
      : extractFirstHeading(frontmatter.bodyText);
  return {
    artifactSlug,
    primary: normalizeForMatching(`${artifactSlug} ${intent.join("\n")} ${firstHeading}`),
    topicPrimary: normalizeForMatching(`${topicIntent.join("\n")} ${firstHeading}`),
    topicTags,
    body: normalizeForMatching(frontmatter.bodyText.slice(0, 16000)),
  };
}

function addTopicTextEvidence(collector, candidates, primary, body, sourcePrefix) {
  for (const candidate of candidates) {
    const strongPrimary = new Set(candidate.strongPrimaryEvidenceTerms ?? []);
    const strongBody = new Set(candidate.strongBodyEvidenceTerms ?? []);
    for (const term of candidate.primaryEvidenceTerms ?? []) {
      if (!hasTerm(primary, term)) continue;
      collector.add(term, {
        source: `${sourcePrefix}-primary`,
        evidence: `${sourcePrefix} primary: ${term}`,
        score: strongPrimary.has(term) ? 8 : 5,
        primaryEvidence: true,
      });
    }
    for (const term of candidate.bodyEvidenceTerms ?? []) {
      if (!hasTerm(body, term)) continue;
      collector.add(term, {
        source: `${sourcePrefix}-body`,
        evidence: `${sourcePrefix} body: ${term}`,
        score: strongBody.has(term) ? 3 : 1,
      });
    }
  }
}

function addSlugTopicCorroboration(collector, slug, source) {
  const normalizedSlug = normalizeForMatching(slug);
  for (const candidate of collector.values()) {
    if (!hasTerm(normalizedSlug, candidate.topic)) continue;
    collector.add(candidate.topic, {
      source,
      evidence: `${source}: ${candidate.slug}`,
      score: 6,
      primaryEvidence: true,
    });
  }
}

function structuredTopicValues(value) {
  const output = [];
  for (const entry of Array.isArray(value) ? value : value == null ? [] : [value]) {
    if (typeof entry === "string") {
      output.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    for (const key of ["id", "name", "slug", "provider", "channel", "type"]) {
      if (typeof entry[key] === "string") output.push(entry[key]);
    }
  }
  return output;
}

function classifyPluginTopics({ manifest, slug, topicText, explicitTopics, topicTags }) {
  const topicInputHash = sha256(
    JSON.stringify({ manifest, slug, topicText, explicitTopics, topicTags }),
  );
  if (explicitTopics !== undefined) {
    return buildTopicResult({ explicitTopics, rawCandidates: [], topicInputHash });
  }

  const collector = createTopicCandidateCollector();
  const artifactSlug = slug.split("/").filter(Boolean).at(-1) ?? slug;
  const publisherSlug = slug.includes("/") ? slug.split("/").filter(Boolean)[0] : "";
  for (const value of Array.isArray(topicTags) ? topicTags : []) {
    if (canonicalTopicSlug(value) === canonicalTopicSlug(publisherSlug)) continue;
    collector.add(value, {
      source: "plugin-tag",
      evidence: `package keyword: ${value}`,
      score: 8,
      primaryEvidence: true,
    });
  }

  for (const field of ["channels", "providers", "cliBackends", "qaRunners"]) {
    const strongEvidence = ["channels", "providers"].includes(field);
    for (const value of structuredTopicValues(manifest?.[field])) {
      collector.add(value, {
        source: "plugin-structured",
        evidence: `${field}: ${value}`,
        score: strongEvidence ? 12 : 8,
        primaryEvidence: true,
        strongEvidence,
      });
    }
  }

  if (
    manifest?.contracts &&
    typeof manifest.contracts === "object" &&
    !Array.isArray(manifest.contracts)
  ) {
    for (const [key, value] of Object.entries(manifest.contracts)) {
      if (!nonEmptyArray(value)) continue;
      const contractTopic = CONTRACT_TOPIC_LABELS[key];
      if (contractTopic) {
        collector.add(contractTopic, {
          source: "plugin-contract",
          evidence: `contracts.${key}`,
          score: 12,
          primaryEvidence: true,
          strongEvidence: true,
        });
      }
      for (const topic of structuredTopicValues(value)) {
        const strongEvidence = STRONG_CONTRACT_VALUE_KEYS.has(key);
        collector.add(topic, {
          source: "plugin-contract",
          evidence: `contracts.${key}: ${topic}`,
          score: strongEvidence ? 12 : 8,
          primaryEvidence: true,
          strongEvidence,
        });
      }
    }
  }

  const topicPrimary = normalizeForMatching(String(topicText ?? "").slice(0, 2400));
  const topicBody = normalizeForMatching(String(topicText ?? "").slice(2400, 24000));
  addTopicTextEvidence(
    collector,
    pluginTextCandidates("", topicText ?? ""),
    topicPrimary,
    topicBody,
    "plugin-text",
  );
  for (const tag of Array.isArray(topicTags) ? topicTags : []) {
    if (!hasTerm(topicPrimary, tag)) continue;
    collector.add(tag, {
      source: "plugin-primary",
      evidence: `plugin primary: ${tag}`,
      score: 5,
      primaryEvidence: true,
    });
  }
  addSlugTopicCorroboration(collector, artifactSlug, "plugin-slug");

  return buildTopicResult({
    explicitTopics,
    rawCandidates: collector.values(),
    topicInputHash,
  });
}

function classifySkillTopics({ slug, text, explicitTopics, topicTags, zones, categoryCandidates }) {
  const allTopicTags = [...zones.topicTags, ...(Array.isArray(topicTags) ? topicTags : [])];
  const topicInputHash = sha256(
    `${slug}\0${text}\0${JSON.stringify(explicitTopics ?? null)}\0${JSON.stringify(allTopicTags)}`,
  );
  if (explicitTopics !== undefined) {
    return buildTopicResult({ explicitTopics, rawCandidates: [], topicInputHash });
  }

  const collector = createTopicCandidateCollector();
  for (const tag of allTopicTags) {
    collector.add(tag, {
      source: "skill-tag",
      evidence: `root tag: ${tag}`,
      score: 8,
      primaryEvidence: true,
    });
    if (hasTerm(zones.topicPrimary, tag)) {
      collector.add(tag, {
        source: "skill-primary",
        evidence: `skill primary: ${tag}`,
        score: 5,
        primaryEvidence: true,
      });
    }
  }

  addTopicTextEvidence(collector, categoryCandidates, zones.topicPrimary, zones.body, "skill-text");
  addSlugTopicCorroboration(collector, zones.artifactSlug, "skill-slug");

  return buildTopicResult({
    explicitTopics,
    rawCandidates: collector.values(),
    topicInputHash,
  });
}

function scoreSkillCategory(category, primary, body) {
  return scoreTextCategory(category, SKILL_RULES[category], primary, body, "skill-text");
}

export function classifySkill({
  slug = "",
  text = "",
  explicitCategories,
  explicitTopics,
  topicTags = [],
} = {}) {
  const inputHash = sha256(`${slug}\0${text}\0${JSON.stringify(explicitCategories ?? [])}`);
  const explicit = validExplicitCategories(explicitCategories, SKILL_CATEGORY_SET);
  const zones = extractSkillZones(slug, text);
  const scored = Object.keys(SKILL_RULES)
    .map((category) => scoreSkillCategory(category, zones.primary, zones.body))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (SKILL_ORDER.get(a.category) ?? 999) - (SKILL_ORDER.get(b.category) ?? 999),
    );
  const topicResult = classifySkillTopics({
    slug,
    text,
    explicitTopics,
    topicTags,
    zones,
    categoryCandidates: scored,
  });

  if (explicit.length > 0) {
    return attachTopics(
      buildResult({
        family: "skill",
        categories: explicit.slice(0, 3),
        rawCandidates: explicit.map((category, index) => ({
          category,
          score: 1000 - index,
          sources: ["author"],
          evidence: ["explicit category"],
        })),
        confidence: "high",
        needsAi: false,
        provenance: "author",
        candidateCountBeforeCap: explicit.length,
        inputHash,
      }),
      topicResult,
    );
  }

  const primaryScored = scored.filter((candidate) => candidate.primaryEvidence);
  const top = primaryScored[0];
  if (!top || top.score < 5) {
    return attachTopics(
      buildResult({
        family: "skill",
        categories: [],
        rawCandidates: scored,
        confidence: "low",
        needsAi: true,
        provenance: "deterministic-v9",
        candidateCountBeforeCap: 0,
        inputHash,
      }),
      topicResult,
    );
  }

  const purposeScored = primaryScored.filter(
    (candidate) => candidate.strongPrimaryEvidence || candidate.primaryEvidenceCount >= 2,
  );
  const candidates = [
    top,
    ...purposeScored.filter(
      (candidate) =>
        candidate.category !== top.category &&
        candidate.score >= 7 &&
        candidate.score >= top.score * 0.55,
    ),
  ];
  const runnerUp = primaryScored[1]?.score ?? 0;
  const high =
    (top.strongPrimaryEvidence || top.primaryEvidenceCount >= 2) &&
    top.score >= 12 &&
    top.score - runnerUp >= 4;

  return attachTopics(
    buildResult({
      family: "skill",
      categories: candidates.slice(0, 3).map((candidate) => candidate.category),
      rawCandidates: scored,
      confidence: high ? "high" : "medium",
      needsAi: !high,
      provenance: "deterministic-v9",
      candidateCountBeforeCap: candidates.length,
      inputHash,
    }),
    topicResult,
  );
}
