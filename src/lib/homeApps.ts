/** Curated shortcuts for the home apps constellation (design-time). */

export const HOME_APP_ICON_PATHS = {
  airtable: "/app-icons/airtable.svg",
  "amazon-bedrock": "/app-icons/amazon-bedrock.svg",
  "apple-pim": "/app-icons/apple.svg",
  aws: "/app-icons/aws.svg",
  brave: "/app-icons/brave.svg",
  cerebras: "/app-icons/cerebras.svg",
  "cloudflare-gateway": "/app-icons/cloudflare.svg",
  chrome: "/app-icons/google-chrome.svg",
  codex: "/app-icons/openai.svg",
  deepinfra: "/app-icons/deepinfra.svg",
  "diagnostics-prometheus": "/app-icons/prometheus.svg",
  discord: "/app-icons/discord.svg",
  docker: "/app-icons/docker.svg",
  dropbox: "/app-icons/dropbox.svg",
  exa: "/app-icons/exa.svg",
  feishu: "/app-icons/feishu-lark.svg",
  figma: "/app-icons/figma.svg",
  firecrawl: "/app-icons/firecrawl.svg",
  github: "/app-icons/github.svg",
  gitlab: "/app-icons/gitlab.svg",
  "gmail-plugin": "/app-icons/google-gmail.svg",
  gmail: "/app-icons/google-gmail.svg",
  "google-calendar": "/app-icons/google-calendar.svg",
  "google-drive": "/app-icons/google-drive.svg",
  "google-meet": "/app-icons/google-meet.svg",
  "google-sheets": "/app-icons/google-sheets.svg",
  googlechat: "/app-icons/google-chat.svg",
  groq: "/app-icons/groq.svg",
  jira: "/app-icons/atlassian-jira.svg",
  kubernetes: "/app-icons/kubernetes.svg",
  line: "/app-icons/line.svg",
  linear: "/app-icons/linear.svg",
  "llama-cpp": "/app-icons/llama-cpp.svg",
  matrix: "/app-icons/matrix.svg",
  msteams: "/app-icons/microsoft-teams.svg",
  "nextcloud-talk": "/app-icons/nextcloud-talk.svg",
  notion: "/app-icons/notion.svg",
  obsidian: "/app-icons/obsidian.svg",
  openai: "/app-icons/openai.svg",
  openclaw: "/app-icons/openclaw.svg",
  parallel: "/app-icons/parallel.svg",
  perplexity: "/app-icons/perplexity.svg",
  qqbot: "/app-icons/qq.svg",
  qwen: "/app-icons/qwen.svg",
  scraperapi: "/app-icons/scraperapi.svg",
  slack: "/app-icons/slack.svg",
  trello: "/app-icons/atlassian-trello.svg",
  twitch: "/app-icons/twitch.svg",
  "voice-call": "/app-icons/twilio.svg",
  vscode: "/app-icons/vscode.svg",
  whatsapp: "/app-icons/whatsapp.svg",
} as const;

export type HomeSkillApp = {
  id: string;
  name: string;
  description: string;
  /** Skills browse search query. */
  browseQuery: string;
  /** Brand favicon via Google favicon helper (domain only). */
  iconDomain: string;
};

export type HomePluginShortcut = {
  id: string;
  runtimeId: string;
  name: string;
  description: string;
  packageName: string;
  /** Brand favicon via Google favicon helper (domain only). */
  iconDomain: string;
};

/** Left orbit — skills for everyday tools. */
export const HOME_SKILL_APPS: HomeSkillApp[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    description: "Browse, scrape, and automate the web from your agent.",
    browseQuery: "chrome browser",
    iconDomain: "google.com",
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Edit repos, run tasks, and ship code from the editor.",
    browseQuery: "vscode",
    iconDomain: "code.visualstudio.com",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Review PRs, manage issues, and automate repo workflows.",
    browseQuery: "github",
    iconDomain: "github.com",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read pages, update databases, and draft docs in Notion.",
    browseQuery: "notion",
    iconDomain: "notion.so",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Create issues, sync cycles, and keep product work moving.",
    browseQuery: "linear",
    iconDomain: "linear.app",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Export assets, comment on files, and sync design context.",
    browseQuery: "figma",
    iconDomain: "figma.com",
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Pair with your editor and run agent workflows in Cursor.",
    browseQuery: "cursor",
    iconDomain: "cursor.com",
  },
  {
    id: "raycast",
    name: "Raycast",
    description: "Launch commands, scripts, and quick actions on macOS.",
    browseQuery: "raycast",
    iconDomain: "raycast.com",
  },
  {
    id: "aws",
    name: "AWS",
    description: "Operate cloud resources and deploy from agent playbooks.",
    browseQuery: "aws",
    iconDomain: "aws.amazon.com",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search conversations, and manage channels.",
    browseQuery: "slack",
    iconDomain: "slack.com",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Work with messages, channels, reactions, and communities.",
    browseQuery: "discord",
    iconDomain: "discord.com",
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Manage Markdown vaults, notes, and knowledge workflows.",
    browseQuery: "obsidian",
    iconDomain: "obsidian.md",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage boards, lists, cards, and project workflows.",
    browseQuery: "trello",
    iconDomain: "trello.com",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, send, search, and organize email.",
    browseQuery: "gmail",
    iconDomain: "mail.google.com",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Find, create, and manage files and folders.",
    browseQuery: "google drive",
    iconDomain: "drive.google.com",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, write, and automate spreadsheet data.",
    browseQuery: "google sheets",
    iconDomain: "sheets.google.com",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Create events, check availability, and manage calendars.",
    browseQuery: "google calendar",
    iconDomain: "calendar.google.com",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Search, create, update, and transition issues.",
    browseQuery: "jira",
    iconDomain: "atlassian.com",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Build bot workflows and automate conversations.",
    browseQuery: "telegram",
    iconDomain: "telegram.org",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Manage bases, tables, records, and fields.",
    browseQuery: "airtable",
    iconDomain: "airtable.com",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Browse, search, upload, and manage files.",
    browseQuery: "dropbox",
    iconDomain: "dropbox.com",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Operate containers, images, and Compose stacks.",
    browseQuery: "docker",
    iconDomain: "docker.com",
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Deploy, inspect, and troubleshoot clusters.",
    browseQuery: "kubernetes",
    iconDomain: "kubernetes.io",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Manage projects, merge requests, issues, and pipelines.",
    browseQuery: "gitlab",
    iconDomain: "gitlab.com",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Query CRM data and manage sales workflows.",
    browseQuery: "salesforce",
    iconDomain: "salesforce.com",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Work with contacts, companies, deals, and pipelines.",
    browseQuery: "hubspot",
    iconDomain: "hubspot.com",
  },
];

/** Right orbit — official @openclaw gateway plugins. */
export const HOME_PLUGIN_SHORTCUTS: HomePluginShortcut[] = [
  {
    id: "whatsapp",
    runtimeId: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp Web channel plugin for agent chats.",
    packageName: "@openclaw/whatsapp",
    iconDomain: "whatsapp.com",
  },
  {
    id: "qqbot",
    runtimeId: "qqbot",
    name: "QQ Bot",
    description: "Group and direct-message workflows for QQ.",
    packageName: "@openclaw/qqbot",
    iconDomain: "qq.com",
  },
  {
    id: "matrix",
    runtimeId: "matrix",
    name: "Matrix",
    description: "Rooms and direct messages on Matrix.",
    packageName: "@openclaw/matrix",
    iconDomain: "matrix.org",
  },
  {
    id: "nextcloud-talk",
    runtimeId: "nextcloud-talk",
    name: "Nextcloud Talk",
    description: "Self-hosted team conversations and calls.",
    packageName: "@openclaw/nextcloud-talk",
    iconDomain: "nextcloud.com",
  },
  {
    id: "voice-call",
    runtimeId: "voice-call",
    name: "Voice Call",
    description: "Phone-call workflows through Twilio, Telnyx, and Plivo.",
    packageName: "@openclaw/voice-call",
    iconDomain: "twilio.com",
  },
  {
    id: "line",
    runtimeId: "line",
    name: "LINE",
    description: "LINE Bot API chats from OpenClaw.",
    packageName: "@openclaw/line",
    iconDomain: "line.me",
  },
  {
    id: "twitch",
    runtimeId: "twitch",
    name: "Twitch",
    description: "Chat and moderation workflows for streams.",
    packageName: "@openclaw/twitch",
    iconDomain: "twitch.tv",
  },
  {
    id: "codex",
    runtimeId: "codex",
    name: "Codex",
    description: "Codex app-server harness and model provider.",
    packageName: "@openclaw/codex",
    iconDomain: "openai.com",
  },
  {
    id: "discord",
    runtimeId: "discord",
    name: "Discord",
    description: "Channels, DMs, commands, and app events.",
    packageName: "@openclaw/discord",
    iconDomain: "discord.com",
  },
  {
    id: "feishu",
    runtimeId: "feishu",
    name: "Feishu/Lark",
    description: "Workplace chats and collaboration tools.",
    packageName: "@openclaw/feishu",
    iconDomain: "feishu.cn",
  },
  {
    id: "slack",
    runtimeId: "slack",
    name: "Slack",
    description: "Channels, DMs, commands, and app events.",
    packageName: "@openclaw/slack",
    iconDomain: "slack.com",
  },
  {
    id: "msteams",
    runtimeId: "msteams",
    name: "Microsoft Teams",
    description: "Meetings and team chat for agents.",
    packageName: "@openclaw/msteams",
    iconDomain: "teams.microsoft.com",
  },
  {
    id: "brave",
    runtimeId: "brave",
    name: "Brave Search",
    description: "Brave Search provider for web lookup.",
    packageName: "@openclaw/brave-plugin",
    iconDomain: "brave.com",
  },
  {
    id: "googlechat",
    runtimeId: "googlechat",
    name: "Google Chat",
    description: "Spaces and direct messages on Google Chat.",
    packageName: "@openclaw/googlechat",
    iconDomain: "chat.google.com",
  },
  {
    id: "google-meet",
    runtimeId: "google-meet",
    name: "Google Meet",
    description: "Join calls through Chrome or phone transports.",
    packageName: "@openclaw/google-meet",
    iconDomain: "meet.google.com",
  },
  {
    id: "parallel",
    runtimeId: "parallel-plugin",
    name: "Parallel",
    description: "Parallel web search for research workflows.",
    packageName: "@openclaw/parallel-plugin",
    iconDomain: "parallel.ai",
  },
  {
    id: "perplexity",
    runtimeId: "perplexity-plugin",
    name: "Perplexity",
    description: "Perplexity-powered web answers.",
    packageName: "@openclaw/perplexity-plugin",
    iconDomain: "perplexity.ai",
  },
  {
    id: "exa",
    runtimeId: "exa-plugin",
    name: "Exa",
    description: "Neural web search for agent research.",
    packageName: "@openclaw/exa-plugin",
    iconDomain: "exa.ai",
  },
  {
    id: "firecrawl",
    runtimeId: "firecrawl-plugin",
    name: "Firecrawl",
    description: "Crawl and extract web pages for agents.",
    packageName: "@openclaw/firecrawl-plugin",
    iconDomain: "firecrawl.dev",
  },
  {
    id: "scraperapi",
    runtimeId: "scraperapi-skills",
    name: "ScraperAPI",
    description: "ScraperAPI skills for large-scale extraction.",
    packageName: "@scraperapitech/scraperapi-skills",
    iconDomain: "scraperapi.com",
  },
  {
    id: "diagnostics-prometheus",
    runtimeId: "diagnostics-prometheus",
    name: "Prometheus",
    description: "Runtime metrics for observability dashboards.",
    packageName: "@openclaw/diagnostics-prometheus",
    iconDomain: "prometheus.io",
  },
  {
    id: "amazon-bedrock",
    runtimeId: "amazon-bedrock-provider",
    name: "Amazon Bedrock",
    description: "Bedrock models, embeddings, and guardrails.",
    packageName: "@openclaw/amazon-bedrock-provider",
    iconDomain: "aws.amazon.com",
  },
  {
    id: "cloudflare-gateway",
    runtimeId: "cloudflare-ai-gateway-provider",
    name: "Cloudflare AI Gateway",
    description: "Model routing through Cloudflare AI Gateway.",
    packageName: "@openclaw/cloudflare-ai-gateway-provider",
    iconDomain: "cloudflare.com",
  },
  {
    id: "groq",
    runtimeId: "groq-provider",
    name: "Groq",
    description: "Groq media-understanding provider.",
    packageName: "@openclaw/groq-provider",
    iconDomain: "groq.com",
  },
  {
    id: "deepinfra",
    runtimeId: "deepinfra-provider",
    name: "DeepInfra",
    description: "DeepInfra model provider for OpenClaw.",
    packageName: "@openclaw/deepinfra-provider",
    iconDomain: "deepinfra.com",
  },
  {
    id: "cerebras",
    runtimeId: "cerebras-provider",
    name: "Cerebras",
    description: "Cerebras model provider for OpenClaw.",
    packageName: "@openclaw/cerebras-provider",
    iconDomain: "cerebras.ai",
  },
  {
    id: "qwen",
    runtimeId: "qwen-provider",
    name: "Qwen Cloud",
    description: "Qwen Cloud provider for OpenClaw.",
    packageName: "@openclaw/qwen-provider",
    iconDomain: "qwen.ai",
  },
  {
    id: "llama-cpp",
    runtimeId: "llama-cpp-provider",
    name: "llama.cpp",
    description: "Local embedding provider through llama.cpp.",
    packageName: "@openclaw/llama-cpp-provider",
    iconDomain: "github.com",
  },
  {
    id: "apple-pim",
    runtimeId: "apple-pim",
    name: "Apple PIM",
    description: "Calendar, Reminders, Contacts, and Mail on macOS.",
    packageName: "apple-pim-cli",
    iconDomain: "apple.com",
  },
  {
    id: "gmail-plugin",
    runtimeId: "gmail",
    name: "Gmail",
    description: "Search mailboxes, threads, and attachments.",
    packageName: "@manuelfedele/openclaw-gmail-plugin",
    iconDomain: "mail.google.com",
  },
];

function homeAppIconUrl(iconDomain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(iconDomain)}&sz=128`;
}

function homeLocalIconUrl(id: string) {
  return id in HOME_APP_ICON_PATHS
    ? HOME_APP_ICON_PATHS[id as keyof typeof HOME_APP_ICON_PATHS]
    : undefined;
}

export function homeSkillAppIconUrl(app: HomeSkillApp) {
  return homeLocalIconUrl(app.id) ?? homeAppIconUrl(app.iconDomain);
}

export function homePluginShortcutIconUrl(shortcut: HomePluginShortcut) {
  return homeLocalIconUrl(shortcut.id) ?? homeAppIconUrl(shortcut.iconDomain);
}

export const SKILLS_BROWSE_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;
